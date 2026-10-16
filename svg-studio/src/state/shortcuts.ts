import { findNode } from '../core/doc';
import { flipMatrix, pivotPoint } from '../core/transform';
import {
  addNodeAfterSelected,
  arrangeSelection,
  clearSelection,
  deleteSelectedNodes,
  deleteSelection,
  duplicateSelection,
  enterGroup,
  exitScope,
  finishPen,
  groupSelection,
  liveSelection,
  nudge,
  nudgeSelectedNodes,
  selectAll,
  selectAllNodes,
  selectionBounds,
  setTool,
  transformSelection,
  updateSettings,
  ungroupSelection,
} from './actions';
import { cancelActiveGesture } from './gestures';
import { store, type ToolId } from './store';

const TOOL_KEYS: Record<string, ToolId> = { v: 'select', a: 'node', p: 'pen', l: 'line', r: 'rect', e: 'ellipse', s: 'scale', x: 'scaleH', y: 'scaleV', t: 'rotate', h: 'hand' };

export const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

export interface ShortcutHooks {
  openHelp(): void;
  openExport(): void;
}

function flip(axis: 'h' | 'v'): void {
  const box = selectionBounds();
  if (!box) return;
  transformSelection(flipMatrix(axis, pivotPoint(box, store.get().pivot)));
}

/** The editor's keyboard shortcuts. Copy, cut and paste are the browser's own events and live in the app. */
export function handleKeyDown(e: KeyboardEvent, hooks: ShortcutHooks): void {
  // While a dialog is open the keys belong to it (Delete must not remove what is selected behind it).
  if (document.querySelector('.backdrop')) return;
  if (isTyping(e.target)) {
    if (e.key === 'Escape') (e.target as HTMLElement).blur();
    return;
  }
  const s = store.get();
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (mod) {
    if (key === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
    } else if (key === 'y') {
      e.preventDefault();
      store.redo();
    } else if (key === 'a') {
      e.preventDefault();
      if (s.tool === 'node') selectAllNodes();
      else selectAll();
    } else if (key === 'd') {
      e.preventDefault();
      duplicateSelection();
    } else if (key === 'g') {
      e.preventDefault();
      if (e.shiftKey) ungroupSelection();
      else groupSelection();
    } else if (key === 's' || (key === 'e' && e.shiftKey)) {
      e.preventDefault();
      hooks.openExport();
    }
    return;
  }

  if (e.key === 'Escape') {
    if (cancelActiveGesture()) return;
    if (s.pen) return finishPen(false);
    if (s.nodeSel.length) return void store.patch({ nodeSel: [] });
    if (s.tool !== 'select') return setTool('select');
    if (s.selection.length) return clearSelection();
    return exitScope();
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    if (s.tool === 'pen' && s.pen) {
      const nodes = s.pen.nodes.slice(0, -1);
      store.patch({ pen: nodes.length ? { ...s.pen, nodes } : null });
    } else if (s.tool === 'node' && s.nodeSel.length) deleteSelectedNodes();
    else deleteSelection();
    return;
  }
  if (e.key === 'Enter') {
    if (s.pen) return finishPen(false);
    // Enter opens the selected group and selects what is in it.
    const ids = liveSelection();
    const n = ids.length === 1 ? findNode(s.doc, ids[0]!) : null;
    if (n?.type === 'group') enterGroup(n.id, n.children.filter((c) => !c.hidden && !c.locked).map((c) => c.id));
    return;
  }
  if (e.key.startsWith('Arrow')) {
    const big = e.shiftKey ? 0.1 : s.settings.snapStep;
    const dx = e.key === 'ArrowLeft' ? -big : e.key === 'ArrowRight' ? big : 0;
    const dy = e.key === 'ArrowUp' ? -big : e.key === 'ArrowDown' ? big : 0;
    e.preventDefault();
    if (s.tool === 'node' && s.nodeSel.length) nudgeSelectedNodes(dx, dy);
    else nudge(dx, dy);
    return;
  }
  if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
    e.preventDefault();
    arrangeSelection(e.code === 'BracketRight' ? (e.shiftKey ? 'front' : 'forward') : e.shiftKey ? 'back' : 'backward');
    return;
  }
  if (e.key === '?' || e.key === 'F1') {
    e.preventDefault();
    hooks.openHelp();
    return;
  }
  if (e.shiftKey && key === 'h') return void flip('h');
  if (e.shiftKey && key === 'v') return void flip('v');
  if (s.tool === 'node' && key === 'n' && !e.shiftKey) return addNodeAfterSelected();
  if (key === 'o' && !e.shiftKey && !e.altKey) return updateSettings({ outline: !s.settings.outline });
  const tool = TOOL_KEYS[key];
  if (tool && !e.shiftKey && !e.altKey) setTool(tool);
}
