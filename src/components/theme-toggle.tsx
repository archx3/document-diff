'use client';

import { useEffect, useState } from 'react';
import { currentTheme, onSystemThemeChange, toggleTheme } from '../ui/theme';
import { Icon } from './icons';
import styles from './site.module.css';

/** Switches between the light and dark themes. The choice applies to the workspace too. */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const sync = () => setDark(currentTheme() === 'dark');
    sync();
    return onSystemThemeChange(sync);
  }, []);
  // The icon follows the theme through CSS (styles.css), so it is right before this runs.
  return (
    <button
      type="button"
      className={styles.themeToggle}
      aria-label="Dark theme"
      aria-pressed={dark}
      title={dark ? 'Switch to the light theme' : 'Switch to the dark theme'}
      onClick={() => setDark(toggleTheme() === 'dark')}
    >
      <span className="theme-moon">
        <Icon name="moon" size={18} />
      </span>
      <span className="theme-sun">
        <Icon name="sun" size={18} />
      </span>
    </button>
  );
}
