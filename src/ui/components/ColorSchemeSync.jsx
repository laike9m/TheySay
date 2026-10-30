import { useEffect } from 'react';
import { useMantineColorScheme } from '@mantine/core';

export function ColorSchemeSync() {
  const { setColorScheme } = useMantineColorScheme();

  useEffect(() => {
    const syncFromDom = () => {
      const attr = document.documentElement.getAttribute('data-theme');
      const scheme = attr === 'dark' ? 'dark' : 'light';
      setColorScheme(scheme);
      if (document.documentElement.getAttribute('data-mantine-color-scheme') !== scheme) {
        document.documentElement.setAttribute('data-mantine-color-scheme', scheme);
      }
    };

    syncFromDom();

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'data-theme') {
          syncFromDom();
          break;
        }
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });

    return () => observer.disconnect();
  }, [setColorScheme]);

  return null;
}
