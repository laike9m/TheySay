import React, { useState, useEffect } from 'react';
import {
  Group,
  Stack,
  Paper,
  ActionIcon,
  Button,
  NativeSelect,
  Divider,
  Title,
  Tooltip
} from '@mantine/core';
import {
  IconChecks,
  IconSun,
  IconMoon,
  IconSettings,
  IconLayoutGrid,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand
} from '@tabler/icons-react';
import { BrandLogoIcon } from '../icons/PlatformIcons';
import { LoginDropdownMenu } from './LoginDropdownMenu';

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'theysay_sidebar_collapsed';

function readInitialCollapsed() {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
      if (saved === '0' || saved === 'false') return false;
      if (saved === '1' || saved === 'true') return true;
    }
  } catch (_) {}
  return true;
}

function getLangIsEn() {
  if (typeof document === 'undefined') return false;
  const lang = (document.documentElement.getAttribute('lang') || '').toLowerCase();
  return lang.startsWith('en');
}

function getThemeIsLight() {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('data-theme') === 'light';
}

export function TopNav() {
  const [collapsed, setCollapsed] = useState(readInitialCollapsed);
  const [isEn, setIsEn] = useState(getLangIsEn);
  const [isLight, setIsLight] = useState(getThemeIsLight);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return undefined;
    }
    const root = document.documentElement;
    setIsEn(getLangIsEn());
    setIsLight(getThemeIsLight());
    const observer = new MutationObserver(() => {
      setIsEn(getLangIsEn());
      setIsLight(getThemeIsLight());
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['lang', 'data-theme']
    });
    return () => observer.disconnect();
  }, []);

  const handleToggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, next ? '1' : '0');
        }
      } catch (_) {}
      return next;
    });
  };

  const labels = isEn
    ? {
        markAllRead: 'Mark All Read',
        gridLayout: 'Grid Layout',
        loginMenu: 'Accounts',
        themeToggle: isLight ? 'Switch to dark mode' : 'Switch to light mode',
        themeLabel: isLight ? 'Light Mode' : 'Dark Mode',
        settings: 'Settings',
        toggleSidebar: collapsed ? 'Expand sidebar' : 'Collapse sidebar'
      }
    : {
        markAllRead: '全部已读',
        gridLayout: '网格布局',
        loginMenu: '登录账号',
        themeToggle: isLight ? '切换深色模式' : '切换浅色模式',
        themeLabel: isLight ? '浅色模式' : '深色模式',
        settings: '设置',
        toggleSidebar: collapsed ? '展开侧边栏' : '收起侧边栏'
      };

  return (
    <Paper
      component="header"
      className={`top-nav mantine-top-nav mantine-side-nav ${
        collapsed ? 'is-collapsed' : 'is-expanded'
      }`}
      radius={0}
      withBorder={false}
    >
      {/* Top Brand & Collapse/Expand Toggle */}
      <div className="sidebar-brand-section">
        <Group className="nav-brand" gap={7} wrap="nowrap">
          <BrandLogoIcon />
          <div className="brand-text">
            <Title order={1} className="brand-title" size="0.94rem">
              TheySay
            </Title>
          </div>
        </Group>

        <Tooltip label={labels.toggleSidebar} position="right" withArrow>
          <ActionIcon
            id="btn-sidebar-toggle"
            variant="subtle"
            size={30}
            radius="md"
            className="sidebar-nav-item btn-sidebar-toggle"
            data-i18n-title="nav.toggleSidebar"
            title={labels.toggleSidebar}
            aria-label={labels.toggleSidebar}
            onClick={handleToggleSidebar}
          >
            {collapsed ? (
              <IconLayoutSidebarLeftExpand size={17} stroke={1.8} />
            ) : (
              <IconLayoutSidebarLeftCollapse size={17} stroke={1.8} />
            )}
          </ActionIcon>
        </Tooltip>
      </div>

      <Divider className="sidebar-section-divider" />

      {/* All Navigation & Utility Controls Grouped at Top */}
      <Stack className="nav-controls" gap={4}>
        {/* 1. 全部已读按钮 */}
        <Tooltip
          label={labels.markAllRead}
          position="right"
          withArrow
          disabled={!collapsed}
        >
          <Button
            id="btn-mark-all-read"
            variant="subtle"
            size="compact-sm"
            radius="md"
            fullWidth
            className="btn-tool sidebar-nav-item"
            data-i18n-title="nav.markAllReadTitle"
            title="将所有推文标记为已读"
            leftSection={
              <span className="sidebar-icon-wrap">
                <IconChecks
                  className="icon-check-check"
                  size={18}
                  stroke={1.8}
                  aria-hidden="true"
                />
              </span>
            }
          >
            <span className="sidebar-label-text" data-i18n="nav.markAllRead">
              全部已读
            </span>
          </Button>
        </Tooltip>

        {/* 2. 网格布局切换器 (Mantine NativeSelect) */}
        <Tooltip
          label={labels.gridLayout}
          position="right"
          withArrow
          disabled={!collapsed}
        >
          <Group className="sidebar-nav-item layout-control-group" gap={8} wrap="nowrap">
            <span className="sidebar-icon-wrap">
              <IconLayoutGrid
                className="layout-grid-icon"
                size={18}
                stroke={1.8}
                aria-hidden="true"
              />
            </span>
            <label
              htmlFor="layout-select"
              className="control-label sidebar-label-text"
              data-i18n="nav.gridLayout"
            >
              网格布局:
            </label>
            <NativeSelect
              id="layout-select"
              size="xs"
              defaultValue="2x2"
              classNames={{
                root: 'mantine-layout-select-root',
                input: 'layout-select'
              }}
            >
              <option value="2x2">2 × 2</option>
              <option value="2x3">2 × 3</option>
              <option value="3x2">3 × 2</option>
              <option value="3x3">3 × 3</option>
              <option value="4x4">4 × 4</option>
            </NativeSelect>
          </Group>
        </Tooltip>

        {/* 3. 登录账号与 Profile 下拉菜单 */}
        <LoginDropdownMenu
          collapsed={collapsed}
          tooltipLabel={labels.loginMenu}
        />

        {/* 4. 深色 / 浅色模式切换 */}
        <Tooltip
          label={labels.themeToggle}
          position="right"
          withArrow
          disabled={!collapsed}
        >
          <Button
            id="btn-theme-toggle"
            variant="subtle"
            size="compact-sm"
            radius="md"
            fullWidth
            className="btn-tool sidebar-nav-item theme-toggle"
            role="switch"
            aria-checked="false"
            title={labels.themeToggle}
            leftSection={
              <span className="sidebar-icon-wrap">
                <IconSun
                  className="theme-thumb-icon sun"
                  size={18}
                  stroke={1.8}
                  aria-hidden="true"
                />
                <IconMoon
                  className="theme-thumb-icon moon"
                  size={18}
                  stroke={1.8}
                  aria-hidden="true"
                />
              </span>
            }
          >
            <span className="sidebar-label-text">{labels.themeLabel}</span>
          </Button>
        </Tooltip>

        {/* 5. 偏好设置按钮 */}
        <Tooltip
          label={labels.settings}
          position="right"
          withArrow
          disabled={!collapsed}
        >
          <ActionIcon
            id="btn-settings"
            variant="subtle"
            radius="md"
            className="btn-tool sidebar-nav-item btn-settings"
            data-i18n-title="nav.settings"
            data-i18n-aria-label="nav.settings"
            title="设置"
            aria-label="设置"
          >
            <span className="sidebar-icon-wrap">
              <IconSettings
                className="settings-gear-icon"
                size={18}
                stroke={1.8}
                aria-hidden="true"
              />
            </span>
            <span className="sidebar-label-text" data-i18n="nav.settings">
              设置
            </span>
          </ActionIcon>
        </Tooltip>
      </Stack>
    </Paper>
  );
}
