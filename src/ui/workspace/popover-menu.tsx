/**
 * What opens in the popover for what is open (pop.ts): a document's load and
 * export menus, the toolbar's menus, and the cards and menus that a click or
 * a right-click on the documents' words opens.
 */
import type { ReactNode, RefObject } from 'react';
import type { Comparison } from '../../core/compare';
import type { Doc } from '../../core/model';
import { movesByRow } from '../../core/moves';
import { driveRefOf } from '../../lib/cloud';
import { changeTarget } from '../../review/anchor';
import { CheckMenu, IssueCard } from '../check-ui';
import type { DialogState } from '../dialogs';
import { CopyMenu, ExportMenu, InlineMenu, LoadMenu, OptionsMenu, RedlineMenu, ReportMenu, ShareMenu } from '../menus';
import { hunkPictures, pictureSides } from '../pictures';
import type { ReviewContext } from '../review-card';
import { ChangeMenu, MarkMenu, ReviewCard } from '../review-card';
import type { ToastFn } from '../toasts';
import { inlineWords } from './docs';
import type { Pop, ReviewPop } from './pop';
import { floatingAnchor } from './pop';
import type { Prefs, SetPref } from './prefs';
import type { Checking } from './use-checking';
import type { Editing } from './use-editing';
import type { Exports } from './use-exports';
import type { Loading } from './use-loading';
import type { Navigation } from './use-navigation';
import type { Review } from './use-review';
import type { Summary } from './use-summary';

/** What the menus show, and do. */
export interface MenuContext {
  a: Doc | null;
  b: Doc | null;
  cmp: Comparison | null;
  prefs: Prefs;
  setPref: SetPref;
  /** The reader's name, and a way to change it. */
  author: string;
  saveAuthor(name: string): void;
  toast: ToastFn;
  setPop(pop: Pop | null): void;
  setDialog(dialog: DialogState): void;
  root: RefObject<HTMLDivElement | null>;
  navigation: Pick<Navigation, 'n' | 'cur' | 'goToRow' | 'setCurrentState'>;
  review: Review;
  checking: Checking;
  editing: Editing;
  loading: Loading;
  exports: Exports;
  summary: Summary;
}

/** The menu for what is open, and its popover's class (no menu: there is nothing to show). */
export function popoverMenu(pop: Pop, w: MenuContext): { menu: ReactNode; className: string } {
  const { a, b, cmp, prefs, setPref, setPop, navigation, review, checking, editing, loading, exports } = w;
  switch (pop.type) {
    case 'load': {
      const here = pop.side === 'a' ? a : b;
      return {
        menu: (
          <LoadMenu
            side={pop.side}
            clouds={loading.clouds}
            driveFile={here ? driveRefOf(here)?.name : undefined}
            onLoad={loading.startLoad}
            media={loading.loadMedia}
            onMedia={loading.setLoadMedia}
          />
        ),
        className: '',
      };
    }
    case 'export': {
      const doc = pop.side === 'a' ? a : b;
      return { menu: doc ? <ExportMenu side={pop.side} doc={doc} onExport={exports.exportDoc} /> : null, className: '' };
    }
    case 'copy':
      return {
        menu: (
          <CopyMenu
            current={navigation.cur}
            total={navigation.n}
            onApply={(scope, dir) => {
              setPop(null);
              if (scope === 'cur') editing.applyCurrent(dir);
              else editing.applyAll(dir);
            }}
          />
        ),
        className: '',
      };
    case 'options':
      return { menu: <OptionsMenu opts={prefs.opts} onChange={(o) => setPref({ opts: o })} />, className: 'wide' };
    case 'check':
      return {
        menu: (
          <CheckMenu
            lang={prefs.lang}
            counts={checking.counts}
            claude={{ enabled: prefs.claude, available: checking.claudeAvailable, run: checking.claudeRun }}
            words={checking.words.length}
            onLang={(l) => setPref({ lang: l })}
            onClaude={(on) => setPref({ claude: on })}
            onClaudeCheck={(side) => void checking.askClaude(side)}
            onStop={checking.stopClaude}
            onNext={checking.nextIssue}
            onClearWords={checking.clearWords}
          />
        ),
        className: 'wide',
      };
    case 'issue': {
      const pi = checking.issues.find((x) => x.key === pop.key);
      const doc = pi && (pi.side === 'a' ? a : b);
      if (!pi || !doc) return { menu: null, className: 'issue' };
      return {
        menu: (
          <IssueCard
            issue={pi.issue}
            side={pi.side}
            suggestions={pop.suggestions}
            editable={pi.block.type === 'p' && doc.blocks.includes(pi.block)}
            canAsk={checking.claudeReady}
            asking={!!checking.claudeRun}
            onFix={(r) => checking.fixIssue(pi, r)}
            onIgnore={() => checking.ignoreIssue(pi)}
            onAddWord={() => checking.addWord(pi)}
            onAsk={() => {
              setPop(null);
              void checking.askClaude(pi.side, [pi.block]);
            }}
          />
        ),
        className: 'issue',
      };
    }
    case 'review': {
      const ctx = review.cardContext(pop);
      return { menu: ctx ? reviewCard(pop, ctx, w) : null, className: 'review' };
    }
    case 'redline':
      return {
        menu:
          cmp && a && b ? (
            <RedlineMenu
              a={a.name}
              b={b.name}
              author={w.author}
              changes={navigation.n}
              notes={exports.notesForRedline().length}
              withNotes={exports.redlineWithNotes}
              onAuthor={w.saveAuthor}
              onWithNotes={exports.setRedlineWithNotes}
              onDownload={exports.downloadRedline}
            />
          ) : null,
        className: 'wide',
      };
    case 'share':
      return {
        menu: (
          <ShareMenu
            canSave={!!(a && b)}
            author={w.author}
            onAuthor={w.saveAuthor}
            onSave={(pw) => void exports.saveReview(pw)}
            onOpen={() => {
              setPop(null);
              loading.chooseFiles('a');
            }}
          />
        ),
        className: 'wide',
      };
    case 'report':
      return {
        menu: cmp ? (
          <ReportMenu choices={exports.reportChoices} hasSummary={!!w.summary.points?.length} onChange={exports.setReportChoices} onDownload={exports.downloadReport} />
        ) : null,
        className: 'wide',
      };
    case 'mark':
      return { menu: markMenu(pop, w), className: 'mark' };
    case 'select':
      return { menu: selectionMenu(pop, w), className: 'mark' };
    case 'change':
      return { menu: changeMenu(pop, w), className: 'mark' };
    case 'inline': {
      const words = inlineWords(cmp, prefs.opts, pop.rowKey, pop.change);
      return { menu: words ? <InlineMenu {...words} onApply={(dir) => editing.copyWording(pop.rowKey, pop.change, dir)} /> : null, className: 'inline' };
    }
  }
}

/** Copies text to the clipboard, and says whether it could. */
function copyText(text: string, toast: ToastFn) {
  navigator.clipboard.writeText(text).then(
    () => toast('Copied the text'),
    () => toast('The text could not be copied.', { error: true }),
  );
}

/** The card opened from a margin: the marks on one side of a row (or on some of its text), and adding more. */
function reviewCard(p: ReviewPop, ctx: ReviewContext, { cmp, review }: MenuContext) {
  const target = () => p.selection ?? (ctx.hunk >= 0 && cmp ? changeTarget(cmp, ctx.hunk) : review.paragraphTarget(p.side, p.rowKey));
  return (
    <ReviewCard
      key={`${p.rowKey}|${p.side}|${p.selection?.pos ?? ''}`}
      ctx={ctx}
      onReact={(r) => review.react(ctx.hunk, r)}
      onDecide={(status) => review.decide(ctx.hunk, status)}
      onHighlight={(color) => {
        const t = p.selection ?? review.paragraphTarget(p.side, p.rowKey);
        if (t) review.highlight(t, color);
      }}
      onAddNote={(text) => {
        const t = target();
        if (t) review.addNote(t, text);
      }}
      onEditNote={review.editNote}
      onDelete={review.remove}
    />
  );
}

/** What can be done with a highlight or a note, from a right-click on its words. */
function markMenu(pop: Extract<Pop, { type: 'mark' }>, { review, setPop, toast }: MenuContext) {
  const p = review.placed.find((x) => x.mark.id === pop.id);
  const m = p?.mark;
  if (!p?.side || !m || (m.kind !== 'note' && m.kind !== 'highlight') || m.target.type !== 'text') return null;
  const target = m.target;
  return (
    <MarkMenu
      kind={m.kind}
      side={p.side}
      quote={target.quote}
      color={m.kind === 'highlight' ? m.color : undefined}
      onColor={(c) => {
        setPop(null);
        review.highlight(target, c);
      }}
      onOpen={() => review.openMark(p)}
      onNote={() => review.openMark(p, true)}
      onCopy={() => {
        setPop(null);
        copyText(target.quote, toast);
      }}
      onRemove={() => {
        setPop(null);
        review.remove(m.id);
      }}
    />
  );
}

/** What can be done with selected text, from a right-click on it. */
function selectionMenu(pop: Extract<Pop, { type: 'select' }>, { review, setPop, toast, root }: MenuContext) {
  const { target, rowKey, side } = pop.sel;
  return (
    <MarkMenu
      kind="selection"
      side={side}
      quote={target.quote}
      onColor={(c) => {
        setPop(null);
        review.highlight(target, c);
        document.getSelection()?.removeAllRanges();
        review.show();
      }}
      onNote={() => {
        const rect = document.getSelection()?.rangeCount ? document.getSelection()!.getRangeAt(0).getBoundingClientRect() : pop.anchor.getBoundingClientRect();
        const anchor = review.railButton(rowKey, side) ?? floatingAnchor(root.current, rect);
        setPop({ type: 'review', anchor, rowKey, side, selection: target, writing: true });
        review.show();
      }}
      onCopy={() => {
        setPop(null);
        copyText(target.quote, toast);
      }}
    />
  );
}

/** Everything that can be done with a change, from a right-click on it. */
function changeMenu(pop: Extract<Pop, { type: 'change' }>, w: MenuContext) {
  const { a, b, cmp, setPop, setDialog, toast, navigation, review, editing, loading } = w;
  const row = cmp?.rows.find((r) => r.key === pop.rowKey);
  const hunk = row?.hunk ?? -1;
  if (!cmp || hunk < 0) return null;
  const { target, rowKey, side, change } = pop;
  return (
    <ChangeMenu
      side={side}
      hunk={hunk}
      decision={review.decided.get(hunk)}
      onDecide={(status) => review.decide(hunk, status)}
      onHistory={loading.versions.length > 2 ? () => loading.showHistory(rowKey) : undefined}
      onPictures={(() => {
        const pairs = hunkPictures(cmp, hunk);
        if (!pairs.length || !a || !b) return undefined;
        return () => {
          setPop(null);
          const [pa, pb] = pictureSides(pairs[0]!, a.name, b.name);
          setDialog({ type: 'pictures', a: pa, b: pb });
        };
      })()}
      moved={(() => {
        const mv = movesByRow(cmp).get(rowKey);
        if (!mv) return undefined;
        const from = mv.from === rowKey;
        return {
          label: from ? `Go to where it moved (change ${mv.toHunk + 1})` : `Go to where it came from (change ${mv.fromHunk + 1})`,
          go: () => {
            setPop(null);
            navigation.goToRow(from ? mv.to : mv.from);
            navigation.setCurrentState(from ? mv.toHunk : mv.fromHunk);
          },
        };
      })()}
      quote={target?.quote ?? ''}
      reactions={review.reactionsOn(hunk)}
      highlights={target ? review.colorsOn(target) : []}
      apply={change < 0 || !!inlineWords(cmp, w.prefs.opts, rowKey, change)}
      whole={change < 0}
      onReact={(r) => {
        review.react(hunk, r);
        review.show();
      }}
      onColor={(c) => {
        setPop(null);
        if (target) review.highlight(target, c);
        review.show();
      }}
      onClearHighlight={() => {
        setPop(null);
        if (target) review.highlight(target, null);
      }}
      onOpen={(writing) => {
        const anchor = review.railButton(rowKey, side) ?? pop.anchor;
        setPop({ type: 'review', anchor, rowKey, side, selection: null, writing });
        review.show();
      }}
      onCopy={() => {
        setPop(null);
        if (target) copyText(target.quote, toast);
      }}
      onApply={(dir) => {
        if (change >= 0) editing.copyWording(rowKey, change, dir);
        else {
          setPop(null);
          editing.copyRow(rowKey, dir);
        }
      }}
    />
  );
}
