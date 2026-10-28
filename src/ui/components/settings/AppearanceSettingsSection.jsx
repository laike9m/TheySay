import React from 'react';
import { Paper, ColorSwatch, UnstyledButton } from '@mantine/core';
import { IconLayoutNavbar, IconInfoCircle } from '@tabler/icons-react';
import { HEADER_PRESETS, TICKER_PRESETS } from '../theme';

export function AppearanceSettingsSection() {
  return (
    <div className="settings-section">
      <div
        className="settings-section-title"
        data-i18n="settings.sectionAppearance"
      >
        外观
      </div>
      <Paper className="settings-group" radius="md" withBorder={false}>
        {/* Title 栏背景配色 (Mantine ColorSwatch) */}
        <div className="settings-row">
          <div className="settings-row-main">
            <span className="platform-icon header-theme">
              <IconLayoutNavbar size={14} stroke={2.1} />
            </span>
            <div className="settings-row-text">
              <div
                className="settings-row-title"
                data-i18n="settings.headerColorLabel"
              >
                Title 栏配色
              </div>
              <div
                className="settings-row-subtitle"
                data-i18n="settings.headerColorSubtitle"
              >
                卡片标题栏背景色
              </div>
            </div>
          </div>
          <div className="settings-color-inline-group">
            <div id="setting-header-presets" className="ticker-preset-list">
              {HEADER_PRESETS.map((bg) => (
                <ColorSwatch
                  key={bg}
                  component="button"
                  type="button"
                  color={bg}
                  size={18}
                  radius="sm"
                  withShadow={false}
                  className="ticker-preset-chip header-preset-chip"
                  data-bg={bg}
                  style={{ backgroundColor: bg }}
                  title={bg}
                  aria-label={bg}
                />
              ))}
            </div>
            <span className="color-inline-divider"></span>
            <div className="settings-color-custom">
              <div className="settings-color-field">
                <span
                  className="color-sub-label"
                  data-i18n="settings.customColor"
                >
                  自定义
                </span>
                <input
                  type="color"
                  id="setting-header-bg-color"
                  className="ticker-color-input"
                  defaultValue="#f3ede2"
                  data-i18n-title="settings.headerColorInputTitle"
                  title="自定义 Title 栏背景颜色"
                />
                <input
                  type="text"
                  id="setting-header-bg-hex"
                  className="ticker-hex-input"
                  defaultValue="#f3ede2"
                  maxLength={7}
                  spellCheck={false}
                  data-i18n-aria-label="settings.headerColorHexAria"
                  aria-label="Title 栏背景色 Hex"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Ticker 高亮配色 (Mantine ColorSwatch) */}
        <div className="settings-row">
          <div className="settings-row-main">
            <span className="platform-icon ticker">$</span>
            <div className="settings-row-text">
              <div
                className="settings-row-title"
                data-i18n="settings.tickerHighlightLabel"
              >
                高亮显示 Ticker
              </div>
              <div
                className="settings-row-subtitle"
                data-i18n="settings.tickerHighlightSubtitle"
              >
                自动高亮美股代码
              </div>
            </div>
          </div>
          <div className="settings-color-inline-group">
            <div id="setting-ticker-presets" className="ticker-preset-list">
              {TICKER_PRESETS.map(({ fg, bg }) => (
                <ColorSwatch
                  key={`${fg}-${bg}`}
                  component="button"
                  type="button"
                  color={bg}
                  size={18}
                  radius="sm"
                  withShadow={false}
                  className="ticker-preset-chip"
                  data-fg={fg}
                  data-bg={bg}
                  style={{ backgroundColor: bg }}
                  title={`${fg} / ${bg}`}
                  aria-label={`${fg} / ${bg}`}
                />
              ))}
            </div>
            <span className="color-inline-divider"></span>
            <div className="settings-color-custom">
              <div className="settings-color-field">
                <span
                  className="color-sub-label"
                  data-i18n="settings.tickerFgLabel"
                >
                  文字
                </span>
                <input
                  type="color"
                  id="setting-ticker-fg-color"
                  className="ticker-color-input"
                  defaultValue="#fde047"
                  data-i18n-title="settings.tickerFgInputTitle"
                  title="选择 Ticker 文字颜色"
                />
                <input
                  type="text"
                  id="setting-ticker-fg-hex"
                  className="ticker-hex-input"
                  defaultValue="#fde047"
                  maxLength={7}
                  spellCheck={false}
                  data-i18n-aria-label="settings.tickerFgHexAria"
                  aria-label="Ticker 前景色 Hex"
                />
              </div>
              <div className="settings-color-field">
                <span
                  className="color-sub-label"
                  data-i18n="settings.tickerBgLabel"
                >
                  底色
                </span>
                <input
                  type="color"
                  id="setting-ticker-bg-color"
                  className="ticker-color-input"
                  defaultValue="#422006"
                  data-i18n-title="settings.tickerBgInputTitle"
                  title="选择 Ticker 背景颜色"
                />
                <input
                  type="text"
                  id="setting-ticker-bg-hex"
                  className="ticker-hex-input"
                  defaultValue="#422006"
                  maxLength={7}
                  spellCheck={false}
                  data-i18n-aria-label="settings.tickerBgHexAria"
                  aria-label="Ticker 背景色 Hex"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 实时预览卡片 + 词库提示 */}
        <div className="settings-row settings-row-block">
          <div className="header-preview-card" id="setting-header-preview">
            <div className="header-preview-bar" id="setting-header-preview-bar">
              <span
                className="header-preview-drag"
                id="setting-header-preview-drag"
              >
                ⠿
              </span>
              <span
                className="header-preview-avatar"
                data-i18n="settings.previewAvatar"
              >
                示
              </span>
              <span
                className="header-preview-name"
                id="setting-header-preview-name"
                data-i18n="settings.previewName"
              >
                示例账号
              </span>
              <span
                className="header-preview-handle"
                id="setting-header-preview-handle"
              >
                @example_user
              </span>
              <span
                className="header-preview-icon"
                id="setting-header-preview-icon"
              >
                ⤢
              </span>
            </div>
            <div className="header-preview-body" id="setting-ticker-preview">
              <div className="header-preview-bubble read">
                <span
                  id="setting-ticker-preview-text"
                  data-i18n-html="settings.previewPostHtml"
                >
                  关注{' '}
                  <span className="ticker-highlight ticker-preview-chip">
                    $NVDA
                  </span>{' '}
                  与{' '}
                  <span className="ticker-highlight ticker-preview-chip">
                    AAPL
                  </span>{' '}
                  财报表现，留意{' '}
                  <span className="ticker-highlight ticker-preview-chip">
                    qqq
                  </span>
                </span>
                <span className="header-preview-time">10:30 AM</span>
              </div>
            </div>
          </div>

          <div className="settings-tip ticker-sync-tip">
            <IconInfoCircle size={12} stroke={2} />
            <div className="ticker-sync-tip-body">
              <span id="setting-ticker-stats-text">
                支持 $ 符号识别及 NASDAQ 美股与 ETF 代码库自动匹配。
              </span>
              <UnstyledButton
                type="button"
                id="btn-sync-tickers"
                className="btn-tool btn-sync-tickers"
                data-i18n="settings.syncTickersBtn"
                data-i18n-title="settings.syncTickersTitle"
                title="从 NASDAQ 官方接口同步最新美股与 ETF 列表"
              >
                同步在线词库
              </UnstyledButton>
            </div>
          </div>
        </div>
      </Paper>
    </div>
  );
}
