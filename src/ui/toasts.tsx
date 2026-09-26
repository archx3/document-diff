import { useCallback, useEffect, useRef, useState } from 'react';
import { Ico } from '../components/icons';

interface Toast {
  id: number;
  message: string;
  /** Offers to undo what was just done. */
  undo?: boolean;
  error?: boolean;
}

export type ToastFn = (message: string, opts?: { undo?: boolean; error?: boolean }) => void;

/** Short messages that go away by themselves; the newest three are kept. */
export function useToasts(): { toasts: Toast[]; toast: ToastFn; dismiss(id: number): void } {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Set<number>());
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback<ToastFn>(
    (message, opts = {}) => {
      const id = ++seq.current;
      setToasts((t) => [...t, { id, message, ...opts }].slice(-3));
      const timer = window.setTimeout(
        () => {
          timers.current.delete(timer);
          dismiss(id);
        },
        opts.error ? 9000 : 4500,
      );
      timers.current.add(timer);
    },
    [dismiss],
  );
  useEffect(() => {
    const all = timers.current;
    return () => all.forEach(clearTimeout);
  }, []);
  return { toasts, toast, dismiss };
}

export function Toasts({ toasts, onUndo, onDismiss }: { toasts: readonly Toast[]; onUndo(): void; onDismiss(id: number): void }) {
  return (
    <div className="toasts" id="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.error ? ' error' : ''}`} role={t.error ? 'alert' : 'status'}>
          <span>{t.message}</span>
          {t.undo && (
            <button
              type="button"
              className="linkbtn"
              onClick={() => {
                onUndo();
                onDismiss(t.id);
              }}
            >
              Undo
            </button>
          )}
          <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>
            <Ico name="close" />
          </button>
        </div>
      ))}
    </div>
  );
}
