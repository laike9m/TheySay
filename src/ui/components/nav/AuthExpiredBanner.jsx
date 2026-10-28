import React from 'react';
import { Box } from '@mantine/core';

export function AuthExpiredBanner() {
  return (
    <>
      <Box
        id="auth-expired-banner"
        className="auth-expired-banner"
        role="alert"
        aria-live="polite"
        style={{ display: 'none' }}
      />
      <div id="toast-container" className="toast-container"></div>
    </>
  );
}
