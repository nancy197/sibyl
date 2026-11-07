import assert from 'node:assert/strict';
import test from 'node:test';
import { db } from '../src/db.js';
import {
  applyCorrection,
  baselineEnsemble,
  hedgeUpdate,
  memoryEnsemble,
  trustWeights,
} from '../src/scoring.js';

test('Hedge moves trust to the accurate voice; a silent voice keeps its weight', () => {
  db.exec('DELETE FROM trust; DELETE FROM trust_history');
  const ctx = '5m/mid/us';
  hedgeUpdate(ctx, [
    { voice: 'good', loss: 0.1 },
    { voice: 'bad', loss: 0.1 },
    { voice: 'sleepy', loss: 0.1 },
  ]);
  const sleepyBefore = trustWeights(ctx, ['good', 'bad', 'sleepy']).sleepy;
  for (let i = 0; i < 40; i++)
    hedgeUpdate(ctx, [
      { voice: 'good', loss: 0.05 },
      { voice: 'bad', loss: 0.4 },
    ]);
  const after = trustWeights(ctx, ['good', 'bad', 'sleepy']);
  assert.ok(after.good > 0.6 && after.bad < 0.1, JSON.stringify(after));
  assert.ok(Math.abs(after.sleepy - sleepyBefore) < 1e-9);
  // The memory ensemble now leans on the good voice; the baseline does not.
  const quotes = [
    { voice: 'good', p: 0.8 },
    { voice: 'bad', p: 0.2 },
  ];
  assert.ok(memoryEnsemble(ctx, quotes)! > 0.7);
  assert.ok(Math.abs(baselineEnsemble(quotes)! - 0.5) < 1e-9);
});

test('corrections remove bias and shrink toward one half', () => {
  assert.ok(Math.abs(applyCorrection(0.7, { bias: 0.1, slope: 1, excluded: false }) - 0.6) < 1e-9);
  assert.ok(Math.abs(applyCorrection(0.9, { bias: 0, slope: 0.5, excluded: false }) - 0.7) < 1e-9);
});

test('the trade signal leaves out the market voice', () => {
  assert.equal(baselineEnsemble([{ voice: 'deepbook', p: 0.9 }], 'deepbook'), null);
});
