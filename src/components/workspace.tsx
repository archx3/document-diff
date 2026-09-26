'use client';

import { useEffect, useRef } from 'react';
import { takeDocs } from '../lib/handoff';
import { App } from '../ui/app';

/** The comparison workspace. The app in src/ui builds and runs its own DOM inside this element. */
export function Workspace() {
  const host = useRef<HTMLDivElement>(null);
  // Taken once and kept: in development React mounts twice, and both mounts must show the same documents.
  const docs = useRef<ReturnType<typeof takeDocs> | undefined>(undefined);

  useEffect(() => {
    if (docs.current === undefined) docs.current = takeDocs();
    const app = new App(host.current!, {
      docs: docs.current ?? undefined,
      home: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/`,
    });
    return () => app.destroy();
  }, []);

  return <div id="app" ref={host} />;
}
