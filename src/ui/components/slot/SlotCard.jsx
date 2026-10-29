import React from 'react';
import { Paper, Box, Loader, ThemeIcon } from '@mantine/core';
import { IconMessageDots } from '@tabler/icons-react';
import { SlotHeader } from './SlotHeader';
import { SlotExpiredBanner } from './SlotExpiredBanner';

export function SlotCard({ index, labels = {} }) {
  return (
    <Paper
      className="slot-card"
      id={`slot-card-${index}`}
      radius="md"
      withBorder
    >
      <SlotHeader index={index} labels={labels} />

      {/* Scrollable Content Viewport */}
      <Box className="slot-content-container" id={`slot-content-${index}`}>
        <Box className="slot-placeholder" id={`slot-placeholder-${index}`}>
          <ThemeIcon
            variant="light"
            color="gray"
            size={34}
            radius="xl"
            className="slot-placeholder-icon"
          >
            <IconMessageDots size={18} stroke={1.8} />
          </ThemeIcon>
          <p>
            {labels.placeholderText ||
              '输入 @ 账号、threads:@账号 或 Discord 频道链接并按回车'}
          </p>
        </Box>

        <Box
          className="slot-loading"
          id={`slot-loading-${index}`}
          style={{ display: 'none' }}
        >
          <Loader
            size={18}
            color="brand"
            className="spinner-small mantine-slot-loader"
          />
          <span className="slot-loading-text" id={`slot-loading-text-${index}`}>
            {labels.loadingText || '加载中...'}
          </span>
        </Box>

        <Box
          className="slot-error"
          id={`slot-error-${index}`}
          style={{ display: 'none' }}
        />

        <Box
          className="slot-posts-list"
          id={`slot-posts-list-${index}`}
          style={{ display: 'none' }}
        />
      </Box>

      {/* Persistent Login Expired Strip for this Slot */}
      <SlotExpiredBanner index={index} />
    </Paper>
  );
}
