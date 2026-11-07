/**
 * BTC/USD one-minute candles from Coinbase's public API. Analysts read price history from here,
 * and the volatility regime is measured from it. (Pyth Hermes now requires an API key.)
 */
const URL = 'https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60';
const CACHE_MS = 10_000;
/** Realised volatility is measured over the last 30 one-minute returns. */
export const VOL_WINDOW_MIN = 30;

export type Candle = { startMs: number; close: number };

let cache: { at: number; candles: Candle[] } | null = null;

/** Recent one-minute candles, oldest first. The last one is still forming (its close is the spot). */
export async function candles(): Promise<Candle[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.candles;
  const response = await fetch(URL, {
    headers: { 'User-Agent': 'sibyl-forecaster' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Coinbase candles ${response.status}`);
  // Each row is [time_s, low, high, open, close, volume], newest first.
  const raw = (await response.json()) as number[][];
  const parsed = raw.map(([time, , , , close]) => ({ startMs: time * 1000, close })).reverse();
  if (parsed.length < VOL_WINDOW_MIN + 1) throw new Error('Coinbase returned too few candles');
  cache = { at: Date.now(), candles: parsed };
  return parsed;
}

export const spotPrice = (series: Candle[]) => series[series.length - 1].close;

export function logReturns(series: Candle[]): number[] {
  return series.slice(1).map((c, i) => Math.log(c.close / series[i].close));
}

/** Standard deviation of one-minute log returns over the last `VOL_WINDOW_MIN` minutes. */
export function sigmaPerMinute(series: Candle[]): number {
  const returns = logReturns(series).slice(-VOL_WINDOW_MIN);
  const m = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - m) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance);
}

/** Coinbase returns at most 300 candles per request. */
const MAX_CANDLES_PER_REQUEST = 300;

/** Historical one-minute candles in [startMs, endMs], oldest first (for the backfill). */
export async function candlesBetween(startMs: number, endMs: number): Promise<Candle[]> {
  const byStart = new Map<number, number>();
  for (let from = startMs; from < endMs; from += MAX_CANDLES_PER_REQUEST * 60_000) {
    const to = Math.min(endMs, from + MAX_CANDLES_PER_REQUEST * 60_000);
    const url = `${URL}&start=${new Date(from).toISOString()}&end=${new Date(to).toISOString()}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'sibyl-forecaster' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Coinbase candles ${response.status}`);
    for (const [time, , , , close] of (await response.json()) as number[][])
      byStart.set(time * 1000, close);
    await new Promise((resolve) => setTimeout(resolve, 200)); // stay well under the public rate limit
  }
  return [...byStart]
    .sort((a, b) => a[0] - b[0])
    .map(([start, close]) => ({ startMs: start, close }));
}
