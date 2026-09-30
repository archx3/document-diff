'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import content from './content.module.css';
import { Icon } from './icons';

export interface Question {
  q: string;
  a: ReactNode;
  /** More words to find it by, besides the question. */
  keys?: string;
}

/** The questions, in groups, with a box that narrows them down as you type. */
export function HelpSearch({ groups }: { groups: Array<{ title: string; items: Question[] }> }) {
  const [query, setQuery] = useState('');
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (item: Question) => words.every((w) => `${item.q} ${item.keys ?? ''}`.toLowerCase().includes(w));
  const shown = groups.map((g) => ({ ...g, items: g.items.filter(match) })).filter((g) => g.items.length);

  return (
    <>
      <label className={content.search}>
        <Icon name="help" size={18} />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the help, e.g. “Google Docs” or “PDF”" aria-label="Search the help" />
      </label>
      <div id="questions" style={{ marginTop: 40, textAlign: 'left' }}>
        {shown.map((g) => (
          <div key={g.title} className={content.faqGroup}>
            <h3>{g.title}</h3>
            <div className={content.faq}>
              {g.items.map((item) => (
                <details key={item.q} open={words.length > 0 && g.items.length <= 3}>
                  <summary>{item.q}</summary>
                  <div className={content.answer}>{item.a}</div>
                </details>
              ))}
            </div>
          </div>
        ))}
        {!shown.length && <p className={content.empty}>Nothing matches “{query}”. Try fewer words, or look through the guides.</p>}
      </div>
    </>
  );
}
