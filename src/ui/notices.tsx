import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Ico } from '../components/icons';

export interface Notice {
  /** Identifies the notice once dismissed. */
  key: string;
  content: ReactNode;
}

/** Things the reader should know about the documents, each of which can be dismissed. */
export function Notices({ notices, onDismiss }: { notices: readonly Notice[]; onDismiss(key: string): void }) {
  const bar = useRef<HTMLDivElement>(null);
  // After a dismissal, keyboard focus moves to the next notice's button.
  const refocus = useRef(false);
  useLayoutEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    bar.current?.querySelector<HTMLElement>('[data-dismiss]')?.focus();
  });
  return (
    <div className="notice" id="notice" hidden={!notices.length} ref={bar}>
      {notices.map((n) => (
        <div className="notice-line" key={n.key}>
          <div className="notice-text">{n.content}</div>
          <button
            type="button"
            className="notice-x btn ghost icon-only"
            data-dismiss={n.key}
            aria-label="Dismiss"
            data-tip="Dismiss"
            onClick={(e) => {
              refocus.current = document.activeElement === e.currentTarget;
              onDismiss(n.key);
            }}
          >
            <Ico name="close" />
          </button>
        </div>
      ))}
    </div>
  );
}
