/**
 * Live BTC/USD ticks for the dashboard chart (Coinbase public ticker, every 2 seconds, kept in
 * memory for two hours). Display only: no decision reads from here.
 */
import { errorText, log } from '../log.js';
import { candles } from './spot.js';

const URL = 'https://api.exchange.coinbase.com/products/BTC-USD/ticker';
const TICK_MS = 2_000;
const KEEP_MS = 2 * 3_600_000;
/** The chart never needs more points than this per request. */
const MAX_POINTS = 1_500;

export type Tick = { t: number; p: number };
const ticks: Tick[] = [];
let failures = 0;

async function sample() {
  try {
    const response = await fetch(URL, {
      headers: { 'User-Agent': 'sibyl-forecaster' },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) throw new Error(`Coinbase ticker ${response.status}`);
    const { price } = (await response.json()) as { price: string };
    ticks.push({ t: Date.now(), p: Number(price) });
    while (ticks.length && ticks[0].t < Date.now() - KEEP_MS) ticks.shift();
    failures = 0;
  } catch (error) {
    if (++failures === 5) log('warn', 'price ticker failing', { error: errorText(error) });
  }
}

/** Start from the last two hours of one-minute closes, so the chart is never empty. */
async function seed() {
  try {
    const history = await candles();
    const firstLive = ticks[0]?.t ?? Infinity;
    const seeded = history
      .map((c) => ({ t: c.startMs + 60_000, p: c.close }))
      .filter((x) => x.t >= Date.now() - KEEP_MS && x.t < firstLive);
    ticks.unshift(...seeded);
  } catch (error) {
    log('warn', 'price ticker could not load history', { error: errorText(error) });
  }
}

export function startTicker() {
  void seed();
  void sample();
  setInterval(() => void sample(), TICK_MS);
}

/** Ticks since `sinceMs`, thinned evenly to at most MAX_POINTS. */
export function ticksSince(sinceMs: number): Tick[] {
  const recent = ticks.filter((x) => x.t >= sinceMs);
  const step = Math.ceil(recent.length / MAX_POINTS);
  return step <= 1 ? recent : recent.filter((_, i) => i % step === 0 || i === recent.length - 1);
}
