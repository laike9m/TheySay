const { getStoredTheme, saveStoredTheme } = require('./storage');

function applyTheme(theme, btnThemeToggle) {
  document.documentElement.setAttribute('data-theme', theme);
  saveStoredTheme(theme);
  if (btnThemeToggle) {
    btnThemeToggle.setAttribute('aria-checked', theme === 'dark' ? 'true' : 'false');
    btnThemeToggle.title = theme === 'light' ? '切换深色模式' : '切换浅色模式';
  }
}

function initTheme(btnThemeToggle) {
  const saved = getStoredTheme();
  applyTheme(saved, btnThemeToggle);

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
  initTheme
};
