import React from 'react';
import { Box, Text, UnstyledButton, Badge, Avatar } from '@mantine/core';

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
        <Avatar
          size={24}
          radius="xl"
          src={twAvatar || null}
          className="source-dropdown-avatar-wrap"
          imageProps={{ referrerPolicy: 'no-referrer' }}
        >
          <span className="source-dropdown-avatar-fallback">𝕏</span>
        </Avatar>
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
        <Avatar
          size={24}
          radius="xl"
          src={thAvatar || null}
          className="source-dropdown-avatar-wrap"
          imageProps={{ referrerPolicy: 'no-referrer' }}
        >
          <span className="source-dropdown-avatar-fallback">@</span>
        </Avatar>
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
