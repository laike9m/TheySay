import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { mantineTheme } from './components/theme';
import { ColorSchemeSync } from './components/ColorSchemeSync';
import { TopNav } from './components/nav/TopNav';
import { AuthExpiredBanner } from './components/nav/AuthExpiredBanner';
import { SettingsModal } from './components/settings/SettingsModal';

let isMounted = false;

export function mountMantineShell() {
  if (isMounted || typeof document === 'undefined') return;
  const topRootEl = document.getElementById('mantine-top-shell-root');
  const modalsRootEl = document.getElementById('mantine-modals-root');
  if (!topRootEl || !modalsRootEl) return;

  isMounted = true;
  const initialScheme =
    document.documentElement.getAttribute('data-theme') === 'light'
      ? 'light'
      : 'dark';
  document.documentElement.setAttribute('data-mantine-color-scheme', initialScheme);

  const topRoot = createRoot(topRootEl);
  const modalsRoot = createRoot(modalsRootEl);

  flushSync(() => {
    topRoot.render(
      <MantineProvider theme={mantineTheme} defaultColorScheme={initialScheme}>
        <ColorSchemeSync />
        <Notifications position="top-center" zIndex={10000} containerWidth={380} />
        <TopNav />
        <AuthExpiredBanner />
      </MantineProvider>
    );
    modalsRoot.render(
      <MantineProvider theme={mantineTheme} defaultColorScheme={initialScheme}>
        <SettingsModal />
      </MantineProvider>
    );
  });

  if (typeof window !== 'undefined') {
    window.__THEYSAY_MANTINE_NOTIFY = ({ message, type = 'warning', duration = 4000 }) => {
      const colorMap = {
        success: 'teal',
        error: 'red',
        warning: 'yellow',
        info: 'blue'
      };
      try {
        notifications.show({
          message,
          color: colorMap[type] || 'blue',
          autoClose: duration,
          withCloseButton: false,
          className: `mantine-toast-item toast-${type}`
        });
      } catch (_) {}
    };
  }
}
