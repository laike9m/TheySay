function escapeHtml(text) {
  if (typeof document !== 'undefined' && document.createElement) {
    const div = document.createElement('div');
    div.innerText = text;
    return div.innerHTML;
  }
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function randomBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatFetchTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const pad = n => String(n).padStart(2, '0');
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  return `${hours}:${minutes}:${seconds}`;
}

function showToast(message, type = 'warning', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast-message toast-${type}`;
  const icon = type === 'warning' ? '⚠️' : (type === 'error' ? '❌' : (type === 'success' ? '✅' : 'ℹ️'));
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-text">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.add('toast-show');
  });

  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 250);
  }, duration);
}

const dns = require('dns');

function isNetworkOnline() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }
  return true;
}

async function canReachHost(hostnameOrUrl, timeoutMs = 2500) {
  if (!isNetworkOnline()) return false;
  let hostname = String(hostnameOrUrl || '').trim();
  if (!hostname) return true;
  try {
    if (hostname.includes('://')) {
      hostname = new URL(hostname).hostname;
    }
  } catch (e) {
    return false;
  }
  if (!hostname) return true;

  let timer = null;
  try {
    await Promise.race([
      dns.promises.lookup(hostname),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS_TIMEOUT')), timeoutMs);
      })
    ]);
    return true;
  } catch (e) {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}


module.exports = {
  escapeHtml,
  randomBetween,
  sleep,
  formatFetchTime,
  showToast,
  isNetworkOnline,
  canReachHost
};
