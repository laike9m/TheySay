const { ipcRenderer, webFrame } = require('electron');

const MAIN_WORLD_DISCORD_GUARD_SCRIPT = `
(() => {
  try {
    if (window.__theysayDiscordGuardInstalled) return;
    window.__theysayDiscordGuardInstalled = true;

    // 1. Neutralize Discord's DevTools dimension heuristic:
    // Discord polls every 500ms checking if (outerWidth - innerWidth > 160) XOR (outerHeight - innerHeight > 160).
    // In an offscreen <webview> or resized host window, outerHeight reflects the host BrowserWindow height,
    // which falsely triggers TokenManager.hideToken() and deletes 'token' & 'tokens' from localStorage.
    try {
      Object.defineProperty(window, 'outerWidth', {
        get: () => window.innerWidth,
        configurable: true
      });
      Object.defineProperty(window, 'outerHeight', {
        get: () => window.innerHeight,
        configurable: true
      });
    } catch (_) {}

    // 2. Capture localStorage reference and prevent hideToken() from deleting 'token' / 'tokens'
    const origSetItem = Storage.prototype.setItem;
    const origRemoveItem = Storage.prototype.removeItem;
    const origGetItem = Storage.prototype.getItem;

    try {
      if (window.localStorage) {
        window.__theysayDiscordLS = window.localStorage;
      }
    } catch (_) {}

    Storage.prototype.getItem = function(key) {
      if (this !== window.sessionStorage && !window.__theysayDiscordLS) {
        window.__theysayDiscordLS = this;
      }
      return origGetItem.call(this, key);
    };

    Storage.prototype.setItem = function(key, value) {
      if (this !== window.sessionStorage) {
        window.__theysayDiscordLS = this;
        if (!window.__theysayAllowDiscordTokenClear) {
          if (key === 'token') {
            const strVal = String(value || '').trim();
            if (strVal && strVal !== 'null' && strVal !== '""') {
              try {
                origSetItem.call(this, '__theysay_discord_token_backup', strVal);
              } catch (_) {}
            } else {
              try {
                const backup = origGetItem.call(this, '__theysay_discord_token_backup');
                if (backup) return;
              } catch (_) {}
            }
          } else if (key === 'tokens') {
            const strVal = String(value || '').trim();
            if (strVal && strVal !== '{}' && strVal !== 'null') {
              try {
                origSetItem.call(this, '__theysay_discord_tokens_backup', strVal);
              } catch (_) {}
            } else if (strVal === '{}' || strVal === 'null') {
              try {
                const backup = origGetItem.call(this, '__theysay_discord_tokens_backup');
                if (backup && backup !== '{}') return;
              } catch (_) {}
            }
          }
        }
      }
      return origSetItem.call(this, key, value);
    };

    Storage.prototype.removeItem = function(key) {
      if (this !== window.sessionStorage) {
        window.__theysayDiscordLS = this;
        if (!window.__theysayAllowDiscordTokenClear && (key === 'token' || key === 'tokens')) {
          return;
        }
      }
      return origRemoveItem.call(this, key);
    };
  } catch (_) {}
})();
`;

function restoreOrBackupDiscordLocalStorage() {
  try {
    const host = (window.location && window.location.hostname) || '';
    if (host !== 'discord.com' && !host.endsWith('.discord.com')) return;

    const ls = window.localStorage;
    if (!ls) return;

    const syncState = ipcRenderer.sendSync('discord-preload-sync');
    const allowClear = Boolean(syncState && syncState.allowTokenClear);
    if (allowClear) return;

    let rawToken = ls.getItem('token');
    let rawTokens = ls.getItem('tokens');
    const backupTokenLocal = ls.getItem('__theysay_discord_token_backup');
    const backupTokensLocal = ls.getItem('__theysay_discord_tokens_backup');

    const parseJsonSafe = (str) => {
      if (!str) return null;
      try {
        return JSON.parse(str);
      } catch (_) {
        return null;
      }
    };

    let tokenVal = parseJsonSafe(rawToken);
    if (typeof tokenVal !== 'string' || !tokenVal.trim()) {
      tokenVal = '';
    }

    // 1. If token is missing in localStorage, restore from local backup or main-process backup
    if (!tokenVal) {
      const localCandidate = parseJsonSafe(backupTokenLocal);
      const mainBackup = syncState && syncState.backup ? syncState.backup : null;
      const restoredToken =
        (typeof localCandidate === 'string' && localCandidate.trim()) ||
        (mainBackup && typeof mainBackup.token === 'string' && mainBackup.token.trim()) ||
        '';

      if (restoredToken) {
        const tokenJson = JSON.stringify(restoredToken);
        ls.setItem('token', tokenJson);
        ls.setItem('__theysay_discord_token_backup', tokenJson);
        tokenVal = restoredToken;

        let tokensObj = parseJsonSafe(rawTokens);
        if (!tokensObj || typeof tokensObj !== 'object' || Object.keys(tokensObj).length === 0) {
          tokensObj =
            parseJsonSafe(backupTokensLocal) ||
            (mainBackup && mainBackup.tokens && typeof mainBackup.tokens === 'object'
              ? mainBackup.tokens
              : null);
        }
        if (!tokensObj || typeof tokensObj !== 'object') {
          tokensObj = {};
        }
        if (mainBackup && mainBackup.userId && !tokensObj[mainBackup.userId]) {
          tokensObj[mainBackup.userId] = restoredToken;
        }
        if (Object.keys(tokensObj).length > 0) {
          const tokensJson = JSON.stringify(tokensObj);
          ls.setItem('tokens', tokensJson);
          ls.setItem('__theysay_discord_tokens_backup', tokensJson);
        }

        if (mainBackup && mainBackup.multiAccountStore) {
          const existingMa = parseJsonSafe(ls.getItem('MultiAccountStore'));
          const maToWrite = existingMa && existingMa._state && Array.isArray(existingMa._state.users)
            ? existingMa
            : mainBackup.multiAccountStore;
          if (maToWrite && maToWrite._state && Array.isArray(maToWrite._state.users)) {
            maToWrite._state.users.forEach((u) => {
              if (u && typeof u === 'object') u.tokenStatus = 2;
            });
            ls.setItem('MultiAccountStore', JSON.stringify(maToWrite));
          }
        }
      }
    } else {
      // 2. Token is present in localStorage; mirror to backup keys and notify main process
      ls.setItem('__theysay_discord_token_backup', JSON.stringify(tokenVal));
      const tokensObj = parseJsonSafe(rawTokens);
      if (tokensObj && typeof tokensObj === 'object' && Object.keys(tokensObj).length > 0) {
        ls.setItem('__theysay_discord_tokens_backup', JSON.stringify(tokensObj));
      }
      const maObj = parseJsonSafe(ls.getItem('MultiAccountStore'));
      ipcRenderer.send('discord-auth-captured', {
        token: tokenVal,
        tokens: tokensObj && typeof tokensObj === 'object' ? tokensObj : null,
        multiAccountStore: maObj && typeof maObj === 'object' ? maObj : null
      });
    }
  } catch (_) {}
}

restoreOrBackupDiscordLocalStorage();

try {
  if (webFrame && typeof webFrame.executeJavaScript === 'function') {
    webFrame.executeJavaScript(MAIN_WORLD_DISCORD_GUARD_SCRIPT).catch(() => {});
  }
} catch (_) {}
