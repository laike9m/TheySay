import React from 'react';
import { Box, Paper, Loader } from '@mantine/core';

export function PostPopupOverlay() {
  return (
    <Box
      id="tweet-popup-overlay"
      className="tweet-popup-overlay is-closed"
      tabIndex={-1}
      aria-hidden="true"
    >
      <Paper
        className="tweet-popup-dialog"
        role="dialog"
        aria-modal="true"
        data-i18n-aria-label="popup.dialogAriaLabel"
        aria-label="推文详情"
        shadow="none"
        radius={0}
      >
        <Paper
          className="tweet-popup-loading"
          id="tweet-popup-loading"
          radius={12}
        >
          <Loader
            size={18}
            color="brand"
            className="spinner-small mantine-popup-loader"
          />
          <span data-i18n="popup.loadingEmbed">正在加载嵌入推文...</span>
        </Paper>
        <Box
          className="tweet-popup-embed-container"
          id="tweet-popup-embed-container"
        />
      </Paper>
    </Box>
  );
}
