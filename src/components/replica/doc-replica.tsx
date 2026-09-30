'use client';

import type { ReactNode } from 'react';
import { Fragment, useState } from 'react';
import { Icon } from '../icons';
import { Frame } from './frame';
import { Region, useRegions } from './region';
import styles from './replica.module.css';

/** Text, or words only in A (d) or only in B (i). */
type Seg = string | { d: string } | { i: string };
type Style = 'h1' | 'h2' | 'p' | 'li';

interface Para {
  id: string;
  style: Style;
  a: Seg[] | null;
  b: Seg[] | null;
}

type Kind = 'same' | 'mod' | 'ins' | 'del';
type Decision = 'accept' | 'reject';

const START: Para[] = [
  { id: 'title', style: 'h1', a: ['Website Services Agreement'], b: ['Website Services Agreement'] },
  { id: 'date', style: 'p', a: ['This agreement is made on ', { d: '12' }, ' May 2026 between Northwind Studio and Harbor & Pine LLC.'], b: ['This agreement is made on ', { i: '19' }, ' May 2026 between Northwind Studio and Harbor & Pine LLC.'] },
  { id: 'scope', style: 'h2', a: ['1. Scope of work'], b: ['1. Scope of work'] },
  { id: 'pages', style: 'p', a: ['A marketing website with up to ', { d: 'six' }, ' pages, a blog and a contact form.'], b: ['A marketing website with up to ', { i: 'eight' }, ' pages, a blog', { i: ', a newsletter sign-up' }, ' and a contact form.'] },
  { id: 'design', style: 'li', a: ['Visual design for desktop and mobile'], b: ['Visual design for desktop', { i: ', tablet' }, ' and mobile'] },
  { id: 'a11y', style: 'li', a: null, b: ['Accessibility review against WCAG 2.2 AA'] },
  { id: 'training', style: 'li', a: ['Training for ', { d: 'two' }, ' staff members'], b: ['Training for ', { i: 'three' }, ' staff members'] },
  { id: 'support', style: 'li', a: ['Launch support for 30 days'], b: null },
  { id: 'fees', style: 'h2', a: ['2. Fees and payment'], b: ['2. Fees and payment'] },
  { id: 'due', style: 'p', a: ['Invoices are due within ', { d: '30' }, ' days of receipt.'], b: ['Invoices are due within ', { i: '15' }, ' days of receipt.'] },
];

function kindOf(p: Para): Kind {
  if (!p.a) return 'ins';
  if (!p.b) return 'del';
  return [...p.a, ...p.b].some((s) => typeof s !== 'string') ? 'mod' : 'same';
}

/** One side's text as it reads, without the marks. */
function plain(segs: Seg[], side: 'a' | 'b'): string {
  return segs.map((s) => (typeof s === 'string' ? s : side === 'a' ? ('d' in s ? s.d : '') : 'i' in s ? s.i : '')).join('');
}

function count(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** How many words are marked on one side: only in A (d) or only in B (i). */
function words(segs: Seg[] | null, key: 'd' | 'i'): number {
  return (segs ?? []).reduce((n, s) => n + (typeof s === 'string' ? 0 : 'd' in s ? (key === 'd' ? count(s.d) : 0) : key === 'i' ? count(s.i) : 0), 0);
}

function Text({ segs, style, onWord, wordRegion }: { segs: Seg[]; style: Style; onWord?: () => void; wordRegion?: boolean }) {
  let marked = false;
  const body = segs.map((s, i) => {
    if (typeof s === 'string') return <Fragment key={i}>{s}</Fragment>;
    const first = !marked;
    marked = true;
    const el = 'd' in s ? <del onClick={onWord}>{s.d}</del> : <ins onClick={onWord}>{s.i}</ins>;
    return wordRegion && first ? (
      <Region key={i} as="span" name="word">
        {el}
      </Region>
    ) : (
      <Fragment key={i}>{el}</Fragment>
    );
  });
  if (style === 'h1') return <span className={styles.h1}>{body}</span>;
  if (style === 'h2') return <span className={styles.h2}>{body}</span>;
  if (style === 'li')
    return (
      <span className={styles.li}>
        <span aria-hidden="true">•</span>
        <span>{body}</span>
      </span>
    );
  return <>{body}</>;
}

const EXPORTS: Array<[string, string]> = [
  ['Word document (.docx)', 'Keeps the original styles and layout'],
  ['Copy formatted text', 'Paste into Google Docs or Word'],
  ['PDF', 'For reading, printing and sharing'],
  ['OpenDocument, RTF, web page, Markdown', ''],
];

/**
 * The document workspace in miniature, comparing two drafts of an agreement.
 * It works: the arrows and marked words copy changes, the toolbar steps
 * through them, folds the rest away and switches to one column, and the list
 * of changes records decisions.
 */
export function DocReplica() {
  const { focus } = useRegions();
  const [paras, setParas] = useState(START);
  const [past, setPast] = useState<Para[][]>([]);
  const [future, setFuture] = useState<Para[][]>([]);
  const [cur, setCur] = useState(0);
  const [changesOnly, setChangesOnly] = useState(false);
  const [unified, setUnified] = useState(false);
  const [panelOpen, setPanel] = useState(false);
  const [review, setReview] = useState(false);
  const [exportOpen, setExport] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const visible = paras.filter((p) => p.a || p.b);
  const changes = visible.filter((p) => kindOf(p) !== 'same');
  const at = Math.min(cur, Math.max(0, changes.length - 1));
  const current = changes[at];
  // A step about a part opens it.
  const panel = panelOpen || focus === 'list' || focus === 'decide';
  const menu = exportOpen || focus === 'export';
  const notes = review || focus === 'review';
  const counts = {
    mod: changes.filter((p) => kindOf(p) === 'mod').length,
    del: changes.filter((p) => kindOf(p) === 'del').length,
    ins: changes.filter((p) => kindOf(p) === 'ins').length,
  };

  function commit(next: Para[]) {
    setPast((p) => [...p, paras]);
    setFuture([]);
    setParas(next);
  }

  /** Makes one side of a paragraph read like the other. */
  function copy(id: string, to: 'a' | 'b') {
    commit(
      paras.map((p) => {
        if (p.id !== id) return p;
        const from = to === 'b' ? p.a : p.b;
        const text = from ? [plain(from, to === 'b' ? 'a' : 'b')] : null;
        return { ...p, a: text, b: text };
      }),
    );
    setCopied(id);
  }

  function undo() {
    const prev = past.at(-1);
    if (!prev) return;
    setFuture((f) => [paras, ...f]);
    setPast((p) => p.slice(0, -1));
    setParas(prev);
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    setPast((p) => [...p, paras]);
    setFuture((f) => f.slice(1));
    setParas(next);
  }

  function copyAll() {
    commit(paras.map((p) => (kindOf(p) === 'same' ? p : { ...p, b: p.a && [plain(p.a, 'a')], a: p.a && [plain(p.a, 'a')] })));
  }

  function reset() {
    setParas(START);
    setPast([]);
    setFuture([]);
    setDecisions({});
    setCur(0);
  }

  // Choosing the same decision again takes it back.
  const decide = (id: string, d: Decision) =>
    setDecisions((all) => {
      const { [id]: was, ...rest } = all;
      return was === d ? rest : { ...rest, [id]: d };
    });

  /** The paragraphs as rows, with unchanged runs folded away when only changes are shown. */
  const rows: ReactNode[] = [];
  let folded = 0;
  const flush = (key: string) => {
    if (folded) rows.push(<div key={`fold-${key}`} className={styles.fold}>{`${folded} unchanged ${folded === 1 ? 'paragraph' : 'paragraphs'}`}</div>);
    folded = 0;
  };
  for (const p of visible) {
    const k = kindOf(p);
    const isCur = p === current;
    if (changesOnly && k === 'same') {
      folded++;
      continue;
    }
    flush(p.id);
    if (unified) {
      if (k === 'same') rows.push(<div key={p.id} className={styles.uni}>{p.a && <Text segs={p.a} style={p.style} />}</div>);
      else
        rows.push(
          <Fragment key={p.id}>
            {p.a && (
              <div className={styles.uni} data-side="a" data-current={isCur || undefined} onClick={() => setCur(changes.indexOf(p))}>
                <Text segs={p.a.filter((s) => typeof s === 'string' || 'd' in s)} style={p.style} />
              </div>
            )}
            {p.b && (
              <div className={styles.uni} data-side="b" data-current={isCur || undefined} onClick={() => setCur(changes.indexOf(p))}>
                <Text segs={p.b.filter((s) => typeof s === 'string' || 'i' in s)} style={p.style} />
              </div>
            )}
          </Fragment>,
        );
      continue;
    }
    const gutter = k !== 'same' && (
      <>
        <button type="button" className={styles.act} title="Use A's version in B" aria-label="Use A's version in B" onClick={() => copy(p.id, 'b')}>
          <Icon name="chevronsRight" size={12} />
        </button>
        <button type="button" className={styles.act} title="Use B's version in A" aria-label="Use B's version in A" onClick={() => copy(p.id, 'a')}>
          <Icon name="chevronsLeft" size={12} />
        </button>
      </>
    );
    rows.push(
      <div
        key={p.id}
        className={styles.row}
        data-k={k}
        data-current={isCur || undefined}
        data-copied={copied === p.id || undefined}
        onClick={() => k !== 'same' && setCur(changes.indexOf(p))}
        onAnimationEnd={() => setCopied(null)}
      >
        <div className={`${styles.cell} ${notes && isCur ? styles.anchor : ''}`} data-side="a">
          {p.a ? (
            <Text segs={p.a} style={p.style} onWord={() => copy(p.id, 'a')} />
          ) : (
            <span className={styles.missing}>
              <span>Not in A</span>
            </span>
          )}
        </div>
        {isCur ? (
          <Region name="copy" className={styles.gut}>
            {gutter}
          </Region>
        ) : (
          <div className={styles.gut}>{gutter}</div>
        )}
        <div className={`${styles.cell} ${notes && isCur ? styles.anchor : ''}`} data-side="b">
          {p.b ? (
            <Text segs={p.b} style={p.style} onWord={() => copy(p.id, 'b')} wordRegion={isCur} />
          ) : (
            <span className={styles.missing}>
              <span>Not in B</span>
            </span>
          )}
          {notes && isCur && (
            <Region name="review" as="aside" className={`${styles.note} ${styles.hideNarrow}`}>
              <b>Needs work · You</b>
              Check this against the budget before we sign.
            </Region>
          )}
        </div>
      </div>,
    );
  }
  flush('end');

  return (
    <Frame address="collate / compare" label="An interactive replica of the document workspace">
      <Region name="appbar" as="header" className={styles.appbar}>
        <span className={styles.brand}>
          <i>C</i>ollate
        </span>
        <span className={styles.spacer} />
        <button type="button" className={styles.btn} data-icon="" title="Swap A and B" aria-label="Swap A and B">
          <Icon name="swap" size={13} />
        </button>
        <button type="button" className={styles.btn} data-icon="" onClick={reset} title="New comparison (resets the replica)" aria-label="New comparison">
          <Icon name="plus" size={13} />
        </button>
        <button type="button" className={styles.btn} data-icon="" title="Help and keyboard shortcuts (?)" aria-label="Help and keyboard shortcuts">
          <Icon name="help" size={13} />
        </button>
      </Region>

      <div className={styles.toolbar} data-match={!changes.length || undefined}>
        <Region name="nav" as="span" className={styles.group}>
          <button type="button" className={styles.btn} data-icon="" disabled={at <= 0} onClick={() => setCur(at - 1)} title="Previous change (P)" aria-label="Previous change">
            <Icon name="up" size={13} />
          </button>
          <button type="button" className={styles.btn} data-icon="" disabled={at >= changes.length - 1} onClick={() => setCur(at + 1)} title="Next change (N)" aria-label="Next change">
            <Icon name="down" size={13} />
          </button>
        </Region>
        <Region name="fold" as="span" className={styles.group}>
          <button type="button" className={styles.btn} aria-pressed={changesOnly} onClick={() => setChangesOnly(!changesOnly)} title="Changes only (C)">
            <Icon name="fold" size={13} />
            <span className={styles.hideNarrow}>Changes only</span>
          </button>
        </Region>
        <span className={`${styles.stats} ${styles.hideNarrow}`}>
          {changes.length ? (
            <>
              {counts.mod > 0 && <span data-k="mod">{counts.mod} changed</span>}
              {counts.del > 0 && <span data-k="del">{counts.del} only in A</span>}
              {counts.ins > 0 && <span data-k="ins">{counts.ins} only in B</span>}
            </>
          ) : (
            <span data-k="match">A and B match</span>
          )}
        </span>
        <span className={styles.spacer} />
        <Region name="view" as="span" className={styles.seg}>
          <button type="button" aria-pressed={!unified} onClick={() => setUnified(false)}>
            Side by side
          </button>
          <button type="button" aria-pressed={unified} onClick={() => setUnified(true)}>
            Unified
          </button>
        </Region>
        <Region name="review-btn" as="span" className={styles.group}>
          <button type="button" className={styles.btn} data-icon="" aria-pressed={notes} onClick={() => setReview(!review)} title="Review mode (R)" aria-label="Review mode">
            <Icon name="review" size={13} />
          </button>
        </Region>
      </div>
      <div className={styles.toolbar}>
        <Region name="undo" as="span" className={styles.group}>
          <button type="button" className={styles.btn} data-icon="" onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)" aria-label="Undo">
            <Icon name="undo" size={13} />
          </button>
          <button type="button" className={styles.btn} data-icon="" onClick={redo} disabled={!future.length} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
            <Icon name="redo" size={13} />
          </button>
        </Region>
        <Region name="copy-all" as="span" className={styles.group}>
          <button type="button" className={styles.btn} onClick={copyAll} disabled={!changes.length} title="Copy changes › Make B match A">
            <Icon name="merge" size={13} />
            Make B match A
          </button>
        </Region>
        <span className={styles.spacer} />
        <Region name="redline" as="span" className={styles.group}>
          <button type="button" className={styles.btn} title="Redline: a Word file with every change as a tracked change">
            <Icon name="download" size={13} />
            Redline
          </button>
          <button type="button" className={`${styles.btn} ${styles.hideNarrow}`} title="Change report, as PDF or Word">
            <Icon name="doc" size={13} />
            Report
          </button>
          <button type="button" className={styles.btn} title="Share the review">
            <Icon name="link" size={13} />
            Share
          </button>
        </Region>
        <Region name="list" as="span" className={styles.group}>
          <button type="button" className={styles.btn} data-icon="" aria-pressed={panel} onClick={() => setPanel(!panelOpen)} title="List of changes (S)" aria-label="List of changes">
            <Icon name="sidebar" size={13} />
          </button>
        </Region>
      </div>

      <div className={styles.body} data-panel={panel || undefined}>
        <div>
          <Region name="heads" className={styles.heads}>
            <div className={styles.head}>
              <span className={styles.siglum}>A</span>
              <span className={styles.headMain}>
                <span className={styles.headName}>agreement-draft-1.docx</span>
                <span className={styles.headMeta}>
                  <span className={styles.badge}>Word</span>
                  <span className={styles.hideNarrow}>1 page · 202 words</span>
                </span>
              </span>
            </div>
            <span className={styles.counter}>
              {changes.length ? (
                <>
                  <b>{at + 1}</b>/{changes.length}
                </>
              ) : (
                '0'
              )}
            </span>
            <div className={styles.head}>
              <span className={styles.siglum}>B</span>
              <span className={styles.headMain}>
                <span className={styles.headName}>agreement-draft-2.docx</span>
                <span className={styles.headMeta}>
                  <span className={styles.badge}>Word</span>
                  <span className={styles.hideNarrow}>1 page · 245 words</span>
                </span>
              </span>
              <Region name="export" as="span" className={styles.anchor}>
                <button type="button" className={styles.btn} onClick={() => setExport(!exportOpen)} aria-expanded={menu}>
                  <Icon name="download" size={12} />
                  <span className={styles.hideNarrow}>Export</span>
                </button>
                {menu && (
                  <div className={styles.menu} role="menu">
                    <p className={styles.menuTitle}>B: agreement-draft-2.docx</p>
                    {EXPORTS.map(([label, hint], i) => (
                      <p key={label} data-on={i === 0 || undefined}>
                        {label}
                        {hint && <small>{hint}</small>}
                      </p>
                    ))}
                  </div>
                )}
              </Region>
            </div>
          </Region>
          <div className={styles.sheets} style={unified ? { paddingTop: 0 } : undefined}>
            {rows}
          </div>
        </div>

        {panel && (
          <Region name="list" as="aside" className={styles.panel}>
            <div className={styles.panelHead}>
              <span>Changes</span>
              <span>
                {changes.filter((p) => decisions[p.id]).length}/{changes.length} decided
              </span>
            </div>
            {changes.map((p, i) => {
              const text = plain(p.b ?? p.a ?? [], p.b ? 'b' : 'a');
              return (
                <div key={p.id} className={styles.item} data-current={i === at || undefined} onClick={() => setCur(i)}>
                  <span className={styles.itemText}>{text}</span>
                  <span className={styles.itemMeta}>
                    <span data-k="del">−{p.b ? words(p.a, 'd') : count(plain(p.a ?? [], 'a'))}</span>
                    <span data-k="ins">+{p.a ? words(p.b, 'i') : count(plain(p.b ?? [], 'b'))}</span>
                    {i === at ? (
                      <Region name="decide" as="span" className={styles.decide}>
                        <DecideButtons id={p.id} value={decisions[p.id]} onDecide={decide} />
                      </Region>
                    ) : (
                      <span className={styles.decide}>
                        <DecideButtons id={p.id} value={decisions[p.id]} onDecide={decide} />
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
            {!changes.length && <span className={styles.panelFoot}>No changes left.</span>}
            <span className={styles.panelFoot}>A accepts, X rejects the current change.</span>
          </Region>
        )}
      </div>
    </Frame>
  );
}

function DecideButtons({ id, value, onDecide }: { id: string; value?: Decision; onDecide(id: string, d: Decision): void }) {
  return (
    <>
      <button
        type="button"
        data-v="accept"
        aria-pressed={value === 'accept'}
        aria-label="Accept"
        title="Accept (A)"
        onClick={(e) => {
          e.stopPropagation();
          onDecide(id, 'accept');
        }}
      >
        <Icon name="check" size={11} />
      </button>
      <button
        type="button"
        data-v="reject"
        aria-pressed={value === 'reject'}
        aria-label="Reject"
        title="Reject (X)"
        onClick={(e) => {
          e.stopPropagation();
          onDecide(id, 'reject');
        }}
      >
        <Icon name="close" size={11} />
      </button>
    </>
  );
}
