import { describe, expect, it } from 'vitest';
import { newMediaNote, normalize, notesOf, readMediaNotes, swapMediaNotes } from '../../src/review/media-notes';

describe('notes on pictures and recordings', () => {
  it('keeps an area inside the picture, the right way round', () => {
    expect(normalize({ type: 'box', x: 0.8, y: 0.5, w: -0.3, h: 0.9 })).toEqual({ type: 'box', x: 0.5, y: 0.5, w: 0.30000000000000004, h: 0.5 });
    expect(normalize({ type: 'time', start: 4, end: 1.5 })).toEqual({ type: 'time', start: 1.5, end: 4 });
  });

  it('reads back what it wrote, and leaves out what it can’t read', () => {
    const a = { ...newMediaNote('a', { type: 'time', start: 1, end: 2 }, 'Ama'), text: 'Too quiet', color: 'pink' as const };
    const b = { ...newMediaNote('b', { type: 'box', x: 0.1, y: 0.1, w: 0.2, h: 0.2 }), text: 'New logo' };
    const back = readMediaNotes(JSON.parse(JSON.stringify([a, b, { id: 'x', side: 'c' }, null, { ...b, at: { type: 'box', x: 'no' } }])));
    expect(back).toEqual([a, b]);
    expect(readMediaNotes('nonsense')).toEqual([]);
  });

  it('sorts each kind by when it was made, and swaps sides with A and B', () => {
    const one = { ...newMediaNote('a', { type: 'time', start: 3, end: 3 }), created: 2 };
    const two = { ...newMediaNote('b', { type: 'time', start: 1, end: 2 }), created: 1 };
    const pic = newMediaNote('a', { type: 'box', x: 0, y: 0, w: 0, h: 0 });
    expect(notesOf([one, pic, two], 'time').map((n) => n.id)).toEqual([two.id, one.id]);
    expect(swapMediaNotes([one, two]).map((n) => n.side)).toEqual(['b', 'a']);
  });
});
