# TheySay - Twitter / X Tweet Fetcher (Electron App)

[English](README.md) | [中文说明](docs/README_zh.md)

A dynamic, drag-and-drop parallel Twitter / X monitoring dashboard built with Electron and [GridStack.js](https://gridstackjs.com/):
- **Dark Mode / Light Mode Toggle Switch**: Header features a sleek, animated pill toggle switch with sun and moon icons to smoothly transition between dark and light themes, automatically persisting user preference.
- **Telegram-Style Chat Bubble Feed with Date Dividers**: Replicates Telegram's clean aesthetics with centered capsule date dividers (e.g. `June 29, 2025`) displayed above each day's messages (with only one date pill per day). Chat bubbles hug content naturally with inline specific timestamps (`11:45 AM`) at the bottom right, status tags (`Pinned`, `Retweet`), removed message numbers, and a hover-revealed link button (`↗`) in the top-right corner.
- **Oldest-to-Newest Chronological Order (Chat Flow)**: Tweets flow naturally from top to bottom (oldest to newest, with the latest tweet at the bottom), automatically scrolling down like an IM chat window.
- **100-Character Truncation & Hover-to-Expand**: Long tweets are automatically truncated to the first 100 characters by default to keep the feed tidy. Hovering over any bubble automatically expands it to display full text, and unhovering neatly collapses it back.
- **Flexible 2×2 to 4×4 Grid Layouts**: Switch seamlessly between `2×2`, `2×3`, `3×2`, `3×3`, and `4×4` presets, strictly matching slot counts without lingering artifacts.
- **Card Header with Avatar & Name, Icon-Only Refresh Button**: Header height slimmed to 34px, displays user avatar (with handle-targeted HD profile extraction to prevent sidebar recommendation contamination), name, and handle in a clean line. Click on the name anytime to switch to editing the handle. Replaces text buttons with a sleek, textless icon refresh button that spins during fetching, eliminating redundant counters and copy buttons to keep the interface minimal.
- **Hidden Scrollbars by Default**: Card scrollbars remain invisible by default and gently fade in on hover, keeping the UI minimal and clean.
- **Multi-Size Expansion Options (`rows × columns`: `1×1`, `2×1 vertical double`, `3×1 vertical triple`, `2×2 spotlight square`)**: Strictly follows the row-first, column-second convention.
- **Surrounding Content Conflict Protection**: Prevents accidental displacement of active cards. Alerts you with visual red shaking and prompts when adjacent slots already contain monitored accounts.
- **Smart Incremental Scraping**: Avoids redundant fetching! Remembers previously fetched tweets, stops scrolling immediately upon hitting known timeline boundaries, and completes in ~1s if there are no new tweets, minimizing network traffic and rate limit triggers.
- **Input, Avatar & Layout Persistence**: Handles, avatars, cached tweets, and custom grid arrangements are saved in real time to `localStorage`. Refreshing (<kbd>Cmd + R</kbd>) preserves your entire workspace.
- **Unread Tweet Highlighting & One-Click "Mark All as Read"**: Newly scraped tweet bubbles are highlighted with a distinct soft blue tint. Hovering over any bubble instantly marks it as read and restores it to the default color. A double-checkmark ("✓✓") "Mark All as Read" button in the header marks all feed bubbles as read with one click, perfectly height-aligned with the grid layout selector.
- **Default Background Polling (10-Minute Interval) & Timestamp Tracking**: Tracks and records the exact timestamp of every fetch with card tooltip display. Refreshing the page (<kbd>Cmd + R</kbd>) never triggers an immediate scrape, instead scheduling the next crawl strictly based on elapsed time since the last fetch.

## Getting Started

Run in project root:

```bash
npm install
npm start
```

## Features

1. **Telegram-Style Chat Bubbles & Date Dividers**:
   - Replicates Telegram's clean message bubble aesthetics: left-aligned, width hugs text length (up to 88% max-width), no message numbers, and inline specific timestamps (`11:45 AM`) positioned at the bottom right.
   - Date Divider Pills: Displays a centered translucent capsule date divider (e.g., `June 29, 2025`) above each day's group of tweets, with only one date header shown per calendar day.
   - Natural IM timeline order: sorted chronologically from top to bottom (oldest to newest), with the latest post at the bottom and auto-scrolling to the newest message upon load.
   - Hovering over any bubble reveals an external browser link (`↗`) in the top-right corner to open the original tweet.
   - Long tweets automatically truncate to the first 100 characters with an ellipsis by default. Hovering over the bubble automatically expands it to full text, and moving the cursor away (unhover) neatly collapses it back.
2. **Theme Switcher & Clean Header with Avatar & Name**:
   - Animated pill toggle switch with sun/moon icons in the navigation bar to easily switch between dark and light themes.
   - Ultra-compact card headers (~34px) with unnecessary card numbers and separate status bars removed, maximizing vertical viewport for tweets.
   - Profile avatar and real name shown side-by-side in header with click-to-edit support and local cache.
   - Scrollbars hidden by default, revealing smoothly upon hover.
3. **Smart Incremental Scraping (Zero Redundant Fetches)**:
   - Compares incoming tweets with cached tweets on the fly.
   - Halts scrolling as soon as it hits the previously fetched boundary.
   - Gathers only brand-new tweets and prepends them, completing in ~1s if no new posts were published.
4. **GridStack Drag-and-Drop & Multi-Size Options**:
   - Powered by GridStack.js: rearrange cards by dragging the header handle (`⠿`).
   - Size Options Menu: Choose between `1×1` (default), `2×1` (2 rows × 1 col, vertical double), `3×1` (3 rows × 1 col, vertical triple), and `2×2` (2 rows × 2 cols, spotlight square), or clear the card with one click.
   - Collision Protection: Checks if target area is occupied by slots with active content. Displays a warning toast and shakes conflicting cards in red if occupied.
   - Layout Selector: Switch seamlessly between `2×2`, `2×3`, `3×2`, `3×3`, and `4×4` grid presets with strict slot synchronization.
5. **Handle, Avatar & Cache Persistence**:
   - Real-time `localStorage` persistence for Twitter handles, avatars, cached tweets, and custom grid coordinates.
   - Reloading with <kbd>Cmd + R</kbd> retains your cards, sizes, avatars, and tweets.
6. **Default Background Polling (10-Minute Cycle) & Accurate Timestamp Tracking**:
   - Accurately records timestamps for every fetch, displaying the last fetch time on card refresh button tooltips (e.g. `上次抓取: 15:09:23`).
   - Page refreshes (<kbd>Cmd + R</kbd>) never trigger immediate scrapes; the app calculates remaining time from the recorded last fetch before scheduling the next crawl.
   - Executes queries sequentially one by one with gentle pauses, eliminating high-concurrency bursts and reducing rate limiting risks.
   - Background webviews are loaded lazily on demand instead of spawning 16 processes at launch.
   - Silences macOS Chromium kernel policy and Mojo widget warnings on terminal output.
7. **Human-like Anti-Bot Jitter & Challenge Detection**:
   - **Polite Inter-Slot Pacing**: Sequential background polling pauses between accounts to avoid machine-like traffic bursts.
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
