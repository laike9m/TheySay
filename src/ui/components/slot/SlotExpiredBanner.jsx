import React from 'react';
import { Box, Button } from '@mantine/core';

export function SlotExpiredBanner({ index }) {
  return (
    <Box
      className="slot-expired-banner"
      id={`slot-expired-banner-${index}`}
      style={{ display: 'none' }}
    >
      <span className="slot-expired-banner-label">
        <span className="slot-expired-banner-dot" />
        <span
          className="slot-expired-banner-text"
          id={`slot-expired-text-${index}`}
        />
      </span>
      <Button
        type="button"
        variant="filled"
        color="red"
        size="compact-xs"
        radius="sm"
        className="slot-expired-login-btn"
        id={`slot-expired-btn-${index}`}
      />
    </Box>
  );
}
