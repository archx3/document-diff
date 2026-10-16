import { useMemo, useState } from 'react';
import { boundsOf, editableIds, findNode, resolveStyle } from '../core/doc';
import type { Rect } from '../core/geometry';
import { fmt, parsePath } from '../core/path';
import { pointsToString } from '../core/shapes';
import type { Pt } from '../core/geometry';
import { flipMatrix, moveToMatrix, pivotPoint, resizeToMatrix, rotateByDegrees, scaleMatrix, type AlignMode, type Pivot } from '../core/transform';
import type { Geometry, ShapeNode, Style, StyleKey } from '../core/types';
import {
  addNodeAfterSelected,
  alignSelection,
  arrangeSelection,
  convertToPath,
  deleteSelectedNodes,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  groupSelection,
  resizeCanvas,
  setGeometry,
  setSelectedNodesType,
  setStyle,
  toggleClosedPath,
  transformSelection,
  ungroupSelection,
  updateSettings,
} from '../state/actions';
import { store, useEditor } from '../state/store';
import { IconButton, NumberField, PaintField, Section, Segmented } from './fields';
import { Icon } from './icons';

/* ----------------------------------------------------------------- transform */

function PivotGrid({ pivot, onPick }: { pivot: Pivot; onPick(p: Pivot): void }) {
  return (
    <div className="pivot-grid" role="group" aria-label="Origin">
      {[0, 0.5, 1].flatMap((fy) =>
        [0, 0.5, 1].map((fx) => {
          const on = pivot.kind === 'box' && pivot.fx === fx && pivot.fy === fy;
          return <button key={`${fx}-${fy}`} type="button" className={`pivot-cell ${on ? 'on' : ''}`} aria-pressed={on} aria-label={`Origin ${['top', 'middle', 'bottom'][fy * 2]} ${['left', 'centre', 'right'][fx * 2]}`} onClick={() => onPick({ kind: 'box', fx, fy })} />;
        }),
      )}
    </div>
  );
}

type ScaleAxis = 'both' | 'h' | 'v';

function TransformSection({ box }: { box: Rect }) {
  const pivot = useEditor((s) => s.pivot);
  const scaleStroke = useEditor((s) => s.settings.scaleStroke);
  const [axis, setAxis] = useState<ScaleAxis>('both');
  const [percent, setPercent] = useState(150);
  const [angle, setAngle] = useState(90);
  const [lock, setLock] = useState(false);
  const origin: Pt = pivotPoint(box, pivot);

  const applyScale = (p = percent) => {
    const f = p / 100;
    if (!(f > 0)) return;
    transformSelection(scaleMatrix(axis === 'v' ? 1 : f, axis === 'h' ? 1 : f, origin));
  };
  const setWidth = (w: number) => transformSelection(resizeToMatrix(box, w, lock && box.w > 0 ? (w / box.w) * box.h : null, origin), 'size');
  const setHeight = (h: number) => transformSelection(resizeToMatrix(box, lock && box.h > 0 ? (h / box.h) * box.w : null, h, origin), 'size');

  return (
    <Section title="Transform" testId="transform">
      <div className="grid-2">
        <NumberField label="X" value={box.x} step={1} onCommit={(v) => transformSelection(moveToMatrix(box, v, null), 'move')} testId="pos-x" />
        <NumberField label="Y" value={box.y} step={1} onCommit={(v) => transformSelection(moveToMatrix(box, null, v), 'move')} testId="pos-y" />
        <NumberField label="W" value={box.w} step={1} min={0.01} onCommit={setWidth} testId="size-w" />
        <NumberField label="H" value={box.h} step={1} min={0.01} onCommit={setHeight} testId="size-h" />
      </div>
      <div className="row between">
        <label className="check">
          <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
          <span>Keep proportions</span>
        </label>
        <div className="row gap">
          <span className="field-label">Origin</span>
          <PivotGrid pivot={pivot} onPick={(p) => store.patch({ pivot: p })} />
        </div>
      </div>

      <div className="subhead">Scale</div>
      <Segmented<ScaleAxis>
        label="Scale direction"
        value={axis}
        onChange={setAxis}
        options={[
          { value: 'h', icon: 'scaleH', label: 'Horizontal', title: 'Scale horizontally: widens or narrows, keeps the height', testId: 'scale-axis-h' },
          { value: 'v', icon: 'scaleV', label: 'Vertical', title: 'Scale vertically: taller or shorter, keeps the width', testId: 'scale-axis-v' },
          { value: 'both', icon: 'scale', label: 'Both', title: 'Scale both ways, keeping proportions', testId: 'scale-axis-both' },
        ]}
      />
      <div className="row gap">
        <NumberField label="" value={percent} min={1} max={10000} step={5} unit="%" onCommit={(v) => setPercent(v)} testId="scale-percent" wide />
        <button type="button" className="btn primary" onClick={() => applyScale()} data-testid="scale-apply">
          Apply
        </button>
      </div>
      <div className="row gap wrap">
        {[50, 75, 125, 150, 200].map((p) => (
          <button key={p} type="button" className="chip" onClick={() => applyScale(p)} data-testid={`scale-${p}`}>
            {p}%
          </button>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={scaleStroke} onChange={(e) => updateSettings({ scaleStroke: e.target.checked })} />
        <span>Scale stroke width too</span>
      </label>

      <div className="subhead">Flip</div>
      <div className="row gap">
        <button type="button" className="btn" onClick={() => transformSelection(flipMatrix('h', origin))} data-testid="flip-h" title="Flip horizontally (Shift+H)">
          <Icon name="flipH" size={16} /> Horizontal
        </button>
        <button type="button" className="btn" onClick={() => transformSelection(flipMatrix('v', origin))} data-testid="flip-v" title="Flip vertically (Shift+V)">
          <Icon name="flipV" size={16} /> Vertical
        </button>
      </div>

      <div className="subhead">Rotate</div>
      <div className="row gap">
        <NumberField label="" value={angle} step={5} unit="°" onCommit={setAngle} testId="rotate-angle" wide />
        <button type="button" className="btn primary" onClick={() => transformSelection(rotateByDegrees(angle, origin))} data-testid="rotate-apply" title="Rotate clockwise by this angle">
          Rotate
        </button>
      </div>
      <div className="row gap wrap">
        {[
          ['−90°', -90],
          ['−45°', -45],
          ['+45°', 45],
          ['+90°', 90],
          ['180°', 180],
        ].map(([label, deg]) => (
          <button key={label as string} type="button" className="chip" onClick={() => transformSelection(rotateByDegrees(deg as number, origin))} data-testid={`rotate-${deg}`}>
            {label}
          </button>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------- arrange */

function ArrangeSection({ count, hasGroup }: { count: number; hasGroup: boolean }) {
  const align = (mode: AlignMode) => alignSelection(mode);
  return (
    <Section title="Arrange" testId="arrange">
      <div className="row gap">
        <IconButton icon="group" title="Group (Ctrl+G)" onClick={groupSelection} testId="group" label="Group" />
        <IconButton icon="ungroup" title="Ungroup (Ctrl+Shift+G)" onClick={ungroupSelection} disabled={!hasGroup} testId="ungroup" label="Ungroup" />
        <IconButton icon="copy" title="Duplicate (Ctrl+D)" onClick={duplicateSelection} testId="duplicate" />
        <IconButton icon="trash" title="Delete" onClick={deleteSelection} testId="delete" />
      </div>
      <div className="row gap">
        <IconButton icon="alignLeft" title="Align left" onClick={() => align('left')} />
        <IconButton icon="alignCenter" title="Align horizontal centres" onClick={() => align('center')} />
        <IconButton icon="alignRight" title="Align right" onClick={() => align('right')} />
        <span className="sep" />
        <IconButton icon="alignTop" title="Align top" onClick={() => align('top')} />
        <IconButton icon="alignMiddle" title="Align vertical middles" onClick={() => align('middle')} />
        <IconButton icon="alignBottom" title="Align bottom" onClick={() => align('bottom')} />
        <span className="sep" />
        <IconButton icon="distributeH" title="Distribute horizontally" onClick={() => distributeSelection('h')} disabled={count < 3} />
        <IconButton icon="distributeV" title="Distribute vertically" onClick={() => distributeSelection('v')} disabled={count < 3} />
      </div>
      <div className="row gap">
        <IconButton icon="front" title="Bring to front (Shift+])" onClick={() => arrangeSelection('front')} />
        <IconButton icon="forward" title="Bring forward (])" onClick={() => arrangeSelection('forward')} />
        <IconButton icon="backward" title="Send backward ([)" onClick={() => arrangeSelection('backward')} />
        <IconButton icon="back" title="Send to back (Shift+[)" onClick={() => arrangeSelection('back')} />
      </div>
    </Section>
  );
}

/* ---------------------------------------------------------------- appearance */

function same<T>(values: T[]): { value: T | null; mixed: boolean } {
  const first = values[0];
  const mixed = values.some((v) => v !== first);
  return { value: mixed ? null : (first ?? null), mixed };
}

function AppearanceSection({ ids }: { ids: string[] }) {
  const doc = useEditor((s) => s.doc);
  const styles = useMemo<Style[]>(() => (ids.length ? ids.map((id) => resolveStyle(doc, id)) : [doc.defaults]), [doc, ids]);
  const get = <K extends StyleKey>(k: K) => same(styles.map((s) => s[k]));
  const stroke = get('stroke');
  const fill = get('fill');
  const width = get('strokeWidth');
  const cap = get('strokeLinecap');
  const join = get('strokeLinejoin');
  const opacity = get('opacity');
  const title = ids.length ? 'Appearance' : 'Icon style';
  return (
    <Section title={title} testId="appearance">
      {!ids.length && <p className="note">Applies to every layer that does not set its own. Select a layer to change just that one.</p>}
      <PaintField label="Stroke" value={stroke.value ?? null} mixed={stroke.mixed} onChange={(v) => setStyle({ stroke: v })} testId="stroke" />
      <div className="row gap">
        <NumberField label="Width" value={width.value ?? 1} mixed={width.mixed} min={0} max={64} step={0.25} onCommit={(v) => setStyle({ strokeWidth: v })} testId="stroke-width" wide />
        <input className="slider" type="range" min={0.5} max={4} step={0.25} value={width.value ?? 1} aria-label="Stroke width" onChange={(e) => setStyle({ strokeWidth: Number(e.target.value) })} />
      </div>
      <div className="row gap between">
        <span className="field-label">Ends</span>
        <Segmented<'butt' | 'round' | 'square'>
          label="Line cap"
          value={cap.value ?? null}
          onChange={(v) => setStyle({ strokeLinecap: v })}
          options={[
            { value: 'butt', label: 'Butt' },
            { value: 'round', label: 'Round' },
            { value: 'square', label: 'Square' },
          ]}
        />
      </div>
      <div className="row gap between">
        <span className="field-label">Corners</span>
        <Segmented<'miter' | 'round' | 'bevel'>
          label="Line join"
          value={join.value ?? null}
          onChange={(v) => setStyle({ strokeLinejoin: v })}
          options={[
            { value: 'miter', label: 'Miter' },
            { value: 'round', label: 'Round' },
            { value: 'bevel', label: 'Bevel' },
          ]}
        />
      </div>
      <PaintField label="Fill" value={fill.value ?? null} mixed={fill.mixed} onChange={(v) => setStyle({ fill: v })} testId="fill" />
      <div className="row gap">
        <NumberField label="Opacity" value={opacity.value ?? 1} mixed={opacity.mixed} min={0} max={1} step={0.1} onCommit={(v) => setStyle({ opacity: v })} wide />
        {ids.length > 0 && (
          <button type="button" className="btn" title="Remove this layer's own style so it follows the icon style again" onClick={() => setStyle({ stroke: undefined, strokeWidth: undefined, strokeLinecap: undefined, strokeLinejoin: undefined, fill: undefined, opacity: undefined })}>
            Reset
          </button>
        )}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ geometry */

function GeometrySection({ shape }: { shape: ShapeNode }) {
  const g = shape.geom;
  const set = (patch: Record<string, number>, key: string) => setGeometry(shape.id, { ...g, ...patch } as Geometry, `geom:${shape.id}:${key}`);
  const num = (k: string, label: string, min?: number) => (
    <NumberField key={k} label={label} value={(g as unknown as Record<string, number>)[k]!} step={0.5} min={min} onCommit={(v) => set({ [k]: v }, k)} />
  );
  let body;
  switch (g.kind) {
    case 'rect':
      body = (
        <div className="grid-2">
          {num('x', 'X')}
          {num('y', 'Y')}
          {num('width', 'W', 0.01)}
          {num('height', 'H', 0.01)}
          {num('rx', 'Rx', 0)}
          {num('ry', 'Ry', 0)}
        </div>
      );
      break;
    case 'circle':
      body = (
        <div className="grid-2">
          {num('cx', 'Cx')}
          {num('cy', 'Cy')}
          {num('r', 'R', 0.01)}
        </div>
      );
      break;
    case 'ellipse':
      body = (
        <div className="grid-2">
          {num('cx', 'Cx')}
          {num('cy', 'Cy')}
          {num('rx', 'Rx', 0.01)}
          {num('ry', 'Ry', 0.01)}
        </div>
      );
      break;
    case 'line':
      body = (
        <div className="grid-2">
          {num('x1', 'X1')}
          {num('y1', 'Y1')}
          {num('x2', 'X2')}
          {num('y2', 'Y2')}
        </div>
      );
      break;
    case 'path':
      body = <PathData key={shape.id} value={g.d} onCommit={(d) => setGeometry(shape.id, { kind: 'path', d })} />;
      break;
    default:
      body = <p className="note">{g.points.length} points: {pointsToString(g.points).slice(0, 80)}</p>;
  }
  return (
    <Section title={`Shape · ${g.kind}`} testId="geometry" actions={g.kind !== 'path' ? <button type="button" className="chip" onClick={convertToPath} title="Turn into a path so its points can be edited" data-testid="to-path">to path</button> : undefined}>
      {body}
    </Section>
  );
}

function PathData({ value, onCommit }: { value: string; onCommit(d: string): void }) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : value;
  const error = parsePath(shown).error;
  return (
    <div className="stack">
      <textarea
        className="input mono"
        rows={4}
        spellCheck={false}
        aria-label="Path data"
        data-testid="path-d"
        value={shown}
        onFocus={() => {
          setText(value);
          setFocused(true);
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setFocused(false);
          if (!parsePath(text).error && text.trim() && text !== value) onCommit(text.trim());
        }}
      />
      {error && <p className="note error">{error}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------- points */

function PointsSection({ nodeCount }: { nodeCount: number }) {
  return (
    <Section title="Points" testId="points">
      <p className="note">{nodeCount ? `${nodeCount} selected` : 'Click a point to select it, or drag a rectangle around several.'}</p>
      <div className="row gap wrap">
        <IconButton icon="smooth" title="Make smooth" label="Smooth" onClick={() => setSelectedNodesType('smooth')} disabled={!nodeCount} />
        <IconButton icon="corner" title="Make corner" label="Corner" onClick={() => setSelectedNodesType('corner')} disabled={!nodeCount} />
        <IconButton icon="addNode" title="Add a point after each selected point (N)" label="Add" onClick={addNodeAfterSelected} disabled={!nodeCount} />
        <IconButton icon="trash" title="Delete selected points" label="Delete" onClick={deleteSelectedNodes} disabled={!nodeCount} />
        <IconButton icon="closePath" title="Open or close the path" label="Close" onClick={toggleClosedPath} />
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------- canvas */

function CanvasSection() {
  const doc = useEditor((s) => s.doc);
  return (
    <Section title="Canvas" testId="canvas-section">
      <div className="grid-2">
        <NumberField label="W" value={doc.width} min={1} max={4096} step={1} onCommit={(v) => resizeCanvas(v, doc.height)} testId="canvas-w" />
        <NumberField label="H" value={doc.height} min={1} max={4096} step={1} onCommit={(v) => resizeCanvas(doc.width, v)} testId="canvas-h" />
      </div>
      <div className="row gap wrap">
        {[16, 20, 24, 32, 48].map((n) => (
          <button key={n} type="button" className={`chip ${doc.width === n && doc.height === n ? 'on' : ''}`} onClick={() => resizeCanvas(n, n)}>
            {n}
          </button>
        ))}
      </div>
    </Section>
  );
}

/* ----------------------------------------------------------------- inspector */

export function Inspector() {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const nodeSel = useEditor((s) => s.nodeSel);
  const ids = useMemo(() => editableIds(doc, selection), [doc, selection]);
  const box = useMemo(() => boundsOf(doc, ids), [doc, ids]);
  const nodes = useMemo(() => ids.map((id) => findNode(doc, id)!).filter(Boolean), [doc, ids]);
  const single = nodes.length === 1 ? nodes[0]! : null;
  const hasGroup = nodes.some((n) => n.type === 'group');

  if (!ids.length || !box) {
    return (
      <div className="inspector" data-testid="inspector">
        <CanvasSection />
        <AppearanceSection ids={[]} />
      </div>
    );
  }
  return (
    <div className="inspector" data-testid="inspector">
      <div className="selection-title">
        {single ? (
          <>
            <Icon name={single.type === 'group' ? 'group' : 'select'} size={15} />
            <strong>{single.name ?? (single.type === 'group' ? 'Group' : single.geom.kind)}</strong>
            {single.type === 'group' && <span className="muted">{countShapes(single)} shapes</span>}
          </>
        ) : (
          <strong>{ids.length} layers</strong>
        )}
        <span className="muted right">
          {fmt(box.w, 2)} × {fmt(box.h, 2)}
        </span>
      </div>
      <TransformSection box={box} />
      {tool === 'node' && single?.type === 'shape' && <PointsSection nodeCount={nodeSel.length} />}
      <ArrangeSection count={ids.length} hasGroup={hasGroup} />
      <AppearanceSection ids={ids} />
      {single?.type === 'shape' && <GeometrySection shape={single} />}
    </div>
  );
}

function countShapes(g: { children: Array<{ type: string; children?: unknown[] }> }): number {
  let n = 0;
  for (const c of g.children) n += c.type === 'group' ? countShapes(c as never) : 1;
  return n;
}
