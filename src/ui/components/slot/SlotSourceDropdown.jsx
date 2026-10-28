import React from 'react';
import { Box, Text, UnstyledButton, Badge } from '@mantine/core';

export function SlotSourceDropdownContent({
  titleText,
  twName,
  twHandle,
  twAvatar,
  twBadgeText,
  thName,
  thHandle,
  thAvatar,
  thBadgeText,
  onSelect
}) {
  return (
    <>
      <Text component="div" className="source-dropdown-title">
        {titleText}
      </Text>

      <UnstyledButton
        type="button"
        className="source-dropdown-item"
        data-source="twitter"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (typeof onSelect === 'function') onSelect('twitter');
        }}
      >
        <Box className="source-dropdown-avatar-wrap">
          {twAvatar ? (
            <img
              className="source-dropdown-avatar"
              src={twAvatar}
              alt=""
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <span className="source-dropdown-avatar-fallback">𝕏</span>
          )}
        </Box>
        <Box className="source-dropdown-info">
          <span className="source-dropdown-name">{twName}</span>
          <span className="source-dropdown-handle">{`@${twHandle}`}</span>
        </Box>
        <Badge
          component="span"
          variant="light"
          color="brand"
          size="xs"
          radius="xl"
          className="source-dropdown-badge twitter"
        >
          {twBadgeText}
        </Badge>
      </UnstyledButton>

      <UnstyledButton
        type="button"
        className="source-dropdown-item"
        data-source="threads"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (typeof onSelect === 'function') onSelect('threads');
        }}
      >
        <Box className="source-dropdown-avatar-wrap">
          {thAvatar ? (
            <img
              className="source-dropdown-avatar"
              src={thAvatar}
              alt=""
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <span className="source-dropdown-avatar-fallback">@</span>
          )}
        </Box>
        <Box className="source-dropdown-info">
          <span className="source-dropdown-name">{thName}</span>
          <span className="source-dropdown-handle">{`threads:@${thHandle}`}</span>
        </Box>
        <Badge
          component="span"
          variant="light"
          color="teal"
          size="xs"
          radius="xl"
          className="source-dropdown-badge threads"
        >
          {thBadgeText}
        </Badge>
      </UnstyledButton>
    </>
  );
}
