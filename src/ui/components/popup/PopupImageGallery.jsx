import React from 'react';
import { Box } from '@mantine/core';

export function PopupImageGallery({
  images = [],
  imageAlt = '',
  viewOriginalImageTitle = ''
}) {
  if (!Array.isArray(images) || images.length === 0) return null;

  return (
    <Box
      className={`discord-popup-images ${images.length > 1 ? 'multi' : 'single'}`}
    >
      {images.map((url, idx) => (
        <Box key={`${url}-${idx}`} className="discord-popup-image-wrap">
          <img
            className="discord-popup-image"
            src={url}
            alt={imageAlt}
            referrerPolicy="no-referrer"
            data-url={url}
            title={viewOriginalImageTitle}
            onError={(e) => {
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
              const wrap = imgEl.closest('.discord-popup-image-wrap');
              if (wrap) wrap.style.display = 'none';
            }}
          />
        </Box>
      ))}
    </Box>
  );
}
