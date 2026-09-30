'use client';

import { useEffect, useState } from 'react';
import content from './content.module.css';

/** A shortcut: the keys to show, what it does, and the key names (KeyboardEvent.key, with modifiers) that press it. */
export type Shortcut = [keys: string[], action: string, match: string[]];

function name(e: KeyboardEvent): string {
  const mods = [e.ctrlKey || e.metaKey ? 'Mod' : '', e.altKey ? 'Alt' : '', e.shiftKey && (e.key.length > 1 || e.ctrlKey || e.metaKey) ? 'Shift' : ''].filter(Boolean);
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [...mods, key].join('+');
}

/**
 * The workspace's keyboard shortcuts. Pressing one on this page lights it up,
 * to learn them without a comparison open.
 */
export function KeyTester({ shortcuts }: { shortcuts: Shortcut[] }) {
  const [hit, setHit] = useState<{ i: number; key: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return;
      const k = name(e);
      const i = shortcuts.findIndex(([, , m]) => m.includes(k));
      if (i < 0) return setHit({ i: -1, key: k });
      // Keep the page where it is: these keys would otherwise scroll or go back.
      if (/^(Mod\+|Alt\+|Page)/.test(k)) e.preventDefault();
      setHit({ i, key: k });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcuts]);

  return (
    <>
      <p className={content.keyHint} aria-live="polite">
        {hit === null ? (
          'Press a key to see what it does in the workspace.'
        ) : hit.i < 0 ? (
          <>
            <b>{hit.key}</b> isn’t a shortcut in the workspace.
          </>
        ) : (
          <>
            <b>{hit.key.replace('Mod', 'Ctrl/⌘')}</b>: {shortcuts[hit.i]![1]}
          </>
        )}
      </p>
      <ul className={content.keys}>
        {shortcuts.map(([keys, action], i) => (
          <li key={action} data-on={hit?.i === i || undefined}>
            <span>{action}</span>
            <span>
              {keys.map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
