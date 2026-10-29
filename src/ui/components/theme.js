import { createTheme } from '@mantine/core';

export const mantineTheme = createTheme({
  primaryColor: 'brand',
  defaultRadius: 'md',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontFamilyMonospace:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  colors: {
    brand: [
      '#e5f4ff',
      '#cde4ff',
      '#9bc8ff',
      '#64aaff',
      '#3890fe',
      '#1d9bf0',
      '#0984db',
      '#0071c4',
      '#0060ad',
      '#004e91'
    ]
  },
  components: {
    Button: {
      defaultProps: {
        size: 'compact-xs',
        radius: 'md'
      }
    },
    ActionIcon: {
      defaultProps: {
        variant: 'subtle',
        radius: 'md'
      }
    },
    CloseButton: {
      defaultProps: {
        variant: 'subtle',
        radius: 'md'
      }
    },
    Badge: {
      defaultProps: {
        radius: 'xl'
      }
    },
    ThemeIcon: {
      defaultProps: {
        variant: 'light',
        radius: 'md',
        size: 28
      }
    },
    NativeSelect: {
      defaultProps: {
        size: 'xs',
        radius: 'md'
      }
    },
    TextInput: {
      defaultProps: {
        size: 'xs',
        radius: 'md'
      }
    }
  }
});

export const HEADER_PRESETS = [
  '#ffffff',
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
