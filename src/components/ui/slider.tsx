'use client';

import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';

/**
 * The two sliders of the SettleMe design language (ported from kr-army-inv-sa):
 *
 * - `Slider` (packages/ui): a round thumb on a teal progress track, with major
 *   and minor ticks and clickable value labels above;
 * - `GraduatedRangeSlider` (apps/web): a thin bar handle over a ruler of ticks,
 *   the chosen value's label growing above it.
 *
 * Both keep the native range input as the source of truth, so the keyboard
 * works as it does for any slider; their colours come from the app's tokens.
 */

interface BaseProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'type' | 'min' | 'max' | 'step'> {
  min?: number;
  max?: number;
  /** The value moves in steps of this, and each step has a major tick. */
  step?: number;
  value: number;
  onChange(value: number): void;
  /** Clickable value labels above the track. */
  showLabels?: boolean;
  /** Only every Nth major tick is labelled (a multiple of `step`). */
  labelStep?: number;
  /** How a label shows its value (such as "50%"). */
  format?(value: number): string;
  /** Ticks as small diamonds rather than bars. */
  diamondTicks?: boolean;
  /** Minor ticks between two major ones. */
  minorTicks?: number;
  /** The slider's name, for screen readers. */
  label: string;
  /** Moves smoothly between the steps (for positions, rather than settings). */
  fine?: boolean;
}

const percentOf = (min: number, max: number, v: number) => (max === min ? 0 : ((v - min) / (max - min)) * 100);

function majors(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  const s = step > 0 ? step : 1;
  for (let v = min; v <= max + 1e-9; v += s) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

function Ticks({ values, minor, diamond }: { values: number[]; minor: number; diamond: boolean }) {
  return (
    <div className="gs-ticks" aria-hidden="true">
      {values.map((v, i) => (
        <span key={v} className="gs-tick-set">
          <span className={`gs-tick major${diamond ? ' diamond' : ''}`} />
          {i < values.length - 1 && Array.from({ length: minor }, (_, j) => <span key={j} className={`gs-tick minor${diamond ? ' diamond' : ''}`} />)}
        </span>
      ))}
    </div>
  );
}

function Labels({ values, value, min, labelStep, step, format, disabled, onPick }: { values: number[]; value: number; min: number; labelStep: number; step: number; format(v: number): string; disabled?: boolean; onPick(v: number): void }) {
  return (
    <div className="gs-labels">
      {values.map((v) => {
        const labelled = Math.abs(((v - min) / (labelStep || step)) % 1) < 1e-6;
        if (!labelled) return <span key={v} aria-hidden="true" className="gs-label-gap" />;
        return (
          <button key={v} type="button" tabIndex={-1} className="gs-label" data-value={v} data-on={Math.abs(v - value) < 1e-9 || undefined} disabled={disabled} onClick={() => onPick(v)}>
            {format(v)}
          </button>
        );
      })}
    </div>
  );
}

/** The round-thumbed graduated slider (packages/ui `Slider`). */
export function Slider({ min = 0, max = 100, step = 10, value, onChange, showLabels = true, labelStep, format = String, diamondTicks = false, minorTicks = 4, label, fine = false, className = '', disabled, ...rest }: BaseProps) {
  const id = useId();
  const values = majors(min, max, step);
  const percent = percentOf(min, max, value);
  return (
    <div className={`gs gs-dial ${className}`} data-disabled={disabled || undefined}>
      {showLabels && <Labels values={values} value={value} min={min} labelStep={labelStep ?? step} step={step} format={format} disabled={disabled} onPick={onChange} />}
      <div className="gs-track">
        <div className="gs-rail" />
        <div className="gs-progress" style={{ width: `${percent}%` }} />
        <Ticks values={values} minor={minorTicks} diamond={diamondTicks} />
        <input
          id={id}
          type="range"
          className="gs-input"
          min={min}
          max={max}
          step={fine ? (max - min) / 200 || step : step}
          value={value}
          aria-label={label}
          aria-valuetext={format(value)}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.currentTarget.value))}
          {...rest}
        />
      </div>
    </div>
  );
}

/** The bar-handled graduated range slider (apps/web `GraduatedRangeSlider`). */
export function GraduatedRangeSlider({ min = 0, max = 100, step = 10, value, onChange, showLabels = true, labelStep, format = String, diamondTicks = false, minorTicks = 4, label, fine = false, className = '', disabled, ...rest }: BaseProps) {
  const values = majors(min, max, step);
  const percent = percentOf(min, max, value);
  return (
    <div className={`gs gs-bar ${className}`} data-disabled={disabled || undefined}>
      {showLabels && <Labels values={values} value={value} min={min} labelStep={labelStep ?? step} step={step} format={format} disabled={disabled} onPick={onChange} />}
      <div className="gs-track">
        <div className="gs-progress" style={{ width: `${percent}%` }} />
        <Ticks values={values} minor={minorTicks} diamond={diamondTicks} />
        <input
          type="range"
          className="gs-input"
          min={min}
          max={max}
          step={fine ? (max - min) / 200 || step : step}
          value={value}
          aria-label={label}
          aria-valuetext={format(value)}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.currentTarget.value))}
          {...rest}
        />
      </div>
    </div>
  );
}
