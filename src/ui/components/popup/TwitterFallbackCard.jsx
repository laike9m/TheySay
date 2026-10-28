import React from 'react';
import { Paper, Box, Badge, UnstyledButton } from '@mantine/core';
import { PopupImageGallery } from './PopupImageGallery';

export function TwitterFallbackCard({
  avatarUrl = '',
  displayName = '',
  userHandle = '',
  isMemberOnly = false,
  effectiveTextHtml = '',
  images = [],
  hasQuote = false,
  quoteUrl = '',
  timeDisplay = '',
  postUrl = '',
  labels = {},
  onOpenExternal
}) {
  const handleCardClick = (e) => {
    const targetEl = e.target.closest('[data-url]');
    if (!targetEl) return;
    e.preventDefault();
    const url = targetEl.getAttribute('data-url');
    if (url && typeof onOpenExternal === 'function') {
      onOpenExternal(url);
    }
  };

  return (
    <Paper
      className="tweet-popup-fallback"
      radius={16}
      withBorder
      onClick={handleCardClick}
    >
      <Box className="tweet-popup-fallback-header">
        {avatarUrl ? (
          <img className="tweet-popup-fallback-avatar" src={avatarUrl} alt="" />
        ) : (
          <Box className="tweet-popup-fallback-avatar-placeholder">👤</Box>
        )}
        <Box className="tweet-popup-fallback-names">
          <span className="tweet-popup-fallback-name">{displayName}</span>
          <span className="tweet-popup-fallback-handle">{userHandle}</span>
        </Box>
      </Box>

      {isMemberOnly && (
        <Box className="tweet-popup-fallback-member">
          <Badge
            component="span"
            variant="outline"
            radius={4}
            className="tweet-tag member"
          >
            {labels.memberOnlyTag}
          </Badge>
          <span className="tweet-member-notice">{labels.memberOnlyNotice}</span>
        </Box>
      )}

      {effectiveTextHtml && (
        <Box
          className="tweet-popup-fallback-text"
          dangerouslySetInnerHTML={{ __html: effectiveTextHtml }}
        />
      )}

      <PopupImageGallery
        images={images}
        imageAlt={labels.imageAlt}
        viewOriginalImageTitle={labels.viewOriginalImageTitle}
      />

      {hasQuote && (
        <Box className="tweet-popup-fallback-quote">
          <Badge
            component="span"
            variant="outline"
            radius={4}
            className="tweet-tag quote"
          >
            {labels.quoteTag}
          </Badge>
          {quoteUrl && (
            <a
              href="#"
              className="tweet-fallback-quote-link"
              data-url={quoteUrl}
            >
              {labels.viewQuotedPost}
            </a>
          )}
        </Box>
      )}

      <Box className="tweet-popup-fallback-footer">
        <span className="tweet-popup-fallback-time">{timeDisplay}</span>
        {postUrl && (
          <UnstyledButton
            className="tweet-popup-fallback-btn"
            data-url={postUrl}
          >
            {labels.openOnTwitter}
          </UnstyledButton>
        )}
      </Box>
    </Paper>
  );
}
