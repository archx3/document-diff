'use client';

import { useEffect } from 'react';

/** Registers the service worker that keeps the app working offline (in the built site only). */
export function Offline() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
    navigator.serviceWorker.register(`${base}/sw.js`, { scope: `${base}/` }).catch(() => {
      /* not allowed here (a private window, a sandboxed frame): the app works online */
    });
  }, []);
  return null;
}
