import React from 'react';
import {
  Group,
  Paper,
  ActionIcon,
  NativeSelect,
  UnstyledButton,
  Divider,
  Title
} from '@mantine/core';
import {
  IconChecks,
  IconSun,
  IconMoon,
  IconSettings
} from '@tabler/icons-react';
import { BrandLogoIcon } from '../icons/PlatformIcons';
import { LoginDropdownMenu } from './LoginDropdownMenu';

export function TopNav() {
  return (
    <Paper
      component="header"
      className="top-nav mantine-top-nav"
      radius={0}
      withBorder={false}
    >
      <Group className="nav-brand" gap={9} wrap="nowrap">
        <BrandLogoIcon />
        <div className="brand-text">
          <Title order={1} className="brand-title" size="0.98rem">
            TheySay
          </Title>
        </div>
      </Group>

      <Group className="nav-controls" gap={10} wrap="nowrap">
        {/* 全部已读按钮 */}
        <UnstyledButton
          id="btn-mark-all-read"
          className="btn-tool"
          data-i18n-title="nav.markAllReadTitle"
          title="将所有推文标记为已读"
        >
          <IconChecks
            className="icon-check-check"
            size={13}
            stroke={2.2}
            aria-hidden="true"
          />
          <span data-i18n="nav.markAllRead">全部已读</span>
        </UnstyledButton>

        {/* 布局切换选择器 (Mantine NativeSelect) */}
        <Group className="layout-control-group" gap={6} wrap="nowrap">
          <label
            htmlFor="layout-select"
            className="control-label"
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

        <Divider orientation="vertical" className="nav-divider" />

        {/* 深色 / 浅色模式切换 Toggle */}
        <UnstyledButton
          id="btn-theme-toggle"
          className="theme-toggle"
          role="switch"
          aria-checked="false"
          title="切换深色 / 浅色模式"
        >
          <span className="theme-toggle-track">
            <span className="theme-toggle-bg-icon sun" aria-hidden="true">
              <IconSun size={11} stroke={2.5} />
            </span>
            <span className="theme-toggle-bg-icon moon" aria-hidden="true">
              <IconMoon size={11} stroke={2.5} />
            </span>
            <span className="theme-toggle-thumb">
              <IconSun
                className="theme-thumb-icon sun"
                size={12}
                stroke={2.5}
                aria-hidden="true"
              />
              <IconMoon
                className="theme-thumb-icon moon"
                size={11}
                stroke={2.5}
                aria-hidden="true"
              />
            </span>
          </span>
        </UnstyledButton>

        <Divider orientation="vertical" className="nav-divider" />

        {/* 设置按钮 (Mantine ActionIcon) */}
        <ActionIcon
          id="btn-settings"
          variant="subtle"
          className="btn-tool btn-settings"
          data-i18n-title="nav.settings"
          data-i18n-aria-label="nav.settings"
          title="设置"
          aria-label="设置"
        >
          <IconSettings
            className="settings-gear-icon"
            size={14}
            stroke={2}
            aria-hidden="true"
          />
        </ActionIcon>

        {/* 登录账号与 Profile 下拉菜单 */}
        <LoginDropdownMenu />
      </Group>
    </Paper>
  );
}
