import { describe, expect, it } from 'vitest';
import { blockText } from '../../src/core/model';
import { DEFAULT_OPTIONS } from '../../src/core/tokens';
import { orderVersions, paragraphHistory } from '../../src/core/versions';
import { readPlainText } from '../../src/formats/text/plain';

const v = (name: string, text: string) => readPlainText(text, name);

describe('versions', () => {
  it('orders drafts by their names, numbers as numbers', () => {
    expect(orderVersions([{ name: 'draft v10.docx' }, { name: 'draft v2.docx' }, { name: 'draft v1.docx' }]).map((d) => d.name)).toEqual([
      'draft v1.docx',
      'draft v2.docx',
      'draft v10.docx',
    ]);
  });

  it('follows one paragraph through every version', () => {
    const versions = [
      v('v1.txt', 'Title.\n\nEnd.\n'),
      v('v2.txt', 'Title.\n\nPayment is due in 30 days.\n\nEnd.\n'),
      v('v3.txt', 'Title.\n\nPayment is due in 30 days.\n\nEnd.\n'),
      v('v4.txt', 'Title.\n\nPayment is due in 45 days.\n\nEnd.\n'),
      v('v5.txt', 'Title.\n\nEnd.\n'),
    ];
    const at = 3;
    const block = versions[at]!.blocks.find((b) => blockText(b).startsWith('Payment'))!;
    const steps = paragraphHistory(versions, at, block, DEFAULT_OPTIONS);
    expect(steps.map((s) => (s.block ? blockText(s.block) : null))).toEqual([null, 'Payment is due in 30 days.', 'Payment is due in 30 days.', 'Payment is due in 45 days.', null]);
    expect(steps.map((s) => s.same)).toEqual([false, false, true, false, false]);
  });
});
