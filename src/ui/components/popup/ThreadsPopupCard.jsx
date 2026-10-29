import React from 'react';
import { Paper, Box, Badge, Button, Avatar } from '@mantine/core';
import { PopupImageGallery } from './PopupImageGallery';

export function ThreadsPopupCard({
  avatarUrl = '',
  displayName = '',
  userHandle = '',
  showUserHandle = false,
  isPinned = false,
  isRetweet = false,
  effectiveTextHtml = '',
  images = [],
  hasQuote = false,
  quoteAuthor = '',
  quoteUrl = '',
  quoteTextHtml = '',
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
      className={`discord-popup-card threads-popup-card ${images.length > 0 ? 'has-images' : ''}`.trim()}
      radius={16}
      withBorder
      onClick={handleCardClick}
    >
      <Box className="discord-popup-header">
        <Avatar
          size={38}
          radius="xl"
          color="dark"
          variant="filled"
          src={avatarUrl || null}
          className="discord-popup-avatar threads-avatar-placeholder"
          imageProps={{ referrerPolicy: 'no-referrer' }}
        >
          @
        </Avatar>
        <Box className="tweet-popup-fallback-names">
          <Box className="discord-popup-names">
            <span className="discord-popup-name">{displayName}</span>
            <Badge
              component="span"
              variant="light"
              color="teal"
              radius={4}
              className="tweet-tag threads threads-badge"
            >
              Threads
            </Badge>
            {isPinned && (
              <Badge
                component="span"
                variant="light"
                color="brand"
                radius={4}
                className="tweet-tag pinned"
              >
                {labels.tagPinned}
              </Badge>
            )}
            {isRetweet && (
              <Badge
                component="span"
                variant="light"
                color="teal"
                radius={4}
                className="tweet-tag repost"
              >
                {labels.tagRepost}
              </Badge>
            )}
          </Box>
          {showUserHandle && (
            <span className="tweet-popup-fallback-handle">{userHandle}</span>
          )}
        </Box>
      </Box>

      {effectiveTextHtml && (
        <Box
          className="discord-popup-text"
          dangerouslySetInnerHTML={{ __html: effectiveTextHtml }}
        />
      )}

      <PopupImageGallery
        images={images}
        imageAlt={labels.imageAlt}
        viewOriginalImageTitle={labels.viewOriginalImageTitle}
      />

      {hasQuote && (
        <Box className="threads-popup-quote">
          <Box className="threads-popup-quote-header">
            <Badge
              component="span"
              variant="light"
              color="grape"
              radius={4}
              className="tweet-tag quote"
            >
              {labels.quoteTag}
            </Badge>
            {quoteAuthor && (
              <span className="threads-popup-quote-author">{quoteAuthor}</span>
            )}
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
          {quoteTextHtml && (
            <Box
              className="threads-popup-quote-text"
              dangerouslySetInnerHTML={{ __html: quoteTextHtml }}
            />
          )}
        </Box>
      )}

      <Box className="discord-popup-footer">
        <span className="discord-popup-time">{timeDisplay}</span>
        {postUrl && (
          <Button
            variant="light"
            color="brand"
            size="compact-xs"
            radius="sm"
            className="tweet-popup-fallback-btn discord-popup-open-btn"
            data-url={postUrl}
          >
            {labels.openOnThreads}
          </Button>
        )}
      </Box>
    </Paper>
  );
}
