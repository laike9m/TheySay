import React from 'react';
import { Box } from '@mantine/core';

export function MediaGrid({
  images,
  imageAlt = 'Post image',
  contentContainer = null
}) {
  if (!Array.isArray(images) || images.length === 0) return null;
  const maxVisible = 4;
  const visibleImages = images.slice(0, maxVisible);
  const extraCount = images.length - visibleImages.length;
  const gridClass = visibleImages.length > 1 ? 'multi' : 'single';

  const handleLoad = (e) => {
    const container =
      contentContainer || e.currentTarget.closest('.slot-content-container');
    if (container) {
      if (
        container.scrollHeight - container.scrollTop - container.clientHeight <
        220
      ) {
        container.scrollTop = container.scrollHeight;
      }
    }
  };

  const handleError = (e) => {
    const imgEl = e.currentTarget;
    if (!imgEl.dataset.retried) {
      imgEl.dataset.retried = '1';
      const src = imgEl.getAttribute('src') || '';
      if (src.includes('media.discordapp.net/attachments/')) {
        imgEl.src = src.replace(
          'media.discordapp.net/attachments/',
          'cdn.discordapp.com/attachments/'
        );
        return;
      }
      if (src.includes('cdn.discordapp.com/attachments/')) {
        imgEl.src = src.replace(
          'cdn.discordapp.com/attachments/',
          'media.discordapp.net/attachments/'
        );
        return;
      }
    }
    imgEl.style.display = 'none';
    const thumb = imgEl.closest('.im-media-thumb');
    if (thumb) thumb.style.display = 'none';
    const grid = imgEl.closest('.im-media-grid');
    if (
      grid &&
      !Array.from(grid.querySelectorAll('.im-media-img')).some(
        (el) => el.style.display !== 'none'
      )
    ) {
      grid.style.display = 'none';
      const bubble = imgEl.closest('.im-bubble');
      if (bubble) bubble.classList.remove('has-media');
    }
  };

  return (
    <Box className={`im-media-grid ${gridClass}`}>
      {visibleImages.map((imgUrl, idx) => {
        const isLastWithMore = extraCount > 0 && idx === visibleImages.length - 1;
        return (
          <Box key={`${imgUrl}-${idx}`} className="im-media-thumb">
            <img
              className="im-media-img"
              src={imgUrl}
              alt={imageAlt}
              loading="lazy"
              referrerPolicy="no-referrer"
              onLoad={handleLoad}
              onError={handleError}
            />
            {isLastWithMore && (
              <span className="im-media-more">{`+${extraCount}`}</span>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
