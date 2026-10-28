import { createTheme } from '@mantine/core';

export const mantineTheme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'sm',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
});

export const HEADER_PRESETS = [
  '#1e293b',
  '#2563eb',
  '#f3ede2',
  '#dff2ea',
  '#eae6f9',
  '#faeed4'
];

export const TICKER_PRESETS = [
  { fg: '#fde047', bg: '#422006' },
  { fg: '#0f172a', bg: '#facc15' },
  { fg: '#4ade80', bg: '#063925' },
  { fg: '#38bdf8', bg: '#0c2d48' },
  { fg: '#c084fc', bg: '#2e1065' },
  { fg: '#fda4af', bg: '#4c0519' }
];
