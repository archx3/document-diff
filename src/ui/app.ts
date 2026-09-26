import type { Comparison } from '../core/compare';
import { compareDocs, inlineDiff } from '../core/compare';
import { fullRange } from '../core/inline';
import type { Dir, Selection } from '../core/merge';
import { applySelection, selectAll, selectHunk, selectInline, selectRows, selectTableRow } from '../core/merge';
import type { Doc } from '../core/model';
import { isBlank, wordCount } from '../core/model';
import { modelBackend } from '../core/model-backend';
import type { CompareOptions } from '../core/tokens';
import { DEFAULT_OPTIONS } from '../core/tokens';
import { zipSync } from 'fflate';
import { docxBackend } from '../formats/docx/backend';
import { DocxPackage } from '../formats/docx/package';
import { VIEWER_EXTENSIONS, exportFormats } from '../formats/export';
import type { ExportFormat } from '../formats/export';
import { readHtml } from '../formats/html/read';
import { blocksToHtml, docToText } from '../formats/html/write';
import { ACCEPTED_EXTENSIONS, LoadError, googleDocId, loadFile, loadPaste } from '../formats/load';
import { odtBackend } from '../formats/odt/backend';
import { OdtPackage } from '../formats/odt/package';
import { SAMPLE_A, SAMPLE_A_NAME, SAMPLE_B, SAMPLE_B_NAME } from '../samples/sample';
import { copyRich, hostedInViewer, inViewer, saveFile, viewerReady } from './files';
import { GridView } from './grid';
import { icons } from './icons';
import { esc } from './render';

type Side = 'a' | 'b';

interface Snapshot {
  a: Doc | null;
  b: Doc | null;
  edits: { a: number; b: number };
  sample: boolean;
}

const PREFS_KEY = 'collate.prefs.v1';
const ACCEPT = ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(',');
const SIDE_NAME: Record<Side, string> = { a: 'A', b: 'B' };
const other = (s: Side): Side => (s === 'a' ? 'b' : 'a');

function kindLabel(doc: Doc): string {
  if (doc.formatLabel) return doc.formatLabel;
  switch (doc.kind) {
    case 'docx':
      return 'Word';
    case 'odt':
      return 'OpenDocument';
    case 'rtf':
      return 'RTF';
    case 'doc':
      return 'Word 97';
    case 'epub':
      return 'EPUB';
    case 'pdf':
      return 'PDF';
    case 'html':
      return /^Pasted/.test(doc.name) ? 'Pasted' : 'HTML';
    case 'markdown':
      return 'Markdown';
    case 'text':
      return /^Pasted/.test(doc.name) ? 'Pasted' : 'Text';
    case 'csv':
      return 'CSV';
    case 'sample':
      return 'Sample';
  }
}

function plural(n: number, one: string, many = one + 's'): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

function baseName(doc: Doc): string {
  return doc.name.replace(/\.[a-z0-9]{1,8}$/i, '').trim() || 'document';
}

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}

export class App {
  private a: Doc | null = null;
  private b: Doc | null = null;
  private sample = false;
  private opts: CompareOptions = { ...DEFAULT_OPTIONS };
  private changesOnly = false;
  private expanded = new Set<string>();
  private cmp: Comparison | null = null;
  private current = -1;
  private undoStack: Array<Snapshot & { label: string }> = [];
  private redoStack: Array<Snapshot & { label: string }> = [];
  private edits = { a: 0, b: 0 };
  private grid!: GridView;
  private el!: {
    root: HTMLElement;
    toolbar: HTMLElement;
    counter: HTMLElement;
    stats: HTMLElement;
    notice: HTMLElement;
    stage: HTMLElement;
    scroller: HTMLElement;
    colheads: HTMLElement;
    gridEl: HTMLElement;
    empty: HTMLElement;
    ruler: HTMLElement;
    rulerView: HTMLElement;
    toasts: HTMLElement;
    pop: HTMLElement;
    dlg: HTMLDialogElement;
    file: HTMLInputElement;
    overlay: HTMLElement;
  };
  private fileTarget: Side = 'a';
  private popAnchor: HTMLElement | null = null;
  private rulerFrame = 0;
  /** The reader scrolled by hand since the last jump to a change. */
  private userScrolled = false;

  constructor(private readonly host: HTMLElement) {
    this.loadPrefs();
    this.buildShell();
    this.bind();
    this.loadSamples();
  }

  /* ------------------------------------------------------------ shell */

  private buildShell(): void {
    this.host.innerHTML = `
<div class="app">
  <header class="appbar">
    <div class="brand"><span class="brand-word" role="img" aria-label="Collate"><span class="brand-mark" aria-hidden="true">C</span><span class="brand-name" aria-hidden="true">ollate</span></span><span class="brand-tag">Compare two documents and copy changes across</span></div>
    <div class="appbar-actions">
      <button type="button" class="btn ghost" id="btn-swap" title="Swap A and B">${icons.swap}<span>Swap</span></button>
      <button type="button" class="btn ghost" id="btn-new" title="Start again with two new documents">${icons.open}<span>New comparison</span></button>
      <button type="button" class="btn ghost icon-only" id="btn-help" title="Help and keyboard shortcuts (?)" aria-label="Help">${icons.help}</button>
    </div>
  </header>
  <div class="toolbar" id="toolbar" role="toolbar" aria-label="Changes">
    <div class="tgroup nav">
      <button type="button" class="btn icon-only" id="btn-prev" title="Previous change (P)" aria-label="Previous change">${icons.up}</button>
      <button type="button" class="btn icon-only" id="btn-next" title="Next change (N)" aria-label="Next change">${icons.down}</button>
      <span class="counter" id="counter" aria-live="polite"></span>
    </div>
    <div class="tgroup stats" id="stats"></div>
    <div class="tgroup view">
      <button type="button" class="btn toggle" id="btn-changes" aria-pressed="false" aria-label="Changes only" title="Hide unchanged paragraphs (C)">${icons.fold}<span>Changes only</span></button>
      <button type="button" class="btn" id="btn-options" aria-haspopup="true" aria-label="Compare options" title="What counts as a difference">${icons.sliders}<span>Compare</span>${icons.chevron}</button>
    </div>
    <div class="tgroup edit">
      <button type="button" class="btn icon-only" id="btn-undo" title="Undo (Ctrl+Z)" aria-label="Undo">${icons.undo}</button>
      <button type="button" class="btn icon-only" id="btn-redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">${icons.redo}</button>
      <button type="button" class="btn" id="btn-all" aria-haspopup="true"><span>Copy all</span>${icons.chevron}</button>
    </div>
  </div>
  <div class="notice" id="notice" hidden></div>
  <main class="stage" id="stage">
    <div class="scroller" id="scroller">
      <div class="colheads" id="colheads"></div>
      <div class="grid" id="grid"></div>
      <div class="endcap"></div>
    </div>
    <div class="ruler" id="ruler" aria-hidden="true"><div class="ruler-view" id="ruler-view"></div></div>
    <div class="empty" id="empty" hidden></div>
  </main>
  <div class="toasts" id="toasts" aria-live="polite"></div>
  <div class="drop-overlay" id="drop-overlay" hidden>
    <div class="drop-half" data-side="a"><span class="siglum">A</span><span>Drop to load as A</span></div>
    <div class="drop-half" data-side="b"><span class="siglum">B</span><span>Drop to load as B</span></div>
  </div>
  <input type="file" id="file-input" accept="${ACCEPT}" multiple hidden>
  <div class="pop" id="pop" hidden></div>
  <dialog class="dlg" id="dlg"></dialog>
</div>`;
    const $ = <T extends HTMLElement>(id: string) => this.host.querySelector<T>('#' + id)!;
    this.el = {
      root: this.host.querySelector('.app')!,
      toolbar: $('toolbar'),
      counter: $('counter'),
      stats: $('stats'),
      notice: $('notice'),
      stage: $('stage'),
      scroller: $('scroller'),
      colheads: $('colheads'),
      gridEl: $('grid'),
      empty: $('empty'),
      ruler: $('ruler'),
      rulerView: $('ruler-view'),
      toasts: $('toasts'),
      pop: $('pop'),
      dlg: $<HTMLDialogElement>('dlg'),
      file: $<HTMLInputElement>('file-input'),
      overlay: $('drop-overlay'),
    };
    this.grid = new GridView(this.el.gridEl, this.el.scroller);
  }

  /* ------------------------------------------------------------ prefs */

  private loadPrefs(): void {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as { opts?: Partial<CompareOptions>; changesOnly?: boolean };
      this.opts = { ...DEFAULT_OPTIONS, ...p.opts };
      this.changesOnly = !!p.changesOnly;
    } catch {
      /* storage unavailable */
    }
  }

  private savePrefs(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ opts: this.opts, changesOnly: this.changesOnly }));
    } catch {
      /* storage unavailable */
    }
  }

  /* ----------------------------------------------------------- events */

  private bind(): void {
    const on = (id: string, fn: (e: MouseEvent) => void) => this.host.querySelector('#' + id)!.addEventListener('click', (e) => fn(e as MouseEvent));
    on('btn-prev', () => this.step(-1));
    on('btn-next', () => this.step(1));
    on('btn-undo', () => this.undo());
    on('btn-redo', () => this.redo());
    on('btn-swap', () => this.swap());
    on('btn-new', () => this.startOver());
    on('btn-help', () => this.openHelp());
    on('btn-changes', () => this.toggleChangesOnly());
    on('btn-options', (e) => this.openOptions(e.currentTarget as HTMLElement));
    on('btn-all', (e) => this.openCopyAll(e.currentTarget as HTMLElement));

    // Stage and notice bar use delegation; the popover and dialog have their own handlers.
    this.el.root.addEventListener('click', (e) => {
      // composedPath() is fixed at dispatch time, so it still holds nodes a handler removed.
      const path = e.composedPath();
      if (path.includes(this.el.pop) || path.includes(this.el.dlg)) return;
      this.onStageClick(e);
    });
    this.el.gridEl.addEventListener('mouseover', (e) => this.onHover(e, true));
    this.el.gridEl.addEventListener('mouseout', (e) => this.onHover(e, false));
    this.el.scroller.addEventListener('scroll', () => {
      this.closePop();
      this.scheduleRuler();
    });
    const manual = () => {
      this.userScrolled = true;
    };
    this.el.scroller.addEventListener('wheel', manual, { passive: true });
    this.el.scroller.addEventListener('touchmove', manual, { passive: true });
    this.el.scroller.addEventListener('pointerdown', (e) => {
      // A press on the scroller itself (not its content) is the scrollbar.
      if (e.target === this.el.scroller) manual();
    });
    this.el.scroller.addEventListener('keydown', (e) => {
      if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) manual();
    });
    this.el.ruler.addEventListener('click', (e) => this.onRulerClick(e));
    window.addEventListener('resize', () => {
      this.closePop();
      this.scheduleRuler();
    });

    this.el.file.addEventListener('change', () => {
      const files = Array.from(this.el.file.files ?? []);
      this.el.file.value = '';
      void this.loadFiles(files, this.fileTarget);
    });

    this.el.pop.addEventListener('click', (e) => this.onPopClick(e));
    this.el.pop.addEventListener('change', (e) => this.onOptionChange(e));
    document.addEventListener('pointerdown', (e) => {
      if (this.el.pop.hidden) return;
      const t = e.target as Node;
      if (this.el.pop.contains(t) || this.popAnchor?.contains(t)) return;
      this.closePop();
    });

    this.el.dlg.addEventListener('click', (e) => this.onDialogClick(e));

    document.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('paste', (e) => this.onGlobalPaste(e));
    this.bindDrop();
  }

  private bindDrop(): void {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      this.el.overlay.hidden = false;
    });
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) this.el.overlay.hidden = true;
    });
    window.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const half = (e.target as HTMLElement).closest?.('.drop-half');
      for (const h of Array.from(this.el.overlay.children)) h.classList.toggle('hot', h === half);
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      this.el.overlay.hidden = true;
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      const half = (e.target as HTMLElement).closest?.('[data-side]') as HTMLElement | null;
      let side: Side = (half?.dataset.side as Side) ?? (e.clientX < window.innerWidth / 2 ? 'a' : 'b');
      if (this.el.dlg.open) {
        const zone = (e.target as HTMLElement).closest?.('.dropzone') as HTMLElement | null;
        if (zone?.dataset.side) side = zone.dataset.side as Side;
        this.el.dlg.close();
      }
      void this.loadFiles(files, side);
    });
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && !this.el.pop.hidden) {
      this.closePop();
      return;
    }
    if (this.el.dlg.open || isTyping(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod && !e.altKey && (k === 'z' || k === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && (k === 'y' || k === 'Y')) {
      e.preventDefault();
      this.redo();
      return;
    }
    if (mod) return;
    if (e.altKey && k === 'ArrowRight') {
      e.preventDefault();
      this.applyCurrent('l2r');
      return;
    }
    if (e.altKey && k === 'ArrowLeft') {
      e.preventDefault();
      this.applyCurrent('r2l');
      return;
    }
    if (e.altKey) return;
    switch (k) {
      case 'n':
      case 'j':
        e.preventDefault();
        this.step(1);
        break;
      case 'p':
      case 'k':
        e.preventDefault();
        this.step(-1);
        break;
      case '>':
        this.applyCurrent('l2r');
        break;
      case '<':
        this.applyCurrent('r2l');
        break;
      case 'c':
        this.toggleChangesOnly();
        break;
      case '?':
        this.openHelp();
        break;
    }
  }

  private onGlobalPaste(e: ClipboardEvent): void {
    if (this.el.dlg.open || isTyping(e)) return;
    const empty: Side | undefined = !this.a ? 'a' : !this.b ? 'b' : undefined;
    if (!empty) return;
    const html = e.clipboardData?.getData('text/html') ?? '';
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!html.trim() && !text.trim()) return;
    e.preventDefault();
    this.loadPasted(empty, html, text);
  }

  /* ------------------------------------------------------- stage clicks */

  private onStageClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const act = t.closest<HTMLElement>('button.act');
    if (act) {
      const key = act.dataset.key!;
      const dir = act.dataset.act as Dir;
      const sub = act.dataset.sub;
      const row = this.cmp?.rows.find((r) => r.key === key);
      if (!row) return;
      this.current = row.hunk;
      const sel: Selection = sub ? selectTableRow(key, sub) : selectRows([row]);
      this.apply(dir, sel, dir === 'l2r' ? 'Copied to B' : 'Copied to A');
      return;
    }
    const fold = t.closest<HTMLElement>('[data-fold]');
    if (fold) {
      this.expanded.add(fold.dataset.fold!);
      this.refresh();
      return;
    }
    const menu = t.closest<HTMLElement>('[data-menu]');
    if (menu) {
      const side = menu.dataset.side as Side;
      if (menu.dataset.menu === 'load') this.openLoadMenu(menu, side);
      else if (menu.dataset.menu === 'export') this.openExportMenu(menu, side);
      return;
    }
    const load = t.closest<HTMLElement>('[data-load]');
    if (load) {
      this.startLoad(load.dataset.load!, load.dataset.side as Side);
      return;
    }
    const cmd = t.closest<HTMLElement>('[data-cmd]');
    if (cmd) {
      this.command(cmd.dataset.cmd!);
      return;
    }
    const chg = t.closest<HTMLElement>('[data-c]');
    const rowEl = chg?.closest<HTMLElement>('.row.k-mod');
    if (chg && rowEl) {
      this.openInline(chg, rowEl.dataset.key!, Number(chg.dataset.c));
      return;
    }
    // Clicking a changed row makes it the current change.
    const anyRow = t.closest<HTMLElement>('.row[data-hunk]');
    if (anyRow && Number(anyRow.dataset.hunk) >= 0) this.setCurrent(Number(anyRow.dataset.hunk), false);
  }

  private onHover(e: MouseEvent, on: boolean): void {
    const chg = (e.target as HTMLElement).closest?.('[data-c]') as HTMLElement | null;
    if (!chg) return;
    const row = chg.closest('.row');
    if (!row) return;
    for (const el of Array.from(row.querySelectorAll(`[data-c="${chg.dataset.c}"]`))) el.classList.toggle('hot', on);
  }

  /* ----------------------------------------------------------- loading */

  private loadSamples(): void {
    this.a = { ...readHtml(SAMPLE_A, SAMPLE_A_NAME), kind: 'sample' };
    this.b = { ...readHtml(SAMPLE_B, SAMPLE_B_NAME), kind: 'sample' };
    this.sample = true;
    this.current = 0;
    this.refresh();
  }

  private snapshot(): Snapshot {
    return { a: this.a, b: this.b, edits: { ...this.edits }, sample: this.sample };
  }

  private restore(s: Snapshot): void {
    this.a = s.a;
    this.b = s.b;
    this.edits = { ...s.edits };
    this.sample = s.sample;
  }

  private pushUndo(label: string): void {
    this.undoStack.push({ ...this.snapshot(), label });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  private setDoc(side: Side, doc: Doc | null): void {
    if (side === 'a') this.a = doc;
    else this.b = doc;
  }

  private getDoc(side: Side): Doc | null {
    return side === 'a' ? this.a : this.b;
  }

  /** Installs a newly loaded document. Loading over the samples clears them. */
  private install(side: Side, doc: Doc, message: string): void {
    this.pushUndo(`Load ${SIDE_NAME[side]}`);
    if (this.sample) {
      this.setDoc(other(side), null);
      this.sample = false;
      this.edits = { a: 0, b: 0 };
    }
    this.setDoc(side, doc);
    this.edits[side] = 0;
    this.current = 0;
    this.expanded.clear();
    this.refresh();
    this.el.scroller.scrollTop = 0;
    this.toast(message, { undo: true });
  }

  private startLoad(kind: string, side: Side): void {
    this.closePop();
    if (kind === 'file') {
      this.fileTarget = side;
      this.el.file.click();
    } else if (kind === 'paste') {
      this.openPaste(side);
    } else if (kind === 'gdoc') {
      this.openGoogleDoc(side);
    }
  }

  private async loadFiles(files: File[], side: Side): Promise<void> {
    if (!files.length) return;
    const targets: Side[] = files.length > 1 ? [side, other(side)] : [side];
    for (let i = 0; i < Math.min(2, files.length); i++) {
      const file = files[i]!;
      const s = targets[i]!;
      this.busy(true, `Reading ${file.name}…`);
      try {
        await new Promise((r) => setTimeout(r, 20));
        const doc = await loadFile(file);
        if (!doc.blocks.some((b) => b.type !== 'marker' && !isBlank(b))) throw new LoadError(`"${file.name}" has no text to compare.`);
        this.install(s, doc, `Loaded “${file.name}” as ${SIDE_NAME[s]}`);
      } catch (err) {
        this.busy(false);
        if (err instanceof LoadError && err.googleDocId !== undefined) {
          this.openGoogleDoc(s, err.googleDocId);
          return;
        }
        this.toast(err instanceof Error ? err.message : String(err), { error: true });
        console.error(err);
        return;
      } finally {
        this.busy(false);
      }
    }
  }

  private loadPasted(side: Side, html: string, text: string): void {
    try {
      const { doc, source } = loadPaste(html, text);
      if (!doc.blocks.some((b) => b.type !== 'marker' && !isBlank(b))) {
        this.toast('The clipboard has no text to compare.', { error: true });
        return;
      }
      const from = source === 'google-docs' ? 'from Google Docs' : source === 'word' ? 'from Word' : source === 'text' ? 'as plain text' : '';
      this.install(side, doc, `Pasted ${from} into ${SIDE_NAME[side]}`.replace('  ', ' '));
    } catch (err) {
      this.toast(`The pasted content could not be read. ${(err as Error).message}`, { error: true });
    }
  }

  private busy(on: boolean, message = ''): void {
    this.el.root.classList.toggle('is-busy', on);
    this.el.root.dataset.busy = message;
  }

  /* -------------------------------------------------------- rendering */

  private refresh(): void {
    const { a, b } = this;
    const ready = !!a && !!b;
    this.el.root.classList.toggle('is-empty', !ready);
    this.el.empty.hidden = ready;
    this.el.scroller.hidden = !ready;
    this.el.ruler.hidden = !ready;
    this.renderNotice();
    if (!ready) {
      this.cmp = null;
      this.el.colheads.innerHTML = '';
      this.el.gridEl.innerHTML = '';
      this.renderEmpty();
      this.renderToolbar();
      return;
    }
    this.cmp = compareDocs(a!, b!, this.opts);
    const n = this.cmp.hunks.length;
    if (this.current >= n) this.current = n - 1;
    if (this.current < 0 && n) this.current = 0;
    this.renderHeads();
    this.grid.setCurrent(-1);
    this.grid.render({ cmp: this.cmp, changesOnly: this.changesOnly, expanded: this.expanded });
    this.grid.setCurrent(this.current);
    this.renderToolbar();
    this.scheduleRuler();
  }

  private renderToolbar(): void {
    const cmp = this.cmp;
    const n = cmp?.hunks.length ?? 0;
    const tb = this.el.toolbar;
    tb.classList.toggle('disabled', !cmp);
    const set = (id: string, disabled: boolean) => {
      const b = tb.querySelector<HTMLButtonElement>('#' + id);
      if (b) b.disabled = disabled;
    };
    set('btn-prev', n === 0);
    set('btn-next', n === 0);
    set('btn-all', n === 0);
    set('btn-options', !cmp);
    set('btn-changes', !cmp);
    set('btn-undo', !this.undoStack.length);
    set('btn-redo', !this.redoStack.length);
    this.host.querySelector<HTMLButtonElement>('#btn-swap')!.disabled = !this.a && !this.b;
    const ch = tb.querySelector<HTMLButtonElement>('#btn-changes')!;
    ch.setAttribute('aria-pressed', String(this.changesOnly));
    if (!cmp) {
      this.el.counter.textContent = '';
      this.el.stats.innerHTML = '';
      return;
    }
    this.el.counter.innerHTML =
      n === 0
        ? '<span class="same">No differences</span>'
        : `<span class="c-word">Change </span><b>${this.current + 1}</b><span class="c-of"> of </span><b class="c-n">${n}</b>`;
    const s = cmp.stats;
    this.el.stats.innerHTML =
      n === 0
        ? `<span class="stat ok">${icons.check}Identical text</span>`
        : `<span class="stat mod" title="Paragraphs that differ">${s.changed.toLocaleString()} changed</span>` +
          `<span class="stat del" title="Paragraphs only in A">${s.removed.toLocaleString()} only in A</span>` +
          `<span class="stat ins" title="Paragraphs only in B">${s.added.toLocaleString()} only in B</span>`;
  }

  private slotHtml(side: Side, doc: Doc): string {
    const paras = doc.blocks.filter((b) => b.type !== 'marker' && !isBlank(b)).length;
    const edits = this.edits[side];
    return `<div class="slot" data-side="${side}">
      <span class="siglum" aria-hidden="true">${SIDE_NAME[side]}</span>
      <div class="slot-main">
        <div class="slot-name" title="${esc(doc.name)}">${esc(doc.name)}</div>
        <div class="slot-meta"><span class="badge">${kindLabel(doc)}</span><span>${plural(wordCount(doc), 'word')}</span><span>${paras.toLocaleString()} ¶</span>${edits ? `<span class="edited">${plural(edits, 'edit')} applied</span>` : ''}</div>
      </div>
      <div class="slot-actions">
        <button type="button" class="btn sm" data-menu="load" data-side="${side}" aria-haspopup="true" title="Load a different document as ${SIDE_NAME[side]}">${icons.open}<span>Replace</span></button>
        <button type="button" class="btn sm${edits ? ' primary' : ''}" data-menu="export" data-side="${side}" aria-haspopup="true" title="Download or copy ${SIDE_NAME[side]}">${icons.download}<span>Export</span></button>
      </div>
    </div>`;
  }

  private renderHeads(): void {
    this.el.colheads.innerHTML = `<div class="colhead a">${this.slotHtml('a', this.a!)}</div><div class="colhead gut" aria-hidden="true"></div><div class="colhead b">${this.slotHtml('b', this.b!)}</div>`;
  }

  private renderEmpty(): void {
    const card = (side: Side) => {
      const doc = this.getDoc(side);
      const title = side === 'a' ? 'First version' : 'Second version';
      if (doc) {
        return `<section class="dropcard loaded" data-side="${side}">
          <span class="siglum big" aria-hidden="true">${SIDE_NAME[side]}</span>
          <h2>${esc(doc.name)}</h2>
          <p class="dc-meta"><span class="badge">${kindLabel(doc)}</span> ${plural(wordCount(doc), 'word')}</p>
          <div class="dc-actions"><button type="button" class="btn" data-menu="load" data-side="${side}">${icons.open}<span>Replace</span></button></div>
        </section>`;
      }
      return `<section class="dropcard" data-side="${side}">
        <span class="siglum big" aria-hidden="true">${SIDE_NAME[side]}</span>
        <h2>${title}</h2>
        <p>Drop a document here, or</p>
        <div class="dc-actions">
          <button type="button" class="btn primary" data-load="file" data-side="${side}">${icons.open}<span>Choose file</span></button>
          <button type="button" class="btn" data-load="paste" data-side="${side}">${icons.paste}<span>Paste text</span></button>
          <button type="button" class="btn" data-load="gdoc" data-side="${side}">${icons.link}<span>Google Doc</span></button>
        </div>
        <p class="hint">Word, Google Docs, PDF, OpenDocument, RTF, EPUB, HTML, Markdown, CSV or text</p>
      </section>`;
    };
    this.el.empty.innerHTML = `<div class="empty-inner">
      <div class="empty-grid">${card('a')}${card('b')}</div>
      <p class="privacy">Files are read in this browser tab. Nothing is uploaded.</p>
      <p class="hint center">Want to see how it works? <button type="button" class="linkbtn" data-cmd="samples">Load the sample drafts</button></p>
    </div>`;
  }

  private renderNotice(): void {
    const parts: string[] = [];
    if (this.sample && this.a && this.b)
      parts.push(
        `<span><b>Sample drafts.</b> Replace A and B with your own documents, or drop two files anywhere on the page.</span><button type="button" class="btn sm" data-cmd="clear">Use my own documents</button>`,
      );
    // Notes that apply to both documents are shown once.
    const notesA = this.a?.notes ?? [];
    const notesB = this.b?.notes ?? [];
    for (const n of new Set([...notesA, ...notesB])) {
      const who = notesA.includes(n) && notesB.includes(n) ? 'A and B' : notesA.includes(n) ? 'A' : 'B';
      parts.push(`<span><b>${who}:</b> ${esc(n)}</span>`);
    }
    this.el.notice.hidden = !parts.length;
    this.el.notice.innerHTML = parts.map((p) => `<div class="notice-line">${p}</div>`).join('');
  }

  /* ----------------------------------------------------------- ruler */

  private scheduleRuler(): void {
    if (this.rulerFrame) return;
    this.rulerFrame = requestAnimationFrame(() => {
      this.rulerFrame = 0;
      this.drawRuler();
    });
  }

  private drawRuler(): void {
    if (!this.cmp || this.el.ruler.hidden) return;
    const sc = this.el.scroller;
    const total = sc.scrollHeight || 1;
    const view = this.el.rulerView;
    view.style.top = `${(sc.scrollTop / total) * 100}%`;
    view.style.height = `${(sc.clientHeight / total) * 100}%`;
    const key = `${this.cmp.hunks.length}:${total}:${this.current}`;
    if (this.el.ruler.dataset.key === key) return;
    this.el.ruler.dataset.key = key;
    for (const m of Array.from(this.el.ruler.querySelectorAll('.mark'))) m.remove();
    const frag = document.createDocumentFragment();
    for (const p of this.grid.hunkPositions()) {
      const m = document.createElement('div');
      m.className = `mark m-${p.kind}${p.hunk === this.current ? ' cur' : ''}`;
      m.style.top = `${p.top * 100}%`;
      m.style.height = `max(3px, ${p.height * 100}%)`;
      m.dataset.hunk = String(p.hunk);
      frag.appendChild(m);
    }
    this.el.ruler.appendChild(frag);
  }

  private onRulerClick(e: MouseEvent): void {
    const mark = (e.target as HTMLElement).closest<HTMLElement>('.mark');
    if (mark) {
      this.setCurrent(Number(mark.dataset.hunk), true);
      return;
    }
    const r = this.el.ruler.getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    const sc = this.el.scroller;
    sc.scrollTo({ top: f * sc.scrollHeight - sc.clientHeight / 2, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  /* -------------------------------------------------------- navigation */

  private setCurrent(h: number, scroll: boolean): void {
    this.current = h;
    this.grid.setCurrent(h);
    this.renderToolbar();
    this.el.ruler.dataset.key = '';
    this.scheduleRuler();
    if (scroll) this.grid.scrollToHunk(h, !reducedMotion());
  }

  private step(delta: number): void {
    const n = this.cmp?.hunks.length ?? 0;
    if (!n) return;
    let base = this.current;
    // If the reader scrolled away by hand, continue from what is on screen.
    if (this.userScrolled && !this.hunkVisible(base)) {
      const inView = this.grid.hunkInView();
      if (inView >= 0) base = delta > 0 ? inView - 1 : inView;
    }
    const next = Math.max(0, Math.min(n - 1, base + delta));
    this.userScrolled = false;
    this.setCurrent(next, true);
  }

  private hunkVisible(h: number): boolean {
    const el = this.el.gridEl.querySelector<HTMLElement>(`.row[data-hunk="${h}"]`);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = this.el.scroller.getBoundingClientRect();
    return r.bottom > s.top && r.top < s.bottom;
  }

  /* ---------------------------------------------------------- editing */

  private apply(dir: Dir, sel: Selection, verb: string): void {
    const cmp = this.cmp;
    if (!cmp || !this.a || !this.b) return;
    const side: Side = dir === 'l2r' ? 'b' : 'a';
    const target = this.getDoc(side)!;
    const backend = target.pkg instanceof DocxPackage ? docxBackend : target.pkg instanceof OdtPackage ? odtBackend : modelBackend;
    let res;
    try {
      res = applySelection(cmp, dir, sel, backend);
    } catch (err) {
      console.error(err);
      this.toast(`That change could not be copied: ${(err as Error).message}`, { error: true });
      return;
    }
    if (!res.applied) return;
    this.pushUndo(verb);
    this.setDoc(side, res.doc);
    this.edits[side] += res.applied;
    this.refresh();
    this.toast(res.applied > 1 ? `${verb}: ${plural(res.applied, 'change')}` : verb, { undo: true });
  }

  private applyCurrent(dir: Dir): void {
    if (!this.cmp || this.current < 0 || this.current >= this.cmp.hunks.length) return;
    this.apply(dir, selectHunk(this.cmp, this.current), dir === 'l2r' ? 'Copied to B' : 'Copied to A');
  }

  private applyAll(dir: Dir): void {
    if (!this.cmp) return;
    this.apply(dir, selectAll(this.cmp), dir === 'l2r' ? 'B now matches A' : 'A now matches B');
  }

  private undo(): void {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push({ ...this.snapshot(), label: s.label });
    this.restore(s);
    this.refresh();
    this.toast(`Undid: ${s.label}`);
  }

  private redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push({ ...this.snapshot(), label: s.label });
    this.restore(s);
    this.refresh();
    this.toast(`Redid: ${s.label}`);
  }

  private swap(): void {
    if (!this.a && !this.b) return;
    this.pushUndo('Swap A and B');
    [this.a, this.b] = [this.b, this.a];
    this.edits = { a: this.edits.b, b: this.edits.a };
    this.refresh();
  }

  private startOver(): void {
    if (!this.a && !this.b) return;
    this.pushUndo('New comparison');
    this.a = null;
    this.b = null;
    this.sample = false;
    this.edits = { a: 0, b: 0 };
    this.refresh();
  }

  private toggleChangesOnly(): void {
    if (!this.cmp) return;
    this.changesOnly = !this.changesOnly;
    this.expanded.clear();
    this.savePrefs();
    this.refresh();
    if (this.current >= 0) this.grid.scrollToHunk(this.current, false);
  }

  private command(cmd: string): void {
    switch (cmd) {
      case 'samples':
        this.pushUndo('Load samples');
        this.loadSamples();
        break;
      case 'clear':
        this.startOver();
        break;
    }
  }

  /* ------------------------------------------------------------ popover */

  private openPop(anchor: HTMLElement, html: string, cls = ''): void {
    const pop = this.el.pop;
    if (!pop.hidden && this.popAnchor === anchor) {
      this.closePop();
      return;
    }
    pop.className = `pop ${cls}`;
    pop.innerHTML = html;
    pop.hidden = false;
    this.popAnchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    let left = Math.min(window.innerWidth - pw - 12, Math.max(12, r.left));
    if (anchor.closest('.colhead.b, .tgroup.edit')) left = Math.min(window.innerWidth - pw - 12, Math.max(12, r.right - pw));
    let top = r.bottom + 6;
    if (top + ph > window.innerHeight - 12) top = Math.max(12, r.top - ph - 6);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.querySelector<HTMLElement>('button, input')?.focus({ preventScroll: true });
  }

  private closePop(): void {
    if (this.el.pop.hidden) return;
    this.el.pop.hidden = true;
    this.el.pop.innerHTML = '';
    this.popAnchor?.removeAttribute('aria-expanded');
    this.popAnchor = null;
  }

  private openLoadMenu(anchor: HTMLElement, side: Side): void {
    this.openPop(
      anchor,
      `<div class="menu" role="menu" aria-label="Load ${SIDE_NAME[side]}">
        <button type="button" class="mi" role="menuitem" data-load="file" data-side="${side}">${icons.open}<span>Open a file…</span><small>Word, PDF, OpenDocument, RTF, EPUB, HTML, Markdown, CSV, text</small></button>
        <button type="button" class="mi" role="menuitem" data-load="paste" data-side="${side}">${icons.paste}<span>Paste from Google Docs or Word…</span></button>
        <button type="button" class="mi" role="menuitem" data-load="gdoc" data-side="${side}">${icons.link}<span>Google Docs link…</span></button>
      </div>`,
    );
  }

  private openExportMenu(anchor: HTMLElement, side: Side): void {
    const doc = this.getDoc(side);
    if (!doc) return;
    const viewer = inViewer();
    const item = (f: ExportFormat, first: boolean) => {
      const zipped = viewer && !VIEWER_EXTENSIONS.has(f.ext);
      const hint = zipped ? 'Saved inside a .zip here (this viewer only saves some file types)' : (f.hint ?? '');
      return `<button type="button" class="mi" role="menuitem" data-export="${f.id}" data-side="${side}">${first ? icons.download : icons.doc}<span>${esc(f.label)} <span class="ext">.${f.ext}${zipped ? '.zip' : ''}</span></span>${hint ? `<small>${esc(hint)}</small>` : ''}</button>`;
    };
    const [own, ...rest] = exportFormats(doc);
    this.openPop(
      anchor,
      `<div class="menu" role="menu" aria-label="Export ${SIDE_NAME[side]}">
        <div class="menu-title">${SIDE_NAME[side]}: ${esc(doc.name)}</div>
        ${item(own!, true)}
        <button type="button" class="mi" role="menuitem" data-export="copy" data-side="${side}">${icons.copy}<span>Copy formatted text</span><small>Paste into Google Docs or Word</small></button>
        ${hostedInViewer() ? '' : `<button type="button" class="mi" role="menuitem" data-export="print" data-side="${side}">${icons.print}<span>Print…</span></button>`}
        <div class="menu-sep"></div>
        <div class="menu-title">Download as</div>
        ${rest.map((f) => item(f, false)).join('')}
      </div>`,
    );
  }

  private openCopyAll(anchor: HTMLElement): void {
    if (!this.cmp) return;
    const cur = this.current >= 0 && this.current < this.cmp.hunks.length;
    this.openPop(
      anchor,
      `<div class="menu" role="menu" aria-label="Copy changes">
        ${cur ? `<div class="menu-title">Change ${this.current + 1}</div>
        <button type="button" class="mi" role="menuitem" data-apply="cur-l2r">${icons.toB}<span>Use A’s version in B</span><kbd>Alt+→</kbd></button>
        <button type="button" class="mi" role="menuitem" data-apply="cur-r2l">${icons.toA}<span>Use B’s version in A</span><kbd>Alt+←</kbd></button>
        <div class="menu-sep"></div>` : ''}
        <div class="menu-title">All ${plural(this.cmp.hunks.length, 'change')}</div>
        <button type="button" class="mi" role="menuitem" data-apply="all-l2r">${icons.toB}<span>Make B match A</span></button>
        <button type="button" class="mi" role="menuitem" data-apply="all-r2l">${icons.toA}<span>Make A match B</span></button>
      </div>`,
    );
  }

  private openOptions(anchor: HTMLElement): void {
    const o = this.opts;
    const box = (key: keyof CompareOptions, label: string, hint = '') =>
      `<label class="opt"><input type="checkbox" data-opt="${key}"${o[key] ? ' checked' : ''}><span>${label}${hint ? `<small>${hint}</small>` : ''}</span></label>`;
    this.openPop(
      anchor,
      `<div class="menu options" role="dialog" aria-label="Comparison options">
        <div class="menu-title">Compare</div>
        <label class="opt"><input type="radio" name="gran" value="word"${o.granularity === 'word' ? ' checked' : ''}><span>Word by word</span></label>
        <label class="opt"><input type="radio" name="gran" value="char"${o.granularity === 'char' ? ' checked' : ''}><span>Character by character<small>Shows single-letter edits</small></span></label>
        <div class="menu-sep"></div>
        <div class="menu-title">Ignore</div>
        ${box('ignoreEmpty', 'Empty paragraphs')}
        ${box('ignoreFormatting', 'Formatting', 'Bold, italic, underline, links and alignment')}
        ${box('ignoreCase', 'Upper and lower case')}
        ${box('ignoreWhitespace', 'Extra spaces')}
        ${box('normalizePunctuation', 'Quote and dash styles', 'Treats “curly” and "straight" quotes alike')}
      </div>`,
      'wide',
    );
  }

  private onOptionChange(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (t.name === 'gran') this.opts = { ...this.opts, granularity: t.value as 'word' | 'char' };
    else if (t.dataset.opt) this.opts = { ...this.opts, [t.dataset.opt]: t.checked };
    else return;
    this.savePrefs();
    this.refresh();
  }

  private openInline(anchor: HTMLElement, rowKey: string, change: number): void {
    const row = this.cmp?.rows.find((r) => r.key === rowKey);
    if (!row || row.l?.type !== 'p' || row.r?.type !== 'p') return;
    const d = inlineDiff(row.l, row.r, this.opts);
    const ch = d.changes[change];
    if (!ch) return;
    const text = (t: typeof d.a, c0: number, c1: number) => {
      const [f0, f1] = fullRange(t, c0, c1);
      return t.tokens
        .slice(f0, f1)
        .map((x) => x.text)
        .join('')
        .trim();
    };
    const ta = text(d.a, ch.a0, ch.a1);
    const tb = text(d.b, ch.b0, ch.b1);
    const show = (s: string, side: 'A' | 'B') => (s ? esc(s.length > 80 ? s.slice(0, 77) + '…' : s) : `<em>nothing in ${side}</em>`);
    this.openPop(
      anchor,
      `<div class="menu inline-pop" role="dialog" aria-label="Word-level change">
        <div class="chg-preview"><div><span class="siglum sm">A</span><del>${show(ta, 'A')}</del></div><div><span class="siglum sm">B</span><ins>${show(tb, 'B')}</ins></div></div>
        ${ch.fmtOnly ? '<div class="menu-note">Same words, different formatting.</div>' : ''}
        <button type="button" class="mi" data-inline="l2r" data-key="${esc(rowKey)}" data-c="${change}">${icons.toB}<span>Use A’s wording in B</span></button>
        <button type="button" class="mi" data-inline="r2l" data-key="${esc(rowKey)}" data-c="${change}">${icons.toA}<span>Use B’s wording in A</span></button>
      </div>`,
      'inline',
    );
  }

  private onPopClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    const load = t.closest<HTMLElement>('[data-load]');
    if (load) {
      this.startLoad(load.dataset.load!, load.dataset.side as Side);
      return;
    }
    const exp = t.closest<HTMLElement>('[data-export]');
    if (exp) {
      this.closePop();
      void this.export(exp.dataset.export!, exp.dataset.side as Side);
      return;
    }
    const ap = t.closest<HTMLElement>('[data-apply]');
    if (ap) {
      this.closePop();
      const [scope, dir] = ap.dataset.apply!.split('-') as ['cur' | 'all', Dir];
      if (scope === 'cur') this.applyCurrent(dir);
      else this.applyAll(dir);
      return;
    }
    const inl = t.closest<HTMLElement>('[data-inline]');
    if (inl) {
      this.closePop();
      const key = inl.dataset.key!;
      const row = this.cmp?.rows.find((r) => r.key === key);
      if (row) this.current = row.hunk;
      const dir = inl.dataset.inline as Dir;
      this.apply(dir, selectInline(key, Number(inl.dataset.c)), dir === 'l2r' ? 'Copied wording to B' : 'Copied wording to A');
    }
  }

  /* ------------------------------------------------------------ export */

  private async export(format: string, side: Side): Promise<void> {
    const doc = this.getDoc(side);
    if (!doc) return;
    const base = baseName(doc) + (this.edits[side] ? ' (merged)' : '');
    try {
      if (format === 'copy') {
        const html = `<meta charset="utf-8">${blocksToHtml(doc.blocks)}`;
        const res = await copyRich(html, docToText(doc));
        if (res === 'rich') this.toast(`Copied ${SIDE_NAME[side]} with formatting. Paste it into Google Docs or Word.`);
        else if (res === 'plain') this.toast(`Copied ${SIDE_NAME[side]} as plain text (this browser blocked formatted copying).`);
        else this.toast('The clipboard is not available here. Use Download instead.', { error: true });
        return;
      }
      if (format === 'print') {
        this.print(doc, base);
        return;
      }
      const fmt = exportFormats(doc).find((f) => f.id === format);
      if (!fmt) return;
      let name = `${base}.${fmt.ext}`;
      if (fmt.id === 'pdf') this.busy(true, 'Making the PDF…');
      let out: Uint8Array | string;
      try {
        out = await fmt.build(doc);
      } finally {
        this.busy(false);
      }
      let blob = new Blob([out as BlobPart], { type: fmt.mime });
      if ((await viewerReady()) && !VIEWER_EXTENSIONS.has(fmt.ext)) {
        // This viewer only saves some file types; the file travels inside a zip.
        const bytes = typeof out === 'string' ? new TextEncoder().encode(out) : out;
        blob = new Blob([zipSync({ [name]: [bytes, { level: 6 }] }) as BlobPart], { type: 'application/zip' });
        name += '.zip';
      }
      const res = await saveFile(name, blob);
      if (res === 'saved') this.toast(`Downloaded “${name}”`);
      else if (res === 'unsupported') this.toast(`This viewer can’t save .${name.split('.').pop()} files. Choose another format.`, { error: true });
      else if (res === 'busy') this.toast('A save is already waiting for your answer.', { error: true });
      else if (res === 'failed') this.toast('The file could not be saved from this page.', { error: true });
    } catch (err) {
      console.error(err);
      this.toast(`Export failed: ${(err as Error).message}`, { error: true });
    }
  }

  /** Prints one document on its own (the print dialog can also save it as PDF). */
  private print(doc: Doc, title: string): void {
    const root = document.createElement('div');
    root.id = 'print-root';
    root.innerHTML = `<article class="print-doc">${blocksToHtml(doc.blocks)}</article>`;
    document.body.appendChild(root);
    const oldTitle = document.title;
    document.title = title;
    document.documentElement.classList.add('printing');
    let opened = false;
    const before = () => {
      opened = true;
    };
    const cleanup = () => {
      root.remove();
      document.title = oldTitle;
      document.documentElement.classList.remove('printing');
      window.removeEventListener('beforeprint', before);
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', cleanup, { once: true });
    try {
      window.print();
    } catch {
      /* blocked */
    }
    // A page shown inside a viewer may not be allowed to open the print dialog.
    setTimeout(() => {
      if (opened) return;
      cleanup();
      this.toast('Printing isn’t available here. Download the document as PDF instead.', { error: true });
    }, 400);
  }

  /* ----------------------------------------------------------- dialogs */

  private openDialog(html: string, cls = ''): void {
    this.closePop();
    const d = this.el.dlg;
    if (d.open) d.close();
    d.className = `dlg ${cls}`;
    d.innerHTML = `<button type="button" class="dlg-x btn ghost icon-only" data-close aria-label="Close">${icons.close}</button>${html}`;
    d.showModal();
  }

  private onDialogClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    if (t === this.el.dlg || t.closest('[data-close]')) {
      this.el.dlg.close();
      return;
    }
    const load = t.closest<HTMLElement>('[data-load]');
    if (load) {
      this.el.dlg.close();
      this.startLoad(load.dataset.load!, load.dataset.side as Side);
    }
  }

  private openPaste(side: Side): void {
    this.openDialog(
      `<h2>Paste into ${SIDE_NAME[side]}</h2>
      <p>In Google Docs or Word, select the whole document (<kbd>Ctrl</kbd>+<kbd>A</kbd>, or <kbd>⌘</kbd>+<kbd>A</kbd> on a Mac) and copy it. Then paste it into the box below. Headings, lists, tables, bold, italic and links are kept.</p>
      <div class="pastebox" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Paste area" data-side="${side}"></div>
      <p class="hint">To keep page layout, headers and styles when you export, load a .docx file instead.</p>`,
      'paste',
    );
    const box = this.el.dlg.querySelector<HTMLElement>('.pastebox')!;
    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const html = e.clipboardData?.getData('text/html') ?? '';
      const text = e.clipboardData?.getData('text/plain') ?? '';
      this.el.dlg.close();
      this.loadPasted(side, html, text);
    });
    // Browsers that insert the content without a usable paste event.
    box.addEventListener('input', () => {
      const html = box.innerHTML;
      const text = box.innerText;
      if (!text.trim()) return;
      this.el.dlg.close();
      this.loadPasted(side, html, text);
    });
    box.focus();
  }

  private openGoogleDoc(side: Side, presetId?: string): void {
    this.openDialog(
      `<h2>Load a Google Doc as ${SIDE_NAME[side]}</h2>
      <p>Browsers don’t let other sites read Google Docs directly, so this takes two quick steps. Private documents work too, because the download uses your own Google sign-in.</p>
      <label class="form-field"><span>Google Docs link</span><input id="gd-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://docs.google.com/document/d/…" value="${presetId ? `https://docs.google.com/document/d/${esc(presetId)}/edit` : ''}"></label>
      <ol class="steps">
        <li><span class="step-n">1</span><div><a id="gd-dl" class="btn primary" target="_blank" rel="noopener noreferrer" aria-disabled="true">${icons.download}<span>Download it as Word (.docx)</span></a><p class="hint" id="gd-hint">Paste the link above first.</p></div></li>
        <li><span class="step-n">2</span><div class="dropzone" data-side="${side}"><span>Drop the downloaded file here, or</span> <button type="button" class="btn sm" data-load="file" data-side="${side}">${icons.open}<span>choose it</span></button></div></li>
      </ol>
      <p class="hint">Or open the document, copy all of it, and use <button type="button" class="linkbtn" data-load="paste" data-side="${side}">Paste text</button> instead.</p>`,
      'gdoc',
    );
    const input = this.el.dlg.querySelector<HTMLInputElement>('#gd-url')!;
    const link = this.el.dlg.querySelector<HTMLAnchorElement>('#gd-dl')!;
    const hint = this.el.dlg.querySelector<HTMLElement>('#gd-hint')!;
    const update = () => {
      const id = googleDocId(input.value);
      if (id) {
        link.href = `https://docs.google.com/document/d/${id}/export?format=docx`;
        link.removeAttribute('aria-disabled');
        hint.textContent = 'Opens a new tab; your browser saves the .docx file.';
      } else {
        link.removeAttribute('href');
        link.setAttribute('aria-disabled', 'true');
        hint.textContent = input.value.trim() ? 'That doesn’t look like a Google Docs link.' : 'Paste the link above first.';
      }
    };
    input.addEventListener('input', update);
    update();
    if (!presetId) input.focus();
  }

  private openHelp(): void {
    this.openDialog(
      `<h2>How Collate works</h2>
      <div class="help-cols">
        <section>
          <h3>Compare</h3>
          <p>Load two versions of a document as <b>A</b> and <b>B</b>. Paragraphs are lined up side by side. Words only in A are marked in red, words only in B in green; a caret marks where the other side has extra text.</p>
          <h3>Copy changes</h3>
          <p>Use the arrows between the columns to copy a paragraph across: <span class="k">${icons.toB}</span> makes B use A’s version, <span class="k">${icons.toA}</span> makes A use B’s version. Click a highlighted word to copy just that edit. Tables can be copied row by row.</p>
          <h3>Get the result</h3>
          <p><b>Export</b> saves a document in its own format first. Word (.docx) and OpenDocument (.odt) files keep their own styles, headers, footers and page setup, with only the copied paragraphs changed. Any document can also be saved as Word, PDF, OpenDocument, RTF, a web page, Markdown or plain text. A PDF is laid out afresh on A4 pages; saving the first one loads the PDF maker, which needs an internet connection.</p>
          <p>For Google Docs, either upload the .docx to Drive and open it with Google Docs, or use <b>Copy formatted text</b> and paste over the document’s contents.</p>
          <h3>File types</h3>
          <p>Word (.docx and older .doc), Google Docs, PDF, OpenDocument (.odt), RTF, EPUB, web pages, Markdown, CSV and plain text files, including code and data. PDFs, EPUBs and .doc files can be compared and copied from. A PDF is saved as a new PDF (or in another format); EPUB and .doc files are saved in another format.</p>
        </section>
        <section>
          <h3>Keyboard</h3>
          <dl class="keys">
            <dt><kbd>N</kbd> / <kbd>P</kbd></dt><dd>Next / previous change</dd>
            <dt><kbd>Alt</kbd>+<kbd>→</kbd></dt><dd>Use A’s version in B</dd>
            <dt><kbd>Alt</kbd>+<kbd>←</kbd></dt><dd>Use B’s version in A</dd>
            <dt><kbd>Ctrl</kbd>+<kbd>Z</kbd></dt><dd>Undo</dd>
            <dt><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd></dt><dd>Redo</dd>
            <dt><kbd>C</kbd></dt><dd>Show changes only</dd>
            <dt><kbd>?</kbd></dt><dd>This help</dd>
          </dl>
          <h3>What is compared</h3>
          <p>The text of the document body: paragraphs, headings, lists, tables, links, images, footnote text and basic formatting. Headers, footers and comments are left as they are. A PDF stores laid-out text rather than paragraphs, so Collate rebuilds them; its pictures and page numbers can’t be matched to another format’s.</p>
          <h3>Privacy</h3>
          <p>Documents are read and written inside this browser tab. Nothing is uploaded. The first PDF you open or save may download a PDF library; your document stays here.</p>
        </section>
      </div>`,
      'help',
    );
  }

  /* ------------------------------------------------------------ toasts */

  private toast(message: string, opts: { undo?: boolean; error?: boolean } = {}): void {
    const t = document.createElement('div');
    t.className = `toast${opts.error ? ' error' : ''}`;
    t.setAttribute('role', opts.error ? 'alert' : 'status');
    t.innerHTML = `<span>${esc(message)}</span>`;
    if (opts.undo) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'linkbtn';
      b.textContent = 'Undo';
      b.addEventListener('click', () => {
        this.undo();
        t.remove();
      });
      t.appendChild(b);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-x';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML = icons.close;
    close.addEventListener('click', () => t.remove());
    t.appendChild(close);
    this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstElementChild!.remove();
    setTimeout(() => t.remove(), opts.error ? 9000 : 4500);
  }
}
