/**
 * Volatility regime: low / mid / high by terciles of recent one-minute realised volatility.
 * Samples are stored, so the live worker and the backfill classify contexts the same way.
 */
import { rows, run } from './db.js';
import { volRegime, type VolRegime } from './events.js';

/** Terciles come from the last week of samples... */
const TERCILE_WINDOW_MS = 7 * 86_400_000;
/** ...once there are enough of them (an hour of one-minute samples). */
const MIN_TERCILE_SAMPLES = 60;
/** Until then: typical BTC one-minute log-return volatility bands. */
const DEFAULT_TERCILES: [number, number] = [0.0004, 0.0008];

export function recordVolatility(sigmaPerMinute: number, at = Date.now()) {
  run(`INSERT OR REPLACE INTO vol_samples VALUES (?, ?)`, at, sigmaPerMinute);
}

export function terciles(now = Date.now()): [number, number] {
  const samples = rows<{ vol: number }>(
    `SELECT vol FROM vol_samples WHERE at_ms >= ? AND at_ms <= ? ORDER BY vol`,
    now - TERCILE_WINDOW_MS,
    now,
  ).map((r) => r.vol);
  if (samples.length < MIN_TERCILE_SAMPLES) return DEFAULT_TERCILES;
  return [samples[Math.floor(samples.length / 3)], samples[Math.floor((2 * samples.length) / 3)]];
}

export const regimeOf = (sigmaPerMinute: number, now = Date.now()): VolRegime =>
  volRegime(sigmaPerMinute, terciles(now));
