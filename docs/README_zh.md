# TheySay - Twitter / X 推文抓取器 (Electron App)

[English](../README.md) | [中文说明](README_zh.md)

基于 Electron 与 [GridStack.js](https://gridstackjs.com/) 构建的动态可拖拽 Twitter / X 多账号推文看板：
- **支持 2×2 到 4×4 灵活网格切换**：支持在 `2×2`、`2×3`、`3×2`、`3×3`、`4×4` 间自由无缝切换。
- **自由拖拽卡片排版**：按住卡片顶部的拖拽把手（`⠿`）即可随意调换卡片位置，打造专属布局。
- **增大重点关注账号空间**：点击卡片右上角放大按钮（`⤢`）或直接拖动卡片右下角，即可将重要账号一键扩大为 2×2 聚光灯大卡片，其余账号自适应紧凑排列。
- **排版与输入持久化保存**：Twitter handle、已抓取的推文缓存以及自定义拖拽后的网格坐标均实时存入 `localStorage`，刷新应用（<kbd>Cmd + R</kbd>）原样完整还原。
- **真正并发后台静默抓取**：底层内置最多 16 个后台离屏 Webview 实例，共享同一登录态，支持一键全部并发抓取。

## 运行方法

在项目根目录下执行：

```bash
npm install
npm start
```

## 功能特点

1. **GridStack 动态网格与拖拽缩放**：
   - 拖拽卡片：按住顶栏把手 `⠿` 即可自由拖动卡片重新排序；
   - 重点关注放大：点击每张卡片右上角的 `⤢` 按钮即可切换为 2×2 焦点大卡片，或直接拖拽右下角拉伸缩放大小；
   - 预设切换：顶部下拉菜单可快速切换 `2×2`、`2×3`、`3×2`、`3×3`、`4×4` 网格，并提供“重置排版”一键对齐。
2. **Handle、缓存与布局持久化**：
   - 每次输入与排版调整自动实时保存，刷新页面（<kbd>Cmd + R</kbd>）保留所有状态。
3. **多 Webview 并行并发**：
   - 支持最多 16 个后台并发离屏 Webview，独立滚动抓取，支持顶部“全部并行抓取”。
4. **拟人化随机延迟与防风控感知**：
   - **错峰启动**：一键并行抓取时按 `200ms ~ 450ms` 阶梯随机错峰，消除机械式的突发流量峰值；
   - **随机平滑滚动**：每次动态滚动 `650px ~ 1050px`，并加入平滑滚动动画；
   - **阅读停顿模拟**：滚动后模拟人眼停留阅读 `300ms ~ 600ms`；
   - **风控主动识别**：自动感知 Arkose Labs 人机验证挑战或 Rate limit 限制，提供即时指引。

## 参考资料与防爬机制解析

关于 Twitter / X 的反爬虫风控模型与限制机制：
- [Scrapfly: How to Scrape Twitter (X.com) Data - Rotating Guards, Rate Limits, and Pacing](https://scrapfly.io/blog/how-to-scrape-twitter/)（系统解析了 Twitter 隐式 GraphQL API、Guest Token 轮转以及限频策略）
- [X API: 官方 Rate Limits 速率限制说明](https://developer.x.com/en/docs/x-api/rate-limits)（官方关于接口访问频次的阈值标准）
- [Arkose Labs: MatchKey / FunCAPTCHA 人机识别技术原理](https://www.arkoselabs.com/)（Twitter 核心采用的防自动化验证系统）
