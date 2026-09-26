import type { ReactNode } from 'react';
import { Icon } from './icons';
import styles from './preview.module.css';

type Kind = 'same' | 'mod' | 'ins';

function Row({ kind, a, b, current }: { kind: Kind; a?: ReactNode; b: ReactNode; current?: boolean }) {
  return (
    <div className={styles.row} data-k={kind} data-current={current || undefined}>
      <div className={styles.cell} data-side="a">
        {kind === 'ins' ? (
          <span className={styles.missing}>
            <span>Not in A</span>
          </span>
        ) : (
          a
        )}
      </div>
      <div className={styles.gut}>
        {kind !== 'same' && (
          <>
            <span className={styles.act}>
              <Icon name="toA" size={13} />
            </span>
            <span className={styles.act}>
              <Icon name="toB" size={13} />
            </span>
          </>
        )}
      </div>
      <div className={styles.cell} data-side="b">
        {b}
      </div>
    </div>
  );
}

function Head({ side, name, words }: { side: 'A' | 'B'; name: string; words: number }) {
  return (
    <div className={styles.head}>
      <span className={styles.siglum}>{side}</span>
      <span className={styles.headMain}>
        <span className={styles.headName}>{name}</span>
        <span className={styles.headMeta}>
          <span className="badge">Sample</span>
          {words} words
        </span>
      </span>
      <span className={styles.headButton}>
        <Icon name="download" size={14} />
        <span>Export</span>
      </span>
    </div>
  );
}

const li = (content: ReactNode) => (
  <span className={styles.li}>
    <span aria-hidden="true">•</span>
    <span>{content}</span>
  </span>
);

/** The workspace comparing the sample drafts, drawn in HTML so it stays sharp and follows the theme. */
export function ComparisonPreview() {
  return (
    <figure className={styles.frame} aria-label="The workspace comparing two drafts of an agreement: changed words are marked in red and green, with arrows between the columns for copying changes">
      <div className={styles.chrome} aria-hidden="true">
        <span className={styles.lights}>
          <i />
          <i />
          <i />
        </span>
        <span className={styles.address}>
          <Icon name="lock" size={11} />
          collate / compare
        </span>
      </div>
      <div className={styles.window} aria-hidden="true">
        <div className={styles.toolbar}>
          <span className={styles.tbtn} data-icon="">
            <Icon name="up" />
          </span>
          <span className={styles.tbtn} data-icon="">
            <Icon name="down" />
          </span>
          <span className={styles.counter}>
            Change <b>1</b> of <b>7</b>
          </span>
          <span className={styles.stats}>
            <span data-k="mod">12 changed</span>
            <span data-k="del">1 only in A</span>
            <span data-k="ins">4 only in B</span>
          </span>
          <span className={styles.tbtn} data-wide="">
            <Icon name="fold" />
            Changes only
          </span>
          <span className={styles.tbtn} data-end="">
            Copy all
            <Icon name="chevron" />
          </span>
        </div>
        <div className={styles.sheets}>
          <div className={styles.row} data-k="head">
            <Head side="A" name="Agreement, draft 1" words={202} />
            <div />
            <Head side="B" name="Agreement, draft 2" words={245} />
          </div>
          <Row kind="same" a={<span className={styles.h1}>Website Services Agreement</span>} b={<span className={styles.h1}>Website Services Agreement</span>} />
          <Row
            kind="mod"
            current
            a={
              <>
                This agreement is made on <b><del>12</del> May 2026</b> between <b>Northwind Studio</b> (“Contractor”) and <b>Harbor &amp; Pine LLC</b> (“Client”).
              </>
            }
            b={
              <>
                This agreement is made on <b><ins>19</ins> May 2026</b> between <b>Northwind Studio</b> (“Contractor”) and <b>Harbor &amp; Pine LLC</b> (“Client”).
              </>
            }
          />
          <Row kind="same" a={<span className={styles.h2}>1. Scope of work</span>} b={<span className={styles.h2}>1. Scope of work</span>} />
          <Row
            kind="mod"
            a={
              <>
                The Contractor will design and build a marketing website with up to <del>six</del> pages, a blog<span className={styles.caret} /> and a contact form.
              </>
            }
            b={
              <>
                The Contractor will design and build a marketing website with up to <ins>eight</ins> pages, a blog<ins>, a newsletter sign-up</ins> and a contact form.
              </>
            }
          />
          <Row
            kind="mod"
            a={li(
              <>
                Visual design for desktop<span className={styles.caret} /> and mobile
              </>,
            )}
            b={li(
              <>
                Visual design for desktop<ins>, tablet</ins> and mobile
              </>,
            )}
          />
          <Row kind="ins" b={li('Accessibility review against WCAG 2.2 AA')} />
          <Row
            kind="mod"
            a={li(
              <>
                Content management training for <del>two</del> staff members
              </>,
            )}
            b={li(
              <>
                Content management training for <ins>three</ins> staff members
              </>,
            )}
          />
          <Row kind="same" a={<span className={styles.h2}>2. Schedule</span>} b={<span className={styles.h2}>2. Schedule</span>} />
        </div>
      </div>
    </figure>
  );
}
