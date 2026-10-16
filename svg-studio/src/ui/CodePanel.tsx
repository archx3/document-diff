import { useEffect, useMemo, useRef, useState } from 'react';
import { reconcileIds } from '../core/doc';
import { parseSvg, serializeSvg, SvgParseError } from '../core/svg-io';
import { toast } from '../state/actions';
import { store, useEditor } from '../state/store';
import { copyText } from './export';
import { Icon } from './icons';

/** The document as SVG source, editable: what you type is read back into the canvas as soon as it parses. */
export function CodePanel({ onClose }: { onClose(): void }) {
  const doc = useEditor((s) => s.doc);
  const generated = useMemo(() => serializeSvg(doc, { includeHidden: true }), [doc]);
  const [text, setText] = useState(generated);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  // The source the document currently corresponds to: what we show unless the user is typing something else.
  const synced = useRef(generated);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (generated !== synced.current) {
      synced.current = generated;
      setText(generated);
      setError(null);
      setWarning(null);
    }
  }, [generated]);

  const onChange = (value: string) => {
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        const { doc: parsed, warnings } = parseSvg(value);
        const next = reconcileIds(store.get().doc, parsed);
        synced.current = serializeSvg(next, { includeHidden: true });
        setError(null);
        setWarning(warnings[0] ?? null);
        store.commit(next, {}, 'code');
      } catch (e) {
        setError(e instanceof SvgParseError ? e.message : 'Could not read this SVG');
      }
    }, 250);
  };

  return (
    <div className="code-panel" data-testid="code-panel">
      <div className="code-head">
        <h3>SVG code</h3>
        {error ? <span className="status error">{error}</span> : warning ? <span className="status warn">{warning}</span> : <span className="status ok">Edits here update the canvas</span>}
        <span className="grow" />
        <button
          type="button"
          className="btn"
          onClick={async () => toast((await copyText(serializeSvg(doc))) ? 'SVG copied' : 'Could not copy', false)}
        >
          <Icon name="copy" size={15} /> Copy
        </button>
        <button type="button" className="btn icon" aria-label="Close code panel" title="Close" onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <textarea className="code-area" aria-label="SVG source" data-testid="code-area" spellCheck={false} value={text} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
