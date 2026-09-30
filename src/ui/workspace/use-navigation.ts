/**
 * Moving through the comparison: the change the reader is on, the folds they
 * opened, the layout of whichever grid is showing (aligned rows, or
 * connection bands), stepping and paging between changes, going to a row,
 * and the view's toggles, which move every row.
 */
import type { RefObject } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Comparison } from '../../core/compare';
import { ElasticLayout } from '../elastic';
import type { Place } from '../grid';
import { useInstance, useStable } from '../hooks';
import { GridLayout, captureAnchor, restoreAnchor, scrollToHunk } from '../layout';
import { gridItems } from '../rows';
import type { NavOff } from '../toolbar';
import { ALL_NAV_OFF } from '../toolbar';
import type { View } from '../util';
import { reducedMotion } from '../util';
import type { Pop } from './pop';
import type { Prefs, SetPref } from './prefs';
import { panelOverlays } from './prefs';

interface NavigationDeps {
  cmp: Comparison | null;
  prefs: Prefs;
  setPref: SetPref;
  phone: boolean;
  view: View;
  elastic: boolean;
  /** The change the reader was on (before a reload). */
  initial: number;
  root: RefObject<HTMLDivElement | null>;
  setPop(pop: Pop | null): void;
}

export type Navigation = ReturnType<typeof useNavigation>;

export function useNavigation({ cmp, prefs, setPref, phone, view, elastic, initial, root, setPop }: NavigationDeps) {
  const { changesOnly, minimap, lines, bands, sidebar, review } = prefs;
  const [current, setCurrentState] = useState(initial);
  /** Folds the reader opened, by the key of their first row. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  /** The change and page buttons that would do nothing. */
  const [buttons, setButtons] = useState<NavOff>(ALL_NAV_OFF);
  const n = cmp?.hunks.length ?? 0;
  const cur = n ? Math.min(Math.max(current, 0), n - 1) : -1;
  // With no changes there is nothing to fold away.
  const items = useMemo(() => (cmp ? gridItems(cmp.rows, changesOnly && n > 0, expanded) : []), [cmp, changesOnly, n, expanded]);

  const scroller = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const heads = useRef<HTMLDivElement>(null);
  /** The reader scrolled by hand since the last jump to a change. */
  const userScrolled = useRef(false);
  /** Runs once the page shows the next update. */
  const afterRender = useRef<(() => void) | null>(null);
  const layout = useInstance(GridLayout, () => new GridLayout(() => scroller.current, () => grid.current));
  const elasticLayout = useInstance(ElasticLayout, () => new ElasticLayout());
  /** Measures whichever grid is showing. */
  const lay = elastic ? elasticLayout : layout;
  /** The grid on the page is the one with connection bands (in a commit, it may not be the one being rendered). */
  const isElastic = () => !!grid.current?.classList.contains('egrid');
  const place = useMemo<Place>(
    () => ({
      capture: () => {
        const sc = scroller.current;
        const g = grid.current;
        if (!sc || !g) return null;
        return g.classList.contains('egrid') ? elasticLayout.capture() : captureAnchor(sc, g);
      },
      restore: (anchor) => {
        const sc = scroller.current;
        const g = grid.current;
        if (!sc || !g) return;
        if (g.classList.contains('egrid')) elasticLayout.restore(anchor);
        else restoreAnchor(sc, g, anchor);
      },
    }),
    [elasticLayout],
  );

  /** Scrolls a change into view in whichever grid is showing. */
  const scrollToChange = (h: number, smooth: boolean) => {
    const sc = scroller.current;
    const g = grid.current;
    if (!sc || !g) return;
    if (isElastic()) elasticLayout.scrollToHunk(h, smooth);
    else scrollToHunk(sc, g, h, smooth);
  };

  /**
   * The change N (delta 1) or P (delta -1) goes to, or -1 when there is none.
   * After the reader scrolled away from the current change, it goes from what
   * is on screen instead.
   */
  const navTarget = (delta: 1 | -1): number => {
    if (!n) return -1;
    let base = cur;
    const sc = scroller.current;
    const L = userScrolled.current && sc ? lay.measure() : null;
    if (L && sc) {
      const top = sc.scrollTop + L.head;
      const bottom = sc.scrollTop + sc.clientHeight;
      const box = L.hunks[cur];
      if (!box || box.bottom <= top || box.top >= bottom) {
        // The first change that ends below the top of the screen (n when all are above it).
        let lo = 0;
        let hi = L.hunks.length;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (L.hunks[mid]!.bottom > top) hi = mid;
          else lo = mid + 1;
        }
        const next = lo < L.hunks.length ? L.hunks[lo]!.hunk : n;
        base = delta > 0 ? next - 1 : next;
      }
    }
    const t = base + delta;
    return t >= 0 && t < n ? t : -1;
  };

  /** Turns the change and page buttons off where they would do nothing. */
  const updateNav = () => {
    const sc = scroller.current;
    let next = ALL_NAV_OFF;
    if (cmp && sc) {
      const bottom = sc.scrollHeight - sc.clientHeight - 1;
      next = { prev: navTarget(-1) < 0, next: navTarget(1) < 0, pageUp: sc.scrollTop <= 0, pageDown: sc.scrollTop >= bottom };
    }
    setButtons((v) => (v.prev === next.prev && v.next === next.next && v.pageUp === next.pageUp && v.pageDown === next.pageDown ? v : next));
  };
  const latestUpdateNav = useRef(updateNav);
  const navFrame = useRef(0);
  const scheduleNav = useCallback(() => {
    if (navFrame.current) return;
    navFrame.current = requestAnimationFrame(() => {
      navFrame.current = 0;
      latestUpdateNav.current();
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(navFrame.current), []);

  // After every update: queued work, then the navigation buttons.
  useLayoutEffect(() => {
    const fn = afterRender.current;
    afterRender.current = null;
    fn?.();
    latestUpdateNav.current = updateNav;
    updateNav();
  });

  // Widening the gutter or the list of changes, or changing the view, moves every row.
  useLayoutEffect(() => layout.invalidate(), [layout, minimap, lines, sidebar, view, review]);

  // A resized window moves every row, and leaves menus behind.
  useEffect(() => {
    const resize = () => {
      setPop(null);
      scheduleNav();
    };
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [setPop, scheduleNav]);

  const setCurrent = (h: number, scroll: boolean) => {
    setCurrentState(h);
    if (scroll) scrollToChange(h, !reducedMotion());
  };

  const step = (delta: 1 | -1) => {
    const t = navTarget(delta);
    if (t < 0) return;
    userScrolled.current = false;
    setCurrent(t, true);
  };

  /** Scrolls the documents by a screen, keeping a little of the last one in view. */
  const page = (delta: 1 | -1) => {
    const sc = scroller.current;
    if (!cmp || !sc) return;
    const bottom = sc.scrollHeight - sc.clientHeight - 1;
    if (delta < 0 ? sc.scrollTop <= 0 : sc.scrollTop >= bottom) return;
    userScrolled.current = true;
    setPop(null);
    sc.scrollBy({ top: delta * Math.max(80, sc.clientHeight - (heads.current?.offsetHeight ?? 0) - 48), behavior: reducedMotion() ? 'auto' : 'smooth' });
  };

  const goToChange = useStable((h: number) => {
    userScrolled.current = false;
    setCurrent(h, true);
    // Where the list covers the documents, get it out of the way (keyboard focus goes back to its button).
    if (!panelOverlays()) return;
    const hadFocus = !!document.activeElement?.closest('#changes');
    setPref({ sidebar: false });
    if (hadFocus) afterRender.current = () => root.current?.querySelector<HTMLElement>('#btn-sidebar')?.focus({ preventScroll: true });
  });

  /** Scrolls a row into view, showing it first if it is folded away. */
  const goToRow = useStable((rowKey: string) => {
    if (!cmp) return;
    const at = cmp.rows.findIndex((r) => r.key === rowKey);
    let fold: string | null = null;
    for (const it of items) {
      if (it.type !== 'fold') continue;
      const from = cmp.rows.findIndex((r) => r.key === it.key);
      if (from <= at && at < from + it.count) fold = it.key;
    }
    const show = () => place.restore([{ id: rowKey, offset: (heads.current?.offsetHeight ?? 0) + 48 }]);
    userScrolled.current = true;
    if (fold) {
      const key = fold;
      setExpanded((e) => new Set(e).add(key));
      afterRender.current = show;
    } else show();
    if (panelOverlays()) setPref({ sidebar: false });
  });

  /** Shows a newly loaded comparison from its start: its first change, with no folds open. */
  const fromTop = () => {
    setCurrentState(0);
    setExpanded(new Set());
    userScrolled.current = false;
    afterRender.current = () => scroller.current?.scrollTo({ top: 0 });
  };

  /* ------------------------------------------------------ view toggles */

  const toggleChangesOnly = () => {
    if (!n) return;
    setPref({ changesOnly: !changesOnly });
    setExpanded(new Set());
    afterRender.current = () => {
      if (cur >= 0) scrollToChange(cur, false);
    };
  };

  const setView = (v: View) => {
    if (phone || v === prefs.view) return;
    setPref({ view: v });
  };

  const toggleBands = () => {
    if (cmp && view === 'split') setPref({ bands: !bands });
  };

  const toggleSidebar = (open = !sidebar) => {
    if (open !== sidebar && (!open || cmp)) setPref({ sidebar: open });
  };

  const closeSidebar = useStable(() => {
    toggleSidebar(false);
    afterRender.current = () => root.current?.querySelector<HTMLElement>('#btn-sidebar')?.focus();
  });

  /* ------------------------------------ the documents' scroller and grid */

  /** The reader scrolled by hand. */
  const manual = () => {
    userScrolled.current = true;
  };
  const onOverviewGo = useStable((h: number) => {
    userScrolled.current = false;
    setCurrent(h, true);
  });
  const onOverviewScrolled = useStable(() => {
    userScrolled.current = true;
    setPop(null);
  });
  const onFold = useStable((key: string) => setExpanded((e) => new Set(e).add(key)));
  const onPick = useStable((h: number) => setCurrent(h, false));
  const onGridRender = useCallback(() => layout.invalidate(), [layout]);

  return {
    n,
    cur,
    items,
    setCurrentState,
    buttons,
    scroller,
    grid,
    heads,
    elasticLayout,
    lay,
    place,
    scheduleNav,
    step,
    page,
    goToChange,
    goToRow,
    fromTop,
    toggleChangesOnly,
    setView,
    toggleBands,
    toggleSidebar,
    closeSidebar,
    manual,
    onOverviewGo,
    onOverviewScrolled,
    onFold,
    onPick,
    onGridRender,
  };
}
