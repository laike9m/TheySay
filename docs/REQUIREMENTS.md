# TheySay - Technical Requirements & Documentation

A dynamic, drag-and-drop parallel Twitter / X, Threads, and Discord monitoring dashboard built with Electron and [GridStack.js](https://gridstackjs.com/):
- **Unified "登录账号" (Login Accounts) Dropdown Menu & Profile Export/Import**: Consolidates Twitter / X, Threads, and Discord accounts into a single, clean dropdown in the top navigation bar. Displays real-time status badges (Logged In / Logged Out / Checking) for each platform with an overall status indicator dot, launches dedicated login/account-switch windows on click, and provides quick **Export Profile (`导出 Profile`)** and **Import Profile (`导入 Profile`)** actions.
- **Full Profile Backup (All Settings + Followed Accounts) & Non-Destructive Account Switching**: Export your complete profile to a `.json` file (via the top-right "登录账号" menu or the Settings modal), including all preferences (theme, grid preset & card layout/sizes, Twitter, Threads & Discord refresh intervals, member-only filter, Discord sound toggle, card title bar color, chat background color, message bubble color, ticker highlight colors, and per-slot mute states) as well as all followed Twitter handles, Threads profiles, and Discord channels. **Switching accounts never clears already-scraped data** — whether you switch the logged-in Twitter/Threads/Discord account, change a card's monitored handle/channel, edit the handle input, or import a profile, all previously scraped tweets, Threads posts, and Discord messages are permanently preserved in a per-target cache (`theysay_target_cache`) and instantly restored when switching back.
- **Settings Modal & Independent Platform Refresh Rates**: A gear button next to the login account dropdown opens a centralized preferences modal dialog. Configure background auto-refresh frequencies separately for Twitter / X, Threads, and Discord with preset options (30s, 1m, 2m, 3m, 5m, 10m, 15m, 30m, 1h) or custom minute intervals, complete with anti-rate-limit safety hints, restore defaults, and live scheduler reload.
- **Threads Data Source Support (`threads.com` / `threads.net`)**: Monitor any Threads account by entering a full URL (`https://www.threads.com/@handle` or `https://www.threads.net/@handle`) or shorthand (`threads:@handle`, `threads:handle`, `threads/handle`, `@handle@threads.net`). Supports public profile scraping out of the box plus an optional isolated login session (`persist:threads_session`) via **Accounts → Threads**, inline media previews, pinned/repost/quote detection, stock ticker highlighting, OS notifications, and a zero-latency local Threads post detail modal.
- **Member-Only (Super Follows) Tweet Badging & Display Filter**: Automatically detects creator subscription / subscriber-only tweets on Twitter/X (such as posts requiring "Subscribe to unlock") and badges them with an amber `仅会员` (Member Only) tag in the timeline feed. In the Settings modal, a dedicated option "是否显示仅会员可见的帖子" (Show Member-Only Posts) allows users to toggle whether these exclusive posts are displayed or automatically filtered out, with live instant re-rendering of all active feeds.
- **Filter Keywords & Multi-Word Phrase Discard Filter**: Configure filter keywords and multi-word phrases (containing spaces, such as `"crypto giveaway"` or `"limited time offer"`) in the Settings modal (`#setting-filter-keywords-input`). Any post or message across Twitter / X, Threads, and Discord containing a configured keyword or multi-word phrase (case-insensitive, matching across normalized whitespace in body text, reply context, or attachment summaries) is directly discarded and never displayed, counted in unread badges, or notified.
- **Smart Ticker Highlighting with Customizable Foreground & Background Colors**: Automatically detects stock, ETF, and crypto tickers in Twitter, Threads, and Discord messages — supporting explicit `$TICKER` cashtags (e.g. `$ZETA`, `$nvda`) as well as uppercase and lowercase bare tickers (e.g. `SMTC`, `muu`, `mu`, `uctt`, `spcx`, `intc`) backed by a built-in and online-synced NASDAQ Stock & ETF dictionary (~9,600+ symbols, with common English words and options terms like `put`/`call` excluded). Renders matched tickers in bold with a badge background (`font-weight: 700`), and provides full foreground & background color pickers, 6 one-click color presets, and a real-time preview inside the Settings modal.
- **Discord Notification Sound Toggle**: The offscreen Discord client keeps playing Discord's own notification pings (DMs, @mentions, etc.) even though it runs unattended. A "Discord 通知声音" (Discord Notification Sound) option in the Settings modal mutes the background Discord webview at the audio level — it takes effect the moment you save, persists across restarts, and never affects message scraping.
- **Dark Mode / Light Mode Toggle, TradingView-Style Multi-Panel Layout & Customizable Card Title Bar, Chat Background & Bubble Colors**: Features a TradingView-inspired borderless multi-panel workspace (`radius="xs"` `4px` micro-rounded panels separated by `#e0e3eb` cool-gray gutters with `4px` horizontal and `6px` vertical section spacing, and a continuous top/bottom seam extending to the left edge above/below the sidebar). In the Settings modal (`外观` / Appearance), dedicated controls allow customizing **Card Title Bar Color (`Title 栏配色`)**, **Chat Background Color (`聊天背景配色`)**, and **Message Bubble Color (`消息气泡配色`)**, each with curated color presets, custom color picker + Hex input, automatic luminance-based text contrast adaptation, and live preview.
- **Telegram-Style Chat Bubble Feed with Date Dividers**: Replicates Telegram's clean aesthetics with centered capsule date dividers (e.g. `June 29, 2025`) displayed above each day's messages (with only one date pill per day). Chat bubbles hug content naturally with inline specific timestamps (`11:45 AM`) at the bottom right, status tags (`Pinned`, `Retweet`), removed message numbers, and a hover-revealed link button (`↗`) in the top-right corner.
- **100-Character Truncation & Pre-Rendered Frameless Embed Modal on Click**: Long tweets are automatically truncated to the first 100 characters by default to keep the feed tidy, while quote tweets are recognized with a purple "Quote" badge. Clicking on any tweet bubble opens a frameless modal displaying the official embedded Twitter/X post. Inside the embed popup, clicking **"Show more"** expands long `note_tweet` posts in-place with full text and entities instead of jumping to an external browser, and clicking or selecting the tweet text / card body no longer opens the browser — only clicking the top-right **𝕏** logo or the bottom **Read X replies** button opens the post in the external browser. Embeds are pre-rendered in the background — on idle after a feed loads, and at high priority the moment you hover a bubble — so the real card is already built before you click. Each tweet keeps its own persistent host element inside the modal that is revealed with a pure CSS toggle, so the iframe is never re-parented (which would force a reload) and there is no placeholder-to-card swap. Combined with Electron HTTP disk cache overrides (1-year immutable caching for static assets), reopening a tweet is instant. The popup closes seamlessly by clicking the surrounding backdrop area or pressing <kbd>Esc</kbd>.
- **TradingView-Style Borderless Inline Legend Header, Auto-Hide on Feed Hover & Per-Channel System Notification Mute Toggle (Default Muted)**: Header height slimmed to 28px with a borderless TradingView inline legend layout (no bottom border, no drag grip `⋮⋮`, and no `⤢` expand icon; default background seamlessly matches the chat background `#f8f9fd` / `#0f1723`), displaying user avatar (or clean `#`-free channel name for Discord), display name (with Twitter's `@id` hidden), grey-toned Tabler platform icons (`IconBrandX`, `IconBrandDiscord`, `IconBrandThreads`), unread badge, and capsule notification mute pill side by side. Hovering the message content area below a card's header smoothly hides the header bar to reveal any obscured messages underneath without shifting scroll position, while moving the cursor to the top header area restores it immediately for dragging or clicking controls. Click on the name anytime to switch to editing the handle and press <kbd>Enter</kbd> to fetch. Clicking the mute button toggles native OS system notifications for that specific Twitter account, Threads profile, or Discord channel when new posts arrive, and clicking a system notification brings the app window to focus and highlights the corresponding card.
- **Hidden Scrollbars by Default**: Card scrollbars remain invisible by default and gently fade in on hover, keeping the UI minimal and clean.
- **Multi-Size Expansion Options (`rows × columns`: `1×1`, `2×1 vertical double`, `3×1 vertical triple`, `2×2 spotlight square`)**: Strictly follows the row-first, column-second convention.
- **Smooth Column Focus (Post, Blank-Space & Edge Handle Click Height Expansion & Half-Height Squeeze)**: Clicking on a post bubble (which expands the current section in the background while opening the post detail popup), blank space (any non-message-bubble area inside a section's content viewport), or the edge resize handle area smoothly expands that section's height while squeezing the other sections in the same column to half of their original height (`0.5×`). Clicking blank space or the resize handle area in the expanded section again, staying in the same section for more than 20 seconds, or moving onto a section's header (the username bar) smoothly restores all sections in the column to their original heights.
- **Surrounding Content Conflict Protection**: Prevents accidental displacement of active cards. Alerts you with visual red shaking and prompts when adjacent slots already contain monitored accounts.
- **Smart Incremental Scraping**: Avoids redundant fetching! Remembers previously fetched tweets, stops scrolling immediately upon hitting known timeline boundaries, and completes in ~1s if there are no new tweets, minimizing network traffic and rate limit triggers.
- **Input, Avatar, Mute State, Layout & Window Bounds Persistence**: Handles, avatars, per-channel mute preferences, cached tweets, and custom grid arrangements are saved in real time to `localStorage`, while the main window's size, position, and fullscreen/maximized state are automatically persisted to `window-state.json` in `userData` across restarts.
- **Unread Tweet Highlighting, Per-Card Blue Unread Count Badge & One-Click "Mark All as Read"**: Newly scraped tweet, Threads, and Discord bubbles are highlighted with a distinct soft blue tint, and a Twitter-blue circular unread count badge appears right next to each user/channel name in the card header. Hovering over any bubble decrements the badge in real time, clicking a card's blue badge marks that card's messages as read, and the double-checkmark ("✓✓") "Mark All as Read" button in the top navbar clears all unread states with one click.
- **Default Background Polling (10-Minute Interval) & Timestamp Tracking**: Tracks and records the exact timestamp of every fetch with card header tooltip display. Refreshing the page (<kbd>Cmd + R</kbd>) never triggers an immediate scrape, instead scheduling the next crawl strictly based on elapsed time since the last fetch.

## Getting Started

Run in project root:

```bash
npm install
npm start
```

Run Electron integration tests (Playwright; also executed automatically on `windows-latest` via GitHub Actions):

```bash
npm test
```

### Building Distributable Packages (macOS / Windows / Linux — All Directly on Mac)

```bash
# Build all 3 platforms (macOS arm64 + Windows x64 + Linux x64) with Apple notarization
npm run dist:all

# Build all 3 platforms quickly (macOS Developer ID signed, skips Apple notary wait)
npm run dist:all:quick

# Or build each platform individually on Mac:
npm run dist:mac        # macOS arm64 (.dmg & .zip — Developer ID signed + notarized + stapled)
npm run dist:mac:quick  # macOS arm64 (.dmg & .zip — Developer ID signed, skips notarization)
npm run dist:win        # Windows x64 (NSIS installer .exe & portable .exe)
npm run dist:linux      # Linux x64 (.AppImage & .deb)
```

## Features

1. **Telegram-Style Chat Bubbles & Date Dividers**:
   - Replicates Telegram's clean message bubble aesthetics: left-aligned, width hugs text length (up to 88% max-width for text-only posts), no message numbers, and inline specific timestamps (`11:45 AM`) positioned at the bottom right. For posts containing images, the bubble expands to 100% of the slot width and splits into two sides: text and timestamp on the left, and compact height-matched image thumbnails on the right so the bubble's original height is preserved.
   - Date Divider Pills: Displays a centered translucent capsule date divider (e.g., `June 29, 2025`) above each day's group of tweets, with only one date header shown per calendar day.
   - Natural IM timeline order: sorted chronologically from top to bottom (oldest to newest), with the latest post at the bottom and auto-scrolling to the newest message upon load.
   - Hovering over any bubble reveals an external browser link (`↗`) in the top-right corner to open the original tweet.
   - Truncated Tweets (>100 characters) & Quoted Tweets: Instead of expanding inline and shifting subsequent messages, clicking on any tweet bubble triggers a centered modal popup embedding the complete, original Twitter/X post in a clean, frameless view. Within the embedded card, clicking **"Show more"** expands long tweets in-place, text can be freely clicked or selected without opening a browser tab, and only the top-right **𝕏** icon or bottom **Read X replies** action button opens the tweet externally. Hover triggers are omitted to prevent accidental popups. Clicking anywhere on the surrounding backdrop or pressing <kbd>Esc</kbd> cleanly closes the popup.
2. **Theme Switcher, Customizable Card Title Bar Colors & Per-Channel System Notification Mute Button**:
   - Animated pill toggle switch with sun/moon icons in the navigation bar to easily switch between dark and light themes.
   - Customizable Card Title Bar (`Title 栏背景配色`) in Settings with 6 one-click presets (Deep Navy, Classic Royal Blue, Warm Linen, Fresh Mint, Soft Lavender, Warm Apricot), custom color picker, automatic foreground contrast calculation, and live preview.
   - Ultra-compact card headers (~28px) with unnecessary card numbers and separate status bars removed, maximizing vertical viewport for tweets.
   - Profile avatar and real name shown side-by-side in header with click-to-edit support and local cache.
   - Replaces the manual refresh button with a per-channel **Mute / Unmute toggle button** (default **Muted**). Unmute any specific Twitter account, Threads profile, or Discord channel to receive native macOS system notifications when new posts or messages arrive; clicking a notification focuses TheySay and scrolls to the card.
   - Scrollbars hidden by default, revealing smoothly upon hover.
3. **Smart Incremental Scraping (Zero Redundant Fetches)**:
   - Compares incoming tweets with cached tweets on the fly.
   - Halts scrolling as soon as it hits the previously fetched boundary.
   - Gathers only brand-new tweets and prepends them, completing in ~1s if no new posts were published.
4. **GridStack Drag-and-Drop, Multi-Size Options & Smooth Column Focus**:
   - Powered by GridStack.js: rearrange cards by dragging the header handle (`⠿`).
   - Size Options Menu: Choose between `1×1` (default), `2×1` (2 rows × 1 col, vertical double), `3×1` (3 rows × 1 col, vertical triple), and `2×2` (2 rows × 2 cols, spotlight square), or clear the card with one click.
   - Smooth Column Focus: Clicking a post bubble (in the background while opening the popup), blank space, or the edge resize handle area inside a section smoothly increases its vertical height while squeezing the other sections in the same column to half their original height; clicking blank space or the resize handle area again, staying in the same section for > 20s, or moving the cursor to a section's header (the username bar) smoothly restores normal heights.
   - Collision Protection: Checks if target area is occupied by slots with active content. Displays a warning toast and shakes conflicting cards in red if occupied.
   - Layout Selector: Switch seamlessly between `2×2`, `2×3`, `3×2`, `3×3`, and `4×4` grid presets with strict slot synchronization.
5. **Discord Channel Monitoring (Public & Private Channels) & Threads Profile Monitoring**:
   - Monitor any Discord channel alongside your Twitter and Threads feeds by pasting its full URL (e.g. `https://discord.com/channels/100000000000000001/200000000000000002`), or monitor any Threads user via `https://www.threads.com/@handle`, `https://www.threads.net/@handle`, or `threads:@handle`.
   - Card input automatically detects Discord channel links and Threads URLs/handles, updating the prefix and header display accordingly.
   - **Private Channels & Dedicated Login**: Accessible via the "登录账号" dropdown menu in the top navigation bar with persistent session partitions (`persist:discord_session` and `persist:threads_session`).
   - **Telegram-Style Group Chat Aesthetics & Inline Image Previews**: Renders chat messages with per-author colored names, collapses consecutive messages from the same sender, displays quoted reply context (`↩ author: text`), embeds inline image previews (single image or multi-image grid) directly inside chat bubbles, and summarizes non-image attachments/media with neat badge chips.
   - **Click-to-Expand Modal with Full-Size Images & Clickable Links**: Clicking any Discord or Threads bubble opens a centered message detail modal displaying the full text with clickable inline URLs (opening in system browser), high-resolution images (clickable to open original in browser), author info, reply/quote context, and attachment summary, with a button to jump directly to the original post.
   - **Shared Offscreen Client, Smart Channel Switching & Strict State Verification**: Runs an offscreen background Discord webview with seamless in-app switching for same-server channels and verified target loading across different servers, preserving gateway connection and saving memory. Employs strict channel/message ID validation and cache self-healing to prevent DOM desync and cross-channel message contamination.
   - **Notification Sound Toggle**: Set "Discord 通知声音" to "关闭 (静音)" in Settings to silence every sound the background client makes (the webview's guest WebContents is muted via `setAudioMuted`). Applied instantly on save and re-applied whenever the client reloads; defaults to on.
6. **Profile Export/Import, Non-Destructive Account Switching & Persistence**:
   - **One-Click Profile Export & Import**: Export all settings (theme, grid preset, card positions/sizes, refresh intervals, member-only filter, Discord sound, header & ticker colors, per-slot notification mute states) and all followed Twitter accounts, Threads profiles, and Discord channels into a single JSON file, and import it anytime from either the "登录账号" menu or Settings modal.
   - **Never Lose Scraped Data on Account Switch**: Scraped tweets, Threads posts, and Discord messages are indexed in a persistent per-target cache (`theysay_target_cache`) by handle/channel in addition to slot cache. Switching the monitored handle in a card, clicking the input clear (`✕`) button while editing, switching logged-in accounts, or importing another Profile preserves all previously scraped data and immediately restores cached messages when switching back.
   - Automatically saves and restores the Electron app window's dimensions (`width`, `height`), position (`x`, `y`), and fullscreen/maximized state across restarts (`window-state.json` in `userData`), with multi-display boundary validation.
   - Reloading with <kbd>Cmd + R</kbd> or restarting the app retains your window size, cards, sizes, mute states, avatars, tweets, Threads posts, and Discord channel feeds.
7. **Independent Background Polling & Refresh Rate Settings (Twitter, Threads & Discord)**:
   - Dedicated Settings modal accessed via the top-bar gear button (`⚙️`) allows configuring Twitter / X, Threads, and Discord refresh frequencies separately.
   - Preset options (`30s`, `1m`, `2m`, `3m`, `5m`, `10m`, `15m`, `30m`, `1h`) plus custom minute intervals with built-in validation and anti-bot rate-limit guidance.
   - Saves preferences instantly to `localStorage` and hot-reloads the polling schedulers without requiring an application restart.
   - Accurately records timestamps for every fetch, displaying the last fetch time on card header tooltips (e.g. `上次抓取: 15:09:23`).
   - Page refreshes (<kbd>Cmd + R</kbd>) never trigger immediate scrapes; the app calculates remaining time from the recorded last fetch before scheduling the next crawl.
   - Executes queries sequentially one by one with gentle pauses, eliminating high-concurrency bursts and reducing rate limiting risks.
   - Automatically checks network and DNS reachability (`navigator.onLine` + DNS lookup) before fetching, skipping background crawls cleanly when the Mac is asleep or offline.
   - Background webviews are loaded lazily on demand instead of spawning 16 processes at launch.
   - Silences macOS Chromium kernel policy and Mojo widget warnings on terminal output.
8. **Member-Only (Super Follows) Tweet Badging & Visibility Settings**:
   - **Intelligent Detection**: Identifies creator subscription posts via unlock URLs (`/superfollows/subscribe`), unlock button labels, and localized subscriber phrases (`Subscribe to unlock` / `订阅以解锁`).
   - **Distinctive Feed Badging**: Renders an amber `仅会员` tag on member-only tweet bubbles, clearly distinguishing them from public tweets, pinned posts, retweets, and quote tweets.
   - **Preference Toggle & Dynamic Filtering**: In the Settings modal, configure "是否显示仅会员可见的帖子" (Show Member-Only Posts) to either show them or automatically filter them out.
   - **Hot Reload**: Changing and saving the setting immediately re-renders all active cards without requiring a reload or re-scrape. If all posts in a feed are member-only and hidden, a clear informative notice is displayed.
   - **Instant Detail Modal**: Clicking a member-only tweet bubble opens a specialized message modal immediately with a "仅会员可见" notice and external browser link, bypassing third-party embed timeouts.
9. **Ticker Highlighting & Custom Color Themes**:
   - **Three-Tier Case-Insensitive Detection**: Recognizes `$TICKER` cashtags (e.g., `$ZETA`, `$nvda`), unambiguous US stock & ETF symbols in upper or lowercase (`SMTC`, `muu`, `mu`, `uctt`, `spcx`, `intc`), and context-aware symbols (`coin`, `hood`, `spy`) while excluding ordinary English words, options terms (`put`, `call`), URLs, and user handles.
   - **Permanent Local Dictionary + On-Demand NASDAQ API Sync**: Ships with 9,600+ pre-filtered US Stock & ETF symbols in `data/ticker-data.json` and permanently persists any newly synced symbols from the live NASDAQ Stock & ETF Screener APIs (`api.nasdaq.com`) without expiration.
   - **Selectable Foreground & Background Colors**: Choose from 6 curated presets (Amber Gold, Highlighter Yellow, Bullish Emerald, Cyber Blue, Neon Purple, Crimson) or pick any custom foreground text color and background color with a live preview in Settings.
10. **Human-like Anti-Bot Jitter & Challenge Detection**:
    - **Polite Inter-Slot Pacing**: Sequential background polling pauses between accounts to avoid machine-like traffic bursts.
    - **Randomized Smooth Scrolling**: Dynamic scroll distance (`650px ~ 1050px`) with smooth behavior.
    - **Reading Pauses**: Injects `300ms ~ 600ms` scan pauses after scrolling to emulate human eye reading time.
    - **Challenge Detection**: Automatically detects Arkose Labs FunCAPTCHAs and HTTP 429 rate limits, notifying you immediately with guidance.

## Project Structure

```
TheySay/
├── .github/workflows/
│   └── windows-integration.yml # GitHub Actions CI workflow for Windows Electron integration tests
├── assets/
│   ├── icon.icns       # macOS application icon bundle
│   ├── icon.png        # High-resolution (1024x1024) application icon
│   └── icon.svg        # Master vector icon (macOS squircle dark theme & brand waves)
├── build/
│   └── entitlements.mac.plist # macOS Hardened Runtime entitlements for Developer ID signing & notarization
├── data/
│   └── ticker-data.json# Permanently persisted US Stock & ETF symbol dictionary & word filter list
├── docs/
│   └── REQUIREMENTS.md # Technical requirements, build instructions & architecture documentation
├── scripts/
│   ├── brand-app.js    # macOS app bundle branding (name, bundle ID, icon & path synchronization)
│   └── notarize-mac.js # macOS DMG notarization & ticket stapling via 'notarize-app' keychain profile
├── src/
│   ├── auth.js         # Twitter, Threads & Discord login status check & IPC dialogs
│   ├── constants.js    # Layout limits, storage keys, partition names & polling intervals
│   ├── discord.js      # Discord shared webview client, SPA navigation & message scraper
│   ├── grid.js         # GridStack layout management & resize collision checks
│   ├── notification.js # Per-channel OS system notification dispatcher & click handler
│   ├── popup.js        # Centered tweet embed modal & Threads/Discord message detail modal
│   ├── scraper.js      # Fetch dispatcher & periodic background polling crawler
│   ├── settings.js     # Preferences modal (refresh intervals, member-only filter, ticker colors, Discord sound)
│   ├── slot.js         # Card component UI, avatars, mute toggle, interactions & feed message bubbles
│   ├── source.js       # Source detection & URL parsing (Twitter handle vs Threads profile vs Discord channel)
│   ├── storage.js      # LocalStorage persistence layer (handles, mute state, ticker settings, cache, auth flags)
│   ├── theme.js        # Dark/light theme state management
│   ├── threads.js      # Offscreen Threads profile scraper & DOM post extractor
│   ├── ticker.js       # Case-insensitive ticker highlighter, CSS color manager & NASDAQ API sync
│   ├── tweet-embed-frame.html # Local same-origin Twitter embed frame host for click control & Show more expansion
│   ├── tweet_embed.js  # In-place "Show more" expander & restricted external link click controller for tweet embeds
│   ├── tweet.js        # Snowflake & ISO timestamp parsing, deduplication & sorting
│   ├── utils.js        # Jitter, delay, string escaping & toast notifications
│   └── webview.js      # Offscreen webview pool lifecycle & navigation
├── tests/
│   └── integration.spec.js # Playwright Electron end-to-end integration test suite
├── index.html          # Main application window layout
├── main.js             # Electron main process (multi-partition sessions, login windows, notifications, NASDAQ API)
├── package.json        # Project metadata and run scripts
├── playwright.config.js# Playwright test runner configuration
├── renderer.js         # Main renderer process orchestrator
├── styles.css          # App styling (themes, layout, animations, ticker badges, Discord/Threads chat bubbles)
└── README.md           # User-facing bilingual product overview
```

## References & Anti-Bot Mechanics

For background on Twitter/X bot detection, rate limits, and scraping defenses:
- [Scrapfly: How to Scrape Twitter (X.com) Data - Rotating Guards, Rate Limits, and Pacing](https://scrapfly.io/blog/how-to-scrape-twitter/)
- [X API: Official Rate Limits Documentation](https://developer.x.com/en/docs/x-api/rate-limits)
- [Arkose Labs: How MatchKey / FunCAPTCHA Detects Automation](https://www.arkoselabs.com/)
