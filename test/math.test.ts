import assert from 'node:assert/strict';
import test from 'node:test';
import {
  impliedSigmaSqrtTau,
  meanTest,
  normalCdf,
  normalInv,
  shiftStrike,
  slope,
} from '../src/math.js';

test('normalInv inverts normalCdf', () => {
  for (const p of [0.001, 0.02, 0.3, 0.5, 0.77, 0.99])
    assert.ok(Math.abs(normalCdf(normalInv(p)) - p) < 1e-6);
  assert.ok(Math.abs(normalCdf(1.959964) - 0.975) < 1e-6);
});

test('implied spread recovers sigma*sqrt(tau) from a synthetic lognormal', () => {
  const forward = 75_000;
  const spread = 0.0012; // e.g. 5 minutes of BTC
  const up = (k: number) => normalCdf((Math.log(forward / k) - spread ** 2 / 2) / spread);
  const k1 = 74_950;
  const k2 = 75_080;
  assert.ok(Math.abs(impliedSigmaSqrtTau(k1, up(k1), k2, up(k2)) - spread) < 1e-6);
  assert.throws(() => impliedSigmaSqrtTau(k2, up(k2), k1, up(k1)));
});

test('strike shift matches the lognormal model it assumes', () => {
  const forward = 75_000;
  const spread = 0.002;
  const up = (k: number) => normalCdf(Math.log(forward / k) / spread);
  assert.ok(Math.abs(shiftStrike(up(75_100), 75_100, 74_900, spread) - up(74_900)) < 1e-6);
  assert.equal(shiftStrike(0.4, 75_000, 75_000, spread), 0.4);
});

test('mean test and slope behave on clear and null signals', () => {
  const shifted = Array.from({ length: 100 }, (_, i) => 0.1 + Math.sin(i) * 0.05);
  assert.ok(meanTest(shifted).p < 1e-6);
  const centred = Array.from({ length: 100 }, (_, i) => Math.sin(i));
  assert.ok(meanTest(centred).p > 0.05);
  const xs = Array.from({ length: 50 }, (_, i) => i / 50);
  const fit = slope(
    xs,
    xs.map((x) => 0.5 * x + 0.1),
  );
  assert.ok(Math.abs(fit.slope - 0.5) < 1e-9);
});
