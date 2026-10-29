import React from 'react';
import { Box, Text, UnstyledButton, Divider } from '@mantine/core';
import { IconCheck, IconTrash } from '@tabler/icons-react';

export function SlotSizeMenuContent({
  titleText,
  items = [],
  clearLabel,
  clearDesc,
  onSelectSize,
  onClearSlot
}) {
  return (
    <>
      <Text component="div" className="size-menu-title">
        {titleText}
      </Text>

      {items.map((opt) => (
        <UnstyledButton
          key={`${opt.r}x${opt.c}`}
          type="button"
          className={`size-menu-item ${opt.isActive ? 'active' : ''}`}
          data-r={opt.r}
          data-c={opt.c}
          style={opt.disabled ? { opacity: 0.45 } : undefined}
          onClick={(e) => {
            e.stopPropagation();
            if (typeof onSelectSize === 'function') {
              onSelectSize(opt.r, opt.c);
            }
          }}
        >
          <Box>
            <span className="size-label">{opt.label}</span>
            <span className="size-desc">{opt.hint}</span>
          </Box>
          {opt.isActive && (
            <span className="size-check">
              <IconCheck size={13} stroke={2.5} />
            </span>
          )}
        </UnstyledButton>
      ))}

      <Divider className="size-menu-divider" />

      <UnstyledButton
        type="button"
        className="size-menu-item danger"
        data-action="clear"
        onClick={(e) => {
          e.stopPropagation();
          if (typeof onClearSlot === 'function') {
            onClearSlot();
          }
        }}
      >
        <Box>
          <span className="size-label">{clearLabel}</span>
          <span className="size-desc">{clearDesc}</span>
        </Box>
        <span className="size-clear-icon">
          <IconTrash size={13} stroke={2.1} />
        </span>
      </UnstyledButton>
    </>
  );
}
