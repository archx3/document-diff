'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Doc } from '../core/model';
import { takeDocs } from '../lib/handoff';
import { CompareApp } from '../ui/app';
import type { Restored, SessionScope } from '../ui/session';
import { restoreSession } from '../ui/session';

const NEW_COMPARISON = '/compare/new/';

type Start = { docs: { a: Doc; b: Doc } | null; restored: Restored | null };

/**
 * The comparison workspace. With `sample` it shows the sample drafts.
 * Otherwise it shows the documents handed over by the page that chose them.
 * Reloaded, it carries on with the comparison it had (kept in this browser);
 * opened without one, it sends the reader to choose two documents.
 */
export function Workspace({ sample = false }: { sample?: boolean }) {
  const router = useRouter();
  const scope: SessionScope = sample ? 'sample' : 'compare';
  // Taken once and kept: in development React runs effects twice, and both runs must see the same documents.
  const taken = useRef<Promise<Start> | null>(null);
  const [start, setStart] = useState<Start | null>(null);

  useEffect(() => {
    let live = true;
    taken.current ??= (async () => {
      const docs = sample ? null : takeDocs();
      return { docs, restored: docs ? null : await restoreSession(scope) };
    })();
    void taken.current.then((s) => {
      if (!live) return;
      if (!sample && !s.docs && !s.restored?.docs.a && !s.restored?.docs.b) router.replace(NEW_COMPARISON);
      else setStart(s);
    });
    return () => {
      live = false;
    };
  }, [router, sample, scope]);

  return (
    <div id="app">
      {start && (
        <CompareApp
          docs={start.docs ?? undefined}
          restored={start.restored}
          sample={sample}
          session={scope}
          home={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/`}
        />
      )}
    </div>
  );
}
