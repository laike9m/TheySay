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
import { SlotCard } from './components/slot/SlotCard';
import { SlotMuteIcon, SlotExpandIcon } from './components/slot/SlotIcons';
import { SlotSourceDropdownContent } from './components/slot/SlotSourceDropdown';
import { SlotSizeMenuContent } from './components/slot/SlotSizeMenu';
import { PostTimeline } from './components/slot/PostBubble';
import { PostPopupOverlay } from './components/popup/PostPopupOverlay';
import { TwitterFallbackCard } from './components/popup/TwitterFallbackCard';
import { DiscordPopupCard } from './components/popup/DiscordPopupCard';
import { ThreadsPopupCard } from './components/popup/ThreadsPopupCard';

let isMounted = false;
let timelineRenderSeq = 0;
let popupRenderSeq = 0;
const elementRoots = new WeakMap();

function getCurrentScheme() {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light'
    ? 'light'
    : 'dark';
}

function getOrCreateRoot(el) {
  let root = elementRoots.get(el);
  if (!root) {
    root = createRoot(el);
    elementRoots.set(el, root);
  }
  return root;
}

function renderInSubtreeRoot(el, node) {
  if (!el) return;
  const root = getOrCreateRoot(el);
  const scheme = getCurrentScheme();
  flushSync(() => {
    root.render(
      <MantineProvider
        theme={mantineTheme}
        defaultColorScheme={scheme}
        withCssVariables={false}
        withGlobalClasses={false}
      >
        {node}
      </MantineProvider>
    );
  });
}

export function mountMantineShell() {
  if (isMounted || typeof document === 'undefined') return;
  const topRootEl = document.getElementById('mantine-top-shell-root');
  const modalsRootEl = document.getElementById('mantine-modals-root');
  if (!topRootEl || !modalsRootEl) return;

  isMounted = true;
  const initialScheme = getCurrentScheme();
  document.documentElement.setAttribute(
    'data-mantine-color-scheme',
    initialScheme
  );

  const topRoot = createRoot(topRootEl);
  const modalsRoot = createRoot(modalsRootEl);

  flushSync(() => {
    topRoot.render(
      <MantineProvider theme={mantineTheme} defaultColorScheme={initialScheme}>
        <ColorSchemeSync />
        <Notifications
          position="top-center"
          zIndex={10000}
          containerWidth={380}
        />
        <TopNav />
        <AuthExpiredBanner />
      </MantineProvider>
    );
    modalsRoot.render(
      <MantineProvider
        theme={mantineTheme}
        defaultColorScheme={initialScheme}
        withCssVariables={false}
        withGlobalClasses={false}
      >
        <PostPopupOverlay />
        <SettingsModal />
      </MantineProvider>
    );
  });

  if (typeof window !== 'undefined') {
    window.__THEYSAY_MANTINE_NOTIFY = ({
      message,
      type = 'warning',
      duration = 4000
    }) => {
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

export function mountMantineSlotCard(containerEl, index, labels = {}) {
  renderInSubtreeRoot(containerEl, <SlotCard index={index} labels={labels} />);
}

export function renderMantineMuteIcon(iconWrapEl, isMuted) {
  if (!iconWrapEl) return;
  const root = getOrCreateRoot(iconWrapEl);
  flushSync(() => {
    root.render(<SlotMuteIcon isMuted={isMuted} />);
  });
}

export function renderMantineExpandIcon(iconWrapEl, r = 1, c = 1) {
  if (!iconWrapEl) return;
  const root = getOrCreateRoot(iconWrapEl);
  flushSync(() => {
    root.render(<SlotExpandIcon r={r} c={c} />);
  });
}

export function renderMantineSlotSourceDropdown(dropdownEl, props) {
  renderInSubtreeRoot(dropdownEl, <SlotSourceDropdownContent {...props} />);
}

export function clearMantineSlotSourceDropdown(dropdownEl) {
  if (!dropdownEl) return;
  if (elementRoots.has(dropdownEl)) {
    flushSync(() => {
      elementRoots.get(dropdownEl).render(null);
    });
  } else {
    dropdownEl.innerHTML = '';
  }
}

export function renderMantineSlotSizeMenu(menuEl, props) {
  renderInSubtreeRoot(menuEl, <SlotSizeMenuContent {...props} />);
}

export function renderMantineSlotPosts(postsListEl, props) {
  timelineRenderSeq += 1;
  renderInSubtreeRoot(
    postsListEl,
    <PostTimeline key={timelineRenderSeq} {...props} />
  );
}

export function clearMantineSlotPosts(postsListEl) {
  if (!postsListEl) return;
  if (elementRoots.has(postsListEl)) {
    flushSync(() => {
      elementRoots.get(postsListEl).render(null);
    });
  } else {
    postsListEl.innerHTML = '';
  }
}

export function renderMantineTwitterFallbackCard(containerEl, props) {
  popupRenderSeq += 1;
  renderInSubtreeRoot(
    containerEl,
    <TwitterFallbackCard key={popupRenderSeq} {...props} />
  );
}

export function renderMantineDiscordPopupCard(containerEl, props) {
  popupRenderSeq += 1;
  renderInSubtreeRoot(
    containerEl,
    <DiscordPopupCard key={popupRenderSeq} {...props} />
  );
}

export function renderMantineThreadsPopupCard(containerEl, props) {
  popupRenderSeq += 1;
  renderInSubtreeRoot(
    containerEl,
    <ThreadsPopupCard key={popupRenderSeq} {...props} />
  );
}

