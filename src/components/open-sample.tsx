'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { handOffDocs } from '../lib/handoff';
import { noteSource } from '../lib/sources';
import { Icon } from './icons';
import content from './content.module.css';
import { asset } from './site-header';
import site from './site.module.css';

const WORKSPACE = '/compare/';

export interface SampleFile {
  /** The file's name, as the workspace shows it. */
  name: string;
  /** Where it is served, under public/. */
  path: string;
}

/** Fetches one sample file and reads it as the pickers would read a file from disk. */
async function readSample(file: SampleFile) {
  const res = await fetch(asset(file.path));
  if (!res.ok) throw new Error(`“${file.name}” could not be fetched (${res.status}).`);
  const blob = await res.blob();
  const f = new File([blob], file.name, { type: blob.type });
  const { loadFile } = await import('../formats/load');
  const doc = await loadFile(f);
  noteSource(doc, f);
  return doc;
}

/** Opens two sample files in the workspace, as if they had been chosen on the new comparison page. */
export function OpenSample({ files, label = 'Open the comparison' }: { files: readonly [SampleFile, SampleFile]; label?: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'opening' | { error: string }>('idle');

  async function open() {
    setState('opening');
    try {
      const [a, b] = await Promise.all(files.map(readSample));
      handOffDocs(a!, b!);
      router.push(WORKSPACE);
    } catch (err) {
      console.error(err);
      setState({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <>
      <button type="button" className={`${site.pill} ${site.primary} ${site.small}`} onClick={() => void open()} disabled={state === 'opening'} aria-busy={state === 'opening'}>
        {state === 'opening' ? 'Opening…' : label}
        {state !== 'opening' && <Icon name="arrow" className={site.arrow} />}
      </button>
      {typeof state === 'object' && (
        <p className={content.problem} role="alert">
          {state.error}
        </p>
      )}
    </>
  );
}
