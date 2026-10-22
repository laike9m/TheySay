const { DEFAULT_HEADER_BG_COLOR, HEADER_COLOR_PRESETS } = require('../core/constants');
const { getStoredTheme, saveStoredTheme, getHeaderBgColor } = require('../core/storage');
const { clearPostWidgetCache } = require('./popup');
const { t } = require('../core/i18n');

function normalizeHex(val, fallback = DEFAULT_HEADER_BG_COLOR) {
  const str = String(val || '').trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(str)) return str.toLowerCase();
  if (/^[0-9A-Fa-f]{6}$/.test(str)) return `#${str.toLowerCase()}`;
  return fallback;
}

function shadeRgb(r, g, b, factor) {
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  const toHex = (n) => clamp(n).toString(16).padStart(2, '0');
  return `#${toHex(r * factor)}${toHex(g * factor)}${toHex(b * factor)}`;
}

function resolveHeaderPalette(bgHex) {
  const bg = normalizeHex(bgHex, DEFAULT_HEADER_BG_COLOR);
  const preset = HEADER_COLOR_PRESETS.find((p) => p.bg.toLowerCase() === bg);
  if (preset) {
    return { ...preset, name: t(`settings.colorPreset.${preset.id}`) };
  }

  const r = parseInt(bg.slice(1, 3), 16);
  const g = parseInt(bg.slice(3, 5), 16);
  const b = parseInt(bg.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const isDark = lum < 0.55;

  if (isDark) {
    return {
      id: 'custom',
      name: t('settings.customColor'),
      bg,
      text: '#f8fafc',
      subtext: 'rgba(248, 250, 252, 0.72)',
      border: shadeRgb(r, g, b, 0.78),
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
    border: shadeRgb(r, g, b, 0.9),
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
  resolveHeaderPalette
};
