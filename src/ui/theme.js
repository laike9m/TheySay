const { colord } = require('colord');
const {
  DEFAULT_HEADER_BG_COLOR,
  DEFAULT_DARK_HEADER_BG_COLOR,
  DEFAULT_CHAT_BG_COLOR,
  DEFAULT_DARK_CHAT_BG_COLOR,
  DEFAULT_BUBBLE_BG_COLOR,
  DEFAULT_DARK_BUBBLE_BG_COLOR,
  HEADER_COLOR_PRESETS
} = require('../core/constants');
const {
  getStoredTheme,
  saveStoredTheme,
  getHeaderBgColor,
  saveHeaderBgColor,
  getChatBgColor,
  saveChatBgColor,
  getBubbleBgColor,
  saveBubbleBgColor
} = require('../core/storage');
const { clearPostWidgetCache } = require('./popup');
const { t } = require('../core/i18n');

function normalizeHexColor(val, fallback = DEFAULT_HEADER_BG_COLOR) {
  const str = String(val || '').trim();
  if (/^#?[0-9A-Fa-f]{6}$/.test(str)) {
    const parsed = colord(str.startsWith('#') ? str : `#${str}`);
    if (parsed.isValid()) return parsed.toHex();
  }
  return fallback;
}

function resolveHeaderPalette(bgHex) {
  const bg = normalizeHexColor(bgHex, DEFAULT_HEADER_BG_COLOR);
  const preset = HEADER_COLOR_PRESETS.find((p) => p.bg.toLowerCase() === bg);
  if (preset) {
    return { ...preset, name: t(`settings.colorPreset.${preset.id}`) };
  }

  const color = colord(bg);
  const isDark = color.brightness() < 0.55;

  if (isDark) {
    return {
      id: 'custom',
      name: t('settings.customColor'),
      bg,
      text: '#f8fafc',
      subtext: 'rgba(248, 250, 252, 0.72)',
      border: color.darken(0.12).toHex(),
      hoverBg: 'rgba(255, 255, 255, 0.12)',
      activeIcon: '#ffffff',
      activeBg: 'rgba(255, 255, 255, 0.22)',
      badgeBorder: 'rgba(255, 255, 255, 0.8)'
    };
  }

  return {
    id: 'custom',
    name: t('settings.customColor'),
    bg,
    text: '#0f1419',
    subtext: '#787b86',
    border: color.darken(0.08).toHex(),
    hoverBg: 'rgba(15, 23, 42, 0.07)',
    activeIcon: '#1d9bf0',
    activeBg: 'rgba(29, 155, 240, 0.15)',
    badgeBorder: 'transparent'
  };
}

function applyHeaderColor(bgHex) {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const fallback = getStoredTheme() === 'light' ? DEFAULT_HEADER_BG_COLOR : DEFAULT_DARK_HEADER_BG_COLOR;
  const norm = normalizeHexColor(bgHex, fallback);
  const root = document.documentElement;
  root.style.setProperty('--slot-header-bg', norm);

  const currentChatBg = normalizeHexColor(getChatBgColor(), fallback);
  if (norm === currentChatBg || norm === DEFAULT_HEADER_BG_COLOR || norm === DEFAULT_DARK_HEADER_BG_COLOR) {
    const chatPalette = resolveChatBgPalette(norm);
    root.style.setProperty(
      '--slot-header-surface',
      norm === currentChatBg
        ? 'linear-gradient(180deg, var(--bg-card) 82%, transparent 100%)'
        : norm
    );
    root.style.setProperty('--slot-header-text', chatPalette.text);
    root.style.setProperty('--slot-header-subtext', chatPalette.subtext);
    root.style.setProperty('--slot-header-pill-bg', chatPalette.pillBg);
    root.style.setProperty('--slot-header-border', 'transparent');
    root.style.setProperty(
      '--slot-header-hover-bg',
      chatPalette.isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(19, 23, 34, 0.06)'
    );
    root.style.setProperty('--slot-header-active-icon', '#2962ff');
    root.style.setProperty('--slot-header-active-bg', 'rgba(41, 98, 255, 0.12)');
    root.style.setProperty('--slot-header-badge-border', 'transparent');
    return;
  }

  const palette = resolveHeaderPalette(norm);
  root.style.setProperty('--slot-header-surface', palette.bg);
  root.style.setProperty('--slot-header-text', palette.text);
  root.style.setProperty('--slot-header-subtext', palette.subtext);
  root.style.setProperty('--slot-header-border', palette.border);
  root.style.setProperty('--slot-header-hover-bg', palette.hoverBg);
  root.style.setProperty('--slot-header-active-icon', palette.activeIcon);
  root.style.setProperty('--slot-header-active-bg', palette.activeBg);
  root.style.setProperty('--slot-header-badge-border', palette.badgeBorder || 'transparent');
}

function resolveChatBgPalette(bgHex) {
  const bg = normalizeHexColor(bgHex, DEFAULT_CHAT_BG_COLOR);
  const color = colord(bg);
  const isDark = color.brightness() < 0.55;
  return {
    bg,
    isDark,
    text: isDark ? '#f4f7fa' : '#131722',
    subtext: isDark ? '#8696a7' : '#787b86',
    pillBg: isDark ? 'rgba(255, 255, 255, 0.09)' : 'rgba(19, 23, 34, 0.055)'
  };
}

function applyChatBgColor(bgHex) {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const palette = resolveChatBgPalette(bgHex);
  const root = document.documentElement;
  root.style.setProperty('--bg-card', palette.bg);
  root.style.setProperty('--slot-header-pill-bg', palette.pillBg);
  const headerBg = normalizeHexColor(getHeaderBgColor(), DEFAULT_HEADER_BG_COLOR);
  if (
    headerBg === palette.bg ||
    headerBg === DEFAULT_HEADER_BG_COLOR ||
    headerBg === DEFAULT_DARK_HEADER_BG_COLOR
  ) {
    root.style.setProperty(
      '--slot-header-surface',
      headerBg === palette.bg
        ? 'linear-gradient(180deg, var(--bg-card) 82%, transparent 100%)'
        : headerBg
    );
    root.style.setProperty('--slot-header-text', palette.text);
    root.style.setProperty('--slot-header-subtext', palette.subtext);
    root.style.setProperty(
      '--slot-header-hover-bg',
      palette.isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(19, 23, 34, 0.06)'
    );
  }
}

function resolveBubblePalette(bgHex) {
  const bg = normalizeHexColor(bgHex, DEFAULT_BUBBLE_BG_COLOR);
  const color = colord(bg);
  const isDark = color.brightness() < 0.55;
  const rgb = color.toRgb();
  const ratio = isDark ? 0.22 : 0.14;
  const unreadBg =
    bg === '#ffffff'
      ? '#e7f3fd'
      : bg === '#172332'
        ? '#163650'
        : colord({
            r: Math.round(rgb.r * (1 - ratio) + 29 * ratio),
            g: Math.round(rgb.g * (1 - ratio) + 155 * ratio),
            b: Math.round(rgb.b * (1 - ratio) + 240 * ratio)
          }).toHex();
  return {
    bg,
    isDark,
    hoverBg: isDark ? color.lighten(0.04).toHex() : color.darken(0.015).toHex(),
    border: isDark
      ? 'rgba(255, 255, 255, 0.07)'
      : color.darken(0.07).alpha(0.55).toRgbString(),
    borderHover: isDark
      ? 'rgba(255, 255, 255, 0.13)'
      : color.darken(0.12).alpha(0.75).toRgbString(),
    text: isDark ? '#e4e9ef' : '#0f1419',
    timeText: isDark ? '#8696a7' : '#536471',
    unreadBg,
    unreadBorder: isDark
      ? 'rgba(29, 155, 240, 0.45)'
      : 'rgba(29, 155, 240, 0.38)'
  };
}

function applyBubbleColor(bgHex) {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const palette = resolveBubblePalette(bgHex);
  const root = document.documentElement;
  root.style.setProperty('--bg-bubble', palette.bg);
  root.style.setProperty('--bg-bubble-hover', palette.hoverBg);
  root.style.setProperty('--border-bubble', palette.border);
  root.style.setProperty('--border-bubble-hover', palette.borderHover);
  root.style.setProperty('--bubble-text-color', palette.text);
  root.style.setProperty('--bubble-time-color', palette.timeText);
  root.style.setProperty('--bg-bubble-unread', palette.unreadBg);
  root.style.setProperty('--border-bubble-unread', palette.unreadBorder);
}

function applyTheme(theme, btnThemeToggle) {
  const prevTheme = document.documentElement.getAttribute('data-theme');
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-mantine-color-scheme', theme === 'light' ? 'light' : 'dark');
  saveStoredTheme(theme);
  if (typeof clearPostWidgetCache === 'function') {
    clearPostWidgetCache();
  }
  const toggleEl = btnThemeToggle || document.getElementById('btn-theme-toggle');
  if (toggleEl) {
    toggleEl.setAttribute('aria-checked', theme === 'dark' ? 'true' : 'false');
    toggleEl.title = theme === 'light' ? t('nav.switchToDark') : t('nav.switchToLight');
  }

  if (prevTheme && prevTheme !== theme) {
    const curHeader = getHeaderBgColor();
    if (curHeader === DEFAULT_HEADER_BG_COLOR || curHeader === DEFAULT_DARK_HEADER_BG_COLOR) {
      const nextHeader = theme === 'light' ? DEFAULT_HEADER_BG_COLOR : DEFAULT_DARK_HEADER_BG_COLOR;
      saveHeaderBgColor(nextHeader);
      applyHeaderColor(nextHeader);
    }
    const curChat = getChatBgColor();
    if (curChat === DEFAULT_CHAT_BG_COLOR || curChat === DEFAULT_DARK_CHAT_BG_COLOR) {
      const nextChat = theme === 'light' ? DEFAULT_CHAT_BG_COLOR : DEFAULT_DARK_CHAT_BG_COLOR;
      saveChatBgColor(nextChat);
      applyChatBgColor(nextChat);
    }
    const curBubble = getBubbleBgColor();
    if (curBubble === DEFAULT_BUBBLE_BG_COLOR || curBubble === DEFAULT_DARK_BUBBLE_BG_COLOR) {
      const nextBubble = theme === 'light' ? DEFAULT_BUBBLE_BG_COLOR : DEFAULT_DARK_BUBBLE_BG_COLOR;
      saveBubbleBgColor(nextBubble);
      applyBubbleColor(nextBubble);
    }
  }
}

function initTheme(btnThemeToggle) {
  const saved = getStoredTheme();
  applyTheme(saved, btnThemeToggle);
  applyHeaderColor(getHeaderBgColor());
  applyChatBgColor(getChatBgColor());
  applyBubbleColor(getBubbleBgColor());

  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = cur === 'dark' ? 'light' : 'dark';
      applyTheme(next, btnThemeToggle);
    });
  }
}

module.exports = {
  applyTheme,
  initTheme,
  applyHeaderColor,
  resolveHeaderPalette,
  applyChatBgColor,
  resolveChatBgPalette,
  applyBubbleColor,
  resolveBubblePalette,
  normalizeHexColor
};
