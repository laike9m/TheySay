# TheySay UI 迁移至 Mantine 架构规划 (Mantine Migration Plan)

本文档定义了将 **TheySay** 桌面端 UI 从原生 Vanilla JS + 手写 CSS 渐进式迁移至 **React + [Mantine](https://mantine.dev/)** 组件库的完整工程方案。

---

## 1. 背景与选型理由

### 1.1 现状分析
- **运行时架构**：Electron 桌面应用（`nodeIntegration: true`, `contextIsolation: false`），渲染进程使用 CommonJS 模块体系（`renderer.js`、`src/core/`、`src/data/`、`src/ui/`）。
- **UI 现状**：单文件 `index.html` + `styles.css`（约 3,300 行）+ 原生 DOM 命令式操作。
- **核心约束**：
  1. **高密度网格性能**：支持最高 `4×4`（16 个并发监控槽位）的实时信息流渲染。
  2. **GridStack 深度集成**：槽位拖拽、尺寸调整与列悬停展开直接操作 `.grid-stack-item` DOM 节点，且拖拽时必须保持各槽位滚动条位置不丢失。
  3. **Twitter 预渲染机制**：推文详情浮层在关闭态不能卸载或设为 `display: none`（宽度为 0 会导致 Twitter `widgets.js` 无法在后台计算卡片高度）。
  4. **动态主题与配色变量**：深浅色切换（`data-theme`）、自定义卡片标题栏背景色（`--slot-header-bg` 等对比度派生变量）与美股 Ticker 高亮配色（`--ticker-fg-color` / `--ticker-bg-color`）。

### 1.2 为什么选择 Mantine (v7/v8)
1. **原生 CSS 变量与零运行时开销**：Mantine 采用静态 CSS + CSS Custom Properties（`data-mantine-color-scheme="dark|light"`），无 Emotion 等 CSS-in-JS 运行时性能损耗，且与现有的 `--slot-header-*` / `--ticker-*` CSS 变量天然兼容。
2. **桌面级高密度组件完备**：原生提供 `<NativeSelect>`、`<NumberInput>`、`<ColorSwatch>`、`<ColorInput>`、`<Menu>`、`<Switch>`、`<Badge>`、`<Indicator>`、`<Modal>`、`<ActionIcon>` 以及可在 React 树外直接调用的 `@mantine/notifications`。
3. **平滑的渐进式迁移能力**：可通过 `esbuild` 打包 React + Mantine 渲染模块供 Electron CommonJS 渲染进程直接加载，保持 `src/core/`、`src/data/` 及 Playwright 集成测试中的 `require()` 调用路径 100% 兼容。

---

## 2. 分阶段迁移路线图 (Phased Roadmap)

### 第一阶段 (Step 1)：基础架构搭建与外围 App Shell 迁移（已完成）
**目标**：保持 `src/core/` 与 `src/data/` 抓取/存储逻辑不变，引入 React 19 + Mantine + Tabler Icons + `esbuild` 构建管线，将**外围全局 UI** 全面迁移为 React + Mantine 组件：
1. **工程与样式基建**：
   - 引入 `react`、`react-dom`、`@mantine/core`、`@mantine/hooks`、`@mantine/notifications`、`@tabler/icons-react` 与 `esbuild`。
   - 配置 `MantineProvider` 并与 `src/ui/theme.js` 的 `data-theme` / `data-mantine-color-scheme` 双向同步。
   - 在 `package.json` 的 `files` 与脚本中集成 UI 构建产物（`src/ui/dist/mantine-shell.js`），确保 `npm start`、`npm test` 与 `electron-builder` 打包开箱即用。
2. **全局通知系统 (`@mantine/notifications`)**：
   - 挂载 `<Notifications />` 容器，升级 `src/core/utils.js` 中的 `showToast()` 以驱动 Mantine Notification 卡片渲染。
3. **顶部全局导航栏 (`TopNav`)**：
   - 使用 Mantine `<Group>`、`<Button>`、`<NativeSelect>`、`<Switch>`、`<ActionIcon>`、`<Divider>`、`<Menu>` / `<Popover>`、`<Badge>` 重构顶部工具栏与账号/Profile 管理下拉菜单（对接 `src/ui/auth.js`）。
4. **登录过期持久横幅 (`AuthExpiredBanner`)**：
   - 使用 Mantine `<Alert>` / `<Group>` / `<Button>` 重构顶部平台登录过期常驻警告条（对接 `src/ui/auth.js`）。
5. **偏好设置弹窗 (`SettingsModal`)**：
   - 使用 Mantine `<Modal>` / `<Paper>`、`<NativeSelect>`、`<NumberInput>`、`<ColorSwatch>`、`<TextInput>`、`<Button>` 重构偏好设置弹窗（对接 `src/ui/settings.js`），保留实时卡片预览与在线美股词库同步能力。
6. **测试迁移与验证**：
   - 更新并扩展 `tests/integration.spec.js`，验证 Mantine Shell 挂载、主题同步、表单交互、国际化切换及全部 15+ 项端到端集成测试通过。

---

### 第二阶段 (Step 2)：监控槽位卡片 (Slot Card) 与消息时间线组件化（已完成）
**目标**：将 `src/ui/slot.js` 中的 16 个监控槽位内部 UI 迁移至 React + Mantine 组件，同时保持 GridStack 拖拽与滚动位置零回退：
1. **GridStack + React 子树同步挂载桥接**：
   - 由 GridStack 管理外层 `.grid-stack-item` 容器的坐标（`gs-x`, `gs-y`, `gs-w`, `gs-h`）与拖拽句柄（`.slot-drag-handle`）。
   - 使用 `createRoot` + `flushSync` 将每个槽位的 React `<SlotCard />` 挂载至对应的 `.grid-stack-item-content` 容器内，确保 GridStack 移动节点时 React 组件状态与 DOM 滚动条（`scrollTop`）完全保留。
2. **槽位 Header 与操作栏 Mantine 化**：
   - 使用 Mantine `<Paper>`、`<Box>`、`<Badge>`（未读计数）、`<ActionIcon>`（静音开关、尺寸展开、清空输入）与 `<UnstyledButton>`（卡片尺寸切换菜单项与双平台同名账号选择下拉框）构建槽位头部与菜单。
3. **消息气泡流与媒体网格组件化**：
   - 将推文、Threads 与 Discord 消息气泡拆分为 `<PostTimeline />`、`<PostBubble />`、`<DateDivider />`、`<MediaGrid />` 与 `<SlotExpiredBanner />` React + Mantine 组件，完整保留行末二分自适应展开（`expandBubbleLastLine`）与左右对半分栏缩略图排版。

---

### 第三阶段 (Step 3)：详情悬浮弹窗 (Popup Modal) 迁移与样式收尾（已完成）
**目标**：完成 `src/ui/popup.js` 迁移并整合 Mantine 弹窗详情卡片体系：
1. **详情弹窗容器与加载指示器 Mantine 化 (`PostPopupOverlay`)**：
   - 在 `#mantine-modals-root` 中挂载常驻 `<PostPopupOverlay />`（基于 Mantine `<Box>`、`<Paper>` 与 `<Loader>`），关闭态通过 `.is-closed` 保持非零宽度 DOM 布局以支持 Twitter `widgets.js` 后台预渲染嵌入卡片且不触发 iframe 重载。
2. **三平台本地零延迟详情卡片与多图画廊组件化**：
   - 拆分为 `<TwitterFallbackCard />`（离线/仅会员/同分钟合并推文详情卡片）、`<DiscordPopupCard />`（Discord 频道消息详情卡片）、`<ThreadsPopupCard />`（Threads 帖子详情与引用卡片）以及 `<PopupImageGallery />`（支持单图/多图画廊与 Discord CDN 备用域名自动重试），全部使用 Mantine `<Paper>`、`<Box>`、`<Badge>`、`<UnstyledButton>` 驱动渲染。
3. **样式整合与全量验证**：
   - 统一 Mantine 组件样式映射，并通过全部 15 项 Playwright 端到端集成测试验证。

---

## 3. 组件目录结构规范 (Component Directory Structure)

按职责将 UI 组件拆分为独立模块存放于 `src/ui/components/` 下，避免单文件膨胀：

```text
src/ui/
├── mantine-shell.jsx                        # 渲染挂载入口 (MantineProvider + Notifications + Slot/Popup 挂载桥接)
└── components/
    ├── theme.js                             # Mantine createTheme 配置与配色预设常量
    ├── ColorSchemeSync.jsx                  # data-theme <-> data-mantine-color-scheme 双向同步组件
    ├── icons/
    │   └── PlatformIcons.jsx                # 品牌 Logo 与 Discord 等平台专属图标组件
    ├── nav/
    │   ├── TopNav.jsx                       # 顶部全局导航栏 (全部已读、网格布局选择、深浅色切换、设置按钮)
    │   ├── LoginDropdownMenu.jsx            # 登录账号管理与 Profile 导入/导出下拉菜单
    │   └── AuthExpiredBanner.jsx            # 顶部登录过期常驻警告横幅与 Toast 容器
    ├── settings/
    │   ├── SettingsModal.jsx                # 偏好设置弹窗主容器 (Header / Body / Footer)
    │   ├── GeneralSettingsSection.jsx       # 通用设置分组 (语言、三平台轮询周期、仅会员、声音、图标角标)
    │   ├── AppearanceSettingsSection.jsx    # 外观设置分组 (Title 栏配色、Ticker 配色、实时预览卡片、词库同步)
    │   └── BackupSettingsSection.jsx        # 备份设置分组 (Profile 导入与导出)
    ├── slot/
    │   ├── SlotCard.jsx                     # 监控槽位外层卡片容器 (Mantine Paper + Loader + 空状态/错误态)
    │   ├── SlotHeader.jsx                   # 紧凑型 28px 标题栏 (头像、身份徽章、输入框、静音/尺寸按钮)
    │   ├── SlotIcons.jsx                    # 槽位铃铛静音与网格尺寸方向 Tabler 图标组件
    │   ├── SlotSourceDropdown.jsx           # 双平台同名账号选择下拉菜单 (Twitter / Threads)
    │   ├── SlotSizeMenu.jsx                 # 卡片占用空间调整与清空频道下拉菜单 (1×1 / 2×1 / 3×1 / 2×2)
    │   ├── SlotExpiredBanner.jsx            # 单槽位底部登录过期常驻提示条与一键重登入口
    │   ├── MediaGrid.jsx                    # 消息气泡内单图/多图自适应缩略图网格与 Discord CDN 容错
    │   └── PostBubble.jsx                   # 消息时间线 (PostTimeline)、日期分割胶囊 (DateDivider) 与消息气泡 (PostBubble)
    └── popup/
        ├── PostPopupOverlay.jsx             # 居中推文/消息详情悬浮遮罩与预渲染宿主容器 (Mantine Paper + Loader)
        ├── PopupImageGallery.jsx            # 详情弹窗内单图/多图高清画廊与 Discord CDN 容错
        ├── TwitterFallbackCard.jsx          # Twitter 离线/仅会员/同分钟合并推文 Mantine 详情卡片
        ├── DiscordPopupCard.jsx             # Discord 频道消息本地零延迟 Mantine 详情卡片
        └── ThreadsPopupCard.jsx             # Threads 帖子与引用内容本地零延迟 Mantine 详情卡片
```
