# TheySay - Twitter / X Tweet Fetcher (Electron App)

[English](README.md) | [中文说明](docs/README_zh.md)

A dynamic, drag-and-drop parallel Twitter / X monitoring dashboard built with Electron and [GridStack.js](https://gridstackjs.com/):
- **Dark Mode / Light Mode**: One-click theme toggle in the header with persistent state.
- **Flexible 2×2 to 4×4 Grid Layouts**: Switch seamlessly between `2×2`, `2×3`, `3×2`, `3×3`, and `4×4` presets, strictly matching slot counts without lingering artifacts.
- **Card Header with Avatar & Name (Removed Redundant Status Bar)**: Header height slimmed to 34px, displays user avatar, name, handle, and tweet count in a single line. Click on the name anytime to switch to editing the handle. Completely eliminates the second sub-bar to maximize vertical space for tweets.
- **Hidden Scrollbars by Default**: Card scrollbars remain invisible by default and gently fade in on hover, keeping the UI minimal and clean.
- **Multi-Size Expansion Options (`rows × columns`: `1×1`, `2×1 vertical double`, `3×1 vertical triple`, `2×2 spotlight square`)**: Strictly follows the row-first, column-second convention.
- **Surrounding Content Conflict Protection**: Prevents accidental displacement of active cards. Alerts you with visual red shaking and prompts when adjacent slots already contain monitored accounts.
- **Input, Avatar & Layout Persistence**: Handles, avatars, cached tweets, and custom grid arrangements are saved in real time to `localStorage`. Refreshing (<kbd>Cmd + R</kbd>) preserves your entire workspace.
- **On-Demand Webviews & macOS Engine Error Fixes**: Dynamically allocates background webviews as needed to reduce memory usage and silences macOS-specific Chromium `task_policy_set` / Mojo noise.

## Getting Started

Run in project root:

```bash
npm install
npm start
```

## Features

1. **Theme Switcher & Clean Header with Avatar & Name**:
   - Integrated dark mode / light mode toggle button (☀️/🌙) in the navigation bar.
   - Ultra-compact card headers (~34px) with unnecessary card numbers and separate status bars removed, maximizing vertical viewport for tweets.
   - Profile avatar and real name shown side-by-side in header with click-to-edit support and local cache.
   - Scrollbars hidden by default, revealing smoothly upon hover.
2. **GridStack Drag-and-Drop & Multi-Size Options**:
   - Powered by GridStack.js: rearrange cards by dragging the header handle (`⠿`).
   - Size Options Menu: Choose between `1×1` (default), `2×1` (2 rows × 1 col, vertical double), `3×1` (3 rows × 1 col, vertical triple), and `2×2` (2 rows × 2 cols, spotlight square), or clear the card with one click.
   - Collision Protection: Checks if target area is occupied by slots with active content. Displays a warning toast and shakes conflicting cards in red if occupied.
   - Layout Selector: Switch between `2×2`, `2×3`, `3×2`, `3×3`, and `4×4` grid presets with strict slot synchronization, or click "Reset Layout" to align.
3. **Handle, Avatar & Cache Persistence**:
   - Real-time `localStorage` persistence for Twitter handles, avatars, cached tweets, and custom grid coordinates.
   - Reloading with <kbd>Cmd + R</kbd> retains your cards, sizes, avatars, and tweets.
4. **On-Demand Parallel Scraping & Clean Logs**:
   - Background webviews are loaded lazily on demand instead of spawning 16 processes at launch.
   - Silences macOS Chromium kernel policy and Mojo widget warnings on terminal output.
   - Global **"Fetch All in Parallel"** button with staggered jitter delays.
5. **Human-like Anti-Bot Jitter & Challenge Detection**:
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
