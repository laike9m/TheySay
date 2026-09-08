# TheySay - Twitter / X Tweet Fetcher (Electron App)

[English](README.md) | [中文说明](docs/README_zh.md)

A 4-panel parallel Twitter / X monitoring dashboard built with Electron:
- **4-Panel Multi-Account Grid**: The screen is split into 4 independent slots (2x2 grid). Each slot can track a distinct Twitter handle and display its latest tweets with dedicated scrollbars.
- **Input Persistence**: Twitter handles entered in all 4 slots are automatically saved to `localStorage`. Refreshing the app (<kbd>Cmd + R</kbd>) preserves all input handles and cached tweets.
- **Parallel Background Scraping**: Each slot runs its own offscreen webview instance in the background. Slots can be scraped individually or all 4 at the same time concurrently via **"Fetch All in Parallel"**.
- **Popup Login**: A dedicated login status button in the top navigation opens an isolated pop-up window for Twitter/X login. Once logged in, the session is shared across all 4 background scrapers and persists across restarts.

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

1. **4-Panel Grid Dashboard**:
   - 2x2 grid layout designed for monitoring multiple Twitter/X accounts side-by-side.
   - Each slot has its own handle input, fetch button, author banner, and a scrollable tweet viewport.
   - Global **"Fetch All in Parallel"** button triggers concurrent fetching across all 4 slots.
2. **Handle & Cache Persistence**:
   - Automatically saves input handles to `localStorage` in real time. Refreshing the app retains your configuration.
   - Restores previously fetched tweets upon startup/reload.
3. **True Parallel Background Scraping**:
   - Uses 4 dedicated offscreen webviews sharing the `persist:x_session` partition.
   - All 4 slots can load, scroll, and extract tweets simultaneously without blocking each other.
   - Each tweet card displays index `#1-#5`, pinned & retweet badges, timestamp, text, copy button, and "Open in Browser ↗".

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

## Documentation

- [中文文档 (Chinese Documentation)](docs/README_zh.md)
