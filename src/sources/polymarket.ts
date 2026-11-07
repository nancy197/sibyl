/**
 * Optional Polymarket voice (Chainlink-resolved 15m BTC up/down markets). Off by default because
 * the API is geo-blocked from some regions. The caller treats failures like any other source.
 */
import { config } from '../config.js';
import { HORIZON_MS, type Event, type Quote } from '../events.js';

type GammaEvent = { markets?: { outcomePrices?: string }[] };

export async function polymarketQuote(e: Event): Promise<Quote | null> {
  if (!config.polymarket || e.horizon !== '15m') return null;
  const windowStart = Math.floor((e.expiryMs - HORIZON_MS['15m']) / 1000);
  const response = await fetch(
    `https://gamma-api.polymarket.com/events?slug=btc-updown-15m-${windowStart}`,
    { signal: AbortSignal.timeout(5_000) },
  );
  if (!response.ok) throw new Error(`Polymarket ${response.status}`);
  const [event] = (await response.json()) as GammaEvent[];
  const prices = event?.markets?.[0]?.outcomePrices;
  const up = prices ? Number(JSON.parse(prices)[0]) : NaN;
  if (!Number.isFinite(up)) return null;
  // "Up" means close above the window's open, which is the same question as our 15m strike.
  return {
    voice: 'polymarket',
    p: up,
    expiryMs: e.expiryMs,
    strike: e.strike,
    oracle: 'Chainlink',
  };
}
