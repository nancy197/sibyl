import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contextKey,
  horizonFromWindow,
  isSnapshotDue,
  newEvent,
  normalise,
  volRegime,
} from '../src/events.js';

test('horizon is read from the window length', () => {
  assert.equal(horizonFromWindow(60_000), '1m');
  assert.equal(horizonFromWindow(298_000), '5m');
  assert.equal(horizonFromWindow(900_500), '15m');
  assert.equal(horizonFromWindow(450_000), null);
});

test('snapshots only inside the lead window, never in the last seconds', () => {
  const expiry = 1_000_000_000;
  const e = newEvent('deepbook', '5m', expiry, 75_000, '0x1');
  assert.equal(isSnapshotDue(e, expiry - 300_000), false);
  assert.equal(isSnapshotDue(e, expiry - 200_000), true);
  assert.equal(isSnapshotDue(e, expiry - 10_000), false);
});

test('quotes for another expiry are not mapped', () => {
  const e = newEvent('kalshi', '15m', 1_000_000_000, 75_000, 'T');
  const quote = { voice: 'x', p: 0.6, strike: 75_000, oracle: 'o' };
  assert.equal(normalise({ ...quote, expiryMs: e.expiryMs + 120_000 }, e, 0.002), null);
  assert.equal(normalise({ ...quote, expiryMs: e.expiryMs }, e, 0.002), 0.6);
});

test('context key', () => {
  assert.equal(contextKey('5m', volRegime(0.0009, [0.0004, 0.0008]), 'us'), '5m/high/us');
});
