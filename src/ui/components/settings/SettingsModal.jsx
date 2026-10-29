import React from 'react';
import { Paper, CloseButton, Button } from '@mantine/core';
import { IconSettings, IconRotateClockwise } from '@tabler/icons-react';
import { GeneralSettingsSection } from './GeneralSettingsSection';
import { AppearanceSettingsSection } from './AppearanceSettingsSection';
import { BackupSettingsSection } from './BackupSettingsSection';

export function SettingsModal() {
  return (
    <div
      id="settings-modal-overlay"
      className="settings-modal-overlay is-closed"
      tabIndex={-1}
      aria-hidden="true"
    >
      <Paper
        className="settings-modal-dialog mantine-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        shadow="xl"
        radius="lg"
        withBorder
      >
        {/* 弹窗 Header */}
        <div className="settings-modal-header">
          <div className="settings-modal-header-left">
            <IconSettings
              className="settings-modal-header-icon"
              size={17}
              stroke={2}
            />
            <h2
              id="settings-dialog-title"
              className="settings-modal-title"
              data-i18n="settings.title"
            >
              偏好设置
            </h2>
          </div>
          <CloseButton
            id="btn-settings-close"
            variant="subtle"
            size="sm"
            radius="md"
            className="settings-modal-close"
            data-i18n-title="settings.closeTitle"
            data-i18n-aria-label="settings.closeAria"
            title="关闭设置 (Esc)"
            aria-label="关闭设置"
          />
        </div>

        {/* 弹窗 Body */}
        <div className="settings-modal-body">
          <GeneralSettingsSection />
          <AppearanceSettingsSection />
          <BackupSettingsSection />
        </div>

        {/* 弹窗 Footer */}
        <div className="settings-modal-footer">
          <Button
            id="btn-settings-reset"
            variant="subtle"
            color="gray"
            size="compact-xs"
            radius="md"
            className="btn-tool btn-settings-reset"
            data-i18n="settings.resetBtn"
            data-i18n-title="settings.resetTitle"
            title="恢复默认设置"
            leftSection={<IconRotateClockwise size={13} stroke={2} />}
          >
            恢复默认
          </Button>
        </div>
      </Paper>
    </div>
  );
}
