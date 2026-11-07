/**
 * Analyst agents: the paid voices. Each is a small, honest model over one-minute BTC candles:
 *   randomwalk  driftless lognormal at realised volatility (the benchmark)
 *   momentum    recent drift partly persists
 *   meanrev     price pulls back toward its 20-minute average
 * Each analyst keeps its own lessons in Walrus ("analyst:<name>") and shrinks its calls toward
 * 0.5 where it has learned it is overconfident, so its memory changes what it sells.
 */
import { run } from '../db.js';
import type { Event, Quote, VolRegime } from '../events.js';
import { clampP, mean, normalCdf } from '../math.js';
import { candles, logReturns, sigmaPerMinute, spotPrice, type Candle } from '../sources/spot.js';
import { selfShrink } from '../brain/lessons.js';
import { anchorPrice } from '../sources/deepbook.js';

export const AGENTS = ['momentum', 'meanrev', 'randomwalk'] as const;
export type Agent = (typeof AGENTS)[number];
export const isAgent = (name: string): name is Agent =>
  (AGENTS as readonly string[]).includes(name);

/** Momentum: share of the last 5 minutes' average drift expected to continue. */
const MOMENTUM_LOOKBACK_MIN = 5;
const MOMENTUM_PERSISTENCE = 0.5;
/** Mean reversion: 20-minute average, closing ~10% of the gap per minute. */
const MEANREV_LOOKBACK_MIN = 20;
const MEANREV_SPEED_PER_MIN = 0.1;

type Inputs = { series: Candle[]; logMoneyness: number; sigma: number; minutes: number };

/** Expected log move to expiry under each analyst's view. */
const DRIFT: Record<Agent, (x: Inputs) => number> = {
  randomwalk: () => 0,
  momentum: ({ series, minutes }) =>
    mean(logReturns(series).slice(-MOMENTUM_LOOKBACK_MIN)) * MOMENTUM_PERSISTENCE * minutes,
  meanrev: ({ series, minutes }) => {
    const average = mean(series.slice(-MEANREV_LOOKBACK_MIN).map((c) => c.close));
    const gap = Math.log(spotPrice(series) / average);
    return -gap * (1 - Math.exp(-MEANREV_SPEED_PER_MIN * minutes));
  },
};

/** The analyst's own context for self-lessons: horizon x volatility regime. */
export const selfContext = (e: Event, regime: VolRegime) => `${e.horizon}/${regime}`;

/** The analyst's raw model: P(BTC at expiry > strike) given candles up to now. Pure. */
export function rawProbability(
  agent: Agent,
  series: Candle[],
  strike: number,
  minutes: number,
  level = spotPrice(series),
): number {
  const sigma = Math.max(1e-5, sigmaPerMinute(series));
  const horizon = Math.max(0.25, minutes);
  const inputs = {
    series,
    logMoneyness: Math.log(level / strike),
    sigma,
    minutes: horizon,
  };
  return clampP(
    normalCdf((inputs.logMoneyness + DRIFT[agent](inputs)) / (sigma * Math.sqrt(horizon))),
  );
}

/** Record the raw call (for self-lessons) and apply the analyst's learned shrink. */
export function analystCall(
  agent: Agent,
  e: Event,
  regime: VolRegime,
  raw: number,
  at = Date.now(),
): Quote {
  const key = selfContext(e, regime);
  run(`INSERT OR IGNORE INTO analyst_calls VALUES (?, ?, ?, ?, ?)`, e.id, agent, key, raw, at);
  return {
    voice: `analyst:${agent}`,
    p: clampP(0.5 + selfShrink(agent, key) * (raw - 0.5)),
    expiryMs: e.expiryMs,
    strike: e.strike,
    oracle: 'Coinbase',
  };
}

/**
 * Live analyst quote. Shape (drift, volatility) comes from Coinbase candles; the price level comes
 * from DeepBook's on-chain forward, which tracks the Pyth price the market settles on. Without
 * that anchor a few dollars of Coinbase-vs-Pyth gap make one-minute calls confidently wrong.
 */
export async function analystQuote(agent: Agent, e: Event, regime: VolRegime): Promise<Quote> {
  const minutes = (e.expiryMs - Date.now()) / 60_000;
  const level = await anchorPrice(e.expiryMs).catch(() => undefined);
  return analystCall(
    agent,
    e,
    regime,
    rawProbability(agent, await candles(), e.strike, minutes, level),
  );
}
