import { useMemo, useRef, useState } from 'react';
import { editableIds, moveNodes } from '../core/doc';
import type { Node } from '../core/types';
import { renameNode, selectFromList, toggleCollapsed, toggleHidden, toggleLocked } from '../state/actions';
import { store, useEditor } from '../state/store';
import { Icon, type IconName } from './icons';

const KIND_ICON: Record<string, IconName> = { path: 'pen', line: 'line', rect: 'rect', circle: 'ellipse', ellipse: 'ellipse', polyline: 'pen', polygon: 'pen', group: 'group' };

interface Row {
  node: Node;
  depth: number;
  parentId: string | null;
  /** Position in the parent's children (z-order index). */
  index: number;
  count: number;
}

function rows(nodes: readonly Node[], depth: number, parentId: string | null, out: Row[]): Row[] {
  // Top of the list is the front of the drawing.
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    out.push({ node, depth, parentId, index: i, count: nodes.length });
    if (node.type === 'group' && !node.collapsed) rows(node.children, depth + 1, node.id, out);
  }
  return out;
}

type Drop = { id: string; where: 'before' | 'after' | 'into' } | null;

export function Layers() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const list = useMemo(() => rows(doc.children, 0, null, []), [doc.children]);
  const [editing, setEditing] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const dragging = useRef<string | null>(null);

  const label = (n: Node) => n.name ?? (n.type === 'group' ? 'Group' : n.geom.kind[0]!.toUpperCase() + n.geom.kind.slice(1));

  const onDrop = (target: Row, where: 'before' | 'after' | 'into') => {
    const dragId = dragging.current;
    dragging.current = null;
    setDrop(null);
    if (!dragId) return;
    const ids = selection.includes(dragId) ? editableIds(doc, selection) : [dragId];
    let next;
    if (where === 'into' && target.node.type === 'group') next = moveNodes(doc, ids, target.node.id, target.node.children.length);
    else if (where === 'before') next = moveNodes(doc, ids, target.parentId, target.index + 1);
    else next = moveNodes(doc, ids, target.parentId, target.index);
    if (next !== doc) store.commit(next);
  };

  return (
    <div className="layers" data-testid="layers">
      <div className="layers-head">
        <h3>Layers</h3>
        <span className="muted">{list.length}</span>
      </div>
      <ul className="layer-list" role="tree" aria-label="Layers">
        {list.length === 0 && <li className="empty">Nothing here yet. Draw a shape, or paste or drop an SVG.</li>}
        {list.map((r) => {
          const n = r.node;
          const selected = selection.includes(n.id);
          const d = drop?.id === n.id ? drop.where : null;
          return (
            <li
              key={n.id}
              role="treeitem"
              aria-selected={selected}
              data-testid="layer"
              data-id={n.id}
              className={`layer ${selected ? 'selected' : ''} ${n.hidden ? 'is-hidden' : ''} ${d ? `drop-${d}` : ''}`}
              style={{ paddingLeft: 6 + r.depth * 14 }}
              draggable={editing !== n.id}
              onDragStart={(e) => {
                dragging.current = n.id;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/x-layer', n.id);
              }}
              onDragEnd={() => {
                dragging.current = null;
                setDrop(null);
              }}
              onDragOver={(e) => {
                if (!dragging.current) return;
                e.preventDefault();
                const box = e.currentTarget.getBoundingClientRect();
                const f = (e.clientY - box.top) / box.height;
                const where = n.type === 'group' && f > 0.28 && f < 0.72 ? 'into' : f < 0.5 ? 'before' : 'after';
                if (drop?.id !== n.id || drop.where !== where) setDrop({ id: n.id, where });
              }}
              onDragLeave={() => setDrop((cur) => (cur?.id === n.id ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                onDrop(r, drop?.id === n.id ? drop.where : 'after');
              }}
              onClick={(e) => selectFromList(n.id, e.shiftKey || e.metaKey || e.ctrlKey ? 'toggle' : 'replace')}
            >
              {n.type === 'group' ? (
                <button
                  type="button"
                  className="twisty"
                  aria-label={n.collapsed ? 'Expand group' : 'Collapse group'}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCollapsed(n.id);
                  }}
                >
                  <Icon name={n.collapsed ? 'chevronRight' : 'chevronDown'} size={13} />
                </button>
              ) : (
                <span className="twisty" />
              )}
              <Icon name={KIND_ICON[n.type === 'group' ? 'group' : n.geom.kind]!} size={15} />
              {editing === n.id ? (
                <input
                  className="input rename"
                  autoFocus
                  defaultValue={n.name ?? label(n)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    renameNode(n.id, e.target.value === label(n) ? '' : e.target.value);
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setEditing(null);
                    }
                  }}
                />
              ) : (
                <span className="layer-name" onDoubleClick={() => setEditing(n.id)} title="Double-click to rename">
                  {label(n)}
                </span>
              )}
              <span className="layer-actions">
                <button type="button" className={`mini ${n.locked ? 'on' : ''}`} aria-label={n.locked ? 'Unlock' : 'Lock'} title={n.locked ? 'Unlock' : 'Lock'} onClick={(e) => (e.stopPropagation(), toggleLocked(n.id))}>
                  <Icon name={n.locked ? 'lock' : 'unlock'} size={14} />
                </button>
                <button type="button" className={`mini ${n.hidden ? 'on' : ''}`} aria-label={n.hidden ? 'Show' : 'Hide'} title={n.hidden ? 'Show' : 'Hide'} onClick={(e) => (e.stopPropagation(), toggleHidden(n.id))}>
                  <Icon name={n.hidden ? 'eyeOff' : 'eye'} size={14} />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
