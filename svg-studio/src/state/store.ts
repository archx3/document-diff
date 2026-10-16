import { useSyncExternalStore } from 'react';
import { findNode, orderIds } from '../core/doc';
import type { Pt, Rect } from '../core/geometry';
import type { Matrix } from '../core/matrix';
import type { PNode } from '../core/nodes';
import type { MarqueeMode } from '../core/pick';
import { CENTER_PIVOT, type Pivot } from '../core/transform';
import type { Doc, Node } from '../core/types';

export type ToolId = 'select' | 'node' | 'pen' | 'line' | 'rect' | 'ellipse' | 'scale' | 'scaleH' | 'scaleV' | 'rotate' | 'hand';

export interface Settings {
  snap: boolean;
  snapStep: number;
  grid: boolean;
  keylines: boolean;
  /** What a dragged selection rectangle picks: shapes completely inside it, or any it touches. */
  selectMode: MarqueeMode;
  /** Scale stroke widths along with the shapes (off: an icon keeps its line weight). */
  scaleStroke: boolean;
  /** Draw every path as a hairline, to see the geometry under the stroke. */
  outline: boolean;
  /** The artboard's background: following the theme, or always light or dark (for icons that are black or white). */
  artboard: 'auto' | 'light' | 'dark';
}

export interface PenState {
  nodes: PNode[];
  /** Where the pointer is, for the segment that follows it. */
  cursor: Pt | null;
}

/** Things drawn on top of the canvas while a gesture is going on. */
export type Overlay =
  | { kind: 'marquee'; rect: Rect; mode: MarqueeMode }
  /** The selection's box as it was, with the transform being dragged applied to it. */
  | { kind: 'box'; box: Rect; m: Matrix; label: string; pivot?: Pt }
  | { kind: 'readout'; at: Pt; label: string };

export interface Toast {
  id: number;
  text: string;
  error?: boolean;
}

export interface EditorState {
  doc: Doc;
  name: string;
  selection: string[];
  /** The group that is open for selecting inside (null: the top level). */
  scope: string | null;
  tool: ToolId;
  settings: Settings;
  pivot: Pivot;
  /** Selected anchor points while node-editing, as "subpath:index". */
  nodeSel: string[];
  pen: PenState | null;
  overlay: Overlay | null;
  hover: string | null;
  toast: Toast | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Layers shown as an outline in the editor. */
  clipboard: Node[] | null;
}

interface Snapshot {
  doc: Doc;
  selection: string[];
  scope: string | null;
}

const MAX_HISTORY = 200;

type Listener = () => void;

export class Store {
  private state: EditorState;
  private listeners = new Set<Listener>();
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private base: Snapshot | null = null;
  private coalesce: { key: string; at: number } | null = null;

  constructor(initial: EditorState) {
    this.state = initial;
  }

  get = (): EditorState => this.state;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  private emit(next: EditorState): void {
    this.state = next;
    for (const fn of this.listeners) fn();
  }

  private snapshot(): Snapshot {
    const { doc, selection, scope } = this.state;
    return { doc, selection, scope };
  }

  private withHistoryFlags(s: EditorState): EditorState {
    return { ...s, canUndo: this.past.length > 0, canRedo: this.future.length > 0 };
  }

  /** Changes state without touching the history (selection, tool, view options, previews). */
  patch(p: Partial<EditorState>): void {
    this.emit({ ...this.state, ...p });
  }

  /** Replaces the document without recording it. Used while a gesture is previewing. */
  setDoc(doc: Doc, p: Partial<EditorState> = {}): void {
    this.emit({ ...this.state, ...p, doc });
  }

  /**
   * Replaces the document and records the old one so it can be undone. Edits with the same `coalesce`
   * key made in quick succession (arrow-key nudges, typing in a field) share one undo step.
   */
  commit(doc: Doc, p: Partial<EditorState> = {}, coalesce?: string): void {
    if (doc !== this.state.doc) {
      const now = Date.now();
      const merge = coalesce && this.coalesce && this.coalesce.key === coalesce && now - this.coalesce.at < 800 && this.past.length > 0;
      if (!merge) {
        this.past.push(this.snapshot());
        if (this.past.length > MAX_HISTORY) this.past.shift();
      }
      this.future = [];
      this.coalesce = coalesce ? { key: coalesce, at: now } : null;
    }
    this.emit(this.withHistoryFlags({ ...this.state, ...p, doc }));
  }

  /** Starts a gesture: the document as it is now is what undo returns to. */
  begin(): void {
    this.base = this.snapshot();
  }

  /** Ends a gesture, recording it if it changed the document. */
  end(): void {
    const base = this.base;
    this.base = null;
    if (base && base.doc !== this.state.doc) {
      this.past.push(base);
      if (this.past.length > MAX_HISTORY) this.past.shift();
      this.future = [];
      this.coalesce = null;
    }
    this.emit(this.withHistoryFlags({ ...this.state, overlay: null }));
  }

  /** Cancels a gesture and restores what it started from. */
  abort(): void {
    const base = this.base;
    this.base = null;
    this.emit({ ...this.state, ...(base ?? {}), overlay: null });
  }

  get gesturing(): boolean {
    return this.base !== null;
  }

  private restore(s: Snapshot): void {
    const ids = new Set(orderIds(s.doc));
    const selection = s.selection.filter((id) => ids.has(id));
    const scope = s.scope && findNode(s.doc, s.scope) ? s.scope : null;
    this.emit(this.withHistoryFlags({ ...this.state, doc: s.doc, selection, scope, nodeSel: [], pen: null, overlay: null, hover: null }));
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.snapshot());
    this.coalesce = null;
    this.restore(prev);
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.snapshot());
    this.coalesce = null;
    this.restore(next);
  }

  /** Forgets the history (a new or imported document starts fresh). */
  resetHistory(): void {
    this.past = [];
    this.future = [];
    this.base = null;
    this.coalesce = null;
    this.emit(this.withHistoryFlags(this.state));
  }
}

export const DEFAULT_SETTINGS: Settings = { snap: true, snapStep: 1, grid: true, keylines: true, selectMode: 'encompass', scaleStroke: false, outline: false, artboard: 'auto' };

export function createInitialState(doc: Doc, name: string, settings: Settings = DEFAULT_SETTINGS): EditorState {
  return {
    doc,
    name,
    selection: [],
    scope: null,
    tool: 'select',
    settings,
    pivot: CENTER_PIVOT,
    nodeSel: [],
    pen: null,
    overlay: null,
    hover: null,
    toast: null,
    canUndo: false,
    canRedo: false,
    clipboard: null,
  };
}

/** The editor's one store. */
export let store: Store;

export function initStore(initial: EditorState): Store {
  store = new Store(initial);
  return store;
}

/** Subscribes a component to part of the state. The selector must return a stable value (a field, not a fresh array). */
export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}
