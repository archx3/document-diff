/**
 * Long recordings of real (synthesised) speech for the stress tests, which
 * don't repeat themselves: a talk of varied sentences, said by the system's
 * voice (macOS `say`), and a second take with 8% of sentences reworded, 3%
 * left out and 3% added. What was changed is written beside them, so the
 * comparison's accuracy can be checked, not only its speed.
 *
 * Run: node scripts/stress/make-speech.mjs [minutes …]   (default: 10 30 60)
 * Writes tests/fixtures/out/stress/speech-<minutes>m-a.wav, -b.wav and speech-<minutes>m.json.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'out', 'stress');
const WHO = ['The committee', 'Our finance team', 'The new manager', 'Each regional office', 'The board', 'Every supplier', 'The research group', 'Our largest client', 'The support desk', 'The city council'];
const DID = ['approved', 'reviewed', 'questioned', 'delayed', 'announced', 'rejected', 'published', 'funded', 'extended', 'simplified'];
const WHAT = ['the budget for the library', 'a plan to hire engineers', 'the quarterly sales report', 'a contract with the printers', 'the rules for remote work', 'the price of the annual licence', 'a survey of our customers', 'the schedule for the new bridge', 'the design of the website', 'a review of the delivery times'];
const WHEN = ['on Tuesday', 'last month', 'before the summer', 'after a long debate', 'without any warning', 'in the spring', 'at the end of the year', 'during the meeting', 'earlier this week', 'for the third time'];
const WHY = ['because costs were rising', 'so that work could start sooner', 'to answer the complaints', 'after the numbers improved', 'while the talks went on', 'as the lawyers had advised', 'to keep the project on time', 'since nobody objected', 'because the old one had failed', 'to save money next year'];

function random(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Sentences for about `minutes` of speech (the voice says about 11 a minute). */
function talk(minutes, rnd) {
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  return Array.from({ length: Math.round(minutes * 11) }, () => `${pick(WHO)} ${pick(DID)} ${pick(WHAT)} ${pick(WHEN)}, ${pick(WHY)}.`);
}

function say(sentences, path) {
  const text = `${path}.txt`;
  writeFileSync(text, sentences.join('\n'));
  execFileSync('say', ['-r', '175', '-o', path, '--file-format=WAVE', '--data-format=LEI16@22050', '-f', text]);
}

mkdirSync(OUT, { recursive: true });
const minutes = process.argv.slice(2).map(Number);
for (const m of minutes.length ? minutes : [10, 30, 60]) {
  const rnd = random(m * 7919);
  const a = talk(m, rnd);
  const b = [];
  const changes = { reworded: 0, removed: 0, added: 0 };
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  for (const s of a) {
    const r = rnd();
    if (r < 0.03) {
      changes.removed++;
      continue;
    }
    if (r < 0.11) {
      // Another subject and verb: the same length, said differently.
      const words = s.split(' ');
      b.push(`${pick(WHO)} ${pick(DID)} ${words.slice(words.length > 12 ? 3 : 2).join(' ')}`);
      changes.reworded++;
    } else b.push(s);
    if (rnd() < 0.03) {
      b.push(`${pick(WHO)} ${pick(DID)} ${pick(WHAT)} ${pick(WHEN)}, ${pick(WHY)}.`);
      changes.added++;
    }
  }
  const stem = join(OUT, `speech-${m}m`);
  const t0 = Date.now();
  say(a, `${stem}-a.wav`);
  say(b, `${stem}-b.wav`);
  writeFileSync(`${stem}.json`, JSON.stringify({ minutes: m, sentences: [a.length, b.length], ...changes }, null, 1));
  console.log(`${m} min: ${a.length} sentences; ${JSON.stringify(changes)} (said in ${Math.round((Date.now() - t0) / 1000)} s)`);
}
