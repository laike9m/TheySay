import React from 'react';
import {
  Paper,
  ColorSwatch,
  Button,
  TextInput,
  ThemeIcon
} from '@mantine/core';
import {
  IconLayoutNavbar,
  IconInfoCircle,
  IconGripVertical,
  IconArrowsMaximize,
  IconRefresh
} from '@tabler/icons-react';
import { HEADER_PRESETS, TICKER_PRESETS } from '../theme';

const HEX_INPUT_CLASS_NAMES = {
  root: 'mantine-ticker-hex-root',
  input: 'ticker-hex-input'
};

function ColorField({
  labelI18n,
  labelText,
  colorId,
  hexId,
  defaultValue,
  titleI18n,
  titleText,
  ariaI18n,
  ariaText
}) {
  return (
    <div className="settings-color-field">
      <span className="color-sub-label" data-i18n={labelI18n}>
        {labelText}
      </span>
      <input
        type="color"
        id={colorId}
        className="ticker-color-input"
        defaultValue={defaultValue}
        data-i18n-title={titleI18n}
        title={titleText}
      />
      <TextInput
        type="text"
        id={hexId}
        size="xs"
        defaultValue={defaultValue}
        maxLength={7}
        spellCheck={false}
        data-i18n-aria-label={ariaI18n}
        aria-label={ariaText}
        classNames={HEX_INPUT_CLASS_NAMES}
      />
    </div>
  );
}

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
            <ThemeIcon
              variant="light"
              color="brand"
              size={28}
              radius="md"
              className="platform-icon header-theme"
            >
              <IconLayoutNavbar size={14} stroke={2.1} />
            </ThemeIcon>
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
              <ColorField
                labelI18n="settings.customColor"
                labelText="自定义"
                colorId="setting-header-bg-color"
                hexId="setting-header-bg-hex"
                defaultValue="#f3ede2"
                titleI18n="settings.headerColorInputTitle"
                titleText="自定义 Title 栏背景颜色"
                ariaI18n="settings.headerColorHexAria"
                ariaText="Title 栏背景色 Hex"
              />
            </div>
          </div>
        </div>

        {/* Ticker 高亮配色 (Mantine ColorSwatch) */}
        <div className="settings-row">
          <div className="settings-row-main">
            <ThemeIcon
              variant="light"
              color="yellow"
              size={28}
              radius="md"
              className="platform-icon ticker"
            >
              $
            </ThemeIcon>
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
              <ColorField
                labelI18n="settings.tickerFgLabel"
                labelText="文字"
                colorId="setting-ticker-fg-color"
                hexId="setting-ticker-fg-hex"
                defaultValue="#fde047"
                titleI18n="settings.tickerFgInputTitle"
                titleText="选择 Ticker 文字颜色"
                ariaI18n="settings.tickerFgHexAria"
                ariaText="Ticker 前景色 Hex"
              />
              <ColorField
                labelI18n="settings.tickerBgLabel"
                labelText="底色"
                colorId="setting-ticker-bg-color"
                hexId="setting-ticker-bg-hex"
                defaultValue="#422006"
                titleI18n="settings.tickerBgInputTitle"
                titleText="选择 Ticker 背景颜色"
                ariaI18n="settings.tickerBgHexAria"
                ariaText="Ticker 背景色 Hex"
              />
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
                <IconGripVertical size={12} stroke={2.2} />
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
                <IconArrowsMaximize size={12} stroke={2.2} />
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
              <Button
                type="button"
                id="btn-sync-tickers"
                variant="default"
                size="compact-xs"
                radius="sm"
                className="btn-tool btn-sync-tickers"
                data-i18n="settings.syncTickersBtn"
                data-i18n-title="settings.syncTickersTitle"
                title="从 NASDAQ 官方接口同步最新美股与 ETF 列表"
                leftSection={<IconRefresh size={11} stroke={2.2} />}
              >
                同步在线词库
              </Button>
            </div>
          </div>
        </div>
      </Paper>
    </div>
  );
}
