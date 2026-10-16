import {
  arrange,
  boundsOf,
  cloneInPlace,
  cloneNodes,
  editableIds,
  findNode,
  groupNodes,
  insertNodes,
  locate,
  nodeBounds,
  normalizeSelection,
  removeNodes,
  transformNodes,
  ungroupNodes,
  updateNode,
  updateNodes,
  type ArrangeMode,
} from '../core/doc';
import { unionAll, type Rect } from '../core/geometry';
import { meanScale, translate, type Matrix } from '../core/matrix';
import { deleteNodes, fromSubPaths, insertNode, moveNodes, segmentCount, setClosed, setNodeType, toSubPaths, type NodeRef, type SubPath } from '../core/nodes';
import { serializePath } from '../core/path';
import { geomToPath, geomToSegs } from '../core/shapes';
import { rebaseStyle, serializeSvg, parseSvg, SvgParseError } from '../core/svg-io';
import { CENTER_PIVOT, alignDeltas, distributeDeltas, type AlignMode } from '../core/transform';
import { emptyDoc, uid, type Geometry, type GroupNode, type Node, type Style, type StyleKey } from '../core/types';
import { store, type Settings, type ToolId } from './store';

const S = () => store.get();

let toastId = 0;
export function toast(text: string, error = false): void {
  const id = ++toastId;
  store.patch({ toast: { id, text, error } });
  setTimeout(() => {
    if (store.get().toast?.id === id) store.patch({ toast: null });
  }, error ? 5000 : 2400);
}

/** The selected nodes that exist, can be edited, and are not inside another selected group. */
export function liveSelection(): string[] {
  const { doc, selection } = S();
  return editableIds(doc, selection);
}

/** The selection's outline box, or null when nothing is selected. */
export function selectionBounds(): Rect | null {
  const { doc } = S();
  return boundsOf(doc, liveSelection());
}

/* ---------------------------------------------------------------- selection */

export function setSelection(ids: readonly string[], scope?: string | null): void {
  const s = S();
  const ordered = normalizeSelection(s.doc, ids);
  const same = ordered.length === s.selection.length && ordered.every((id, i) => id === s.selection[i]);
  store.patch({
    selection: ordered,
    ...(scope !== undefined ? { scope } : {}),
    ...(same ? {} : { nodeSel: [], pivot: CENTER_PIVOT }),
  });
}

export function clearSelection(): void {
  setSelection([]);
}

/** Selects a node from the layers list: the scope moves to the group around it so it can be edited on the canvas. */
export function selectFromList(id: string, mode: 'replace' | 'toggle' = 'replace'): void {
  const { doc, selection } = S();
  const loc = locate(doc, id);
  if (!loc) return;
  const scope = loc.parent?.id ?? null;
  if (mode === 'toggle') {
    const keep = selection.filter((x) => (locate(doc, x)?.parent?.id ?? null) === scope);
    setSelection(keep.includes(id) ? keep.filter((x) => x !== id) : [...keep, id], scope);
  } else setSelection([id], scope);
}

export function selectAll(): void {
  const { doc, scope } = S();
  const group = scope ? findNode(doc, scope) : null;
  const items = group && group.type === 'group' ? group.children : doc.children;
  setSelection(items.filter((n) => !n.hidden && !n.locked).map((n) => n.id));
}

/** Opens a group so its children can be selected one by one. */
export function enterGroup(id: string, select: string[] = []): void {
  setSelection(select, id);
}

/** Closes the open group; the group itself becomes the selection. */
export function exitScope(): void {
  const { doc, scope } = S();
  if (scope === null) return;
  const loc = locate(doc, scope);
  setSelection([scope], loc?.parent?.id ?? null);
}

export function setTool(tool: ToolId): void {
  const s = S();
  if (s.tool === tool) return;
  if (s.pen) finishPen();
  store.patch({ tool, overlay: null, nodeSel: [] });
}

export function updateSettings(p: Partial<Settings>): void {
  store.patch({ settings: { ...S().settings, ...p } });
}

/* ------------------------------------------------------------------- editing */

export function deleteSelection(): void {
  const ids = liveSelection();
  if (!ids.length) return;
  store.commit(removeNodes(S().doc, ids), { selection: [], nodeSel: [], hover: null });
}

export function duplicateSelection(): void {
  const ids = liveSelection();
  if (!ids.length) return;
  const copy = cloneInPlace(S().doc, ids);
  const out = transformNodes(copy.doc, copy.ids, translate(1, 1));
  store.commit(out, { selection: normalizeSelection(out, copy.ids), nodeSel: [] });
}

export function groupSelection(): void {
  const { doc } = S();
  const ids = liveSelection();
  if (!ids.length) return;
  const r = groupNodes(doc, ids);
  if (!r) return;
  const scope = locate(r.doc, r.groupId)?.parent?.id ?? null;
  store.commit(r.doc, { selection: [r.groupId], scope, nodeSel: [] });
}

export function ungroupSelection(): void {
  const { doc } = S();
  const ids = liveSelection().filter((id) => findNode(doc, id)?.type === 'group');
  if (!ids.length) {
    toast('Select a group to ungroup it');
    return;
  }
  const r = ungroupNodes(doc, ids);
  store.commit(r.doc, { selection: normalizeSelection(r.doc, r.ids), nodeSel: [] });
}

export function arrangeSelection(mode: ArrangeMode): void {
  const ids = liveSelection();
  if (ids.length) store.commit(arrange(S().doc, ids, mode));
}

export function transformSelection(m: Matrix, coalesce?: string): void {
  const s = S();
  const ids = liveSelection();
  if (!ids.length) return;
  const strokeScale = s.settings.scaleStroke ? meanScale(m) : 1;
  store.commit(transformNodes(s.doc, ids, m, { strokeScale }), {}, coalesce);
}

export function nudge(dx: number, dy: number): void {
  transformSelection(translate(dx, dy), 'nudge');
}

export function alignSelection(mode: AlignMode): void {
  const s = S();
  const ids = liveSelection();
  if (!ids.length) return;
  const boxes = new Map<string, Rect>();
  for (const id of ids) {
    const n = findNode(s.doc, id);
    const b = n ? nodeBounds(n) : null;
    if (b) boxes.set(id, b);
  }
  // One item lines up with the canvas; several line up with each other.
  const reference: Rect = boxes.size === 1 ? { x: 0, y: 0, w: s.doc.width, h: s.doc.height } : unionAll(boxes.values())!;
  moveEach(alignDeltas(boxes, mode, reference));
}

export function distributeSelection(axis: 'h' | 'v'): void {
  const s = S();
  const boxes = new Map<string, Rect>();
  for (const id of liveSelection()) {
    const n = findNode(s.doc, id);
    const b = n ? nodeBounds(n) : null;
    if (b) boxes.set(id, b);
  }
  if (boxes.size < 3) {
    toast('Select three or more layers to distribute them');
    return;
  }
  moveEach(distributeDeltas(boxes, axis));
}

function moveEach(deltas: ReadonlyMap<string, { x: number; y: number }>): void {
  let doc = S().doc;
  for (const [id, d] of deltas) if (d.x || d.y) doc = transformNodes(doc, [id], translate(d.x, d.y));
  store.commit(doc);
}

/* --------------------------------------------------------------------- style */

const stripKeys = (n: Node, keys: StyleKey[]): Node => {
  const style = { ...n.style };
  for (const k of keys) delete style[k];
  return n.type === 'group' ? { ...n, style, children: n.children.map((c) => stripKeys(c, keys)) } : { ...n, style };
};

/**
 * Applies style properties to the selection (or to the document's defaults when nothing is selected).
 * A property set to undefined is cleared so the layer inherits it again.
 */
export function setStyle(patch: Style): void {
  const s = S();
  const keys = Object.keys(patch) as StyleKey[];
  const ids = liveSelection();
  if (!ids.length) {
    const defaults: Style = { ...s.doc.defaults };
    for (const k of keys) {
      if (patch[k] === undefined) continue;
      (defaults as Record<string, unknown>)[k] = patch[k];
    }
    store.commit({ ...s.doc, defaults }, {}, `style:${keys.join()}`);
    return;
  }
  const doc = updateNodes(s.doc, ids, (n) => {
    const style: Style = { ...n.style };
    for (const k of keys) {
      if (patch[k] === undefined) delete style[k];
      else (style as Record<string, unknown>)[k] = patch[k];
    }
    // A group's setting wins over what its children say, so those are cleared.
    return n.type === 'group' ? { ...stripKeys(n, keys), style } as GroupNode : { ...n, style };
  });
  store.commit(doc, {}, `style:${ids.join()}:${keys.join()}`);
}

export function setGeometry(id: string, geom: Geometry, coalesce?: string): void {
  store.commit(updateNode(S().doc, id, (n) => (n.type === 'shape' ? { ...n, geom } : n)), {}, coalesce);
}

export function convertToPath(): void {
  const ids = liveSelection();
  let doc = S().doc;
  let changed = false;
  const all = (n: Node): Node => {
    if (n.type === 'group') return { ...n, children: n.children.map(all) };
    if (n.geom.kind === 'path') return n;
    changed = true;
    return { ...n, geom: geomToPath(n.geom) };
  };
  doc = updateNodes(doc, ids, all);
  if (changed) store.commit(doc);
  else toast('Already paths');
}

export function renameNode(id: string, name: string): void {
  store.commit(updateNode(S().doc, id, (n) => ({ ...n, name: name.trim() || undefined })));
}

export function toggleHidden(id: string): void {
  const { doc, selection } = S();
  const n = findNode(doc, id);
  if (!n) return;
  store.commit(updateNode(doc, id, (x) => ({ ...x, hidden: x.hidden ? undefined : true })), { selection: n.hidden ? selection : selection.filter((s) => s !== id) });
}

export function toggleLocked(id: string): void {
  const { doc, selection } = S();
  const n = findNode(doc, id);
  if (!n) return;
  store.commit(updateNode(doc, id, (x) => ({ ...x, locked: x.locked ? undefined : true })), { selection: n.locked ? selection : selection.filter((s) => s !== id) });
}

export function toggleCollapsed(id: string): void {
  store.setDoc(updateNode(S().doc, id, (n) => (n.type === 'group' ? { ...n, collapsed: !n.collapsed } : n)));
}

/* ------------------------------------------------------------------ documents */

export function newDocument(size = 24): void {
  // Recorded like any other change, so a stray click on New can be undone.
  store.commit(emptyDoc(size), { selection: [], scope: null, nodeSel: [], pen: null, name: 'untitled' });
}

export function resizeCanvas(width: number, height: number): void {
  const { doc } = S();
  if (width > 0 && height > 0 && (width !== doc.width || height !== doc.height)) store.commit({ ...doc, width, height });
}

export function importSvg(text: string, mode: 'replace' | 'insert' = 'replace'): boolean {
  try {
    const { doc: imported, warnings } = parseSvg(text);
    const s = S();
    if (mode === 'replace') {
      store.commit({ ...imported }, { selection: [], scope: null, nodeSel: [], pen: null });
    } else {
      const nodes = rebaseStyle(imported.children, imported.defaults, s.doc.defaults);
      const parent = s.scope;
      const doc = insertNodes(s.doc, parent, null, nodes);
      store.commit(doc, { selection: nodes.map((n) => n.id), nodeSel: [] });
    }
    if (warnings.length) toast(warnings[0]!, true);
    else toast(mode === 'replace' ? 'SVG imported' : 'Pasted');
    return true;
  } catch (e) {
    toast(e instanceof SvgParseError ? e.message : 'Could not read that SVG', true);
    return false;
  }
}

/** The selected layers as SVG markup, for the clipboard. */
export function selectionAsSvg(): string | null {
  const { doc } = S();
  const ids = liveSelection();
  if (!ids.length) return null;
  const nodes = ids.map((id) => findNode(doc, id)!).filter(Boolean);
  store.patch({ clipboard: nodes });
  return serializeSvg({ ...doc, children: nodes }, { includeHidden: true });
}

export function pasteNodes(nodes: readonly Node[]): void {
  const s = S();
  const copies = cloneNodes(nodes);
  store.commit(insertNodes(s.doc, s.scope, null, copies), { selection: copies.map((n) => n.id), nodeSel: [] });
}

/* ----------------------------------------------------------------- node editing */

/** The one shape whose points are being edited. */
export function nodeTargetId(): string | null {
  const ids = liveSelection();
  if (ids.length !== 1) return null;
  const n = findNode(S().doc, ids[0]!);
  return n && n.type === 'shape' ? n.id : null;
}

export function subPathsOf(id: string): SubPath[] {
  const n = findNode(S().doc, id);
  return n && n.type === 'shape' ? toSubPaths(geomToSegs(n.geom)) : [];
}

export const geomFromSubPaths = (subs: readonly SubPath[]): Geometry => ({ kind: 'path', d: serializePath(fromSubPaths(subs)) });

export const parseNodeKey = (key: string): NodeRef => {
  const [sub, idx] = key.split(':').map(Number);
  return { sub: sub!, idx: idx! };
};

function editSelectedNodes(fn: (subs: SubPath[], refs: NodeRef[]) => { subs: SubPath[]; nodeSel?: string[] } | null, coalesce?: string): void {
  const id = nodeTargetId();
  if (!id) return;
  const refs = S().nodeSel.map(parseNodeKey);
  const out = fn(subPathsOf(id), refs);
  if (!out) return;
  setGeometry(id, geomFromSubPaths(out.subs), coalesce);
  store.patch({ nodeSel: out.nodeSel ?? [] });
}

export function nudgeSelectedNodes(dx: number, dy: number): void {
  editSelectedNodes((subs, refs) => (refs.length ? { subs: moveNodes(subs, refs, dx, dy), nodeSel: S().nodeSel } : null), 'nudge-nodes');
}

export function selectAllNodes(): void {
  const id = nodeTargetId();
  if (!id) return;
  store.patch({ nodeSel: subPathsOf(id).flatMap((sp, si) => sp.nodes.map((_, ni) => `${si}:${ni}`)) });
}

export function deleteSelectedNodes(): void {
  editSelectedNodes((subs, refs) => (refs.length ? { subs: deleteNodes(subs, refs) } : null));
  // A path with nothing left goes away.
  const id = nodeTargetId();
  if (id) {
    const n = findNode(S().doc, id);
    if (n && n.type === 'shape' && n.geom.kind === 'path' && !n.geom.d) deleteSelection();
  }
}

export function setSelectedNodesType(type: 'corner' | 'smooth'): void {
  editSelectedNodes((subs, refs) => (refs.length ? { subs: refs.reduce((acc, r) => setNodeType(acc, r, type), subs), nodeSel: S().nodeSel } : null));
}

/** Adds a node in the middle of the segment after each selected node. */
export function addNodeAfterSelected(): void {
  editSelectedNodes((subs, refs) => {
    if (!refs.length) return null;
    // Insert from the highest index down so earlier indices stay valid.
    const sorted = [...refs].filter((r) => r.idx < segmentCount(subs[r.sub]!)).sort((a, b) => b.sub - a.sub || b.idx - a.idx);
    let out = subs;
    const added: string[] = [];
    for (const r of sorted) {
      const res = insertNode(out, r.sub, r.idx, 0.5);
      out = res.subs;
      added.push(`${res.ref.sub}:${res.ref.idx}`);
    }
    return { subs: out, nodeSel: added };
  });
}

export function toggleClosedPath(): void {
  const id = nodeTargetId();
  if (!id) return;
  const subs = subPathsOf(id);
  if (!subs.length) return;
  const sel = S().nodeSel.map(parseNodeKey);
  const target = sel[0]?.sub ?? 0;
  setGeometry(id, geomFromSubPaths(setClosed(subs, target, !subs[target]!.closed)));
}

/* ---------------------------------------------------------------------- pen */

/** Finishes the path being drawn with the pen: it becomes a layer if it has at least two points. */
export function finishPen(closed = false): void {
  const s = S();
  const pen = s.pen;
  if (!pen) return;
  const nodes = pen.nodes;
  store.patch({ pen: null });
  if (nodes.length < 2) return;
  const geom = geomFromSubPaths([{ nodes, closed }]);
  const node: Node = { type: 'shape', id: uid(), geom, style: {} };
  store.commit(insertNodes(s.doc, s.scope, null, [node]), { selection: [node.id], nodeSel: [] });
}
