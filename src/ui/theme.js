const { colord } = require('colord');
const { DEFAULT_HEADER_BG_COLOR, HEADER_COLOR_PRESETS } = require('../core/constants');
const { getStoredTheme, saveStoredTheme, getHeaderBgColor } = require('../core/storage');
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
    subtext: '#536471',
    border: color.darken(0.08).toHex(),
    hoverBg: 'rgba(15, 23, 42, 0.07)',
    activeIcon: '#1d9bf0',
    activeBg: 'rgba(29, 155, 240, 0.15)',
    badgeBorder: 'transparent'
  };
}

function applyHeaderColor(bgHex) {
  if (typeof document === 'undefined' || !document.documentElement) return;
  const palette = resolveHeaderPalette(bgHex);
  const root = document.documentElement;
  root.style.setProperty('--slot-header-bg', palette.bg);
  root.style.setProperty('--slot-header-text', palette.text);
  root.style.setProperty('--slot-header-subtext', palette.subtext);
  root.style.setProperty('--slot-header-border', palette.border);
  root.style.setProperty('--slot-header-hover-bg', palette.hoverBg);
  root.style.setProperty('--slot-header-active-icon', palette.activeIcon);
  root.style.setProperty('--slot-header-active-bg', palette.activeBg);
  root.style.setProperty('--slot-header-badge-border', palette.badgeBorder || 'transparent');
}

function applyTheme(theme, btnThemeToggle) {
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
}

function initTheme(btnThemeToggle) {
  const saved = getStoredTheme();
  applyTheme(saved, btnThemeToggle);
  applyHeaderColor(getHeaderBgColor());

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
  normalizeHexColor
};
