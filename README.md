# TheySay - Twitter / X Tweet Fetcher (Electron App)

[English](README.md) | [中文说明](docs/README_zh.md)

A dynamic, drag-and-drop parallel Twitter / X monitoring dashboard built with Electron and [GridStack.js](https://gridstackjs.com/):
- **Flexible 2×2 to 4×4 Grid Layouts**: Switch seamlessly between `2×2`, `2×3`, `3×2`, `3×3`, and `4×4`.
- **Drag-and-Drop Organization**: Freely reorder, drag, and drop account monitoring cards to customize your dashboard layout.
- **Enlarge Priority Accounts**: Click the expand button (`⤢`) or drag the resize handle on any card to enlarge key accounts (e.g. 2×2 focus view) while keeping other cards compact.
- **Input & Layout Persistence**: Handles and customized grid arrangements are saved in real time to `localStorage`. Refreshing (<kbd>Cmd + R</kbd>) preserves your entire workspace.
- **True Parallel Background Scraping**: Powered by up to 16 offscreen webviews sharing the `persist:x_session` partition with human-like anti-bot jitter.

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- npm

### Installation & Launch

1. Install dependencies:
   ```bash
   npm install
   ```

2. Launch the application:
   ```bash
   npm start
   ```

## Features

1. **GridStack Drag-and-Drop & Resizing**:
   - Powered by GridStack.js: rearrange cards by dragging the header handle (`⠿`).
   - Priority Account Focus: Click the `⤢` button on any card to instantly expand it to a 2×2 spotlight card, or manually drag the bottom-right resize handle.
   - Layout Selector: Switch between `2×2`, `2×3`, `3×2`, `3×3`, and `4×4` grid presets at any time.
   - Click "Reset Layout" to neatly realign all cards.
2. **Handle & Cache Persistence**:
   - Real-time `localStorage` persistence for Twitter handles, cached tweets, and custom grid coordinates.
   - Reloading with <kbd>Cmd + R</kbd> retains your cards, sizes, and tweets.
3. **True Parallel Background Scraping**:
   - Up to 16 isolated background webview instances executing concurrently without interfering with each other.
   - Global **"Fetch All in Parallel"** button with staggered jitter delays.
4. **Human-like Anti-Bot Jitter & Challenge Detection**:
   - **Staggered Start**: Concurrent batch requests stagger by `200ms ~ 450ms` intervals to avoid machine-like traffic bursts.
   - **Randomized Smooth Scrolling**: Dynamic scroll distance (`650px ~ 1050px`) with smooth behavior.
   - **Reading Pauses**: Injects `300ms ~ 600ms` scan pauses after scrolling to emulate human eye reading time.
   - **Challenge Detection**: Automatically detects Arkose Labs FunCAPTCHAs and HTTP 429 rate limits, notifying you immediately with guidance.

## Project Structure

```
TheySay/
├── docs/
│   └── README_zh.md    # Chinese Documentation (中文文档)
├── index.html          # Main application window layout
├── main.js             # Electron main process
├── package.json        # Project metadata and run scripts
├── renderer.js         # UI logic and tweet extraction script
├── styles.css          # Dark-theme styling
└── README.md           # English Documentation
```

## References & Anti-Bot Mechanics

For background on Twitter/X bot detection, rate limits, and scraping defenses:
- [Scrapfly: How to Scrape Twitter (X.com) Data - Rotating Guards, Rate Limits, and Pacing](https://scrapfly.io/blog/how-to-scrape-twitter/)
- [X API: Official Rate Limits Documentation](https://developer.x.com/en/docs/x-api/rate-limits)
- [Arkose Labs: How MatchKey / FunCAPTCHA Detects Automation](https://www.arkoselabs.com/)

## Documentation

- [中文文档 (Chinese Documentation)](docs/README_zh.md)
