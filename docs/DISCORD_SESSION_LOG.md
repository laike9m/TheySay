# Discord 登录与会话状态排查记录

## 2026-10-27 根因定位：为什么 Discord 登录总是无故掉线？

### 1. 现象与 LevelDB 证据
通过对 `~/Library/Application Support/TheySay/Partitions/discord_session/Local Storage/leveldb/015346.log` 的 WriteBatch 逐条解码发现：
- 用户在登录窗口登录 `example_user` (`100000000000000001`) 后，Discord 正常写入了 `PUT token`、`PUT tokens` 以及 `MultiAccountStore`（其中 `tokenStatus: 2`）。
- 随后每当后台 `#discord-bg-webview` 加载 Discord 频道时，仅几百毫秒后 LevelDB 中就会出现：
  - `DEL _https://discord.com\x00\x01token`
  - `DEL _https://discord.com\x00\x01tokens`
- 当应用退出、重启或刷新导致后台 webview 销毁时，由于 `localStorage` 中的 `token` 与 `tokens` 已被删除，下一次启动或导航时 Discord 发现 `localStorage.getItem('token') === null`，便将 `MultiAccountStore` 中的账号标记为 `tokenStatus: 0`（Invalid）并重定向至 `/login`。
- 将 LevelDB 日志中残留的原始 Token 直接请求 `https://discord.com/api/v9/users/@me` 返回 `200 OK`——证明 **Token 根本没有被 Discord 服务端吊销，而是被客户端自己在本地删掉了**。

### 2. 真正根因：Discord Web 端的反 Self-XSS DevTools 尺寸检测器
逆向 Discord Web 客户端 bundle (`/assets/web.33a8a649a2fda558.js` 中的模块 `247775` 与 `class eo`) 发现：
1. Discord 每 `500ms` 执行一次窗口尺寸差检测，用于判断用户是否打开了停靠在侧边或底部的 Chrome DevTools：
   ```js
   let e = window.outerWidth - window.innerWidth > 160;
   let t = window.outerHeight - window.innerHeight > 160;
   if (!(t && e) && (e || t)) {
     // 判定 DevTools 打开，触发反 Self-XSS 保护：
     TokenManager.hideToken();
   }
   ```
2. `TokenManager.hideToken()` 的实现直接调用了：
   ```js
   localStorage.removeItem('token');
   localStorage.removeItem('tokens');
   ```
   Discord 的设计意图是：当用户打开 DevTools 时把 `localStorage` 里的 `token` 删掉（只保留在内存变量里），防止用户在 Console 被骗输入偷 Token 的脚本，等页面正常触发 `beforeunload` 时再调用 `showToken()` 写回 `localStorage`。
3. **为什么在 TheySay 后台 `<webview>` 中被 100% 误触发？**
   - 在 Electron `<webview>` 中，`window.innerWidth` / `window.innerHeight` 是 `<webview>` 容器自身的 CSS 宽高（原先 `.background-webviews-container` 固定写死为 `1280 x 900`）。
   - 而 `<webview>` 内的 `window.outerWidth` / `window.outerHeight` 返回的是宿主 `mainWindow` 的外框尺寸！
   - 当用户将 TheySay 主窗口拉高或调整尺寸（例如 `window-state.json` 中记录的 `1360 x 1079`）时：
     - `window.outerWidth - window.innerWidth` = `1360 - 1280 = 80` (`<= 160`, `false`)
     - `window.outerHeight - window.innerHeight` = `1079 - 900 = 179` (`> 160`, `true`!)
   - `(e || t) && !(t && e)` 恒为 `true`！Discord 每 `500ms` 都误以为用户打开了底部停靠的 DevTools，立即调用 `hideToken()` 将磁盘 `localStorage` 中的 `token` 和 `tokens` 抹除。一旦应用关闭、重启或重置 `<webview>`，`beforeunload` 来不及落盘，登录态即永久丢失。

### 3. MultiAccountStore `tokenStatus` 枚举值勘误
Discord 模块 `274303` 中定义的枚举为：
- `tokenStatus: 2` (`VALID`) — **正常有效**
- `tokenStatus: 1` (`VALIDATING`) — **验证中**
- `tokenStatus: 0` (`INVALID`) — **已失效**（当启动时 `token` 缺失被踢回 `/login` 时会被置为 `0`）

> 注：早期排查文档将 `0` 和 `2` 的含义写反了，特此更正。

### 4. 永久修复方案（四重防护）
1. **CSS 容器尺寸对齐 (`styles.css`)**：
   将 `.background-webviews-container` 从固定 `1280px x 900px` 改为 `width: 100vw; height: 100vh;`，使后台 `<webview>` 的 `innerWidth`/`innerHeight` 始终与 `mainWindow` 保持一致（`outerWidth - innerWidth = 0`，`outerHeight - innerHeight = 28 <= 160`），从物理尺寸上消除误判。
2. **Preload 级防护与同步恢复 (`src/data/discord-preload.js`)**：
   在 `persist:discord_session` 注册 preload 脚本，在 Discord bundle 执行前：
   - 在 Main World 中将 `window.outerWidth` / `window.outerHeight` 代理为 `window.innerWidth` / `window.innerHeight`；
   - 拦截 `Storage.prototype.removeItem('token' | 'tokens')`（非用户主动重登时禁止删除 Token）；
   - 若检测到 `localStorage` 中 `token` 缺失，立即在页面脚本启动前从备份中同步写回 `token`、`tokens`、`user_id_cache` 及 `MultiAccountStore` (`tokenStatus: 2`)。
3. **主进程持久化备份与 LevelDB 自动打捞 (`main.js`)**：
   - 自动将有效 Discord Token 备份在 `preferences.json` (`discordAuthBackup`) 中，并支持从 `Partitions/discord_session/Local Storage/leveldb/*.log|*.ldb` 自动扫描打捞历史有效 Token；
   - 通过 `https://discord.com/api/v9/users/@me` 校验证书有效性，并在退出前调用 `flushStorageData()` 确保 LevelDB 完整落盘。
4. **启动与抓取自愈 (`src/ui/auth.js` & `src/data/discord.js`)**：
   - 应用启动时 `checkDiscordLoginStatus()` 自动校验并恢复被误标为过期的 Discord 会话；
   - `ensureDiscordChannel()` 若遇到 `/login`，会先尝试注入已验证的备份 Token 并重载频道，不再盲目抹除会话。
