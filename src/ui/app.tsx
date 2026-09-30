/**
 * The comparison workspace: two documents (or pictures, or recordings) side
 * by side, and everything the reader does with them. Its parts are in
 * workspace/: a hook for each concern (the settings kept in this browser,
 * moving through the changes, review, checking, copying changes across,
 * loading, exporting, pictures and recordings, the session, the keys) and the
 * menus and dialogs they open. This puts them together and lays out the page.
 */
import type { MouseEvent } from 'react';
import { useMemo, useRef, useState } from 'react';
import { compareDocs } from '../core/compare';
import type { Doc } from '../core/model';
import { pairKind } from '../media/kinds';
import { AudioPanel } from './audio/audio-panel';
import { AudioView } from './audio/audio-view';
import { ChangesPanel } from './changes-panel';
import type { DialogState } from './dialogs';
import { Dialog } from './dialogs';
import { DropOverlay } from './drop';
import { ElasticGrid } from './elastic-grid';
import { EmptyState } from './empty';
import { DocumentGrid, KeepPlace } from './grid';
import { ColumnHeads } from './heads';
import { NO_DOCS, useDocHistory } from './history';
import { ImagePanel } from './image/image-panel';
import { ImageView } from './image/image-view';
import { Popover } from './menus';
import { Notices } from './notices';
import { Overview } from './overview';
import { pairFor, pictureSides } from './pictures';
import type { Restored, SavedExtra, SessionScope } from './session';
import { Toasts, useToasts } from './toasts';
import { AppBar, TextToolbar } from './toolbar';
import { Tooltips } from './tooltip';
import { sameText } from './util';
import { VersionBar } from './versions';
import { dialogBody } from './workspace/dialog-body';
import { sampleDocs } from './workspace/docs';
import { MediaToolbar } from './workspace/media-toolbar';
import { workspaceNotices } from './workspace/notices';
import { usePop } from './workspace/pop';
import { popoverMenu } from './workspace/popover-menu';
import { useAuthor, useDarkTheme, usePrefs } from './workspace/prefs';
import { useChecking } from './workspace/use-checking';
import { useEditing } from './workspace/use-editing';
import { useExports } from './workspace/use-exports';
import { useKeyboard } from './workspace/use-keyboard';
import { ACCEPT, useLoading } from './workspace/use-loading';
import { useMediaCompare } from './workspace/use-media';
import { useMoveLabels } from './workspace/use-moves';
import { useNavigation } from './workspace/use-navigation';
import { useReview } from './workspace/use-review';
import { useSession } from './workspace/use-session';
import { useSummary } from './workspace/use-summary';

/** Keys that scroll the documents when they have focus. */
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);

export interface CompareAppProps {
  /** Documents to compare straight away. */
  docs?: { a: Doc; b: Doc | null };
  /** Without documents, show the sample drafts instead of asking for two. */
  sample?: boolean;
  /** Where the name in the app bar links to. */
  home?: string;
  /** Keeps the comparison in this browser under this name, so a reload brings it back. */
  session?: SessionScope;
  /** A comparison kept from before the page was reloaded, to carry on with. */
  restored?: Restored | null;
}

/** The comparison workspace. */
export function CompareApp({ docs, sample = false, home, session, restored }: CompareAppProps) {
  const history = useDocHistory(() =>
    restored ? restored.docs : docs ? { a: docs.a, b: docs.b, edits: { a: 0, b: 0 }, sample: false } : sample ? sampleDocs() : NO_DOCS,
  );
  const { a, b, edits } = history.now;
  const { prefs, setPref, phone, view, elastic } = usePrefs();
  const { opts, changesOnly, minimap, lines, bands, lowContrast, sidebar } = prefs;
  const { dark, switchTheme } = useDarkTheme();
  const { author, saveAuthor, me } = useAuthor();
  const { pop, setPop, openPop, closePop, openDocMenu } = usePop();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [busy, setBusy] = useState('');
  /** Notices the reader closed, which stay closed while the page is open. */
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const { toasts, toast, dismiss: dismissToast } = useToasts();
  const root = useRef<HTMLDivElement>(null);
  const dialogEl = useRef<HTMLDialogElement>(null);
  const openDialog = (d: DialogState) => {
    setPop(null);
    setDialog(d);
  };

  const cmp = useMemo(() => (a && b ? compareDocs(a, b, opts) : null), [a, b, opts]);
  /** What is compared: text, images or audio (each has its own tools and view). */
  const kind = pairKind(a, b);
  const same = sameText(opts);
  /** What was kept with the comparison before the page was reloaded. */
  const saved = restored?.extra;

  const navigation = useNavigation({ cmp, prefs, setPref, phone, view, elastic, initial: restored?.view?.current ?? 0, root, setPop });
  const { cur, items, scroller, grid, heads } = navigation;
  const checking = useChecking({ cmp, on: prefs.check, lang: prefs.lang, claude: prefs.claude, saved, history, toast, setPop, openPop, goToRow: navigation.goToRow, grid, root });
  const review = useReview({ cmp, on: prefs.review, saved, me, grid, root, pop, setPop, openPop, setPref, issueAt: checking.issueAt, navigation });
  const media = useMediaCompare({ a, b, kind, saved, author });
  const { imageCtl, audioCtl } = media;
  const editing = useEditing({ history, cmp, opts, cur, decided: review.decided, toast, setPop, openPop, setCurrentState: navigation.setCurrentState });
  const summary = useSummary(cmp, toast);
  const loading = useLoading({
    history,
    a,
    b,
    kind,
    cmp,
    opts,
    toast,
    setBusy,
    dialog,
    setDialog,
    dialogEl,
    setPop,
    navigation,
    // The review, notes and findings go with the documents.
    extras: {
      clear: () => {
        review.clear();
        media.clearNotes();
        checking.clear();
      },
      swap: () => {
        review.swap();
        media.swapNotes();
      },
      load: (extra) => {
        media.loadNotes(extra);
        review.load(extra);
        checking.load(extra);
      },
    },
  });
  const exports = useExports({
    history,
    cmp,
    b,
    marks: review.marks,
    author,
    me,
    toast,
    setBusy,
    setPop,
    versions: loading.versions,
    extras: () => ({ review: review.marks, media: media.notes, ignored: checking.ignored, claude: checking.claudeFound }),
    summary: summary.points,
  });
  /** What is kept with the documents in this browser, beside them. */
  const extra = useMemo<SavedExtra>(
    () => ({ review: review.marks, media: media.notes, ignored: checking.ignored, claude: checking.claudeFound, transcripts: media.transcripts }),
    [review.marks, media.notes, checking.ignored, checking.claudeFound, media.transcripts],
  );
  const { saveView } = useSession({ scope: session, restored, docs: history.now, cur, scroller, extra, toast });
  useMoveLabels(grid, cmp);
  useKeyboard({ kind, cmp, prefs, setPref, view, pop, setPop, dialog, openDialog, root, navigation, editing, review, media });

  /** A click on a picture in a change opens the two versions of it side by side. */
  const onPictureClick = (e: MouseEvent): boolean => {
    const img = (e.target as Element).closest?.<HTMLImageElement>('img.obj-img');
    const cell = img?.closest('.cell.a, .cell.b');
    const key = cell?.closest<HTMLElement>('.row')?.dataset.key;
    const row = key ? cmp?.rows.find((r) => r.key === key) : undefined;
    if (!img || !cell || !row || row.hunk < 0 || !a || !b) return false;
    const side = cell.classList.contains('a') ? 'a' : 'b';
    const pair = pairFor(row, side, Array.from(cell.querySelectorAll('img.obj-img')).indexOf(img));
    if (!pair) return false;
    e.stopPropagation();
    const [pa, pb] = pictureSides(pair, a.name, b.name);
    setDialog({ type: 'pictures', a: pa, b: pb });
    return true;
  };
  /** A click on the documents opens what goes with a picture in a change, with underlined words, or with noted or highlighted text. */
  const onDocumentClick = (e: MouseEvent) => {
    if (onPictureClick(e)) return;
    if (checking.onIssueClick(e)) return;
    review.onMarkClick(e);
  };

  /* ------------------------------------------------------------ render */

  const notices = workspaceNotices(history.now, kind, loading.startOver);
  const { menu, className: menuClass } = pop
    ? popoverMenu(pop, { a, b, cmp, prefs, setPref, author, saveAuthor, toast, setPop, setDialog, root, navigation, review, checking, editing, loading, exports, summary })
    : { menu: null, className: '' };
  const body = dialog ? dialogBody(dialog, { a, b, opts, setDialog, loading }) : null;
  // Review mode's margins are for documents: pictures and recordings have notes of their own (and a transcript's rows no rails).
  const appClass = [
    'app',
    view,
    elastic && 'elastic',
    minimap && 'with-map',
    lines && 'with-lines',
    lowContrast && 'lowc',
    prefs.review && cmp && kind === 'text' && 'review',
    !cmp && 'is-empty',
    busy && 'is-busy',
  ]
    .filter(Boolean)
    .join(' ');
  const openId = pop && (pop.type === 'load' || pop.type === 'export') ? `${pop.type}-${pop.side}` : null;
  return (
    <div className={appClass} data-busy={busy || undefined} ref={root}>
      <AppBar
        home={home}
        hasDocs={!!(a || b)}
        lowContrast={lowContrast}
        dark={dark}
        onSwap={loading.swap}
        onNew={loading.startOver}
        onContrast={() => setPref({ lowContrast: !lowContrast })}
        onTheme={switchTheme}
        onHelp={() => openDialog({ type: 'help' })}
      />
      {kind === 'image' || kind === 'audio' ? (
        <MediaToolbar
          kind={kind}
          media={media}
          sidebar={sidebar}
          onSidebar={() => navigation.toggleSidebar()}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onUndo={editing.undo}
          onRedo={editing.redo}
          sharing={pop?.type === 'share'}
          onShare={(e) => openPop({ type: 'share', anchor: e.currentTarget })}
        />
      ) : (
        <TextToolbar
          cmp={cmp}
          current={cur}
          nav={navigation.buttons}
          changesOnly={changesOnly}
          view={view}
          minimap={minimap}
          lines={lines}
          bands={bands}
          sidebar={sidebar}
          review={prefs.review}
          marks={review.marks.length}
          check={prefs.check}
          issues={checking.counts ? checking.counts.a + checking.counts.b : null}
          checking={!!checking.claudeRun}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          menu={
            pop?.type === 'options' || pop?.type === 'copy' || pop?.type === 'check' || pop?.type === 'redline' || pop?.type === 'report' || pop?.type === 'share' ? pop.type : null
          }
          same={same}
          onPrev={() => navigation.step(-1)}
          onNext={() => navigation.step(1)}
          onChangesOnly={navigation.toggleChangesOnly}
          onView={navigation.setView}
          onMinimap={() => setPref({ minimap: !minimap })}
          onLines={() => setPref({ lines: !lines })}
          onBands={navigation.toggleBands}
          onOptions={(e) => openPop({ type: 'options', anchor: e.currentTarget })}
          onPagePrev={() => navigation.page(-1)}
          onPageNext={() => navigation.page(1)}
          onUndo={editing.undo}
          onRedo={editing.redo}
          onCopy={(e) => openPop({ type: 'copy', anchor: e.currentTarget })}
          onRedline={(e) => openPop({ type: 'redline', anchor: e.currentTarget })}
          onReport={(e) => openPop({ type: 'report', anchor: e.currentTarget })}
          onShare={(e) => openPop({ type: 'share', anchor: e.currentTarget })}
          onSidebar={() => navigation.toggleSidebar()}
          onReview={() => setPref({ review: !prefs.review })}
          onCheck={() => setPref({ check: !prefs.check })}
          onCheckMenu={(e) => openPop({ type: 'check', anchor: e.currentTarget })}
        />
      )}
      <Notices notices={notices.filter((x) => !dismissed.has(x.key))} onDismiss={(key) => setDismissed((d) => new Set(d).add(key))} />
      {loading.versions.length > 2 && a && b && (
        <VersionBar versions={loading.versions} a={a} b={b} onPick={loading.pickVersion} onStep={loading.stepVersions} onAdd={() => loading.chooseFiles('versions')} />
      )}
      <main className="stage" id="stage">
        {cmp && a && b ? (
          <>
            <div
              className="scroller"
              id="scroller"
              ref={scroller}
              onScroll={() => {
                // Menus on the documents' words or margins would be left behind; the toolbar's stay open.
                if (pop && (scroller.current?.contains(pop.anchor) || pop.anchor.classList.contains('float-anchor'))) setPop(null);
                navigation.scheduleNav();
                saveView();
              }}
              onClickCapture={onDocumentClick}
              onContextMenu={review.onMarkMenu}
              onMouseMove={review.onMarkHover}
              onMouseLeave={review.onMarkLeave}
              onWheel={navigation.manual}
              onTouchMove={navigation.manual}
              // A press on the scroller itself (not its content) is the scrollbar.
              onPointerDown={(e) => e.target === e.currentTarget && navigation.manual()}
              onKeyDown={(e) => SCROLL_KEYS.has(e.key) && navigation.manual()}
            >
              {/* Recordings have their heads beside their tracks. */}
              {kind !== 'audio' && <ColumnHeads a={a} b={b} edits={edits} cmp={cmp} current={cur} open={openId} onMenu={openDocMenu} ref={heads} />}
              {view === 'unified' && kind === 'text' && <div className="topcap" />}
              {kind === 'image' && media.bothPictures ? (
                <ImageView ctl={imageCtl} notes={media.notesApi} />
              ) : kind === 'audio' ? (
                <AudioView ctl={audioCtl} heads={{ docs: { a, b }, open: openId, onMenu: openDocMenu }} notes={media.notesApi} bands={elastic} />
              ) : (
                <KeepPlace place={navigation.place} watch={[items, minimap, lines, sidebar, view, elastic, prefs.review]}>
                  {elastic ? (
                    <ElasticGrid
                      cmp={cmp}
                      items={items}
                      current={cur}
                      layout={navigation.elasticLayout}
                      onCopyHunk={editing.copyHunk}
                      onFold={navigation.onFold}
                      onInline={editing.onInline}
                      onPick={navigation.onPick}
                      review={review.reviewView}
                      ref={grid}
                    />
                  ) : (
                    <DocumentGrid
                      cmp={cmp}
                      items={items}
                      current={cur}
                      onCopy={editing.copyRow}
                      onFold={navigation.onFold}
                      onInline={editing.onInline}
                      onPick={navigation.onPick}
                      onRender={navigation.onGridRender}
                      review={review.reviewView}
                      ref={grid}
                    />
                  )}
                </KeepPlace>
              )}
              {!elastic && kind === 'text' && <div className="endcap" />}
            </div>
            {kind === 'text' && (
              <Overview
                layout={navigation.lay}
                scroller={scroller}
                current={cur}
                minimap={minimap}
                palette={`${dark}:${lowContrast}`}
                onGo={navigation.onOverviewGo}
                onScrolled={navigation.onOverviewScrolled}
              />
            )}
            {sidebar && kind === 'audio' && <AudioPanel ctl={audioCtl} notes={media.notesApi} onClose={navigation.closeSidebar} />}
            {sidebar && kind === 'image' && media.bothPictures && <ImagePanel ctl={imageCtl} notes={media.notesApi} onClose={navigation.closeSidebar} />}
            {sidebar && kind === 'text' && (
              <ChangesPanel
                cmp={cmp}
                current={cur}
                same={same}
                onGo={navigation.goToChange}
                onClose={navigation.closeSidebar}
                review={review.panelReview}
                decisions={review.decided}
                onDecide={review.decide}
                onApplyDecisions={editing.applyDecisions}
                risks={summary.risks}
                summary={{ points: summary.points, available: !!checking.claudeAvailable, running: summary.running }}
                onSummarize={() => void summary.summarize()}
                onStopSummary={summary.stop}
              />
            )}
          </>
        ) : (
          <EmptyState a={a} b={b} onLoad={loading.startLoad} onMenu={openDocMenu} onSamples={loading.loadSamples} media={loading.loadMedia} onMedia={loading.setLoadMedia} />
        )}
      </main>
      <Toasts toasts={toasts} onUndo={editing.undo} onDismiss={dismissToast} />
      {loading.drop.active && <DropOverlay hot={loading.drop.hot} />}
      <input type="file" id="file-input" accept={ACCEPT} multiple hidden ref={loading.file} onChange={loading.onFile} />
      {pop && menu && (
        <Popover anchor={pop.anchor} className={menuClass} onClose={closePop}>
          {menu}
        </Popover>
      )}
      {dialog && (
        <Dialog key={dialog.type} className={dialog.type} onClose={() => setDialog(null)} ref={dialogEl}>
          {body}
        </Dialog>
      )}
      <Tooltips root={root} />
    </div>
  );
}
