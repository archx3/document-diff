'use client';

import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { Icon } from '../icons';
import { AudioReplica } from './audio-replica';
import { DocReplica } from './doc-replica';
import { ImageReplica } from './image-replica';
import type { Regions } from './region';
import { RegionContext } from './region';
import styles from './walkthrough.module.css';

export interface Step {
  title: string;
  body: ReactNode;
  /** The part of the replica the step is about. */
  focus: string;
}

const REPLICA = { text: DocReplica, image: ImageReplica, audio: AudioReplica };

/**
 * Steps beside a replica of the workspace. The current step's part of the
 * replica is outlined; clicking an outlined-on-hover part shows its step. The
 * replica itself works, so each step can be tried as it is read.
 */
export function Walkthrough({ kind, steps, label = 'Step' }: { kind: keyof typeof REPLICA; steps: Step[]; label?: string }) {
  const [i, setI] = useState(0);
  const Replica = REPLICA[kind];
  const step = steps[i]!;

  const regions = useMemo<Regions>(() => {
    const index = new Map<string, number>();
    steps.forEach((s, n) => index.has(s.focus) || index.set(s.focus, n));
    return {
      focus: step.focus,
      number: (name) => (index.has(name) ? index.get(name)! + 1 : undefined),
      pick: (name) => {
        const n = index.get(name);
        if (n !== undefined) setI(n);
      },
    };
  }, [steps, step.focus]);

  return (
    <div className={styles.walk}>
      <ol className={styles.steps}>
        {steps.map((s, n) => (
          <li key={s.title} className={styles.step} data-on={n === i || undefined}>
            <button type="button" className={styles.stepHead} onClick={() => setI(n)} aria-expanded={n === i}>
              <span className={styles.num}>{n + 1}</span>
              {s.title}
            </button>
            {n === i && <div className={styles.stepBody}>{s.body}</div>}
          </li>
        ))}
      </ol>

      <div className={styles.stage}>
        <div className={styles.stageBar}>
          <span className={styles.where} aria-live="polite">
            {label} {i + 1} of {steps.length}
            <b>{step.title}</b>
          </span>
          <span className={styles.stageNav}>
            <button type="button" onClick={() => setI(i - 1)} disabled={i === 0} aria-label="Previous step">
              <Icon name="up" size={14} />
            </button>
            <button type="button" onClick={() => setI(i + 1)} disabled={i === steps.length - 1} aria-label="Next step">
              <Icon name="down" size={14} />
            </button>
          </span>
        </div>
        <RegionContext.Provider value={regions}>
          <Replica />
        </RegionContext.Provider>
        <p className={styles.tip}>
          <Icon name="info" size={13} />
          It works: try the buttons. Hover to find the parts the steps explain, and click one to jump to it.
        </p>
      </div>
    </div>
  );
}
