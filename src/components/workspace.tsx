'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { takeDocs } from '../lib/handoff';
import { App } from '../ui/app';

const NEW_COMPARISON = '/compare/new/';

/**
 * The comparison workspace. The app in src/ui builds and runs its own DOM inside this element.
 * With `sample` it shows the sample drafts. Otherwise it shows the documents handed over by the
 * page that chose them; opened without any (typed in, or reloaded), it sends the reader there.
 */
export function Workspace({ sample = false }: { sample?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const router = useRouter();
  // Taken once and kept: in development React mounts twice, and both mounts must show the same documents.
  const docs = useRef<ReturnType<typeof takeDocs> | undefined>(undefined);

  useEffect(() => {
    if (!sample && docs.current === undefined) docs.current = takeDocs();
    if (!sample && !docs.current) {
      router.replace(NEW_COMPARISON);
      return;
    }
    const app = new App(host.current!, {
      docs: docs.current ?? undefined,
      sample,
      home: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/`,
    });
    return () => app.destroy();
  }, [router, sample]);

  return <div id="app" ref={host} />;
}
