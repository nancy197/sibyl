import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryLine } from '../src/brain/schema.js';
import { councilRight, weighEvidence, type Situation } from '../src/brain/recall.js';

const now: Situation = {
  eventId: 'now',
  horizon: '5m',
  marketVoice: 'deepbook',
  market: 0.5,
  signal: 0.58,
  gap: 0.08,
  description:
    '5m BTC, low volatility, asia session: council far above the market; market near a coin flip',
};
const episode = (id: string, horizon: string, gap: number, right: boolean | null) =>
  memoryLine(`EPISODE ${id}`, {
    kind: 'episode',
    eventId: id,
    horizon,
    situation: { description: '', gap, councilRight: right },
  });

test('council is right when the outcome lands on its side of the market', () => {
  assert.equal(councilRight(0.08, 1), true);
  assert.equal(councilRight(-0.08, 1), false);
  assert.equal(councilRight(0.01, 1), null);
});

test('recall counts only comparable episodes and moves the threshold within bounds', () => {
  const good = Array.from({ length: 8 }, (_, i) => episode(`e${i}`, '5m', 0.07, i < 7));
  const noise = [
    episode('x1', '15m', 0.07, false),
    episode('x2', '5m', -0.07, false),
    episode('now', '5m', 0.07, false),
    'not a memory',
  ];
  const evidence = weighEvidence(now, [...noise, ...good]);
  assert.equal(evidence.recalled, 8);
  assert.equal(evidence.hits, 7);
  assert.ok(evidence.adjustment < 0 && evidence.adjustment >= -0.02);

  const bad = Array.from({ length: 8 }, (_, i) => episode(`b${i}`, '5m', 0.07, i < 1));
  assert.ok(weighEvidence(now, bad).adjustment > 0);
  assert.equal(weighEvidence(now, good.slice(0, 3)).adjustment, 0); // too few to count
});
