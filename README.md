# TheySay

**TheySay** is a multi-column desktop dashboard for monitoring multiple Twitter / X accounts, Threads profiles, and Discord channels side by side in real time.  
**TheySay** 是一款多栏桌面监控看板，支持在网格布局中同时实时追踪多个 Twitter / X 账号、Threads 账号与 Discord 频道。

## Features / 功能介绍

- **Multi-Platform Grid Dashboard & Smart Handle Search**: Monitor Twitter / X accounts, Threads profiles, and Discord channels (public or private) side by side in a drag-and-drop, resizable grid. Enter any handle to automatically search both Twitter / X and Threads—if the handle exists on both platforms, a dropdown lets you choose which one to track; if it exists on only one, scraping starts automatically.  
  **多平台网格看板与智能账号检索**：支持在可自由拖拽、调整尺寸的网格中并排监控多个 Twitter / X 博主、Threads 账号与 Discord 频道（含私有频道）。输入普通用户名时会自动检索 Twitter / X 与 Threads：若两边均有该账号则弹出下拉框供选择，若仅一侧存在则自动开始抓取。

- **Telegram-Style Feed & Popup Reader**: Read updates in clean chronological chat bubbles (consecutive messages sent within the same minute are automatically merged into a single bubble separated by `.` or `。` and shown in full without truncation; posts with images expand to full slot width with text on the left and compact height-matched thumbnails on the right; hovering over a card's feed area automatically hides its header bar to reveal any obscured content at the top, and moving to the top header area brings it right back), and click any post to view the full text, quoted posts, or high-resolution images in a centered popup.  
  **Telegram 风格对话流与弹窗阅读**：以清爽的对话气泡按时间流展示最新消息（同一分钟内的连续消息会自动按中英文以 `。` 或 `.` 分隔合并为一条气泡并完整展示全文，不作字数截断；含图消息自动占满卡片宽度，左侧显示文字、右侧显示与气泡等高的小缩略图；光标移入板块下方消息内容区时会自动隐藏顶部标题栏以展示被遮挡的内容，移至顶部标题栏区域即刻恢复显示），点击任意气泡即可居中弹出详情卡片阅读全文、引用内容或查看高清大图。

- **Smart Stock & ETF Ticker Highlighting**: Automatically detects and highlights US stock, ETF, and crypto tickers (with or without `$`) with customizable badge colors and NASDAQ symbol sync.  
  **股票与 ETF 代码智能高亮**：自动识别并高亮消息中的美股、ETF 及加密货币代码（无论是否带 `$` 前缀），支持自定义配色与 NASDAQ 词库在线同步。

- **Unread Tracking & Per-Channel Notifications**: Highlights new messages with unread count badges and lets you toggle desktop notifications independently for each account or channel.  
  **未读提醒与按频道独立通知**：自动高亮新消息并显示未读计数角标，支持为每个账号或频道单独开启桌面系统通知。

- **Custom Auto-Refresh, Login Expiration Alerts & Profile Backup**: Set independent background refresh intervals for Twitter, Threads, and Discord, receive prominent persistent top-banner and per-slot alerts when a previously logged-in session expires (strictly distinguished from initial unlogged-in use) with one-click re-login and instant resume, and export or import your entire layout, settings, and followed list as a `.json` profile anytime.  
  **独立自动刷新、登录过期强提示与 Profile 备份**：支持分别为 Twitter、Threads 与 Discord 设置后台刷新频率；当已登录过的平台会话过期时，在页面顶部及对应卡片内展示持久醒目的过期警告与一键重登入口（严格区分初次使用的未登录状态，重登后提示自动消失并立即恢复抓取）；同时可将全部排版、设置与关注列表一键导出/导入为 `.json` 备份文件。

- **Bilingual Interface (English & Chinese)**: Automatically adapts to your system language (defaults to English unless your system is set to Simplified or Traditional Chinese), with instant language switching in Settings.  
  **中英双语界面**：自动根据系统语言切换界面语言（系统为简/繁体中文时默认显示中文，其他语言环境默认显示英文），并支持在设置中随时手动切换。

