import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * One object, made by `make`, for the life of the component. In development,
 * editing the module of its class hot-reloads the component with its state,
 * and so with an object of the old class; one of the new class replaces it.
 */
export function useInstance<T extends object>(Kind: abstract new (...args: never[]) => T, make: () => T): T {
  const ref = useRef<T | null>(null);
  if (!(ref.current instanceof Kind)) ref.current = make();
  return ref.current;
}

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
