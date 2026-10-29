import React from 'react';
import { Paper, NativeSelect, TextInput, TagsInput, ThemeIcon } from '@mantine/core';
import {
  IconWorld,
  IconStarFilled,
  IconFilter,
  IconVolume,
  IconBell
} from '@tabler/icons-react';
import { DiscordSvgIcon } from '../icons/PlatformIcons';
import { parseFilterKeywordsInput } from '../../../core/post';

const SELECT_CLASS_NAMES = {
  root: 'mantine-settings-select-root',
  input: 'settings-select'
};

const NUMBER_CLASS_NAMES = {
  root: 'mantine-settings-number-root',
  input: 'settings-input-number'
};

const COMMON_INTERVAL_OPTIONS = [
  { value: '2', i18n: 'settings.interval2m', label: '2 分钟' },
  { value: '3', i18n: 'settings.interval3m', label: '3 分钟' },
  { value: '5', i18n: 'settings.interval5m', label: '5 分钟' },
  { value: '10', i18n: 'settings.interval10mDefault', label: '10 分钟 (默认)' },
  { value: '15', i18n: 'settings.interval15m', label: '15 分钟' },
  { value: '30', i18n: 'settings.interval30m', label: '30 分钟' },
  { value: '60', i18n: 'settings.interval60m', label: '60 分钟' },
  { value: 'custom', i18n: 'settings.intervalCustom', label: '自定义...' }
];

const DISCORD_EXTRA_INTERVAL_OPTIONS = [
  { value: '0.5', i18n: 'settings.interval30s', label: '30 秒' },
  { value: '1', i18n: 'settings.interval1m', label: '1 分钟' }
];

const PLATFORM_REFRESH_ROWS = [
  {
    key: 'twitter',
    tipI18n: 'settings.twitterRefreshTip',
    tipText: '建议设为 5 ~ 15 分钟或以上，过频抓取可能触发 Twitter 频率限制',
    iconColor: 'gray',
    iconClass: 'twitter',
    iconContent: '𝕏',
    titleI18n: 'settings.twitterRefreshTitle',
    titleText: 'Twitter 刷新',
    subtitleI18n: 'settings.twitterRefreshSubtitle',
    subtitleText: '后台轮询周期',
    options: COMMON_INTERVAL_OPTIONS,
    min: 1,
    step: 1
  },
  {
    key: 'threads',
    tipI18n: 'settings.threadsRefreshTip',
    tipText: '建议设为 5 ~ 15 分钟或以上',
    iconColor: 'gray',
    iconClass: 'threads',
    iconContent: '@',
    titleI18n: 'settings.threadsRefreshTitle',
    titleText: 'Threads 刷新',
    subtitleI18n: 'settings.threadsRefreshSubtitle',
    subtitleText: '后台轮询周期',
    options: COMMON_INTERVAL_OPTIONS,
    min: 1,
    step: 1
  },
  {
    key: 'discord',
    tipI18n: 'settings.discordRefreshTip',
    tipText: 'Discord 频道消息更新通常较频繁，可设为 1 ~ 5 分钟',
    iconColor: 'indigo',
    iconClass: 'discord',
    iconContent: <DiscordSvgIcon />,
    titleI18n: 'settings.discordRefreshTitle',
    titleText: 'Discord 刷新',
    subtitleI18n: 'settings.discordRefreshSubtitle',
    subtitleText: '频道轮询周期',
    options: [...DISCORD_EXTRA_INTERVAL_OPTIONS, ...COMMON_INTERVAL_OPTIONS],
    min: 0.5,
    step: 0.5
  }
];

const TOGGLE_SELECT_ROWS = [
  {
    id: 'setting-discord-sound',
    tipI18n: 'settings.discordSoundTip',
    tipText: '关闭后后台 Discord 客户端全部静音，不影响消息抓取',
    iconColor: 'indigo',
    iconClass: 'discord',
    iconContent: <IconVolume size={14} stroke={2.2} />,
    titleI18n: 'settings.discordSoundTitle',
    titleText: 'Discord 声音',
    subtitleI18n: 'settings.discordSoundSubtitle',
    subtitleText: '后台消息提示音',
    options: [
      { value: 'true', i18n: 'settings.optionOnDefault', label: '开启 (默认)' },
      { value: 'false', i18n: 'settings.optionOffMuted', label: '关闭 (静音)' }
    ]
  },
  {
    id: 'setting-app-badge',
    tipI18n: 'settings.appBadgeTip',
    tipText: '控制是否在系统 Dock / 任务栏应用图标上显示未读消息数角标',
    iconColor: 'red',
    iconClass: 'app-badge',
    iconContent: <IconBell size={14} stroke={2.2} />,
    titleI18n: 'settings.appBadgeTitle',
    titleText: '图标未读角标',
    subtitleI18n: 'settings.appBadgeSubtitle',
    subtitleText: '在应用图标上显示未读消息数',
    options: [
      { value: 'true', i18n: 'settings.optionOnDefault', label: '开启 (默认)' },
      { value: 'false', i18n: 'settings.optionOff', label: '关闭' }
    ]
  }
];

function SettingsSelectRow({
  id,
  defaultValue = 'true',
  tipI18n,
  tipText,
  iconColor,
  iconClass,
  iconContent,
  titleI18n,
  titleText,
  subtitleI18n,
  subtitleText,
  options,
  extraControl
}) {
  return (
    <div className="settings-row" data-i18n-title={tipI18n} title={tipText}>
      <div className="settings-row-main">
        <ThemeIcon
          variant="light"
          color={iconColor}
          size={28}
          radius="md"
          className={`platform-icon ${iconClass}`}
        >
          {iconContent}
        </ThemeIcon>
        <div className="settings-row-text">
          <div className="settings-row-title" data-i18n={titleI18n}>
            {titleText}
          </div>
          <div className="settings-row-subtitle" data-i18n={subtitleI18n}>
            {subtitleText}
          </div>
        </div>
      </div>
      <div className="settings-input-group">
        <NativeSelect
          id={id}
          size="xs"
          defaultValue={defaultValue}
          classNames={SELECT_CLASS_NAMES}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} data-i18n={opt.i18n}>
              {opt.label}
            </option>
          ))}
        </NativeSelect>
        {extraControl}
      </div>
    </div>
  );
}

export function GeneralSettingsSection() {
  const [filterKeywords, setFilterKeywords] = React.useState([]);
  const [filterSearch, setFilterSearch] = React.useState('');
  const filterSearchRef = React.useRef('');
  const filterKeywordsRef = React.useRef([]);

  const applyKeywordsChange = React.useCallback((rawNext, { notify = true } = {}) => {
    const parsed = parseFilterKeywordsInput(rawNext);
    filterKeywordsRef.current = parsed;
    setFilterKeywords(parsed);
    if (
      notify &&
      typeof window !== 'undefined' &&
      typeof window.__THEYSAY_ON_FILTER_KEYWORDS_CHANGE === 'function'
    ) {
      window.__THEYSAY_ON_FILTER_KEYWORDS_CHANGE(parsed);
    }
    return parsed;
  }, []);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__THEYSAY_FILTER_KEYWORDS_BRIDGE = {
      setKeywords: (list) => {
        filterSearchRef.current = '';
        setFilterSearch('');
        return applyKeywordsChange(list, { notify: false });
      },
      commitPending: ({ notify = true } = {}) => {
        const pending = filterSearchRef.current;
        filterSearchRef.current = '';
        setFilterSearch('');
        if (!pending || !pending.trim()) {
          return filterKeywordsRef.current;
        }
        return applyKeywordsChange([...filterKeywordsRef.current, pending], { notify });
      },
      getKeywords: () => {
        const pending = filterSearchRef.current;
        return parseFilterKeywordsInput(
          pending && pending.trim()
            ? [...filterKeywordsRef.current, pending]
            : filterKeywordsRef.current
        );
      }
    };
  }, [applyKeywordsChange]);

  return (
    <div className="settings-section">
      <div className="settings-section-title" data-i18n="settings.sectionGeneral">
        通用
      </div>
      <Paper className="settings-group" radius="md" withBorder={false}>
        {/* 界面语言 */}
        <SettingsSelectRow
          id="setting-language"
          defaultValue="zh"
          tipI18n="settings.languageTip"
          tipText="默认根据系统语言设置（中文系统为中文，其余默认为英文）"
          iconColor="teal"
          iconClass="language"
          iconContent={<IconWorld size={14} stroke={2.1} />}
          titleI18n="settings.languageTitle"
          titleText="界面语言"
          subtitleI18n="settings.languageSubtitle"
          subtitleText="显示语言设置"
          options={[
            { value: 'en', label: 'English' },
            { value: 'zh', label: '中文' }
          ]}
        />

        {/* 平台刷新频率 (Twitter / Threads / Discord) */}
        {PLATFORM_REFRESH_ROWS.map((row) => (
          <SettingsSelectRow
            key={row.key}
            id={`setting-${row.key}-interval`}
            defaultValue="10"
            tipI18n={row.tipI18n}
            tipText={row.tipText}
            iconColor={row.iconColor}
            iconClass={row.iconClass}
            iconContent={row.iconContent}
            titleI18n={row.titleI18n}
            titleText={row.titleText}
            subtitleI18n={row.subtitleI18n}
            subtitleText={row.subtitleText}
            options={row.options}
            extraControl={
              <div
                id={`setting-${row.key}-custom-wrap`}
                className="settings-custom-wrap"
                style={{ display: 'none' }}
              >
                <TextInput
                  type="number"
                  id={`setting-${row.key}-custom`}
                  size="xs"
                  min={row.min}
                  max={1440}
                  step={row.step}
                  defaultValue="10"
                  classNames={NUMBER_CLASS_NAMES}
                />
                <span className="settings-unit" data-i18n="settings.unitMinutes">
                  分
                </span>
              </div>
            }
          />
        ))}

        {/* 仅会员可见帖子 */}
        <SettingsSelectRow
          id="setting-show-member-only"
          defaultValue="true"
          tipI18n="settings.memberOnlyTip"
          tipText="控制是否在时间线中显示 Twitter 创作者订阅专享推文 (Super Follows)"
          iconColor="yellow"
          iconClass="member"
          iconContent={<IconStarFilled size={14} />}
          titleI18n="settings.memberOnlyTitle"
          titleText="仅会员推文"
          subtitleText="Super Follows"
          options={[
            { value: 'true', i18n: 'settings.memberOnlyShow', label: '显示 (标【仅会员】)' },
            { value: 'false', i18n: 'settings.memberOnlyHide', label: '不显示 (过滤)' }
          ]}
        />

        {/* 屏蔽关键词 */}
        <div
          className="settings-row settings-row-filter-keywords"
          data-i18n-title="settings.filterKeywordsTip"
          title="包含以下任意词或多词短语的帖子将被直接丢弃不显示（按回车或用逗号分隔添加）"
        >
          <div className="settings-row-main">
            <ThemeIcon
              variant="light"
              color="orange"
              size={28}
              radius="md"
              className="platform-icon filter-keywords"
            >
              <IconFilter size={14} stroke={2.1} />
            </ThemeIcon>
            <div className="settings-row-text">
              <div
                className="settings-row-title"
                data-i18n="settings.filterKeywordsTitle"
              >
                屏蔽关键词
              </div>
              <div
                className="settings-row-subtitle"
                data-i18n="settings.filterKeywordsSubtitle"
              >
                丢弃含指定词或短语的帖子
              </div>
            </div>
          </div>
          <TagsInput
            id="setting-filter-keywords-input"
            size="xs"
            value={filterKeywords}
            searchValue={filterSearch}
            onSearchChange={(val) => {
              filterSearchRef.current = val;
              setFilterSearch(val);
            }}
            onChange={(next) => {
              filterSearchRef.current = '';
              setFilterSearch('');
              applyKeywordsChange(next, { notify: true });
            }}
            splitChars={[',', '，', ';', '；']}
            acceptValueOnBlur
            isDuplicate={() => false}
            clearable
            data-i18n-placeholder="settings.filterKeywordsPlaceholder"
            placeholder="输入词或短语，回车添加"
            classNames={{
              root: 'mantine-settings-filter-tags-root',
              input: 'settings-filter-tags-input',
              pillsList: 'settings-filter-pills-list',
              pill: 'filter-keyword-chip',
              inputField: 'settings-filter-input-field'
            }}
          />
        </div>

        {/* Discord 通知声音 & 应用图标未读角标 */}
        {TOGGLE_SELECT_ROWS.map((row) => (
          <SettingsSelectRow key={row.id} {...row} />
        ))}
      </Paper>
    </div>
  );
}
