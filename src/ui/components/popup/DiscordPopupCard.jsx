import React from 'react';
import { Paper, Box, Badge, UnstyledButton } from '@mantine/core';
import { PopupImageGallery } from './PopupImageGallery';

export function DiscordPopupCard({
  avatarUrl = '',
  displayName = '',
  isBot = false,
  hasReply = false,
  replyAuthor = '',
  replyTextHtml = '',
  textHtml = '',
  images = [],
  attachmentLabels = [],
  timeDisplay = '',
  msgUrl = '',
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
      className={`discord-popup-card ${images.length > 0 ? 'has-images' : ''}`.trim()}
      radius={16}
      withBorder
      onClick={handleCardClick}
    >
      <Box className="discord-popup-header">
        {avatarUrl ? (
          <img className="discord-popup-avatar" src={avatarUrl} alt="" />
        ) : (
          <Box className="discord-popup-avatar-placeholder">#</Box>
        )}
        <Box className="discord-popup-names">
          <span className="discord-popup-name">{displayName}</span>
          {isBot && (
            <Badge
              component="span"
              variant="outline"
              radius={4}
              className="tweet-tag bot"
            >
              BOT
            </Badge>
          )}
        </Box>
      </Box>

      {hasReply && (
        <Box className="discord-popup-reply">
          <span className="discord-popup-reply-author">↩ {replyAuthor}</span>
          <span
            className="discord-popup-reply-text"
            dangerouslySetInnerHTML={{ __html: replyTextHtml }}
          />
        </Box>
      )}

      {textHtml && (
        <Box
          className="discord-popup-text"
          dangerouslySetInnerHTML={{ __html: textHtml }}
        />
      )}

      <PopupImageGallery
        images={images}
        imageAlt={labels.imageAlt}
        viewOriginalImageTitle={labels.viewOriginalImageTitle}
      />

      {attachmentLabels.length > 0 && (
        <Box className="discord-popup-attachments">
          {attachmentLabels.map((label, idx) => (
            <Badge
              key={`${label}-${idx}`}
              component="span"
              variant="outline"
              radius={4}
              className="im-attachment-chip"
            >
              {label}
            </Badge>
          ))}
        </Box>
      )}

      <Box className="discord-popup-footer">
        <span className="discord-popup-time">{timeDisplay}</span>
        {msgUrl && (
          <UnstyledButton
            className="tweet-popup-fallback-btn"
            data-url={msgUrl}
          >
            {labels.openInDiscord}
          </UnstyledButton>
        )}
      </Box>
    </Paper>
  );
}
