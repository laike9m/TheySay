# TheySay

**TheySay** is a multi-column desktop dashboard for monitoring multiple Twitter / X accounts, Threads profiles, and Discord channels side by side in real time.  
**TheySay** 是一款多栏桌面监控看板，支持在网格布局中同时实时追踪多个 Twitter / X 账号、Threads 账号与 Discord 频道。

![TheySay Dashboard Screenshot](docs/screenshot.png)

## Features / 功能介绍

- **Multi-Platform Grid Dashboard & Smart Handle Search**: Monitor Twitter / X accounts, Threads profiles, and Discord channels (public or private) side by side in a drag-and-drop, resizable grid. Enter any handle to automatically search both Twitter / X and Threads—if the handle exists on both platforms, a dropdown lets you choose which one to track; if it exists on only one, scraping starts automatically.  
  **多平台网格看板与智能账号检索**：支持在可自由拖拽、调整尺寸的网格中并排监控多个 Twitter / X 博主、Threads 账号与 Discord 频道（含私有频道）。输入普通用户名时会自动检索 Twitter / X 与 Threads：若两边均有该账号则弹出下拉框供选择，若仅一侧存在则自动开始抓取。

- **Telegram-Style Feed & Popup Reader**: Read updates in clean chronological chat bubbles (web links automatically resolve and display their webpage title instead of raw URLs; consecutive Discord messages from the same sender within the same minute are automatically merged into a single bubble separated by `.` or `。` and shown in full without truncation, while Twitter and Threads posts remain individual bubbles with 100-character truncation; posts with images expand to full slot width with text on the left and compact height-matched thumbnails on the right; hovering over a card's feed area automatically hides its header bar to reveal any obscured content at the top, and moving to the top header area brings it right back), and click any post to expand the current section in the background while viewing the full text, quoted posts, or high-resolution images in a centered popup.  
  **Telegram 风格对话流与弹窗阅读**：以清爽的对话气泡按时间流展示最新消息（消息中的网页长链接会自动解析并展示网页标题而非原始 URL；Discord 同一发送者在同一分钟内的连续消息会自动按中英文以 `。` 或 `.` 分隔合并为一条气泡并完整展示全文，而 Twitter 与 Threads 帖子保持独立气泡展示并按 100 字截断；含图消息自动占满卡片宽度，左侧显示文字、右侧显示与气泡等高的小缩略图；光标移入板块下方消息内容区时会自动隐藏顶部标题栏以展示被遮挡的内容，移至顶部标题栏区域即刻恢复显示），点击任意气泡即可在后台自动展开当前板块的同时居中弹出详情卡片阅读全文、引用内容或查看高清大图。

- **Smart Stock & ETF Ticker Highlighting & Keyword / Multi-Word Phrase Filtering**: Automatically detects and highlights US stock, ETF, and crypto tickers (with or without `$`) with customizable badge colors and NASDAQ symbol sync, and lets you configure filter keywords or multi-word phrases (e.g. `"crypto giveaway"`, `"limited time offer"`) in Settings so matching posts across Twitter / X, Threads, and Discord are directly discarded and never displayed, counted as unread, or notified.  
  **股票与 ETF 代码智能高亮及关键词 / 多词短语屏蔽过滤**：自动识别并高亮消息中的美股、ETF 及加密货币代码（无论是否带 `$` 前缀），支持自定义配色与 NASDAQ 词库在线同步；同时支持在设置中添加屏蔽关键词或包含空格的多词短语（如 `"crypto giveaway"`、`"limited time offer"`），命中任意关键词或短语的帖子将被直接丢弃不显示，也不计入未读角标或触发通知。

- **Unread Tracking & Per-Channel Notifications**: Highlights new messages with per-slot unread count badges, keeps the OS app / Dock icon badge synchronized with the total unread count across active slots (can be toggled on or off in Settings, and automatically clears when all messages are read), and lets you toggle desktop notifications independently for each account or channel.  
  **未读提醒与按频道独立通知**：自动高亮新消息并显示栏目未读计数角标，同时支持在设置中控制是否将系统 Dock / 任务栏应用图标角标与当前看板的实际未读总数实时同步（全部已读或关闭该选项时自动清零消除），并支持为每个账号或频道单独开启桌面系统通知。

- **Custom Auto-Refresh, Login Expiration Alerts, Discord Session Self-Healing & Profile Backup**: Set independent background refresh intervals for Twitter, Threads, and Discord, receive prominent persistent top-banner and per-slot alerts when a previously logged-in session expires (strictly distinguished from initial unlogged-in use) with one-click re-login and instant resume, keep Discord sessions persistently protected against background WebView token eviction with automatic token backup and self-healing recovery, and export or import your entire layout, settings, and followed list as a `.json` profile anytime.  
  **独立自动刷新、登录过期强提示、Discord 会话防掉线自愈与 Profile 备份**：支持分别为 Twitter、Threads 与 Discord 设置后台刷新频率；当已登录过的平台会话过期时，在页面顶部及对应卡片内展示持久醒目的过期警告与一键重登入口（严格区分初次使用的未登录状态，重登后提示自动消失并立即恢复抓取）；内置 Discord 会话防误删保护与 Token 持久化自愈恢复机制；同时可将全部排版、设置与关注列表一键导出/导入为 `.json` 备份文件。

- **Bilingual Interface (English & Chinese)**: Automatically adapts to your system language (defaults to English unless your system is set to Simplified or Traditional Chinese), with instant language switching in Settings.  
  **中英双语界面**：自动根据系统语言切换界面语言（系统为简/繁体中文时默认显示中文，其他语言环境默认显示英文），并支持在设置中随时手动切换。

- **Mantine UI + GridStack Desktop Architecture**: Built with Electron, React 19, [Mantine v8](https://mantine.dev/), Tabler Icons, and GridStack—combining a collapsible Mantine left sidebar, a TradingView-inspired borderless multi-panel layout with inline legend headers, customizable header, chat background, and message bubble colors, a unified dark/light theme (`Paper`, `Button`, `ActionIcon`, `CloseButton`, `Badge`, `ThemeIcon`, `Avatar`, `TextInput`, `NativeSelect`, `Tooltip`, and `Notifications`), slot cards, timeline bubbles, and popup reader modals with smooth drag-and-drop grid resizing and background Twitter widget pre-rendering.  
  **Mantine UI + GridStack 桌面架构**：基于 Electron、React 19、[Mantine v8](https://mantine.dev/)、Tabler Icons 与 GridStack 构建，提供支持一键展开/收起的可折叠 Mantine 左侧导航栏、TradingView 风格的无边框内联图例标题栏与多面板网格布局、可自由定制的标题栏/聊天背景/消息气泡配色，并将统一风格的 Mantine 原生组件体系与深浅色主题（`Paper`、`Button`、`ActionIcon`、`CloseButton`、`Badge`、`ThemeIcon`、`Avatar`、`TextInput`、`NativeSelect`、`Tooltip` 与 `Notifications`）、监控槽位卡片、消息气泡流及详情弹窗组件同丝滑的网格拖拽缩放与 Twitter 嵌入卡片后台预渲染深度融合。
