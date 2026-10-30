import React from 'react';
import { Box, Badge, ActionIcon, CloseButton, Paper } from '@mantine/core';
import { IconPencil } from '@tabler/icons-react';
import { SlotMuteIcon } from './SlotIcons';

export function SlotHeader({ index, labels = {} }) {
  return (
    <Box className="slot-header slot-drag-handle">
      {/* User Profile Avatar in Header */}
      <Box
        className="slot-avatar"
        id={`slot-avatar-${index}`}
        title={labels.avatarTitle || '频道头像'}
      >
        <img
          className="slot-avatar-img"
          id={`slot-avatar-img-${index}`}
          referrerPolicy="no-referrer"
          alt=""
          style={{ display: 'none' }}
        />
        <span
          className="slot-avatar-placeholder"
          id={`slot-avatar-placeholder-${index}`}
        >
          𝕏
        </span>
      </Box>

      {/* Identity Area: Displays Author Name · @Handle · Source next to Avatar, or Input Field */}
      <Box className="slot-identity-area" id={`slot-identity-${index}`}>
        <Box
          className="slot-author-header"
          id={`slot-author-header-${index}`}
          style={{ display: 'none' }}
          title={labels.clickEditAccount || '点击修改监控账号'}
        >
          <span className="slot-author-name" id={`author-name-${index}`} />
          <span className="slot-author-handle" id={`author-handle-${index}`} />
          <span
            className="slot-author-edit-hint"
            title={labels.editHint || '编辑'}
          >
            <IconPencil size={11} stroke={2.2} />
          </span>
        </Box>

        <Badge
          component="span"
          variant="filled"
          color="brand"
          size="xs"
          radius="xl"
          className="slot-unread-badge"
          id={`slot-unread-badge-${index}`}
          style={{ display: 'none' }}
        />

        {/* Handle input field (shown initially or when editing) */}
        <Box className="slot-input-wrapper" id={`slot-input-wrapper-${index}`}>
          <span className="slot-input-prefix" id={`slot-input-prefix-${index}`}>
            @
          </span>
          <input
            type="text"
            className="slot-handle-input mantine-slot-input"
            id={`handle-input-${index}`}
            placeholder={
              labels.inputPlaceholder || '账号、threads:@账号 或 Discord 链接'
            }
            autoComplete="off"
            spellCheck={false}
          />
          <CloseButton
            component="button"
            type="button"
            variant="subtle"
            color="gray"
            size={16}
            iconSize={10}
            radius="xl"
            className="slot-btn-clear"
            id={`btn-clear-${index}`}
            title={labels.clearBtnTitle || '清空此频道'}
            style={{ display: 'none' }}
          />
        </Box>
      </Box>

      <ActionIcon
        component="button"
        type="button"
        variant="subtle"
        color="gray"
        size={20}
        radius="xl"
        className="slot-btn-mute is-muted"
        id={`btn-mute-${index}`}
        title={labels.mutedTitle || '已静音通知（点击开启此频道新消息提醒）'}
        aria-label={labels.muteAriaLabel || '切换频道通知静音'}
        aria-pressed="false"
      >
        <span className="mute-icon-wrap" id={`mute-icon-${index}`}>
          <SlotMuteIcon isMuted={true} />
        </span>
      </ActionIcon>

      {/* Platform Source Picker Dropdown */}
      <Paper
        className="slot-source-dropdown"
        id={`slot-source-dropdown-${index}`}
        shadow="md"
        radius="md"
        withBorder
        style={{ display: 'none' }}
      />
    </Box>
  );
}
