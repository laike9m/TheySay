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
        <div
          className="settings-row"
          data-i18n-title="settings.languageTip"
          title="默认根据系统语言设置（中文系统为中文，其余默认为英文）"
        >
          <div className="settings-row-main">
            <ThemeIcon
              variant="light"
              color="teal"
              size={28}
              radius="md"
              className="platform-icon language"
            >
              <IconWorld size={14} stroke={2.1} />
            </ThemeIcon>
            <div className="settings-row-text">
              <div className="settings-row-title" data-i18n="settings.languageTitle">
                界面语言
              </div>
              <div
                className="settings-row-subtitle"
                data-i18n="settings.languageSubtitle"
              >
                显示语言设置
              </div>
            </div>
          </div>
          <div className="settings-input-group">
            <NativeSelect
              id="setting-language"
              size="xs"
              defaultValue="zh"
              classNames={{
                root: 'mantine-settings-select-root',
                input: 'settings-select'
              }}
            >
              <option value="en">English</option>
              <option value="zh">中文</option>
            </NativeSelect>
          </div>
        </div>

        {/* Twitter 刷新频率 */}
        <div
          className="settings-row"
          data-i18n-title="settings.twitterRefreshTip"
          title="建议设为 5 ~ 15 分钟或以上，过频抓取可能触发 Twitter 频率限制"
        >
          <div className="settings-row-main">
            <ThemeIcon
              variant="light"
              color="gray"
              size={28}
              radius="md"
              className="platform-icon twitter"
            >
              𝕏
            </ThemeIcon>
            <div className="settings-row-text">
              <div
                className="settings-row-title"
                data-i18n="settings.twitterRefreshTitle"
              >
                Twitter 刷新
              </div>
              <div
                className="settings-row-subtitle"
                data-i18n="settings.twitterRefreshSubtitle"
              >
                后台轮询周期
              </div>
            </div>
          </div>
          <div className="settings-input-group">
            <NativeSelect
              id="setting-twitter-interval"
              size="xs"
              defaultValue="10"
              classNames={{
                root: 'mantine-settings-select-root',
                input: 'settings-select'
              }}
            >
              <option value="2" data-i18n="settings.interval2m">2 分钟</option>
              <option value="3" data-i18n="settings.interval3m">3 分钟</option>
              <option value="5" data-i18n="settings.interval5m">5 分钟</option>
              <option value="10" data-i18n="settings.interval10mDefault">10 分钟 (默认)</option>
              <option value="15" data-i18n="settings.interval15m">15 分钟</option>
              <option value="30" data-i18n="settings.interval30m">30 分钟</option>
              <option value="60" data-i18n="settings.interval60m">60 分钟</option>
              <option value="custom" data-i18n="settings.intervalCustom">自定义...</option>
            </NativeSelect>
            <div
              id="setting-twitter-custom-wrap"
              className="settings-custom-wrap"
              style={{ display: 'none' }}
            >
              <TextInput
                type="number"
                id="setting-twitter-custom"
                size="xs"
                min={1}
                max={1440}
                step={1}
                defaultValue="10"
                classNames={{
                  root: 'mantine-settings-number-root',
                  input: 'settings-input-number'
                }}
              />
              <span className="settings-unit" data-i18n="settings.unitMinutes">分</span>
            </div>
          </div>
        </div>

        {/* Threads 刷新频率 */}
        <div
          className="settings-row"
          data-i18n-title="settings.threadsRefreshTip"
          title="建议设为 5 ~ 15 分钟或以上"
        >
          <div className="settings-row-main">
            <ThemeIcon
              variant="light"
              color="gray"
              size={28}
              radius="md"
              className="platform-icon threads"
            >
              @
            </ThemeIcon>
            <div className="settings-row-text">
              <div
                className="settings-row-title"
                data-i18n="settings.threadsRefreshTitle"
              >
                Threads 刷新
              </div>
              <div
                className="settings-row-subtitle"
                data-i18n="settings.threadsRefreshSubtitle"
              >
                后台轮询周期
              </div>
            </div>
          </div>
          <div className="settings-input-group">
            <NativeSelect
              id="setting-threads-interval"
              size="xs"
              defaultValue="10"
              classNames={{
                root: 'mantine-settings-select-root',
                input: 'settings-select'
              }}
            >
              <option value="2" data-i18n="settings.interval2m">2 分钟</option>
              <option value="3" data-i18n="settings.interval3m">3 分钟</option>
              <option value="5" data-i18n="settings.interval5m">5 分钟</option>
              <option value="10" data-i18n="settings.interval10mDefault">10 分钟 (默认)</option>
              <option value="15" data-i18n="settings.interval15m">15 分钟</option>
              <option value="30" data-i18n="settings.interval30m">30 分钟</option>
              <option value="60" data-i18n="settings.interval60m">60 分钟</option>
              <option value="custom" data-i18n="settings.intervalCustom">自定义...</option>
            </NativeSelect>
            <div
              id="setting-threads-custom-wrap"
              className="settings-custom-wrap"
              style={{ display: 'none' }}
            >
              <TextInput
                type="number"
                id="setting-threads-custom"
                size="xs"
                min={1}
                max={1440}
                step={1}
                defaultValue="10"
                classNames={{
                  root: 'mantine-settings-number-root',
                  input: 'settings-input-number'
                }}
              />
              <span className="settings-unit" data-i18n="settings.unitMinutes">分</span>
            </div>
          </div>
        </div>

        {/* Discord 刷新频率 */}
        <div
          className="settings-row"
          data-i18n-title="settings.discordRefreshTip"
          title="Discord 频道消息更新通常较频繁，可设为 1 ~ 5 分钟"
        >
          <div className="settings-row-main">
            <ThemeIcon
              variant="light"
              color="indigo"
              size={28}
              radius="md"
              className="platform-icon discord"
            >
              <DiscordSvgIcon />
            </ThemeIcon>
            <div className="settings-row-text">
              <div
                className="settings-row-title"
                data-i18n="settings.discordRefreshTitle"
              >
                Discord 刷新
              </div>
              <div
                className="settings-row-subtitle"
                data-i18n="settings.discordRefreshSubtitle"
              >
                频道轮询周期
              </div>
            </div>
          </div>
          <div className="settings-input-group">
            <NativeSelect
              id="setting-discord-interval"
              size="xs"
              defaultValue="10"
              classNames={{
                root: 'mantine-settings-select-root',
                input: 'settings-select'
              }}
            >
              <option value="0.5" data-i18n="settings.interval30s">30 秒</option>
              <option value="1" data-i18n="settings.interval1m">1 分钟</option>
              <option value="2" data-i18n="settings.interval2m">2 分钟</option>
              <option value="3" data-i18n="settings.interval3m">3 分钟</option>
              <option value="5" data-i18n="settings.interval5m">5 分钟</option>
              <option value="10" data-i18n="settings.interval10mDefault">10 分钟 (默认)</option>
              <option value="15" data-i18n="settings.interval15m">15 分钟</option>
              <option value="30" data-i18n="settings.interval30m">30 分钟</option>
              <option value="60" data-i18n="settings.interval60m">60 分钟</option>
              <option value="custom" data-i18n="settings.intervalCustom">自定义...</option>
            </NativeSelect>
            <div
              id="setting-discord-custom-wrap"
              className="settings-custom-wrap"
              style={{ display: 'none' }}
            >
              <TextInput
                type="number"
                id="setting-discord-custom"
                size="xs"
                min={0.5}
                max={1440}
                step={0.5}
                defaultValue="10"
                classNames={{
                  root: 'mantine-settings-number-root',
                  input: 'settings-input-number'
                }}
              />
              <span className="settings-unit" data-i18n="settings.unitMinutes">分</span>
            </div>
          </div>
        </div>

        {/* 仅会员可见帖子 */}
        <div
          className="settings-row"
          data-i18n-title="settings.memberOnlyTip"
          title="控制是否在时间线中显示 Twitter 创作者订阅专享推文 (Super Follows)"
        >
          <div className="settings-row-main">
            <ThemeIcon
              variant="light"
              color="yellow"
              size={28}
              radius="md"
              className="platform-icon member"
            >
              <IconStarFilled size={14} />
            </ThemeIcon>
            <div className="settings-row-text">
              <div
                className="settings-row-title"
                data-i18n="settings.memberOnlyTitle"
              >
                仅会员推文
              </div>
              <div className="settings-row-subtitle">Super Follows</div>
            </div>
          </div>
          <div className="settings-input-group">
            <NativeSelect
              id="setting-show-member-only"
              size="xs"
              defaultValue="true"
              classNames={{
                root: 'mantine-settings-select-root',
                input: 'settings-select'
              }}
            >
              <option value="true" data-i18n="settings.memberOnlyShow">显示 (标【仅会员】)</option>
              <option value="false" data-i18n="settings.memberOnlyHide">不显示 (过滤)</option>
            </NativeSelect>
          </div>
        </div>

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

        {/* Discord 通知声音 */}
        <div
          className="settings-row"
          data-i18n-title="settings.discordSoundTip"
          title="关闭后后台 Discord 客户端全部静音，不影响消息抓取"
        >
          <div className="settings-row-main">
            <ThemeIcon
              variant="light"
              color="indigo"
              size={28}
              radius="md"
              className="platform-icon discord"
            >
              <IconVolume size={14} stroke={2.2} />
            </ThemeIcon>
            <div className="settings-row-text">
              <div
                className="settings-row-title"
                data-i18n="settings.discordSoundTitle"
              >
                Discord 声音
              </div>
              <div
                className="settings-row-subtitle"
                data-i18n="settings.discordSoundSubtitle"
              >
                后台消息提示音
              </div>
            </div>
          </div>
          <div className="settings-input-group">
            <NativeSelect
              id="setting-discord-sound"
              size="xs"
              defaultValue="true"
              classNames={{
                root: 'mantine-settings-select-root',
                input: 'settings-select'
              }}
            >
              <option value="true" data-i18n="settings.optionOnDefault">开启 (默认)</option>
              <option value="false" data-i18n="settings.optionOffMuted">关闭 (静音)</option>
            </NativeSelect>
          </div>
        </div>

        {/* 应用图标未读角标 */}
        <div
          className="settings-row"
          data-i18n-title="settings.appBadgeTip"
          title="控制是否在系统 Dock / 任务栏应用图标上显示未读消息数角标"
        >
          <div className="settings-row-main">
            <ThemeIcon
              variant="light"
              color="red"
              size={28}
              radius="md"
              className="platform-icon app-badge"
            >
              <IconBell size={14} stroke={2.2} />
            </ThemeIcon>
            <div className="settings-row-text">
              <div
                className="settings-row-title"
                data-i18n="settings.appBadgeTitle"
              >
                图标未读角标
              </div>
              <div
                className="settings-row-subtitle"
                data-i18n="settings.appBadgeSubtitle"
              >
                在应用图标上显示未读消息数
              </div>
            </div>
          </div>
          <div className="settings-input-group">
            <NativeSelect
              id="setting-app-badge"
              size="xs"
              defaultValue="true"
              classNames={{
                root: 'mantine-settings-select-root',
                input: 'settings-select'
              }}
            >
              <option value="true" data-i18n="settings.optionOnDefault">开启 (默认)</option>
              <option value="false" data-i18n="settings.optionOff">关闭</option>
            </NativeSelect>
          </div>
        </div>
      </Paper>
    </div>
  );
}
