import type { Issue } from '../check/check';
import type { Lang } from '../check/spell';
import { LANG_NAME } from '../check/spell';
import { Ico } from '../components/icons';
import { Segmented } from '../components/ui/segmented';
import type { Side } from './util';
import { SIDE_NAME, plural } from './util';

/** Claude's part of checking, as the menu shows it. */
export interface ClaudeState {
  /** The reader turned it on. */
  enabled: boolean;
  /** This page can ask Claude (null while that is not known yet). */
  available: boolean | null;
  /** A check under way. */
  run: { side: Side; done: number; total: number } | null;
}

interface CheckMenuProps {
  lang: Lang;
  /** Findings in each document, or null while the dictionary loads. */
  counts: Record<Side, number> | null;
  claude: ClaudeState;
  /** Words in the reader's own dictionary. */
  words: number;
  onLang(lang: Lang): void;
  onClaude(on: boolean): void;
  onClaudeCheck(side: Side): void;
  onStop(): void;
  onNext(): void;
  onClearWords(): void;
}

/** Checking's options: the language, Claude, and the reader's own dictionary. */
export function CheckMenu({ lang, counts, claude, words, onLang, onClaude, onClaudeCheck, onStop, onNext, onClearWords }: CheckMenuProps) {
  const total = counts ? counts.a + counts.b : 0;
  return (
    <div className="menu check-menu" role="menu" aria-label="Spelling and grammar">
      <div className="menu-title">Spelling and grammar</div>
      <div className="cm-status" role="status">
        {counts === null ? 'Loading the dictionary…' : total ? `${plural(counts.a, 'issue')} in A, ${plural(counts.b, 'issue')} in B` : 'No issues found'}
        {total > 0 && (
          <button type="button" className="btn ghost sm" data-check="next" onClick={onNext}>
            Next issue
          </button>
        )}
      </div>
      <Segmented
        className="text cm-lang"
        label="Language"
        value={lang}
        onChange={onLang}
        segments={(Object.keys(LANG_NAME) as Lang[]).map((l) => ({ value: l, content: LANG_NAME[l], attrs: { 'data-lang': l } }))}
      />
      <div className="menu-sep" />
      <div className="menu-title">Claude</div>
      <label className={`cm-switch${claude.available === false ? ' off' : ''}`}>
        <input type="checkbox" role="switch" data-check="claude" checked={claude.enabled} disabled={claude.available === false} onChange={(e) => onClaude(e.currentTarget.checked)} />
        <span>
          Ask Claude for grammar and style suggestions
          <small>
            {claude.available === false
              ? 'Available when Collate runs in the Claude app.'
              : 'Sends the paragraphs you choose to Claude, only when you ask. Your own Claude usage applies.'}
          </small>
        </span>
      </label>
      {claude.enabled && claude.available && (
        <div className="cm-claude">
          {claude.run ? (
            <>
              <span className="cm-progress">
                Checking {SIDE_NAME[claude.run.side]}…{claude.run.total > 1 ? ` ${claude.run.done} of ${claude.run.total}` : ''}
              </span>
              <button type="button" className="btn sm" data-check="stop" onClick={onStop}>
                Stop
              </button>
            </>
          ) : (
            (['a', 'b'] as const).map((side) => (
              <button key={side} type="button" className="btn sm" data-check={`claude-${side}`} onClick={() => onClaudeCheck(side)}>
                <Ico name="spell" />
                <span>Check {SIDE_NAME[side]} with Claude</span>
              </button>
            ))
          )}
        </div>
      )}
      <div className="menu-sep" />
      <div className="cm-words">
        <span>{words ? `${plural(words, 'word')} in your dictionary` : 'Words you add to the dictionary are kept in this browser.'}</span>
        {words > 0 && (
          <button type="button" className="btn ghost sm" data-check="clear-words" onClick={onClearWords}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

interface IssueCardProps {
  issue: Issue;
  side: Side;
  suggestions: string[];
  /** The paragraph can be changed here (not a paragraph inside a table). */
  editable: boolean;
  /** Claude can be asked about the paragraph. */
  canAsk: boolean;
  asking: boolean;
  onFix(replacement: string): void;
  onIgnore(): void;
  onAddWord(): void;
  onAsk(): void;
}

const show = (s: string) => (s === ' ' ? 'one space' : s || 'remove');

/** A finding, from a click on its underlined words: what is wrong, and what to write instead. */
export function IssueCard({ issue, side, suggestions, editable, canAsk, asking, onFix, onIgnore, onAddWord, onAsk }: IssueCardProps) {
  const kind = issue.source === 'claude' ? 'Claude' : issue.kind === 'spelling' ? 'Spelling' : issue.kind === 'contract' ? 'Contract check' : 'Grammar';
  return (
    <div className="issue-card" role="dialog" aria-label={`${kind}: ${issue.message}`} id="issue-card">
      <div className="ic-head">
        <span className={`ic-kind ${issue.source === 'claude' ? 'claude' : issue.kind}`}>{kind}</span>
        <span className="ic-where">in {SIDE_NAME[side]}</span>
      </div>
      <p className="ic-message">
        {issue.kind === 'spelling' ? (
          <>
            “{issue.text}” isn’t in the dictionary.
          </>
        ) : (
          issue.message
        )}
      </p>
      {suggestions.length > 0 ? (
        <div className="ic-sugs" role="group" aria-label="Suggestions">
          {suggestions.map((s) => (
            <button key={s} type="button" className="ic-sug" data-fix={s} disabled={!editable} onClick={() => onFix(s)}>
              {show(s)}
            </button>
          ))}
        </div>
      ) : (
        <p className="ic-none">No suggestions.</p>
      )}
      {!editable && <p className="ic-note">This text is inside a table, where it can’t be changed here. Correct it in the file itself.</p>}
      <div className="ic-actions">
        <button type="button" className="btn ghost sm" data-issue="ignore" onClick={onIgnore}>
          {issue.kind === 'spelling' ? 'Ignore all' : 'Ignore'}
        </button>
        {issue.kind === 'spelling' && (
          <button type="button" className="btn ghost sm" data-issue="add" onClick={onAddWord}>
            Add to dictionary
          </button>
        )}
        {canAsk && issue.source !== 'claude' && (
          <button type="button" className="btn ghost sm" data-issue="ask" disabled={asking} onClick={onAsk}>
            {asking ? 'Asking Claude…' : 'Ask Claude'}
          </button>
        )}
      </div>
    </div>
  );
}
