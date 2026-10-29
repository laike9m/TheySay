import React from 'react';
import {
  Paper,
  Button,
  UnstyledButton,
  ThemeIcon,
  Badge,
  Divider
} from '@mantine/core';
import {
  IconUser,
  IconChevronDown,
  IconDownload,
  IconUpload
} from '@tabler/icons-react';
import { DiscordSvgIcon } from '../icons/PlatformIcons';

export function LoginDropdownMenu() {
  return (
    <div className="login-dropdown-wrapper" id="login-dropdown-wrapper">
      <Button
        id="btn-login-menu"
        variant="default"
        size="compact-xs"
        radius="md"
        className="btn-tool login-dropdown-btn"
        data-i18n-title="nav.loginMenuTitle"
        title="管理登录账号"
        leftSection={
          <span className="login-btn-left-group">
            <span
              className="login-menu-status-dot"
              id="login-menu-status-dot"
            />
            <IconUser
              className="login-menu-icon"
              size={13}
              stroke={2.2}
              aria-hidden="true"
            />
          </span>
        }
        rightSection={
          <IconChevronDown
            className="dropdown-chevron"
            size={11}
            stroke={2.5}
            aria-hidden="true"
          />
        }
      >
        <span data-i18n="nav.loginMenu">登录账号</span>
      </Button>

      <Paper
        className="login-dropdown-menu"
        id="login-dropdown-menu"
        shadow="lg"
        radius="md"
        withBorder
        style={{ display: 'none' }}
      >
        <div className="login-menu-header" data-i18n="auth.accountManagement">
          登录账号管理
        </div>
        <div className="login-menu-list">
          {/* Twitter / X */}
          <UnstyledButton
            className="login-menu-item"
            id="item-login-twitter"
            title="点击登录或切换 Twitter / X 账号"
          >
            <div className="login-item-left">
              <ThemeIcon
                variant="light"
                color="gray"
                size={28}
                radius="md"
                className="platform-icon twitter"
              >
                𝕏
              </ThemeIcon>
              <span className="platform-name">Twitter / X</span>
            </div>
            <div className="login-item-right">
              <Badge
                component="span"
                variant="light"
                size="xs"
                radius="xl"
                className="platform-status-badge checking"
                id="twitter-status-badge"
              >
                <span className="status-indicator-dot" />
                <span
                  className="status-label"
                  id="twitter-status-label"
                  data-i18n="auth.checking"
                >
                  检测中...
                </span>
              </Badge>
            </div>
          </UnstyledButton>

          {/* Threads */}
          <UnstyledButton
            className="login-menu-item"
            id="item-login-threads"
            title="点击登录或切换 Threads 账号"
          >
            <div className="login-item-left">
              <ThemeIcon
                variant="light"
                color="gray"
                size={28}
                radius="md"
                className="platform-icon threads"
              >
                @
              </ThemeIcon>
              <span className="platform-name">Threads</span>
            </div>
            <div className="login-item-right">
              <Badge
                component="span"
                variant="light"
                size="xs"
                radius="xl"
                className="platform-status-badge checking"
                id="threads-status-badge"
              >
                <span className="status-indicator-dot" />
                <span
                  className="status-label"
                  id="threads-status-label"
                  data-i18n="auth.checking"
                >
                  检测中...
                </span>
              </Badge>
            </div>
          </UnstyledButton>

          {/* Discord */}
          <UnstyledButton
            className="login-menu-item"
            id="item-login-discord"
            title="点击登录或切换 Discord 账号"
          >
            <div className="login-item-left">
              <ThemeIcon
                variant="light"
                color="indigo"
                size={28}
                radius="md"
                className="platform-icon discord"
              >
                <DiscordSvgIcon />
              </ThemeIcon>
              <span className="platform-name">Discord</span>
            </div>
            <div className="login-item-right">
              <Badge
                component="span"
                variant="light"
                size="xs"
                radius="xl"
                className="platform-status-badge logged-out"
                id="discord-status-badge"
              >
                <span className="status-indicator-dot" />
                <span
                  className="status-label"
                  id="discord-status-label"
                  data-i18n="auth.loggedOut"
                >
                  未登录
                </span>
              </Badge>
            </div>
          </UnstyledButton>
        </div>

        <Divider className="login-menu-divider" />
        <div className="login-menu-header" data-i18n="auth.profileSectionHeader">
          Profile 配置与关注列表
        </div>
        <div className="login-menu-list">
          {/* 导出 Profile */}
          <UnstyledButton
            className="login-menu-item"
            id="item-export-profile"
            data-i18n-title="auth.exportProfileTitle"
            title="导出全部设置与所有关注账号为 JSON 文件"
          >
            <div className="login-item-left">
              <ThemeIcon
                variant="light"
                color="brand"
                size={28}
                radius="md"
                className="platform-icon profile-export"
              >
                <IconDownload size={14} stroke={2.2} />
              </ThemeIcon>
              <span className="platform-name" data-i18n="auth.exportProfile">
                导出 Profile
              </span>
            </div>
            <div className="login-item-right">
              <Badge
                component="span"
                variant="default"
                size="xs"
                radius="sm"
                className="profile-action-hint"
              >
                JSON
              </Badge>
            </div>
          </UnstyledButton>

          {/* 导入 Profile */}
          <UnstyledButton
            className="login-menu-item"
            id="item-import-profile"
            data-i18n-title="auth.importProfileTitle"
            title="从 JSON 文件导入 Profile 配置（保留已抓取数据）"
          >
            <div className="login-item-left">
              <ThemeIcon
                variant="light"
                color="teal"
                size={28}
                radius="md"
                className="platform-icon profile-import"
              >
                <IconUpload size={14} stroke={2.2} />
              </ThemeIcon>
              <span className="platform-name" data-i18n="auth.importProfile">
                导入 Profile
              </span>
            </div>
            <div className="login-item-right">
              <Badge
                component="span"
                variant="default"
                size="xs"
                radius="sm"
                className="profile-action-hint"
                data-i18n="auth.importProfileHint"
              >
                恢复
              </Badge>
            </div>
          </UnstyledButton>
        </div>
      </Paper>
    </div>
  );
}
