import React from 'react';
import {
  IconBell,
  IconBellOff,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconArrowsVertical,
  IconArrowsHorizontal
} from '@tabler/icons-react';

export function SlotMuteIcon({ isMuted = true }) {
  if (isMuted) {
    return (
      <IconBellOff
        className="mute-icon bell-off"
        size={14}
        stroke={2.2}
        aria-hidden="true"
      />
    );
  }
  return (
    <IconBell
      className="mute-icon bell-on"
      size={14}
      stroke={2.2}
      aria-hidden="true"
    />
  );
}

export function SlotExpandIcon({ r = 1, c = 1 }) {
  const isExpanded = r > 1 || c > 1;
  if (!isExpanded) {
    return (
      <IconArrowsMaximize
        className="expand-svg"
        size={14}
        stroke={2.2}
        aria-hidden="true"
      />
    );
  }
  if (r > 1 && c === 1) {
    return (
      <IconArrowsVertical
        className="expand-svg"
        size={14}
        stroke={2.2}
        aria-hidden="true"
      />
    );
  }
  if (c > 1 && r === 1) {
    return (
      <IconArrowsHorizontal
        className="expand-svg"
        size={14}
        stroke={2.2}
        aria-hidden="true"
      />
    );
  }
  return (
    <IconArrowsMinimize
      className="expand-svg"
      size={14}
      stroke={2.2}
      aria-hidden="true"
    />
  );
}
