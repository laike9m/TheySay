# Discord 登录与会话状态排查记录

## 最近登录记录 (Latest Login Event)

- **登录时间**：`2026-10-26 17:03:15 PDT` (UTC `2026-10-27 00:03:15`)
- **登录账号 (Account)**：
  - **Username**：`laike9m`
  - **User ID**：`100000000000000001`
  - **Discriminator**：`0`
  - **Token Status**：`0` (Valid / 正常有效)
- **存储分区路径 (Partition)**：
  - `~/Library/Application Support/TheySay/Partitions/discord_session`
- **关键 Cookie 与持久化项**：
  - `discord.com`: `__dcfduid`, `__sdcfduid`, `dbind`, `cf_clearance` (有效至 2027 年)
  - `.discord.gg`: `__cf_bm`
  - `Local Storage/leveldb`: `MultiAccountStore` 已写入，`token` 已就绪

---

## 掉线/过期排查关键检查点 (Troubleshooting Checkpoints)

若后续再次出现「Discord 登录已过期」提示，可快速按以下顺序核验：

### 1. 验证 LocalStorage 中 Token 是否仍有效
在终端执行：
```bash
strings ~/Library/Application\ Support/TheySay/Partitions/discord_session/Local\ Storage/leveldb/* | grep -B 2 -A 5 "laike9m"
```
- 如果显示 `"tokenStatus": 0`：说明本地 Token 仍然有效，并未被 Discord 服务端吊销。
- 如果显示 `"tokenStatus": 2`：说明 Token 已被 Discord 服务端失效（如密码修改、2FA 刷新或风控登出）。

### 2. 检查是否有卡片配置了无权限/失效的频道链接
当前配置中的 Discord 频道链接示例：
- `https://discord.com/channels/100000000000000001/200000000000000002`

**排查方法**：
- 如果账号 `laike9m` 未加入该服务器，或者该频道被删除/移出权限，后台 Webview 在加载该 URL 时会被 Discord 自动重定向至 `/login`，触发 TheySay 的 `probe.state === 'login'` 误判为全局会话过期。
- 若发生误判，可先在浏览器中确认该账号是否能在 Web 版 Discord 中直接访问该频道。

### 3. 避免在已登录状态下二次点击菜单
- 在已登录状态下点击登录菜单中的 Discord 项会触发 `wasLoggedIn: true` 清空逻辑，将已有会话抹除。
