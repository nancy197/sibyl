import assert from 'node:assert/strict';
import test from 'node:test';
import { memoryData, memoryLine } from '../src/brain/schema.js';
import { explores, EXPLORATION } from '../src/payments/buyer.js';
import { kelly } from '../src/trader.js';

test('memory lines are readable and parse back', () => {
  const line = memoryLine('TRUST v3 ctx=5m/mid/us a 0.6 | b 0.4', {
    kind: 'trust',
    ctx: '5m/mid/us',
    n: 3,
  });
  assert.ok(line.startsWith('TRUST v3'));
  assert.deepEqual(memoryData(line), {
    kind: 'trust',
    ctx: '5m/mid/us',
    n: 3,
    v: 2,
    at: (memoryData(line) as { at: number }).at,
  });
  assert.equal(memoryData('no tail here'), null);
});

test('exploration is deterministic and close to its rate', () => {
  const picks = Array.from({ length: 5000 }, (_, i) => explores(`event-${i}`, 'momentum'));
  const rate = picks.filter(Boolean).length / picks.length;
  assert.ok(Math.abs(rate - EXPLORATION) < 0.02, String(rate));
  assert.equal(explores('e', 'a'), explores('e', 'a'));
});

test('Kelly fraction for a binary', () => {
  assert.equal(kelly(0.5, 0.5), 0);
  assert.ok(Math.abs(kelly(0.6, 0.5) - 0.2) < 1e-12);
});
