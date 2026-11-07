import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calibrationError,
  nextStatus,
  testBeats,
  testBias,
  testOverconfidence,
} from '../src/brain/lessons.js';

/** Deterministic pseudo-random outcomes so the tests are stable. */
const outcomes = Array.from({ length: 200 }, (_, i) => ((i * 7919) % 13 < 6 ? 1 : 0));

test('a clearly better voice wins the paired test; small samples are never tested', () => {
  const data = outcomes.flatMap((y, i) => [
    {
      event_id: `e${i}`,
      voice: 'sharp',
      p: y ? 0.7 : 0.3,
      outcome: y,
      brier: (y ? 0.3 : 0.3) ** 2,
    },
    { event_id: `e${i}`, voice: 'dull', p: 0.5, outcome: y, brier: 0.25 },
  ]);
  const result = testBeats('5m/mid/us', 'dull', 'sharp', data, 10)!;
  assert.equal(result.voice, 'dull');
  assert.ok(result.significant);
  assert.equal(testBeats('5m/mid/us', 'dull', 'sharp', data.slice(0, 20), 10), null);
});

test('bias and overconfidence are detected', () => {
  const biased = outcomes.map((y) => ({ event_id: '', voice: 'v', p: 0.65, outcome: y, brier: 0 }));
  assert.ok(testBias('c', 'v', biased, 1)!.effect > 0.1);
  const overconfident = outcomes.map((y, i) => ({ p: i % 2 ? 0.95 : 0.05, outcome: y }));
  const result = testOverconfidence('c', 'v', overconfident, 1)!;
  assert.ok(result.significant && result.effect < 0.5);
});

test('lesson state machine: promote, hold, retire on fade or flip', () => {
  const base = {
    kind: 'bias' as const,
    id: 'x',
    ctx: 'c',
    voice: 'v',
    statement: '',
    action: '',
    n: 100,
  };
  const strong = { ...base, effect: 0.1, direction: 1, pValue: 0.0001, significant: true };
  assert.equal(nextStatus(undefined, strong), 'PROMOTED');
  const promoted = { status: 'PROMOTED' as const, effect: 0.1, direction: 1 };
  assert.equal(nextStatus(promoted, { ...strong, pValue: 0.1, significant: false }), null);
  assert.equal(nextStatus(promoted, { ...strong, pValue: 0.5, significant: false }), 'RETIRED');
  assert.equal(nextStatus(promoted, { ...strong, direction: -1 }), 'RETIRED');
  assert.equal(nextStatus(undefined, { ...strong, significant: false }), null);
});

test('calibration error is zero for a calibrated forecaster', () => {
  const calibrated = outcomes.map((y) => ({ p: 6 / 13, outcome: y }));
  assert.ok(calibrationError(calibrated) < 0.02);
  assert.ok(calibrationError(outcomes.map((y) => ({ p: 0.95, outcome: y }))) > 0.4);
});
