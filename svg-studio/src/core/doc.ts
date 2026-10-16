import { type Rect, unionAll } from './geometry';
import type { Matrix } from './matrix';
import { geomBounds, transformGeom } from './shapes';
import { type Doc, type GroupNode, type Node, type ShapeNode, type Style, uid } from './types';

/* Tree operations. Documents are never changed in place: each operation returns a new document that
   shares every untouched node with the old one, which is what makes undo and cheap redraws work. */

export const isGroup = (n: Node): n is GroupNode => n.type === 'group';
export const isShape = (n: Node): n is ShapeNode => n.type === 'shape';

/** A node and everything under it can be seen and edited. */
export const isLive = (n: Node): boolean => !n.hidden && !n.locked;

/** Calls `fn` for every node in z-order (back to front, a group before its children). Return false to skip a group's children. */
export function walk(nodes: readonly Node[], fn: (n: Node, parent: GroupNode | null, depth: number) => boolean | void, parent: GroupNode | null = null, depth = 0): void {
  for (const n of nodes) {
    if (fn(n, parent, depth) === false) continue;
    if (n.type === 'group') walk(n.children, fn, n, depth + 1);
  }
}

export function findNode(doc: Doc, id: string): Node | null {
  let found: Node | null = null;
  walk(doc.children, (n) => {
    if (n.id === id) found = n;
    return !found;
  });
  return found;
}

export interface Located {
  node: Node;
  /** The group it is in (null: the top level). */
  parent: GroupNode | null;
  index: number;
  /** Groups from the outermost down to the parent. */
  ancestors: GroupNode[];
}

export function locate(doc: Doc, id: string): Located | null {
  const search = (nodes: readonly Node[], ancestors: GroupNode[]): Located | null => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      if (n.id === id) return { node: n, parent: ancestors[ancestors.length - 1] ?? null, index: i, ancestors };
      if (n.type === 'group') {
        const hit = search(n.children, [...ancestors, n]);
        if (hit) return hit;
      }
    }
    return null;
  };
  return search(doc.children, []);
}

/** Ids of every node, in z-order. */
export function orderIds(doc: Doc): string[] {
  const out: string[] = [];
  walk(doc.children, (n) => void out.push(n.id));
  return out;
}

/** Ids of all shapes (not groups) under the given nodes. */
export function shapesUnder(nodes: readonly Node[]): ShapeNode[] {
  const out: ShapeNode[] = [];
  walk(nodes, (n) => {
    if (n.type === 'shape') out.push(n);
  });
  return out;
}

/** Replaces the node with the given id by `fn(node)` (null removes it, an array replaces it with several). */
function rewrite(nodes: readonly Node[], id: string, fn: (n: Node) => Node | Node[] | null): Node[] {
  let changed = false;
  const out: Node[] = [];
  for (const n of nodes) {
    if (n.id === id) {
      const r = fn(n);
      changed = true;
      if (r) out.push(...(Array.isArray(r) ? r : [r]));
      continue;
    }
    if (n.type === 'group') {
      const kids = rewrite(n.children, id, fn);
      if (kids !== n.children) {
        changed = true;
        out.push({ ...n, children: kids });
        continue;
      }
    }
    out.push(n);
  }
  return changed ? out : (nodes as Node[]);
}

export function updateNode(doc: Doc, id: string, fn: (n: Node) => Node | Node[] | null): Doc {
  const children = rewrite(doc.children, id, fn);
  return children === doc.children ? doc : { ...doc, children };
}

/** Applies `fn` to each of the nodes with the given ids (those not found are skipped). */
export function updateNodes(doc: Doc, ids: Iterable<string>, fn: (n: Node) => Node | Node[] | null): Doc {
  let out = doc;
  for (const id of ids) out = updateNode(out, id, fn);
  return out;
}

export function removeNodes(doc: Doc, ids: Iterable<string>): Doc {
  const set = new Set(ids);
  const strip = (nodes: readonly Node[]): Node[] => {
    let changed = false;
    const out: Node[] = [];
    for (const n of nodes) {
      if (set.has(n.id)) {
        changed = true;
        continue;
      }
      if (n.type === 'group') {
        const kids = strip(n.children);
        if (kids !== n.children) {
          changed = true;
          out.push({ ...n, children: kids });
          continue;
        }
      }
      out.push(n);
    }
    return changed ? out : (nodes as Node[]);
  };
  const children = strip(doc.children);
  return children === doc.children ? doc : { ...doc, children };
}

/** Inserts nodes into a group (or the top level for null) at `index`; null/undefined index puts them on top. */
export function insertNodes(doc: Doc, parentId: string | null, index: number | null, nodes: readonly Node[]): Doc {
  if (!nodes.length) return doc;
  if (parentId === null) {
    const children = [...doc.children];
    children.splice(index ?? children.length, 0, ...nodes);
    return { ...doc, children };
  }
  return updateNode(doc, parentId, (g) => {
    if (g.type !== 'group') return g;
    const children = [...g.children];
    children.splice(index ?? children.length, 0, ...nodes);
    return { ...g, children };
  });
}

/** Drops the ids that are inside another selected group (that group carries them), in z-order. */
export function normalizeSelection(doc: Doc, ids: Iterable<string>): string[] {
  const set = new Set(ids);
  const out: string[] = [];
  walk(doc.children, (n) => {
    if (set.has(n.id)) {
      out.push(n.id);
      return false;
    }
  });
  return out;
}

/** Whether `id` is inside the group `ancestorId`. */
export function isInside(doc: Doc, id: string, ancestorId: string): boolean {
  const loc = locate(doc, id);
  return !!loc && loc.ancestors.some((g) => g.id === ancestorId);
}

/**
 * The item that a click on node `id` selects when the group `scope` is open (null: the top level):
 * the node itself, or the outermost group around it that is still inside the scope.
 */
export function selectableIn(doc: Doc, id: string, scope: string | null): string | null {
  const loc = locate(doc, id);
  if (!loc) return null;
  const chain = [...loc.ancestors, loc.node];
  if (scope === null) return chain[0]!.id;
  const at = chain.findIndex((n) => n.id === scope);
  return at >= 0 && at < chain.length - 1 ? chain[at + 1]!.id : null;
}

/** The children of the open group (or the top level). */
export function childrenOf(doc: Doc, scope: string | null): readonly Node[] {
  if (scope === null) return doc.children;
  const g = findNode(doc, scope);
  return g && g.type === 'group' ? g.children : doc.children;
}

/** Wraps the nodes in a new group, placed where the topmost of them was. */
export function groupNodes(doc: Doc, ids: readonly string[], name?: string): { doc: Doc; groupId: string } | null {
  const sel = normalizeSelection(doc, ids).filter((id) => {
    const n = findNode(doc, id);
    return n && !n.locked;
  });
  if (!sel.length) return null;
  const nodes = sel.map((id) => findNode(doc, id)!);
  const topLoc = locate(doc, sel[sel.length - 1]!)!;
  const set = new Set(sel);
  const siblings = topLoc.parent ? topLoc.parent.children : doc.children;
  // The group goes after the siblings below the topmost node that are not themselves being grouped.
  let at = 0;
  for (let i = 0; i < topLoc.index; i++) if (!set.has(siblings[i]!.id)) at++;
  const group: GroupNode = { type: 'group', id: uid(), name, style: {}, children: nodes };
  const without = removeNodes(doc, sel);
  return { doc: insertNodes(without, topLoc.parent?.id ?? null, at, [group]), groupId: group.id };
}

/** Replaces each group by its children. The group's own style is kept by passing it down. */
export function ungroupNodes(doc: Doc, ids: readonly string[]): { doc: Doc; ids: string[] } {
  let out = doc;
  const freed: string[] = [];
  for (const id of ids) {
    const n = findNode(out, id);
    if (!n || n.type !== 'group' || n.locked) continue;
    out = updateNode(out, id, (g) => {
      const grp = g as GroupNode;
      return grp.children.map((c): Node => ({ ...c, style: { ...grp.style, ...c.style }, hidden: grp.hidden || c.hidden || undefined, locked: grp.locked || c.locked || undefined }));
    });
    freed.push(...n.children.map((c) => c.id));
  }
  return { doc: out, ids: freed };
}

export type ArrangeMode = 'front' | 'back' | 'forward' | 'backward';

/** Moves the nodes up or down in z-order within their groups. */
export function arrange(doc: Doc, ids: readonly string[], mode: ArrangeMode): Doc {
  const set = new Set(ids);
  const reorder = (nodes: readonly Node[]): Node[] => {
    const list: Node[] = nodes.map((n) => {
      if (n.type !== 'group') return n;
      const kids = reorder(n.children);
      return kids.every((c, i) => c === n.children[i]) ? n : { ...n, children: kids };
    });
    if (!list.some((n) => set.has(n.id))) return list;
    const sel = list.map((n) => set.has(n.id));
    if (mode === 'front' || mode === 'back') {
      const picked = list.filter((_, i) => sel[i]);
      const rest = list.filter((_, i) => !sel[i]);
      return mode === 'front' ? [...rest, ...picked] : [...picked, ...rest];
    }
    const out = [...list];
    const flags = [...sel];
    if (mode === 'forward') {
      for (let i = out.length - 2; i >= 0; i--) {
        if (flags[i] && !flags[i + 1]) {
          [out[i], out[i + 1]] = [out[i + 1]!, out[i]!];
          [flags[i], flags[i + 1]] = [flags[i + 1]!, flags[i]!];
        }
      }
    } else {
      for (let i = 1; i < out.length; i++) {
        if (flags[i] && !flags[i - 1]) {
          [out[i], out[i - 1]] = [out[i - 1]!, out[i]!];
          [flags[i], flags[i - 1]] = [flags[i - 1]!, flags[i]!];
        }
      }
    }
    return out;
  };
  const children = reorder(doc.children);
  const same = children.length === doc.children.length && children.every((c, i) => c === doc.children[i]);
  return same ? doc : { ...doc, children };
}

/** Moves nodes into the group `parentId` (null: top level) at `index`, counted before they are taken out. */
export function moveNodes(doc: Doc, ids: readonly string[], parentId: string | null, index: number): Doc {
  const sel = normalizeSelection(doc, ids);
  if (!sel.length) return doc;
  // A group cannot go inside itself.
  if (parentId !== null && sel.some((id) => id === parentId || isInside(doc, parentId, id))) return doc;
  const nodes = sel.map((id) => findNode(doc, id)!);
  const target = parentId === null ? doc.children : (findNode(doc, parentId) as GroupNode).children;
  let adjusted = index;
  for (let i = 0; i < Math.min(index, target.length); i++) if (sel.includes(target[i]!.id)) adjusted--;
  return insertNodes(removeNodes(doc, sel), parentId, adjusted, nodes);
}

/** Deep copies with fresh ids. */
export function cloneNodes(nodes: readonly Node[]): Node[] {
  return nodes.map((n): Node => (n.type === 'group' ? { ...n, id: uid(), style: { ...n.style }, children: cloneNodes(n.children) } : { ...n, id: uid(), style: { ...n.style }, geom: n.geom }));
}

/** Bounds of the node's outline (hidden children are left out). */
export function nodeBounds(n: Node): Rect | null {
  if (n.type === 'shape') return n.hidden ? null : geomBounds(n.geom);
  if (n.hidden) return null;
  return unionAll(n.children.map(nodeBounds));
}

export function boundsOf(doc: Doc, ids: readonly string[]): Rect | null {
  return unionAll(normalizeSelection(doc, ids).map((id) => findNode(doc, id)).map((n) => (n ? nodeBounds(n) : null)));
}

/** The style a node has once everything it inherits is counted. */
export function resolveStyle(doc: Doc, id: string): Style {
  const loc = locate(doc, id);
  if (!loc) return { ...doc.defaults };
  return [...loc.ancestors, loc.node].reduce<Style>((acc, n) => ({ ...acc, ...n.style }), { ...doc.defaults });
}

export interface TransformOptions {
  /** Multiply stroke widths by this (1 or undefined: leave them alone, so a scaled icon keeps its line weight). */
  strokeScale?: number;
}

function transformNode(n: Node, m: Matrix, inherited: Style, k: number): Node {
  if (n.type === 'shape') {
    const style = k !== 1 ? { ...n.style, strokeWidth: (n.style.strokeWidth ?? inherited.strokeWidth ?? 1) * k } : n.style;
    return { ...n, geom: transformGeom(n.geom, m), style };
  }
  const below = { ...inherited, ...n.style };
  const style = k !== 1 && n.style.strokeWidth !== undefined ? { ...n.style, strokeWidth: n.style.strokeWidth * k } : n.style;
  return { ...n, style, children: n.children.map((c) => transformNode(c, m, below, k)) };
}

/** Applies `m` to the nodes, baking it into the geometry of every shape underneath. Hidden and locked nodes are left as they are. */
export function transformNodes(doc: Doc, ids: readonly string[], m: Matrix, opts: TransformOptions = {}): Doc {
  const set = new Set(ids);
  const k = opts.strokeScale ?? 1;
  const go = (nodes: readonly Node[], inherited: Style): Node[] => {
    let changed = false;
    const out = nodes.map((n) => {
      if (set.has(n.id)) {
        if (!isLive(n)) return n;
        changed = true;
        return transformNode(n, m, inherited, k);
      }
      if (n.type === 'group') {
        const kids = go(n.children, { ...inherited, ...n.style });
        if (kids !== n.children) {
          changed = true;
          return { ...n, children: kids };
        }
      }
      return n;
    });
    return changed ? out : (nodes as Node[]);
  };
  const children = go(doc.children, doc.defaults);
  return children === doc.children ? doc : { ...doc, children };
}

/** Nodes with the ids that exist in the document and can be edited (not hidden or locked, nor inside something that is). */
export function editableIds(doc: Doc, ids: readonly string[]): string[] {
  return normalizeSelection(doc, ids).filter((id) => {
    const loc = locate(doc, id);
    return loc && isLive(loc.node) && loc.ancestors.every(isLive);
  });
}

/**
 * Gives the nodes of `next` the ids (and editor-only names and locks) of `prev` when the two have the same
 * structure, so that the selection survives re-reading the document from edited code.
 */
export function reconcileIds(prev: Doc, next: Doc): Doc {
  const sig = (n: Node) => (n.type === 'group' ? 'g' : n.geom.kind);
  const a: Node[] = [];
  const b: Node[] = [];
  walk(prev.children, (n) => void a.push(n));
  walk(next.children, (n) => void b.push(n));
  if (a.length !== b.length || a.some((n, i) => sig(n) !== sig(b[i]!))) return next;
  let i = 0;
  const go = (nodes: readonly Node[]): Node[] =>
    nodes.map((n): Node => {
      const old = a[i++]!;
      const keep = { id: old.id, name: old.name, locked: old.locked };
      return n.type === 'group' ? { ...n, ...keep, collapsed: (old as GroupNode).collapsed, children: go(n.children) } : { ...n, ...keep };
    });
  return { ...next, children: go(next.children) };
}

/** Duplicates the nodes in place (each right above its original). Returns the new document and the ids of the copies, in z-order. */
export function cloneInPlace(doc: Doc, ids: readonly string[]): { doc: Doc; ids: string[] } {
  let out = doc;
  const fresh: string[] = [];
  for (const id of [...ids].reverse()) {
    const loc = locate(out, id);
    if (!loc) continue;
    const [copy] = cloneNodes([loc.node]);
    out = insertNodes(out, loc.parent?.id ?? null, loc.index + 1, [copy!]);
    fresh.unshift(copy!.id);
  }
  return { doc: out, ids: fresh };
}
