const { STORAGE_LANGUAGE_KEY } = require('./constants');

const LANG_EN = 'en';
const LANG_ZH = 'zh';

/**
 * Returns true if the given locale string represents any variant of Chinese
 * (Simplified, Traditional, zh-CN, zh-TW, zh-HK, zh-MO, zh-SG, zh-Hans, zh-Hant, etc.).
 */
function isChineseLocale(localeStr) {
  if (!localeStr || typeof localeStr !== 'string') return false;
  const normalized = localeStr.trim().replace(/_/g, '-').toLowerCase();
  return (
    normalized === 'zh' ||
    normalized.startsWith('zh-') ||
    normalized === 'cmn' ||
    normalized.startsWith('cmn-') ||
    normalized === 'yue' ||
    normalized.startsWith('yue-') ||
    normalized === 'wuu' ||
    normalized.startsWith('wuu-')
  );
}

/**
 * Resolves a raw locale string or language code to 'zh' or 'en'.
 * Defaults to 'en' unless the locale is Chinese.
 */
function resolveLanguageCode(localeOrLang) {
  return isChineseLocale(localeOrLang) ? LANG_ZH : LANG_EN;
}

/**
 * Detects the default language ('zh' or 'en') from the user's system language settings.
 * Defaults to 'en' unless the primary system language is Chinese (Simplified, Traditional, etc.).
 */
function detectSystemLanguage() {
  try {
    if (typeof window !== 'undefined' && window.__THEYSAY_SYSTEM_LOCALE) {
      return resolveLanguageCode(window.__THEYSAY_SYSTEM_LOCALE);
    }
  } catch (_) {}

  try {
    if (typeof process !== 'undefined' && process && process.env) {
      if (process.env.THEYSAY_LOCALE) {
        return resolveLanguageCode(process.env.THEYSAY_LOCALE);
      }
      if (process.env.THEYSAY_SYSTEM_LOCALE) {
        return resolveLanguageCode(process.env.THEYSAY_SYSTEM_LOCALE);
      }
    }
  } catch (_) {}

  // Electron Main Process detection (when navigator is not used or app is available)
  try {
    const electron = require('electron');
    const app = electron && electron.app;
    if (app) {
      if (typeof app.getPreferredSystemLanguages === 'function') {
        const preferred = app.getPreferredSystemLanguages();
        if (Array.isArray(preferred) && preferred.length > 0 && preferred[0]) {
          return resolveLanguageCode(preferred[0]);
        }
      }
      if (typeof app.getSystemLocale === 'function') {
        const sysLoc = app.getSystemLocale();
        if (sysLoc) return resolveLanguageCode(sysLoc);
      }
      if (typeof app.getLocale === 'function') {
        const appLoc = app.getLocale();
        if (appLoc) return resolveLanguageCode(appLoc);
      }
    }
  } catch (_) {}

  // Browser / Renderer navigator detection
  try {
    if (typeof navigator !== 'undefined') {
      const navLang =
        (Array.isArray(navigator.languages) && navigator.languages.length > 0 && navigator.languages[0]) ||
        navigator.language ||
        '';
      if (navLang) {
        return resolveLanguageCode(navLang);
      }
    }
  } catch (_) {}

  // Intl fallback
  try {
    const intlLoc = Intl.DateTimeFormat().resolvedOptions().locale;
    if (intlLoc) {
      return resolveLanguageCode(intlLoc);
    }
  } catch (_) {}

  return LANG_EN;
}

let activeLanguageOverride = null;

function getCurrentLanguage() {
  if (activeLanguageOverride === LANG_EN || activeLanguageOverride === LANG_ZH) {
    return activeLanguageOverride;
  }
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_LANGUAGE_KEY);
      if (stored === LANG_EN || stored === LANG_ZH) {
        return stored;
      }
    }
  } catch (_) {}
  try {
    if (typeof process !== 'undefined' && process && process.env) {
      const savedEnv = process.env.THEYSAY_SAVED_LANGUAGE;
      if (savedEnv === LANG_EN || savedEnv === LANG_ZH) {
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_LANGUAGE_KEY, savedEnv);
          }
        } catch (_) {}
        return savedEnv;
      }
    }
  } catch (_) {}
  return detectSystemLanguage();
}

function setActiveLanguageOverride(lang) {
  if (lang === LANG_EN || lang === LANG_ZH) {
    activeLanguageOverride = lang;
  } else {
    activeLanguageOverride = null;
  }
}

const MESSAGES = {
  en: {
    // Window & App
    'app.windowTitle': 'TheySay - Follow What People Say',
    'app.mainWindowTitle': 'TheySay - Follow What People Say',
    'app.twitterLoginTitle': 'Log in to Twitter / X',
    'app.twitterReloginTitle': 'Switch or Re-login Twitter / X Account',
    'app.threadsLoginTitle': 'Log in to Threads',
    'app.threadsReloginTitle': 'Switch or Re-login Threads Account',
    'app.discordLoginTitle': 'Log in to Discord',
    'app.discordReloginTitle': 'Switch or Re-login Discord Account',
    'app.exportDialogTitle': 'Export TheySay Profile',
    'app.exportDialogButton': 'Export Profile',
    'app.importDialogTitle': 'Import TheySay Profile',
    'app.importDialogButton': 'Import Profile',
    'app.invalidProfileJson': 'Invalid Profile JSON file format',

    // Top Navigation
    'nav.markAllRead': 'Mark All Read',
    'nav.markAllReadTitle': 'Mark all messages as read',
    'nav.gridLayout': 'Layout:',
    'nav.switchToDark': 'Switch to dark mode',
    'nav.switchToLight': 'Switch to light mode',
    'nav.settings': 'Settings',
    'nav.loginMenu': 'Accounts',
    'nav.loginMenuTitle': 'Manage accounts',
    'nav.toggleSidebar': 'Toggle sidebar',

    // Auth & Profile Dropdown
    'auth.accountManagement': 'Account Management',
    'auth.checking': 'Checking...',
    'auth.loggedIn': 'Logged in',
    'auth.loggedOut': 'Logged out',
    'auth.expired': 'Session Expired',
    'auth.twitterCheckingTitle': 'Twitter / X: Checking login status',
    'auth.twitterLoggedInTitle': 'Twitter / X: Logged in (click to switch or re-login)',
    'auth.twitterLoggedOutTitle': 'Twitter / X: Logged out (click to log in)',
    'auth.twitterExpiredTitle': 'Twitter / X: Session expired (click to re-login)',
    'auth.threadsCheckingTitle': 'Threads: Checking login status',
    'auth.threadsLoggedInTitle': 'Threads: Logged in (click to switch or re-login)',
    'auth.threadsLoggedOutTitle': 'Threads: Logged out (click to log in)',
    'auth.threadsExpiredTitle': 'Threads: Session expired (click to re-login)',
    'auth.discordLoggedInTitle': 'Discord: Logged in (click to switch or re-login)',
    'auth.discordLoggedOutTitle': 'Discord: Logged out (click to log in for private channels)',
    'auth.discordExpiredTitle': 'Discord: Session expired (click to re-login)',
    'auth.expiredBannerText': '{platforms} login session has expired. New messages cannot be fetched until you re-login.',
    'auth.expiredBannerLoginBtn': 'Log in to {platform}',
    'auth.slotExpiredBannerText': '{platform} login expired — paused updating',
    'auth.slotExpiredLoginBtn': 'Re-login',
    'auth.profileSectionHeader': 'Profile & Following List',
    'auth.exportProfile': 'Export Profile',
    'auth.exportProfileTitle': 'Export all settings and followed accounts to a JSON file',
    'auth.importProfile': 'Import Profile',
    'auth.importProfileTitle': 'Import Profile from a JSON file (keeps cached messages)',
    'auth.importProfileHint': 'Restore',

    // Profile Export / Import Toasts
    'profile.exportSuccess': 'Profile exported (all settings & {count} followed items)',
    'profile.exportFailed': 'Failed to export Profile: {error}',
    'profile.exportError': 'Failed to export Profile: {error}',
    'profile.importSuccess': 'Profile imported (restored {count} followed items & all settings; cached data preserved)',
    'profile.importFailed': 'Failed to import Profile: {error}',
    'profile.importError': 'Failed to import Profile: {error}',
    'profile.unknownError': 'Unknown error',
    'profile.invalidFormat': 'Invalid file format',

    // Post / Threads / Discord Popup Modal
    'popup.dialogAriaLabel': 'Post details',
    'popup.loadingEmbed': 'Loading embedded post...',
    'popup.memberOnlyBadge': 'Subscribers Only',
    'popup.memberOnlyTag': 'Subscribers Only',
    'popup.memberOnlyNotice': 'This post is exclusive to subscribers',
    'popup.quoteBadge': 'Quoted Post',
    'popup.quoteTag': 'Quoted Post',
    'popup.viewQuotedPost': 'View quoted post ↗',
    'popup.openOnTwitter': 'Open on Twitter / X ↗',
    'popup.openOnThreads': 'Open on Threads ↗',
    'popup.openInDiscord': 'Open in Discord ↗',
    'popup.viewOriginalImage': 'Click to view original image in browser',
    'popup.viewOriginalImageTitle': 'Click to view original image in browser',
    'popup.imageAlt': 'Image',

    // Slot Cards
    'slot.dragTitle': 'Drag to move card',
    'slot.dragHandleTitle': 'Drag to move card',
    'slot.avatarTitle': 'Avatar',
    'slot.editAccountTitle': 'Click to edit account',
    'slot.clickEditAccount': 'Click to edit account',
    'slot.clickEditChannel': 'Click to edit channel',
    'slot.editHint': 'Edit',
    'slot.inputPlaceholder': 'Twitter / Threads handle or Discord URL',
    'slot.clearTitle': 'Clear',
    'slot.clearBtnTitle': 'Clear',
    'slot.muteMutedTitle': 'Notifications muted (click to enable for this channel)',
    'slot.mutedTitle': 'Notifications muted (click to enable for this channel)',
    'slot.muteUnmutedTitle': 'Notifications enabled (click to mute this channel)',
    'slot.unmutedTitle': 'Notifications enabled (click to mute this channel)',
    'slot.muteAriaLabel': 'Toggle channel notifications',
    'slot.expandDefaultTitle': 'Resize card (1×1, 2×1, 3×1, 2×2)',
    'slot.expandBtnTitle': 'Resize card (1×1, 2×1, 3×1, 2×2)',
    'slot.resizeCardTitle': 'Resize card (1×1, 2×1, 3×1, 2×2)',
    'slot.expandCurrentTitle': 'Current size: {r}×{c} (click to resize or reset)',
    'slot.currentSizeTitle': 'Current size: {r}×{c} (click to resize or reset)',
    'slot.placeholderText': 'Enter a handle or channel URL and press Enter',
    'slot.loadingDefault': 'Fetching in background...',
    'slot.loadingText': 'Fetching in background...',
    'slot.defaultChannelLabel': 'this channel',
    'slot.defaultChannelName': 'this channel',
    'slot.defaultDiscordChannel': '#channel',
    'slot.muteToastMuted': 'Muted notifications for {label}',
    'slot.toastMuted': 'Muted notifications for {label}',
    'slot.muteToastUnmuted': 'Enabled notifications for {label}',
    'slot.toastUnmuted': 'Enabled notifications for {label}',
    'slot.clickToEditChannel': 'click to edit channel',
    'slot.clickToEditAccount': 'click to edit account',
    'slot.lastFetchedTitle': '{name} · Last fetched: {timeStr} ({editHint})',
    'slot.noFetchedTitle': '{name} ({editHint})',
    'slot.unreadBadgeTitle': '{count} unread messages (click to mark slot as read)',
    'slot.unreadUnitSingular': 'message',
    'slot.unreadUnitPlural': 'messages',
    'slot.imageAlt': 'Image',
    'slot.tagPinned': 'Pinned',
    'slot.tagRepost': 'Repost',
    'slot.tagQuote': 'Quote',
    'slot.tagMember': 'Sub Only',
    'slot.tagMemberOnly': 'Sub Only',
    'slot.tagMemberTitle': 'Subscribers / members only',
    'slot.tagMemberOnlyTitle': 'Subscribers / members only',
    'slot.openDiscordLinkTitle': 'Open original message in browser / Discord',
    'slot.openOriginalDiscord': 'Open original message in browser / Discord',
    'slot.openThreadsLinkTitle': 'Open original post on Threads',
    'slot.openOriginalThreads': 'Open original post on Threads',
    'slot.openTwitterLinkTitle': 'Open original post in browser',
    'slot.openOriginalPost': 'Open original post in browser',
    'slot.filteredMemberNotice': 'Hidden {count} subscriber-only posts (can be enabled in Settings)',
    'slot.hiddenMemberPosts': 'Hidden {count} subscriber-only posts (can be enabled in Settings)',
    'slot.postUnitSingular': 'post',
    'slot.postUnitPlural': 'posts',
    'slot.clearedToast': 'Slot cleared (cached history is preserved)',
    'slot.toastCleared': 'Slot cleared (cached history is preserved)',
    'slot.sizeMenuTitle': 'Resize Card (Rows × Cols)',
    'slot.size1x1Desc': 'Default',
    'slot.size2x1Desc': '2 Rows Tall',
    'slot.size3x1Desc': '3 Rows Tall',
    'slot.size2x2Desc': '2×2 Large',
    'slot.sizeNeedRows': '(Needs ≥{r} rows)',
    'slot.needRows': '(Needs ≥{r} rows)',
    'slot.sizeNeedCols': '(Needs ≥{c} cols)',
    'slot.needCols': '(Needs ≥{c} cols)',
    'slot.clearSlotLabel': 'Clear Slot',
    'slot.clearSlotDesc': 'Clear handle & messages',
    'slot.searchingPlatforms': 'Searching @{handle} on Twitter & Threads...',
    'slot.choosePlatformTitle': 'Select platform for @{handle}',
    'slot.platformTwitterBadge': 'Twitter / X',
    'slot.platformThreadsBadge': 'Threads',

    // Attachments
    'attachment.image': 'Image',
    'attachment.video': 'Video',
    'attachment.embed': 'Embed',
    'attachment.file': 'Attachment',

    // Grid Resize & Collisions
    'grid.notEnoughCols': 'Current grid only has {currentCols} columns and cannot fit a {targetW}-column card. Switch to a wider grid layout at the top first.',
    'grid.notEnoughRows': 'Current grid only has {currentRows} rows and cannot fit a {targetH}-row card. Switch to a taller grid layout at the top first.',
    'grid.conflictCardFallback': 'Card',
    'grid.cardFallbackName': 'Card',
    'grid.conflictSeparator': ', ',
    'grid.conflictWarning': '⚠️ Cannot resize to {targetH}×{targetW}: adjacent slots ({conflictNames}) have content. Move or clear them first.',
    'grid.conflictResize': '⚠️ Cannot resize to {targetH}×{targetW}: adjacent slots ({conflictNames}) have content. Move or clear them first.',

    // Notifications
    'notify.discordNewMessages': '{count} new messages',
    'notification.discordNewMessagesCount': '{count} new messages',
    'notify.imageTag': '[Image{suffix}]',
    'notification.imagePlural': '[Images ×{count}]',
    'notification.imageSingle': '[Image]',
    'notify.replyPrefix': '[Reply] {text}',
    'notification.replyPrefix': '[Reply]',
    'notify.newMessageTag': '[New message]',
    'notification.newMessagePlaceholder': '[New message]',
    'notify.twitterNewPost': 'New post',
    'notification.newPost': 'New post',
    'notify.twitterRepost': 'Repost',
    'notification.repost': 'Repost',
    'notify.twitterQuote': 'Quoted post',
    'notification.quotePost': 'Quoted post',
    'notify.twitterMember': 'Subscriber-only post',
    'notification.memberOnlyPost': 'Subscriber-only post',
    'notify.twitterMultiplePosts': '{count} new posts',
    'notification.newPostsCount': '{count} new posts',
    'notify.mediaFallback': '[Media]',
    'notification.mediaContentPlaceholder': '[Media]',

    // Scraper (Twitter)
    'scraper.rateLimit': 'Twitter rate limit exceeded. Please wait 10–15 minutes and try again.',
    'scraper.humanChallenge': 'Twitter requires human verification. Click "Accounts → Twitter / X" in the top right to complete verification.',
    'scraper.captchaRequired': 'Twitter requires human verification. Click "Accounts → Twitter / X" in the top right to complete verification.',
    'scraper.accountNotExist': 'This account does not exist',
    'scraper.accountSuspended': 'This account has been suspended',
    'scraper.accountProtected': 'This account is private and its posts are protected',
    'scraper.notLoggedIn': 'Not logged in to X. Click "Accounts" in the top right to log in.',
    'scraper.mediaOnlyFallback': '(Media or card post with no text)',
    'scraper.emptyInputError': 'Please enter a Twitter / Threads handle or Discord channel URL',
    'scraper.offlineTwitterError': 'Network disconnected. Unable to fetch posts.',
    'scraper.offlineError': 'Network disconnected. Unable to fetch posts.',
    'scraper.offlineToast': 'Network disconnected. Fetching paused.',
    'scraper.offlinePausedToast': 'Network disconnected. Fetching paused.',
    'scraper.fetchingHandle': 'Fetching @{handle} in background...',
    'scraper.fetchedProgress': 'Fetched ({count}/{target})...',
    'scraper.twitterUpToDate': '@{handle} is up to date',
    'scraper.upToDateToast': '@{handle} is up to date',
    'scraper.twitterFetchedNew': 'Fetched {count} new posts from @{handle}',
    'scraper.newPostsToast': 'Fetched {count} new posts from @{handle}',
    'scraper.twitterTimeout': 'Fetch timed out: no posts found. Make sure you are logged in and the account has recent posts.',
    'scraper.fetchTimeoutError': 'Fetch timed out: no posts found. Make sure you are logged in and the account has recent posts.',
    'scraper.errorGeneric': 'Error: {message}',
    'scraper.exceptionError': 'Error: {message}',
    'scraper.twitterFetchError': 'Error fetching @{handle}: {message}',
    'scraper.exceptionToast': 'Error fetching @{handle}: {message}',

    // Scraper (Threads)
    'threads.offlineError': 'Network disconnected. Unable to fetch Threads posts.',
    'threads.offlinePausedToast': 'Network disconnected. Fetching paused.',
    'threads.invalidHandleError': 'Invalid Threads handle or URL',
    'threads.fetchingHandle': 'Fetching Threads @{handle}...',
    'threads.fetchedProgress': 'Fetched ({count}/{target})...',
    'threads.notLoggedInError': 'Threads requires login for this account. Click "Accounts → Threads" in the top right to log in.',
    'threads.accountNotExist': 'This Threads account does not exist or is unavailable',
    'threads.accountProtected': 'This Threads account is private',
    'threads.upToDateToast': 'Threads @{handle} is up to date',
    'threads.newPostsToast': 'Fetched {count} new Threads posts from @{handle}',
    'threads.fetchTimeoutError': 'Fetch timed out: no Threads posts found. Check if the account has public posts or log in via Accounts → Threads.',
    'threads.exceptionError': 'Threads error: {message}',
    'threads.exceptionToast': 'Error fetching Threads @{handle}: {message}',

    // Scraper (Discord)
    'discord.offlineError': 'Network disconnected. Unable to connect to Discord.',
    'discord.offlineConnectError': 'Network disconnected. Unable to connect to Discord.',
    'discord.offlineReadError': 'Network disconnected. Unable to read Discord channel.',
    'discord.offlinePausedToast': 'Network disconnected. Fetching paused.',
    'discord.startingClient': 'Starting Discord client...',
    'discord.bootingClient': 'Starting Discord client...',
    'discord.switchingChannel': 'Switching channel...',
    'discord.loadingChannel': 'Loading channel...',
    'discord.notLoggedIn': 'Not logged in to Discord. Click "Accounts → Discord" in the top right to log in.',
    'discord.notLoggedInError': 'Not logged in to Discord. Click "Accounts → Discord" in the top right to log in.',
    'discord.switchTimeout': 'Channel switch timed out. Make sure the channel exists and your account has access.',
    'discord.switchTimeoutError': 'Channel switch timed out. Make sure the channel exists and your account has access.',
    'discord.loadTimeout': 'Timed out loading messages. You may not have access to this channel, or the connection is slow.',
    'discord.loadTimeoutError': 'Timed out loading messages. You may not have access to this channel, or the connection is slow.',
    'discord.invalidUrl': 'Invalid Discord channel URL',
    'discord.invalidUrlError': 'Invalid Discord channel URL',
    'discord.readingChannel': 'Reading Discord channel...',
    'discord.jumpingToPresent': 'Jumping to latest messages...',
    'discord.locatingLatest': 'Jumping to latest messages...',
    'discord.scrollingHistory': 'Scrolling history ({count})...',
    'discord.fetchFailed': 'Discord fetch failed: {error}',
    'discord.scrapeFailedError': 'Discord fetch failed: {error}',
    'discord.upToDate': '{channelLabel} is up to date',
    'discord.upToDateToast': '{channelLabel} is up to date',
    'discord.emptyChannel': 'No messages found. Make sure the channel has messages and your account has permission to view it.',
    'discord.noMessagesError': 'No messages found. Make sure the channel has messages and your account has permission to view it.',
    'discord.fetchedNew': 'Fetched {count} new messages in {channelLabel}',
    'discord.newMessagesToast': 'Fetched {count} new messages in {channelLabel}',
    'discord.fetchException': 'Discord fetch error: {message}',
    'discord.exceptionError': 'Discord fetch error: {message}',
    'discord.exceptionToast': 'Discord fetch error: {message}',

    // Settings Modal
    'settings.title': 'Preferences',
    'settings.closeTitle': 'Close settings (Esc)',
    'settings.closeAria': 'Close settings',
    'settings.sectionGeneral': 'General',
    'settings.languageTip': 'Defaults to system language (Chinese on Chinese OS, English otherwise)',
    'settings.languageTitle': 'Language',
    'settings.languageSubtitle': 'Display language',
    'settings.twitterRefreshTip': '5–15+ min recommended to avoid triggering Twitter rate limits',
    'settings.twitterRefreshTitle': 'Twitter Refresh',
    'settings.twitterRefreshSubtitle': 'Background polling',
    'settings.threadsRefreshTip': '5–15+ min recommended for Threads background polling',
    'settings.threadsRefreshTitle': 'Threads Refresh',
    'settings.threadsRefreshSubtitle': 'Background polling',
    'settings.discordRefreshTip': 'Discord channels update frequently; 1–5 min works well',
    'settings.discordRefreshTitle': 'Discord Refresh',
    'settings.discordRefreshSubtitle': 'Channel polling',
    'settings.interval30s': '30 sec',
    'settings.interval1m': '1 min',
    'settings.interval2m': '2 min',
    'settings.interval3m': '3 min',
    'settings.interval5m': '5 min',
    'settings.interval10mDefault': '10 min (Default)',
    'settings.interval15m': '15 min',
    'settings.interval30m': '30 min',
    'settings.interval60m': '60 min',
    'settings.intervalCustom': 'Custom...',
    'settings.unitMinutes': 'min',
    'settings.memberOnlyTip': 'Show or hide Twitter subscriber-only posts (Super Follows) in timelines',
    'settings.memberOnlyTitle': 'Member Posts',
    'settings.memberOnlyShow': 'Show (tagged)',
    'settings.memberOnlyHide': 'Hide',
    'settings.filterKeywordsTip': 'Posts containing any of these words or multi-word phrases will be directly discarded (comma or Enter to add)',
    'settings.filterKeywordsTitle': 'Filter Keywords',
    'settings.filterKeywordsSubtitle': 'Discard matching phrases',
    'settings.filterKeywordsPlaceholder': 'Word or phrase, press Enter',
    'settings.discordSoundTip': 'Mutes the background Discord client without affecting message fetching',
    'settings.discordSoundTitle': 'Discord Sound',
    'settings.discordSoundSubtitle': 'Background audio',
    'settings.appBadgeTip': 'Show or hide the unread message count badge on the Dock / taskbar app icon',
    'settings.appBadgeTitle': 'App Icon Badge',
    'settings.appBadgeSubtitle': 'Unread count on app icon',
    'settings.optionOnDefault': 'On (Default)',
    'settings.optionOffMuted': 'Off (Muted)',
    'settings.optionOff': 'Off',
    'settings.sectionAppearance': 'Appearance',
    'settings.headerColorLabel': 'Header Color',
    'settings.headerColorSubtitle': 'Card title bar',
    'settings.customColor': 'Custom',
    'settings.colorPreset.navy': 'Midnight Navy',
    'settings.colorPreset.royalblue': 'Royal Blue',
    'settings.colorPreset.linen': 'Warm Linen',
    'settings.colorPreset.mint': 'Fresh Mint',
    'settings.colorPreset.lavender': 'Soft Lavender',
    'settings.colorPreset.apricot': 'Creamy Apricot',
    'settings.headerColorInputTitle': 'Custom header background color',
    'settings.headerColorHexAria': 'Header background color Hex',
    'settings.tickerHighlightLabel': 'Highlight Tickers',
    'settings.tickerHighlightSubtitle': 'Stock & ETF symbols',
    'settings.tickerFgLabel': 'Text',
    'settings.tickerFgInputTitle': 'Choose ticker text color',
    'settings.tickerFgHexAria': 'Ticker text color Hex',
    'settings.tickerBgLabel': 'Bg',
    'settings.tickerBgInputTitle': 'Choose ticker background color',
    'settings.tickerBgHexAria': 'Ticker background color Hex',
    'settings.previewAvatar': 'E',
    'settings.previewName': 'Example Account',
    'settings.previewPostHtml': 'Watching <span class="ticker-highlight ticker-preview-chip">$NVDA</span> &amp; <span class="ticker-highlight ticker-preview-chip">AAPL</span> earnings, tracking <span class="ticker-highlight ticker-preview-chip">qqq</span>',
    'settings.tickerStatsLoaded': 'Loaded {count} NASDAQ stock & ETF symbols (matches $cashtags & case-insensitive tickers)',
    'settings.tickerStats': 'Loaded {count} NASDAQ stock & ETF symbols (matches $cashtags & case-insensitive tickers)',
    'settings.syncTickersTitle': 'Sync latest US stock & ETF list from NASDAQ',
    'settings.syncTickersBtn': 'Sync Symbols',
    'settings.syncOnlineBtn': 'Sync Symbols',
    'settings.syncingTickersBtn': 'Syncing...',
    'settings.syncing': 'Syncing...',
    'settings.syncTickersSuccess': 'NASDAQ symbols synced ({count} stock/ETF tickers loaded)',
    'settings.toastSyncSuccess': 'NASDAQ symbols synced ({count} stock/ETF tickers loaded)',
    'settings.syncTickersFailed': 'Online sync failed, using built-in symbol list ({error})',
    'settings.toastSyncError': 'Online sync failed, using built-in symbol list ({error})',
    'settings.networkError': 'Network error',
    'settings.networkErrorFallback': 'Network error',
    'settings.sectionBackup': 'Backup',
    'settings.profileCardTitle': 'Profile Backup',
    'settings.profileCardSubtitle': 'Preferences, layout & followed accounts',
    'settings.resetTitle': 'Restore default settings',
    'settings.resetBtn': 'Restore Defaults',
    'settings.cancelBtn': 'Cancel',
    'settings.saveBtn': 'Save Settings',
    'settings.resetToast': 'Defaults restored',
    'settings.toastResetDefaults': 'Defaults restored',
    'settings.invalidTwitterInterval': 'Please enter a valid Twitter refresh interval (>= 1 min)',
    'settings.toastInvalidTwitterInterval': 'Please enter a valid Twitter refresh interval (>= 1 min)',
    'settings.invalidThreadsInterval': 'Please enter a valid Threads refresh interval (>= 1 min)',
    'settings.toastInvalidThreadsInterval': 'Please enter a valid Threads refresh interval (>= 1 min)',
    'settings.invalidDiscordInterval': 'Please enter a valid Discord refresh interval (>= 0.5 min)',
    'settings.toastInvalidDiscordInterval': 'Please enter a valid Discord refresh interval (>= 0.5 min)',
    'settings.savedInterval30s': '30s',
    'settings.interval30sShort': '30s',
    'settings.savedIntervalMin': '{m}m',
    'settings.intervalMinShort': '{m}m',
    'settings.savedMemberShown': 'Member posts shown',
    'settings.memberShownShort': 'Member posts shown',
    'settings.savedMemberHidden': 'Member posts hidden',
    'settings.memberHiddenShort': 'Member posts hidden',
    'settings.savedSoundOn': 'Discord sound on',
    'settings.soundOnShort': 'Discord sound on',
    'settings.savedSoundOff': 'Discord muted',
    'settings.soundOffShort': 'Discord muted',
    'settings.savedToast': 'Settings saved (Header: {bg}, Twitter: {twitter}, Discord: {discord}, {memberText}, {soundText})',
    'settings.toastSaved': 'Settings saved (Header: {bg}, Twitter: {twitter}, Discord: {discord}, {memberText}, {soundText})'
  },

  zh: {
    // Window & App
    'app.windowTitle': 'TheySay - 动态网格看板',
    'app.mainWindowTitle': 'TheySay - 动态网格看板',
    'app.twitterLoginTitle': '登录 Twitter / X',
    'app.twitterReloginTitle': '切换或重新登录 Twitter / X 账号',
    'app.threadsLoginTitle': '登录 Threads',
    'app.threadsReloginTitle': '切换或重新登录 Threads 账号',
    'app.discordLoginTitle': '登录 Discord',
    'app.discordReloginTitle': '切换或重新登录 Discord 账号',
    'app.exportDialogTitle': '导出 TheySay Profile 配置',
    'app.exportDialogButton': '导出 Profile',
    'app.importDialogTitle': '导入 TheySay Profile 配置',
    'app.importDialogButton': '导入 Profile',
    'app.invalidProfileJson': '无效的 Profile JSON 文件格式',

    // Top Navigation
    'nav.markAllRead': '全部已读',
    'nav.markAllReadTitle': '将所有推文标记为已读',
    'nav.gridLayout': '网格布局:',
    'nav.switchToDark': '切换深色模式',
    'nav.switchToLight': '切换浅色模式',
    'nav.settings': '设置',
    'nav.loginMenu': '登录账号',
    'nav.loginMenuTitle': '管理登录账号',
    'nav.toggleSidebar': '展开 / 收起侧边栏',

    // Auth & Profile Dropdown
    'auth.accountManagement': '登录账号管理',
    'auth.checking': '检测中...',
    'auth.loggedIn': '已登录',
    'auth.loggedOut': '未登录',
    'auth.expired': '登录已过期',
    'auth.twitterCheckingTitle': 'Twitter / X: 正在检测登录状态',
    'auth.twitterLoggedInTitle': 'Twitter / X: 已登录 (点击重新登录或切换账号)',
    'auth.twitterLoggedOutTitle': 'Twitter / X: 未登录 (点击弹出窗口登录)',
    'auth.twitterExpiredTitle': 'Twitter / X: 登录已过期 (点击重新登录)',
    'auth.threadsCheckingTitle': 'Threads: 正在检测登录状态',
    'auth.threadsLoggedInTitle': 'Threads: 已登录 (点击重新登录或切换账号)',
    'auth.threadsLoggedOutTitle': 'Threads: 未登录 (点击弹出窗口登录)',
    'auth.threadsExpiredTitle': 'Threads: 登录已过期 (点击重新登录)',
    'auth.discordLoggedInTitle': 'Discord: 已登录 (点击重新登录或切换账号)',
    'auth.discordLoggedOutTitle': 'Discord: 未登录 (点击弹出窗口登录以监控私有频道)',
    'auth.discordExpiredTitle': 'Discord: 登录已过期 (点击重新登录)',
    'auth.expiredBannerText': '{platforms} 登录已过期，无法拉取最新消息，请重新登录以恢复更新。',
    'auth.expiredBannerLoginBtn': '立即登录 {platform}',
    'auth.slotExpiredBannerText': '{platform} 登录已过期，无法更新最新消息',
    'auth.slotExpiredLoginBtn': '重新登录',
    'auth.profileSectionHeader': 'Profile 配置与关注列表',
    'auth.exportProfile': '导出 Profile',
    'auth.exportProfileTitle': '导出全部设置与所有关注账号为 JSON 文件',
    'auth.importProfile': '导入 Profile',
    'auth.importProfileTitle': '从 JSON 文件导入 Profile 配置（保留已抓取数据）',
    'auth.importProfileHint': '恢复',

    // Profile Export / Import Toasts
    'profile.exportSuccess': 'Profile 导出成功 (含全部设置与 {count} 个关注项)',
    'profile.exportFailed': '导出 Profile 失败: {error}',
    'profile.exportError': '导出 Profile 失败: {error}',
    'profile.importSuccess': 'Profile 导入成功 (已恢复 {count} 个关注项与全部设置，已抓取数据完整保留)',
    'profile.importFailed': '导入 Profile 失败: {error}',
    'profile.importError': '导入 Profile 失败: {error}',
    'profile.unknownError': '未知错误',
    'profile.invalidFormat': '文件格式无效',

    // Post / Threads / Discord Popup Modal
    'popup.dialogAriaLabel': '推文详情',
    'popup.loadingEmbed': '正在加载嵌入推文...',
    'popup.memberOnlyBadge': '仅会员可见',
    'popup.memberOnlyTag': '仅会员可见',
    'popup.memberOnlyNotice': '此推文为创作者会员 / 订阅专享内容',
    'popup.quoteBadge': '引用推文',
    'popup.quoteTag': '引用推文',
    'popup.viewQuotedPost': '查看被引用推文 ↗',
    'popup.openOnTwitter': '在 Twitter / X 上打开 ↗',
    'popup.openOnThreads': '在 Threads 上打开 ↗',
    'popup.openInDiscord': '在 Discord 中打开 ↗',
    'popup.viewOriginalImage': '点击在浏览器中查看原图',
    'popup.viewOriginalImageTitle': '点击在浏览器中查看原图',
    'popup.imageAlt': '图片',

    // Slot Cards
    'slot.dragTitle': '按住拖拽卡片',
    'slot.dragHandleTitle': '按住拖拽卡片',
    'slot.avatarTitle': '用户头像',
    'slot.editAccountTitle': '点击修改账号',
    'slot.clickEditAccount': '点击修改账号',
    'slot.clickEditChannel': '点击修改频道',
    'slot.editHint': '修改',
    'slot.inputPlaceholder': 'Twitter / Threads 用户名 或 Discord 频道链接',
    'slot.clearTitle': '清空',
    'slot.clearBtnTitle': '清空',
    'slot.muteMutedTitle': '已静音系统通知 (点击开启此频道通知)',
    'slot.mutedTitle': '已静音系统通知 (点击开启此频道通知)',
    'slot.muteUnmutedTitle': '系统通知已开启 (点击静音此频道)',
    'slot.unmutedTitle': '系统通知已开启 (点击静音此频道)',
    'slot.muteAriaLabel': '切换系统通知静音',
    'slot.expandDefaultTitle': '调整卡片尺寸 (1×1, 2×1, 3×1, 2×2)',
    'slot.expandBtnTitle': '调整卡片尺寸 (1×1, 2×1, 3×1, 2×2)',
    'slot.resizeCardTitle': '调整卡片尺寸 (1×1, 2×1, 3×1, 2×2)',
    'slot.expandCurrentTitle': '当前尺寸: {r}×{c} (点击切换或还原)',
    'slot.currentSizeTitle': '当前尺寸: {r}×{c} (点击切换或还原)',
    'slot.placeholderText': '输入 handle 或频道链接并按回车',
    'slot.loadingDefault': '后台抓取中...',
    'slot.loadingText': '后台抓取中...',
    'slot.defaultChannelLabel': '此频道',
    'slot.defaultChannelName': '此频道',
    'slot.defaultDiscordChannel': '#频道',
    'slot.muteToastMuted': '已静音 {label} 的系统通知',
    'slot.toastMuted': '已静音 {label} 的系统通知',
    'slot.muteToastUnmuted': '已开启 {label} 的系统通知',
    'slot.toastUnmuted': '已开启 {label} 的系统通知',
    'slot.clickToEditChannel': '点击修改频道',
    'slot.clickToEditAccount': '点击修改账号',
    'slot.lastFetchedTitle': '{name} · 上次抓取: {timeStr} ({editHint})',
    'slot.noFetchedTitle': '{name} ({editHint})',
    'slot.unreadBadgeTitle': '{count} 条未读消息 (点击将本栏标记为已读)',
    'slot.unreadUnitSingular': '条',
    'slot.unreadUnitPlural': '条',
    'slot.imageAlt': '图片',
    'slot.tagPinned': '置顶',
    'slot.tagRepost': '转推',
    'slot.tagQuote': '引用',
    'slot.tagMember': '仅会员',
    'slot.tagMemberOnly': '仅会员',
    'slot.tagMemberTitle': '仅会员 / 订阅者可见',
    'slot.tagMemberOnlyTitle': '仅会员 / 订阅者可见',
    'slot.openDiscordLinkTitle': '在浏览器 / Discord 中打开原消息',
    'slot.openOriginalDiscord': '在浏览器 / Discord 中打开原消息',
    'slot.openThreadsLinkTitle': '在 Threads 中打开原帖',
    'slot.openOriginalThreads': '在 Threads 中打开原帖',
    'slot.openTwitterLinkTitle': '在浏览器中打开原推文',
    'slot.openOriginalPost': '在浏览器中打开原推文',
    'slot.filteredMemberNotice': '已隐藏 {count} 条仅会员可见的帖子 (可在设置中开启)',
    'slot.hiddenMemberPosts': '已隐藏 {count} 条仅会员可见的帖子 (可在设置中开启)',
    'slot.postUnitSingular': '条',
    'slot.postUnitPlural': '条',
    'slot.clearedToast': '已清空此栏显示 (历史抓取数据已保留在缓存中)',
    'slot.toastCleared': '已清空此栏显示 (历史抓取数据已保留在缓存中)',
    'slot.sizeMenuTitle': '调整卡片尺寸 (行 × 列)',
    'slot.size1x1Desc': '单格默认',
    'slot.size2x1Desc': '纵向双行',
    'slot.size3x1Desc': '纵向三行',
    'slot.size2x2Desc': '双行双列',
    'slot.sizeNeedRows': '(需≥{r}行)',
    'slot.needRows': '(需≥{r}行)',
    'slot.sizeNeedCols': '(需≥{c}列)',
    'slot.needCols': '(需≥{c}列)',
    'slot.clearSlotLabel': '清空本栏',
    'slot.clearSlotDesc': '清除 Handle 与推文',
    'slot.searchingPlatforms': '正在搜索 @{handle} (Twitter / Threads)...',
    'slot.choosePlatformTitle': '均找到 @{handle}，请选择数据源：',
    'slot.platformTwitterBadge': 'Twitter / X',
    'slot.platformThreadsBadge': 'Threads',

    // Attachments
    'attachment.image': '图片',
    'attachment.video': '视频',
    'attachment.embed': '嵌入卡片',
    'attachment.file': '附件',

    // Grid Resize & Collisions
    'grid.notEnoughCols': '当前网格仅有 {currentCols} 列，无法容纳 {targetW} 列宽度的卡片。请先在顶部切换更大列数的网格布局。',
    'grid.notEnoughRows': '当前网格仅有 {currentRows} 行，无法容纳 {targetH} 行高度的卡片。请先在顶部切换更多行的网格布局。',
    'grid.conflictCardFallback': '卡片',
    'grid.cardFallbackName': '卡片',
    'grid.conflictSeparator': '、',
    'grid.conflictWarning': '⚠️ 无法放大为 {targetH}×{targetW}：周边格子 ({conflictNames}) 已有内容。请先将周边的格子移开，或把它们清除掉后再试。',
    'grid.conflictResize': '⚠️ 无法放大为 {targetH}×{targetW}：周边格子 ({conflictNames}) 已有内容。请先将周边的格子移开，或把它们清除掉后再试。',

    // Notifications
    'notify.discordNewMessages': '收到 {count} 条新消息',
    'notification.discordNewMessagesCount': '收到 {count} 条新消息',
    'notify.imageTag': '[图片{suffix}]',
    'notification.imagePlural': '[图片 ×{count}]',
    'notification.imageSingle': '[图片]',
    'notify.replyPrefix': '[回复] {text}',
    'notification.replyPrefix': '[回复]',
    'notify.newMessageTag': '[新消息]',
    'notification.newMessagePlaceholder': '[新消息]',
    'notify.twitterNewPost': '新推文',
    'notification.newPost': '新推文',
    'notify.twitterRepost': '转推',
    'notification.repost': '转推',
    'notify.twitterQuote': '引用推文',
    'notification.quotePost': '引用推文',
    'notify.twitterMember': '会员专享推文',
    'notification.memberOnlyPost': '会员专享推文',
    'notify.twitterMultiplePosts': '发布 {count} 条新推文',
    'notification.newPostsCount': '发布 {count} 条新推文',
    'notify.mediaFallback': '[媒体内容]',
    'notification.mediaContentPlaceholder': '[媒体内容]',

    // Scraper (Twitter)
    'scraper.rateLimit': '已触碰 Twitter 频率限制 (Rate limit exceeded)，请稍候 10~15 分钟再试',
    'scraper.humanChallenge': 'Twitter 要求进行人机验证，请点击右上角【登录 X】在弹出窗口中手动完成验证',
    'scraper.captchaRequired': 'Twitter 要求进行人机验证，请点击右上角【登录 X】在弹出窗口中手动完成验证',
    'scraper.accountNotExist': '该账号不存在 (Account does not exist)',
    'scraper.accountSuspended': '该账号已被冻结 (Account suspended)',
    'scraper.accountProtected': '该账号为私密账号，推文已受保护',
    'scraper.notLoggedIn': '尚未登录 X 账号，请先点击右上角登录',
    'scraper.mediaOnlyFallback': '(该推文为纯媒体/卡片内容，无文本)',
    'scraper.emptyInputError': '请输入 Twitter / Threads 用户名 或 Discord 频道链接',
    'scraper.offlineTwitterError': '当前网络已断开，无法抓取推文',
    'scraper.offlineError': '当前网络已断开，无法抓取推文',
    'scraper.offlineToast': '当前网络已断开，已暂停抓取',
    'scraper.offlinePausedToast': '当前网络已断开，已暂停抓取',
    'scraper.fetchingHandle': '正在后台抓取 @{handle}...',
    'scraper.fetchedProgress': '已获取 ({count}/{target})...',
    'scraper.twitterUpToDate': '@{handle} 已是最新，暂无新推文',
    'scraper.upToDateToast': '@{handle} 已是最新，暂无新推文',
    'scraper.twitterFetchedNew': '@{handle} 抓取到 {count} 条新推文',
    'scraper.newPostsToast': '@{handle} 抓取到 {count} 条新推文',
    'scraper.twitterTimeout': '抓取超时：未检测到推文。请确认右上角已登录，或该用户近期是否发过推文。',
    'scraper.fetchTimeoutError': '抓取超时：未检测到推文。请确认右上角已登录，或该用户近期是否发过推文。',
    'scraper.errorGeneric': '发生异常: {message}',
    'scraper.exceptionError': '发生异常: {message}',
    'scraper.twitterFetchError': '@{handle} 抓取异常: {message}',
    'scraper.exceptionToast': '@{handle} 抓取异常: {message}',

    // Scraper (Threads)
    'threads.offlineError': '当前网络已断开，无法抓取 Threads 帖子',
    'threads.offlinePausedToast': '当前网络已断开，已暂停抓取',
    'threads.invalidHandleError': '无效的 Threads 用户名或链接',
    'threads.fetchingHandle': '正在抓取 Threads @{handle}...',
    'threads.fetchedProgress': '已获取 ({count}/{target})...',
    'threads.notLoggedInError': '访问此 Threads 账号需要登录，请点击右上角【登录账号 → Threads】完成登录',
    'threads.accountNotExist': '该 Threads 账号不存在或不可用',
    'threads.accountProtected': '该 Threads 账号为私密账号',
    'threads.upToDateToast': 'Threads @{handle} 已是最新，暂无新帖',
    'threads.newPostsToast': 'Threads @{handle} 抓取到 {count} 条新帖',
    'threads.fetchTimeoutError': '抓取超时：未检测到 Threads 帖子。请确认该账号有公开帖子，或在右上角登录 Threads。',
    'threads.exceptionError': 'Threads 抓取异常: {message}',
    'threads.exceptionToast': 'Threads @{handle} 抓取异常: {message}',

    // Scraper (Discord)
    'discord.offlineError': '当前网络已断开，无法连接 Discord',
    'discord.offlineConnectError': '当前网络已断开，无法连接 Discord',
    'discord.offlineReadError': '当前网络已断开，无法读取 Discord 频道',
    'discord.offlinePausedToast': '当前网络已断开，已暂停抓取',
    'discord.startingClient': '正在启动 Discord 客户端...',
    'discord.bootingClient': '正在启动 Discord 客户端...',
    'discord.switchingChannel': '正在切换频道...',
    'discord.loadingChannel': '正在加载频道...',
    'discord.notLoggedIn': '尚未登录 Discord，请点击右上角【登录 Discord】完成登录',
    'discord.notLoggedInError': '尚未登录 Discord，请点击右上角【登录 Discord】完成登录',
    'discord.switchTimeout': '切换频道超时，请确认该频道仍然存在且账号有访问权限',
    'discord.switchTimeoutError': '切换频道超时，请确认该频道仍然存在且账号有访问权限',
    'discord.loadTimeout': '加载频道消息超时，可能没有该频道的访问权限，或网络较慢',
    'discord.loadTimeoutError': '加载频道消息超时，可能没有该频道的访问权限，或网络较慢',
    'discord.invalidUrl': '无法解析 Discord 频道链接',
    'discord.invalidUrlError': '无法解析 Discord 频道链接',
    'discord.readingChannel': '正在读取 Discord 频道...',
    'discord.jumpingToPresent': '正在定位最新消息...',
    'discord.locatingLatest': '正在定位最新消息...',
    'discord.scrollingHistory': '正在向上翻阅历史 ({count})...',
    'discord.fetchFailed': 'Discord 抓取失败: {error}',
    'discord.scrapeFailedError': 'Discord 抓取失败: {error}',
    'discord.upToDate': '{channelLabel} 已是最新，暂无新消息',
    'discord.upToDateToast': '{channelLabel} 已是最新，暂无新消息',
    'discord.emptyChannel': '未读取到消息。请确认该频道有历史消息，且账号拥有查看权限。',
    'discord.noMessagesError': '未读取到消息。请确认该频道有历史消息，且账号拥有查看权限。',
    'discord.fetchedNew': '{channelLabel} 抓取到 {count} 条新消息',
    'discord.newMessagesToast': '{channelLabel} 抓取到 {count} 条新消息',
    'discord.fetchException': 'Discord 抓取异常: {message}',
    'discord.exceptionError': 'Discord 抓取异常: {message}',
    'discord.exceptionToast': 'Discord 抓取异常: {message}',

    // Settings Modal
    'settings.title': '偏好设置',
    'settings.closeTitle': '关闭设置 (Esc)',
    'settings.closeAria': '关闭设置',
    'settings.sectionGeneral': '通用',
    'settings.languageTip': '默认根据系统语言设置（中文系统为中文，其余默认为英文）',
    'settings.languageTitle': '界面语言',
    'settings.languageSubtitle': '显示语言设置',
    'settings.twitterRefreshTip': '建议设为 5 ~ 15 分钟或以上，过频抓取可能触发 Twitter 频率限制',
    'settings.twitterRefreshTitle': 'Twitter 刷新',
    'settings.twitterRefreshSubtitle': '后台轮询周期',
    'settings.threadsRefreshTip': '建议设为 5 ~ 15 分钟或以上',
    'settings.threadsRefreshTitle': 'Threads 刷新',
    'settings.threadsRefreshSubtitle': '后台轮询周期',
    'settings.discordRefreshTip': 'Discord 频道消息更新通常较频繁，可设为 1 ~ 5 分钟',
    'settings.discordRefreshTitle': 'Discord 刷新',
    'settings.discordRefreshSubtitle': '频道轮询周期',
    'settings.interval30s': '30 秒',
    'settings.interval1m': '1 分钟',
    'settings.interval2m': '2 分钟',
    'settings.interval3m': '3 分钟',
    'settings.interval5m': '5 分钟',
    'settings.interval10mDefault': '10 分钟 (默认)',
    'settings.interval15m': '15 分钟',
    'settings.interval30m': '30 分钟',
    'settings.interval60m': '60 分钟',
    'settings.intervalCustom': '自定义...',
    'settings.unitMinutes': '分',
    'settings.memberOnlyTip': '控制是否在时间线中显示 Twitter 创作者订阅专享推文 (Super Follows)',
    'settings.memberOnlyTitle': '仅会员推文',
    'settings.memberOnlyShow': '显示 (标【仅会员】)',
    'settings.memberOnlyHide': '不显示 (过滤)',
    'settings.filterKeywordsTip': '包含以下任意词或多词短语的帖子将被直接丢弃不显示（按回车或用逗号分隔添加）',
    'settings.filterKeywordsTitle': '屏蔽关键词',
    'settings.filterKeywordsSubtitle': '丢弃含指定词或短语的帖子',
    'settings.filterKeywordsPlaceholder': '输入词或短语，回车添加',
    'settings.discordSoundTip': '关闭后后台 Discord 客户端全部静音，不影响消息抓取',
    'settings.discordSoundTitle': 'Discord 声音',
    'settings.discordSoundSubtitle': '后台消息提示音',
    'settings.appBadgeTip': '控制是否在系统 Dock / 任务栏应用图标上显示未读消息数角标',
    'settings.appBadgeTitle': '图标未读角标',
    'settings.appBadgeSubtitle': '在应用图标上显示未读消息数',
    'settings.optionOnDefault': '开启 (默认)',
    'settings.optionOffMuted': '关闭 (静音)',
    'settings.optionOff': '关闭',
    'settings.sectionAppearance': '外观',
    'settings.headerColorLabel': 'Title 栏配色',
    'settings.headerColorSubtitle': '卡片标题栏背景色',
    'settings.customColor': '自定义',
    'settings.colorPreset.navy': '深邃暗夜蓝',
    'settings.colorPreset.royalblue': '经典天青蓝',
    'settings.colorPreset.linen': '温暖亚麻米',
    'settings.colorPreset.mint': '清新薄荷绿',
    'settings.colorPreset.lavender': '雾光薰衣草紫',
    'settings.colorPreset.apricot': '暖阳奶油杏',
    'settings.headerColorInputTitle': '自定义 Title 栏背景颜色',
    'settings.headerColorHexAria': 'Title 栏背景色 Hex',
    'settings.tickerHighlightLabel': '高亮显示 Ticker',
    'settings.tickerHighlightSubtitle': '自动高亮美股代码',
    'settings.tickerFgLabel': '文字',
    'settings.tickerFgInputTitle': '选择 Ticker 文字颜色',
    'settings.tickerFgHexAria': 'Ticker 前景色 Hex',
    'settings.tickerBgLabel': '底色',
    'settings.tickerBgInputTitle': '选择 Ticker 背景颜色',
    'settings.tickerBgHexAria': 'Ticker 背景色 Hex',
    'settings.previewAvatar': '示',
    'settings.previewName': '示例账号',
    'settings.previewPostHtml': '关注 <span class="ticker-highlight ticker-preview-chip">$NVDA</span> 与 <span class="ticker-highlight ticker-preview-chip">AAPL</span> 财报表现，留意 <span class="ticker-highlight ticker-preview-chip">qqq</span>',
    'settings.tickerStatsLoaded': '已加载 {count} 个 NASDAQ 美股与 ETF 代码（支持 $ 符号与大小写自动匹配）',
    'settings.tickerStats': '已加载 {count} 个 NASDAQ 美股与 ETF 代码（支持 $ 符号与大小写自动匹配）',
    'settings.syncTickersTitle': '从 NASDAQ 官方接口同步最新美股与 ETF 列表',
    'settings.syncTickersBtn': '同步在线词库',
    'settings.syncOnlineBtn': '同步在线词库',
    'settings.syncingTickersBtn': '同步中...',
    'settings.syncing': '同步中...',
    'settings.syncTickersSuccess': 'NASDAQ 词库同步完成，当前共收录 {count} 个股票/ETF 代码',
    'settings.toastSyncSuccess': 'NASDAQ 词库同步完成，当前共收录 {count} 个股票/ETF 代码',
    'settings.syncTickersFailed': '在线同步失败，已使用内置词库 ({error})',
    'settings.toastSyncError': '在线同步失败，已使用内置词库 ({error})',
    'settings.networkError': '网络异常',
    'settings.networkErrorFallback': '网络异常',
    'settings.sectionBackup': '备份',
    'settings.profileCardTitle': '个人 Profile 档案',
    'settings.profileCardSubtitle': '包含全部偏好设置、网格布局与 follow 的所有账号/频道',
    'settings.resetTitle': '恢复默认设置',
    'settings.resetBtn': '恢复默认',
    'settings.cancelBtn': '取消',
    'settings.saveBtn': '保存设置',
    'settings.resetToast': '已恢复默认设置',
    'settings.toastResetDefaults': '已恢复默认设置',
    'settings.invalidTwitterInterval': '请输入有效的 Twitter 刷新频率 (>= 1 分钟)',
    'settings.toastInvalidTwitterInterval': '请输入有效的 Twitter 刷新频率 (>= 1 分钟)',
    'settings.invalidThreadsInterval': '请输入有效的 Threads 刷新频率 (>= 1 分钟)',
    'settings.toastInvalidThreadsInterval': '请输入有效的 Threads 刷新频率 (>= 1 分钟)',
    'settings.invalidDiscordInterval': '请输入有效的 Discord 刷新频率 (>= 0.5 分钟)',
    'settings.toastInvalidDiscordInterval': '请输入有效的 Discord 刷新频率 (>= 0.5 分钟)',
    'settings.savedInterval30s': '30秒',
    'settings.interval30sShort': '30秒',
    'settings.savedIntervalMin': '{m}分钟',
    'settings.intervalMinShort': '{m}分钟',
    'settings.savedMemberShown': '显示会员推文',
    'settings.memberShownShort': '显示会员推文',
    'settings.savedMemberHidden': '隐藏会员推文',
    'settings.memberHiddenShort': '隐藏会员推文',
    'settings.savedSoundOn': 'Discord 提示音开启',
    'settings.soundOnShort': 'Discord 提示音开启',
    'settings.savedSoundOff': 'Discord 已静音',
    'settings.soundOffShort': 'Discord 已静音',
    'settings.savedToast': '设置已保存 (Title栏: {bg}, Twitter: {twitter}, Discord: {discord}, {memberText}, {soundText})',
    'settings.toastSaved': '设置已保存 (Title栏: {bg}, Twitter: {twitter}, Discord: {discord}, {memberText}, {soundText})'
  }
};

function t(key, params = {}, langOverride = null) {
  const lang = langOverride || getCurrentLanguage();
  const dict = MESSAGES[lang] || MESSAGES.en;
  let template = dict[key];
  if (template === undefined) {
    template = MESSAGES.en[key] !== undefined ? MESSAGES.en[key] : key;
  }
  if (!params || typeof params !== 'object') return template;
  return String(template).replace(/\{(\w+)\}/g, (_, k) =>
    params[k] !== undefined && params[k] !== null ? String(params[k]) : ''
  );
}

function translateAttachmentLabel(rawLabel) {
  const s = String(rawLabel || '').trim();
  if (s === '图片' || s === 'Image') return t('attachment.image');
  if (s === '视频' || s === 'Video') return t('attachment.video');
  if (s === '嵌入卡片' || s === 'Embed') return t('attachment.embed');
  if (s === '附件' || s === 'Attachment') return t('attachment.file');
  return s;
}

function isImageAttachmentLabel(rawLabel) {
  const s = String(rawLabel || '').trim();
  return s === '图片' || s === 'Image';
}

function normalizeDiscordChannelFallback(title) {
  const s = String(title || '').trim();
  if (!s || s === '#频道' || s === '#channel') {
    return t('slot.defaultDiscordChannel');
  }
  return s;
}

function normalizeMediaOnlyText(rawText) {
  const s = String(rawText || '').trim();
  if (
    s === '(该推文为纯媒体/卡片内容，无文本)' ||
    s === '(Media or card post with no text)'
  ) {
    return t('scraper.mediaOnlyFallback');
  }
  return s;
}

function applyPageLocalization(lang = getCurrentLanguage()) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang === LANG_ZH ? 'zh-CN' : 'en';
  document.title = t('app.windowTitle', {}, lang);

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    const labelEl =
      el.querySelector &&
      el.querySelector('.mantine-Button-label, .mantine-Badge-label');
    if (labelEl) {
      labelEl.textContent = t(key, {}, lang);
    } else {
      el.textContent = t(key, {}, lang);
    }
  });

  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const key = el.getAttribute('data-i18n-html');
    if (key) el.innerHTML = t(key, {}, lang);
  });

  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.setAttribute('title', t(key, {}, lang));
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.setAttribute('placeholder', t(key, {}, lang));
  });

  document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria-label');
    if (key) el.setAttribute('aria-label', t(key, {}, lang));
  });
}

module.exports = {
  LANG_EN,
  LANG_ZH,
  isChineseLocale,
  resolveLanguageCode,
  detectSystemLanguage,
  getCurrentLanguage,
  setActiveLanguageOverride,
  t,
  translateAttachmentLabel,
  isImageAttachmentLabel,
  normalizeDiscordChannelFallback,
  normalizeMediaOnlyText,
  applyPageLocalization
};
