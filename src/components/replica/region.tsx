'use client';

import type { HTMLAttributes, ReactNode } from 'react';
import { createContext, useContext } from 'react';

/**
 * The replicas are pictures of the workspace made of HTML, with parts
 * (regions) a walkthrough can point at. A region is outlined while its step is
 * showing, and clicking one shows the step about it.
 */
export interface Regions {
  /** The region the current step is about. */
  focus: string | null;
  /** The step number of each region that has one. */
  number(name: string): number | undefined;
  /** Shows the step about a region. */
  pick(name: string): void;
}

const NONE: Regions = { focus: null, number: () => undefined, pick: () => undefined };

export const RegionContext = createContext<Regions>(NONE);

export function useRegions(): Regions {
  return useContext(RegionContext);
}

type Tag = 'div' | 'span' | 'section' | 'aside' | 'header' | 'nav';

/** A part of a replica a walkthrough can point at. */
export function Region({ name, as: As = 'div', children, className, ...rest }: { name: string; as?: Tag; children?: ReactNode } & HTMLAttributes<HTMLElement>) {
  const r = useRegions();
  const n = r.number(name);
  return (
    <As
      {...rest}
      className={className}
      data-region={n ? name : undefined}
      data-on={(n && r.focus === name) || undefined}
      data-n={n}
      onClick={(e) => {
        rest.onClick?.(e as never);
        if (!n) return;
        // The innermost region is the one meant.
        e.stopPropagation();
        r.pick(name);
      }}
    >
      {children}
    </As>
  );
}
