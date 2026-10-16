import { useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';

const show = (v: number | null): string => (v === null || !Number.isFinite(v) ? '' : String(Number(v.toFixed(3))));

interface NumberFieldProps {
  label: ReactNode;
  value: number | null;
  onCommit(v: number): void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  mixed?: boolean;
  disabled?: boolean;
  title?: string;
  testId?: string;
  wide?: boolean;
}

/** A number box: Enter or leaving it applies the value, the arrow keys step it, Escape puts it back. */
export function NumberField({ label, value, onCommit, step = 1, min, max, unit, mixed, disabled, title, testId, wide }: NumberFieldProps) {
  // While the box has focus it shows what is being typed; otherwise it always shows the current value.
  const [typed, setTyped] = useState('');
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const current = mixed ? '' : show(value);
  const text = focused ? typed : current;
  const setText = setTyped;

  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  const commit = () => {
    const n = parseFloat(text.replace(',', '.'));
    if (Number.isFinite(n)) {
      const v = clamp(n);
      if (value === null || Math.abs(v - value) > 1e-9 || mixed) onCommit(v);
      setText(show(v));
    } else setText(current);
  };
  const bump = (dir: 1 | -1, e: { shiftKey: boolean; altKey: boolean }) => {
    const base = parseFloat(text.replace(',', '.'));
    const cur = Number.isFinite(base) ? base : (value ?? 0);
    const next = clamp(Number((cur + dir * step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1)).toFixed(6)));
    setText(show(next));
    onCommit(next);
  };

  return (
    <label className={`field ${wide ? 'wide' : ''}`} title={title}>
      <span className="field-label">{label}</span>
      <input
        ref={input}
        className="input"
        data-testid={testId}
        inputMode="decimal"
        value={text}
        placeholder={mixed ? 'Mixed' : ''}
        disabled={disabled}
        spellCheck={false}
        onFocus={(e) => {
          setTyped(current);
          setFocused(true);
          e.currentTarget.select();
        }}
        onBlur={() => {
          commit();
          setFocused(false);
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            input.current?.select();
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setText(current);
            input.current?.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            bump(e.key === 'ArrowUp' ? 1 : -1, e);
          }
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </label>
  );
}

export interface SegOption<T extends string> {
  value: T;
  label?: string;
  icon?: IconName;
  title?: string;
  testId?: string;
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: SegOption<T>[]; value: T | null; onChange(v: T): void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={`seg ${value === o.value ? 'on' : ''}`} aria-pressed={value === o.value} title={o.title ?? o.label} data-testid={o.testId} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={15} />}
          {o.label && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, children, defaultOpen = true, actions, testId }: { title: string; children: ReactNode; defaultOpen?: boolean; actions?: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="section" data-testid={testId}>
      <header className="section-head">
        <button type="button" className="section-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
          <h3>{title}</h3>
        </button>
        {actions}
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function IconButton({ icon, title, onClick, on, disabled, testId, label, size = 17 }: { icon: IconName; title: string; onClick(): void; on?: boolean; disabled?: boolean; testId?: string; label?: string; size?: number }) {
  return (
    <button type="button" className={`btn ${label ? '' : 'icon'} ${on ? 'on' : ''}`} title={title} aria-label={title} aria-pressed={on} disabled={disabled} data-testid={testId} onClick={onClick}>
      <Icon name={icon} size={size} />
      {label && <span>{label}</span>}
    </button>
  );
}

/** A colour: a swatch to pick one, a box to type any SVG paint (`currentColor`, `none`, `#7c3aed`, `rebeccapurple`). */
export function PaintField({ label, value, mixed, onChange, testId }: { label: string; value: string | null; mixed?: boolean; onChange(v: string): void; testId?: string }) {
  const [typed, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const current = mixed ? '' : (value ?? '');
  const text = focused ? typed : current;
  const hex = value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#4f46e5';
  return (
    <div className="paint-field">
      <span className="field-label">{label}</span>
      <input type="color" className="swatch" aria-label={`${label} colour`} value={hex} onChange={(e) => onChange(e.target.value)} />
      <input
        className="input"
        data-testid={testId}
        value={text}
        placeholder={mixed ? 'Mixed' : 'none'}
        spellCheck={false}
        onFocus={(e) => {
          setText(current);
          setFocused(true);
          e.currentTarget.select();
        }}
        onBlur={() => {
          const t = text.trim();
          if (t && t !== value) onChange(t);
          setFocused(false);
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setText(current);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <button type="button" className="chip" title="Use the text colour" onClick={() => onChange('currentColor')}>
        text
      </button>
      <button type="button" className="chip" title="No paint" onClick={() => onChange('none')}>
        none
      </button>
    </div>
  );
}
