import { useEditor } from '../state/store';
import { Artwork } from './Artwork';

const SIZES = [16, 24, 32, 48];

/** The icon at the sizes it will be used at, on light and dark backgrounds. */
export function Preview() {
  const doc = useEditor((s) => s.doc);
  return (
    <div className="preview" data-testid="preview" aria-label="Preview">
      {(['light', 'dark'] as const).map((tone) => (
        <div key={tone} className={`preview-row ${tone}`}>
          {SIZES.map((px) => {
            const k = px / Math.max(doc.width, doc.height);
            return (
              <svg key={px} width={doc.width * k} height={doc.height * k} viewBox={`0 0 ${doc.width} ${doc.height}`} aria-hidden="true">
                <Artwork doc={doc} />
              </svg>
            );
          })}
        </div>
      ))}
    </div>
  );
}
