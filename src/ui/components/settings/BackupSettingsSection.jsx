import React from 'react';
import { Paper, UnstyledButton } from '@mantine/core';
import { IconUsers } from '@tabler/icons-react';

export function BackupSettingsSection() {
  return (
    <div className="settings-section">
      <div
        className="settings-section-title"
        data-i18n="settings.sectionBackup"
      >
        备份
      </div>
      <Paper className="settings-group" radius="md" withBorder={false}>
        <div className="settings-row">
          <div className="settings-row-main">
            <span className="platform-icon profile-export">
              <IconUsers size={14} stroke={2.2} />
            </span>
            <div className="settings-row-text">
              <div
                className="settings-row-title"
                data-i18n="settings.profileCardTitle"
              >
                个人 Profile 档案
              </div>
              <div
                className="settings-row-subtitle"
                data-i18n="settings.profileCardSubtitle"
              >
                包含全部偏好设置、网格布局与 follow 的所有账号/频道
              </div>
            </div>
          </div>
          <div className="settings-input-group">
            <UnstyledButton
              type="button"
              id="btn-import-profile"
              className="btn-tool"
              data-i18n="auth.importProfile"
              data-i18n-title="auth.importProfileTitle"
              title="从 JSON 文件导入 Profile 配置（保留已抓取数据）"
            >
              导入 Profile
            </UnstyledButton>
            <UnstyledButton
              type="button"
              id="btn-export-profile"
              className="btn-tool btn-export-profile"
              data-i18n="auth.exportProfile"
              data-i18n-title="auth.exportProfileTitle"
              title="导出全部设置与 follow 的所有人到 JSON 文件"
            >
              导出 Profile
            </UnstyledButton>
          </div>
        </div>
      </Paper>
    </div>
  );
}
