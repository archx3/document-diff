import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * A function that keeps its identity from render to render but always runs
 * the latest `fn`, so handlers can be handed to memoized components without
 * rendering them again.
 */
export function useStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
