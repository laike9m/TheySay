import React from 'react';
import { Paper, Box, Badge } from '@mantine/core';
import { MediaGrid } from './MediaGrid';

export function DateDivider({ label }) {
  return (
    <Box className="im-date-divider">
      <Badge
        component="span"
        variant="light"
        color="gray"
        radius="xl"
        size="xs"
        className="im-date-pill"
      >
        {label}
      </Badge>
    </Box>
  );
}

function PostBubbleBody({ body }) {
  if (!body) return null;
  return (
    <>
      {body.showAuthor && body.authorName && (
        <>
          <span className="im-author" style={{ color: body.authorColor }}>
            {body.authorName}
          </span>
          {body.isBot && (
            <Badge
              component="span"
              variant="light"
              color="indigo"
              size="xs"
              radius="xs"
              className="tweet-tag bot"
            >
              BOT
            </Badge>
          )}
        </>
      )}

      {Array.isArray(body.tags) &&
        body.tags.map((tag, idx) => (
          <Badge
            key={`${tag.type}-${idx}`}
            component="span"
            variant="light"
            size="xs"
            radius="xs"
            className={`tweet-tag ${tag.type}`}
            title={tag.title || undefined}
          >
            {tag.label}
          </Badge>
        ))}

      {body.reply && (
        <span className="im-reply-ref">
          <span className="im-reply-author">{`↩ ${body.reply.author || ''}`}</span>
          <span
            className="im-reply-text"
            dangerouslySetInnerHTML={{ __html: body.reply.html }}
          />
        </span>
      )}

      {body.text && (
        <span
          className="im-text-content"
          data-full-text={body.text.isLong ? body.text.fullText : undefined}
          dangerouslySetInnerHTML={{ __html: body.text.html }}
        />
      )}

      {Array.isArray(body.attachments) && body.attachments.length > 0 && (
        <span className="im-attachments">
          {body.attachments.map((att, idx) => (
            <Badge
              key={`${att}-${idx}`}
              component="span"
              variant="light"
              color="gray"
              size="xs"
              radius="xs"
              className="im-attachment-chip"
            >
              {att}
            </Badge>
          ))}
        </span>
      )}
    </>
  );
}

export function PostBubble({
  item,
  contentContainer,
  onMarkRead,
  onOpenExternal,
  onPrefetch,
  onOpenPopup
}) {
  const {
    post,
    isDiscord,
    isThreads,
    isUnread,
    isMemberOnly,
    isGrouped,
    hasPopup,
    hasMedia,
    isMediaOnly,
    images,
    imageAlt,
    timeDisplay,
    linkUrl,
    linkTitle,
    body
  } = item;

  const classNames = ['im-bubble'];
  if (isUnread) classNames.push('unread');
  if (isMemberOnly) classNames.push('is-member-only');
  if (isDiscord) {
    classNames.push('discord');
    if (isGrouped) classNames.push('grouped');
  } else if (isThreads) {
    classNames.push('threads');
  }
  if (hasMedia) {
    classNames.push('has-media');
    if (isMediaOnly) classNames.push('media-only');
  }
  if (hasPopup) {
    classNames.push('has-popup');
  }

  const hasMediaOnlyHeader =
    isMediaOnly &&
    body &&
    (body.showAuthor || (Array.isArray(body.tags) && body.tags.length > 0));

  return (
    <Paper
      ref={(el) => {
        if (el) {
          el._post = post;
          el._isDiscord = isDiscord;
        }
      }}
      className={classNames.join(' ')}
      onMouseEnter={(e) => {
        const bubbleEl = e.currentTarget;
        if (typeof onMarkRead === 'function') {
          onMarkRead(post, bubbleEl);
        }
        if (hasPopup && !isDiscord && !isThreads && typeof onPrefetch === 'function') {
          onPrefetch(post);
        }
      }}
      onClick={(e) => {
        if (e.target && typeof e.target.closest === 'function' && e.target.closest('.im-btn-link')) {
          return;
        }
        const bubbleEl = e.currentTarget;
        if (typeof onMarkRead === 'function') {
          onMarkRead(post, bubbleEl);
        }
        if (hasPopup && typeof onOpenPopup === 'function') {
          onOpenPopup(post);
        }
      }}
    >
      {hasMedia ? (
        isMediaOnly ? (
          <>
            {hasMediaOnlyHeader && (
              <Box className="im-media-only-header">
                <PostBubbleBody body={body} />
              </Box>
            )}
            <MediaGrid
              images={images}
              imageAlt={imageAlt}
              contentContainer={contentContainer}
            />
            <span className="im-time">{timeDisplay}</span>
            {linkUrl && (
              <a
                className="im-btn-link"
                data-url={linkUrl}
                title={linkTitle}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const bubbleEl = e.currentTarget.closest('.im-bubble');
                  if (typeof onMarkRead === 'function') {
                    onMarkRead(post, bubbleEl);
                  }
                  if (typeof onOpenExternal === 'function') {
                    onOpenExternal(linkUrl);
                  }
                }}
              >
                ↗
              </a>
            )}
          </>
        ) : (
          <>
            <Box className="im-bubble-left">
              <PostBubbleBody body={body} />
              <span className="im-time">{timeDisplay}</span>
            </Box>
            <MediaGrid
              images={images}
              imageAlt={imageAlt}
              contentContainer={contentContainer}
            />
            {linkUrl && (
              <a
                className="im-btn-link"
                data-url={linkUrl}
                title={linkTitle}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const bubbleEl = e.currentTarget.closest('.im-bubble');
                  if (typeof onMarkRead === 'function') {
                    onMarkRead(post, bubbleEl);
                  }
                  if (typeof onOpenExternal === 'function') {
                    onOpenExternal(linkUrl);
                  }
                }}
              >
                ↗
              </a>
            )}
          </>
        )
      ) : (
        <>
          <PostBubbleBody body={body} />
          <span className="im-time">{timeDisplay}</span>
          {linkUrl && (
            <a
              className="im-btn-link"
              data-url={linkUrl}
              title={linkTitle}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const bubbleEl = e.currentTarget.closest('.im-bubble');
                if (typeof onMarkRead === 'function') {
                  onMarkRead(post, bubbleEl);
                }
                if (typeof onOpenExternal === 'function') {
                  onOpenExternal(linkUrl);
                }
              }}
            >
              ↗
            </a>
          )}
        </>
      )}
    </Paper>
  );
}

export function PostTimeline({
  items = [],
  emptyNoticeText = '',
  contentContainer = null,
  onMarkRead,
  onOpenExternal,
  onPrefetch,
  onOpenPopup
}) {
  return (
    <>
      {items.map((item, idx) => (
        <React.Fragment key={item.key || idx}>
          {item.dateDividerLabel && <DateDivider label={item.dateDividerLabel} />}
          <PostBubble
            item={item}
            contentContainer={contentContainer}
            onMarkRead={onMarkRead}
            onOpenExternal={onOpenExternal}
            onPrefetch={onPrefetch}
            onOpenPopup={onOpenPopup}
          />
        </React.Fragment>
      ))}
      {emptyNoticeText && (
        <Box className="im-filtered-empty-notice">{emptyNoticeText}</Box>
      )}
    </>
  );
}
