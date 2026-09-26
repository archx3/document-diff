'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Doc } from '../core/model';
import { takeDocs } from '../lib/handoff';
import { CompareApp } from '../ui/app';

const NEW_COMPARISON = '/compare/new/';

type Start = { docs: { a: Doc; b: Doc } | null };

/**
 * The comparison workspace. With `sample` it shows the sample drafts.
 * Otherwise it shows the documents handed over by the page that chose them;
 * opened without any (typed in, or reloaded), it sends the reader there.
 */
export function Workspace({ sample = false }: { sample?: boolean }) {
  const router = useRouter();
  // Taken once and kept: in development React runs effects twice, and both runs must see the same documents.
  const taken = useRef<Start | null>(null);
  const [start, setStart] = useState<Start | null>(null);

  useEffect(() => {
    taken.current ??= { docs: sample ? null : takeDocs() };
    if (!sample && !taken.current.docs) router.replace(NEW_COMPARISON);
    else setStart(taken.current);
  }, [router, sample]);

  return (
    <div id="app">{start && <CompareApp docs={start.docs ?? undefined} sample={sample} home={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/`} />}</div>
  );
}
