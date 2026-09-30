/**
 * The image tools, in the toolbar's three groups (the same parts sit in a row
 * over a picture compared in a dialog): the changed areas, how the pictures
 * are compared, and the zoom.
 */
import { Segmented } from '../../components/ui/segmented';
import { GraduatedRangeSlider } from '../../components/ui/slider';
import { Tool } from '../toolbar';
import type { ImageCompare, ImageMode } from './use-image-compare';

export const IMAGE_MODES: ReadonlyArray<{ value: ImageMode; label: string; key: string; tip: string }> = [
  { value: 'side', label: 'Side by side', key: '1', tip: 'Side by side (1)' },
  { value: 'swipe', label: 'Swipe', key: '2', tip: 'Swipe between A and B (2)' },
  { value: 'onion', label: 'Onion skin', key: '3', tip: 'Onion skin: B over A (3)' },
  { value: 'diff', label: 'Difference', key: '4', tip: 'Difference: changed pixels in red (4)' },
];

/** What changed: stepping through the changed areas, and how much changed. */
export function ImageNav({ ctl }: { ctl: ImageCompare }) {
  const { diff, boxes, area } = ctl;
  const none = !boxes.length;
  return (
    <>
      <div className="tgroup nav">
        <Tool id="btn-area-prev" icon="up" label="Previous changed area" kbd="P" disabled={none} onClick={() => ctl.stepArea(-1)} />
        <Tool id="btn-area-next" icon="down" label="Next changed area" kbd="N" disabled={none} onClick={() => ctl.stepArea(1)} />
      </div>
      <span className="media-stats" role="status" data-stats>
        {!diff
          ? 'Comparing…'
          : !diff.changed
            ? 'No visible difference'
            : `${diff.ratio < 0.001 ? '<0.1' : (diff.ratio * 100).toFixed(1)}% changed · ${area >= 0 ? `${area + 1} of ` : ''}${boxes.length} ${boxes.length === 1 ? 'area' : 'areas'}`}
      </span>
    </>
  );
}

/** How the pictures are compared: the mode, the sensitivity and the outlines (a mode's own slider is under the view). */
export function ImageModes({ ctl, annotatable = false }: { ctl: ImageCompare; annotatable?: boolean }) {
  return (
    <>
      <Segmented
        className="text ic-modes"
        label="How to compare"
        value={ctl.mode}
        onChange={ctl.setMode}
        segments={IMAGE_MODES.map((m) => ({ value: m.value, content: m.label, tip: m.tip, kbd: m.key, attrs: { 'data-mode': m.value } }))}
      />
      <label className="tool-field" data-tip="Sensitivity: how small a difference counts">
        <span className="tool-field-name">Sensitivity</span>
        <GraduatedRangeSlider className="tool-slider" label="Sensitivity" data-control="sensitivity" value={ctl.sensitivity} onChange={ctl.setSensitivity} step={10} labelStep={50} />
      </label>
      <Tool
        id="btn-stack"
        icon="image"
        label={`${ctl.top.toUpperCase()} is on top: put ${ctl.top === 'a' ? 'B' : 'A'} on top`}
        tip={ctl.mode === 'side' ? 'Which picture is on top (for swipe, onion skin and difference)' : `${ctl.top.toUpperCase()} on top: swap (X)`}
        kbd="X"
        disabled={ctl.mode === 'side'}
        onClick={() => ctl.setTop(ctl.top === 'a' ? 'b' : 'a')}
      >
        <StackIcon top={ctl.top} />
      </Tool>
      {annotatable && (
        <Tool
          id="btn-annotate"
          icon="note"
          label="Notes on the pictures"
          tip={ctl.annotate ? 'Stop adding notes (C)' : 'Add notes: drag over an area, or click a point (C)'}
          kbd="C"
          toggle
          pressed={ctl.annotate}
          onClick={() => ctl.setAnnotate(!ctl.annotate)}
        />
      )}
      <Tool
        id="btn-outline"
        icon="minimap"
        label="Outline the changed areas"
        tip="Outline the changed areas"
        toggle
        pressed={ctl.outline}
        onClick={() => ctl.setOutline(!ctl.outline)}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <rect x="2.5" y="3.5" width="11" height="9" rx="1" fill="none" stroke="currentColor" strokeDasharray="2 1.6" />
        </svg>
      </Tool>
    </>
  );
}

/** Two cards, one over the other, the top one lettered with the picture on top. */
function StackIcon({ top }: { top: 'a' | 'b' }) {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" className="stack-icon" data-top={top}>
      <rect x="6.5" y="1.5" width="10" height="11" rx="1.75" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.55" />
      <rect className="stack-front" x="1.5" y="5.5" width="10" height="11" rx="1.75" stroke="currentColor" strokeWidth="1.4" />
      <text x="6.5" y="14.2" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="currentColor" className="stack-letter">
        {top.toUpperCase()}
      </text>
    </svg>
  );
}

/** The zoom (in step on both pictures), and saving the difference. */
export function ImageZoom({ ctl }: { ctl: ImageCompare }) {
  const scale = ctl.scale;
  const set = (s: number) => ctl.setZoom(Math.min(Math.max(s, 0.05), 16));
  return (
    <>
      <div className="tgroup zoom" role="group" aria-label="Zoom">
        <Tool id="btn-zoom-out" icon="minus" label="Zoom out" kbd="-" onClick={() => set(scale / 1.25)} />
        <button type="button" className="btn ghost text-btn zoom-level" data-zoom="fit" data-tip="Fit to the window (0)" onClick={() => ctl.setZoom('fit')}>
          {ctl.zoom === 'fit' ? 'Fit' : `${Math.round(scale * 100)}%`}
        </button>
        <Tool id="btn-zoom-in" icon="plus" label="Zoom in" kbd="+" onClick={() => set(scale * 1.25)} />
        <button type="button" className="btn ghost text-btn" data-zoom="100" data-tip="The pictures’ own size" onClick={() => set(1)}>
          100%
        </button>
      </div>
      <Tool id="btn-save-diff" icon="download" label="Save the difference" tip="Save the difference as a picture" disabled={!ctl.diff} onClick={() => void ctl.saveDifference()} />
    </>
  );
}

/** Keys for the image tools; true when a key did something. */
export function imageKey(ctl: ImageCompare, e: { key: string }): boolean {
  const scale = ctl.scale;
  const m = IMAGE_MODES.find((x) => x.key === e.key);
  if (m) ctl.setMode(m.value);
  else if (e.key === '+' || e.key === '=') ctl.setZoom(Math.min(16, scale * 1.25));
  else if (e.key === '-') ctl.setZoom(Math.max(0.05, scale / 1.25));
  else if (e.key === '0') ctl.setZoom('fit');
  else if (e.key === 'c') ctl.setAnnotate(!ctl.annotate);
  else if (e.key === 'x' && ctl.mode !== 'side') ctl.setTop(ctl.top === 'a' ? 'b' : 'a');
  else if (e.key === 'n' || e.key === 'j') ctl.stepArea(1);
  else if (e.key === 'p' || e.key === 'k') ctl.stepArea(-1);
  else return false;
  return true;
}


