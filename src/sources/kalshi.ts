/**
 * Kalshi BTC markets (public, no auth). Settles on CF Benchmarks BRTI, a different oracle
 * from DeepBook's Pyth, which is exactly why its track record per context is worth learning.
 */
import { MAX_EXPIRY_GAP_MS, newEvent, type Event, type Quote } from '../events.js';

const BASE = 'https://api.elections.kalshi.com/trade-api/v2';
/** 15-minute "above target" series, and the hourly "above strike" ladder. */
const SERIES = ['KXBTC15M', 'KXBTCD'] as const;
const CACHE_MS = 15_000;
/** A quote whose bid/ask spread is wider than this says little about the probability. */
const MAX_SPREAD = 0.2;

export type KalshiMarket = {
  ticker: string;
  event_ticker: string;
  close_time: string;
  floor_strike?: number | null;
  yes_bid_dollars?: string | null;
  yes_ask_dollars?: string | null;
  last_price_dollars?: string | null;
  result?: string | null;
  expiration_value?: string | null;
  status?: string;
};

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Kalshi ${response.status} for ${path}`);
  return (await response.json()) as T;
}

let cache: { at: number; markets: KalshiMarket[] } | null = null;

export async function kalshiMarkets(): Promise<KalshiMarket[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.markets;
  const pages = await Promise.all(
    SERIES.map((series) =>
      getJson<{ markets: KalshiMarket[] }>(
        `/markets?series_ticker=${series}&status=open&limit=1000`,
      ),
    ),
  );
  cache = { at: Date.now(), markets: pages.flatMap((page) => page.markets ?? []) };
  return cache.markets;
}

const closeMs = (m: KalshiMarket) => Date.parse(m.close_time);
const dollars = (value?: string | null) => (value == null || value === '' ? null : Number(value));

/** Mid of bid/ask when the book is tight enough, else the last trade, else null. */
export function kalshiProbability(m: KalshiMarket): number | null {
  const bid = dollars(m.yes_bid_dollars);
  const ask = dollars(m.yes_ask_dollars);
  if (bid !== null && ask !== null && ask > 0 && ask - bid <= MAX_SPREAD) return (bid + ask) / 2;
  return dollars(m.last_price_dollars);
}

/** Each open 15-minute market becomes an event: "BRTI at close >= target". */
export function kalshiEvents(markets: KalshiMarket[]): Event[] {
  const now = Date.now();
  return markets
    .filter((m) => m.event_ticker.startsWith('KXBTC15M') && m.floor_strike && closeMs(m) > now)
    .map((m) => newEvent('kalshi', '15m', closeMs(m), m.floor_strike!, m.ticker));
}

/** The Kalshi voice: the event's own market, or the nearest strike expiring at the same time. */
export function kalshiQuote(e: Event, markets: KalshiMarket[]): Quote | null {
  const sameExpiry = markets.filter(
    (m) => m.floor_strike != null && Math.abs(closeMs(m) - e.expiryMs) <= MAX_EXPIRY_GAP_MS,
  );
  const market =
    sameExpiry.find((m) => m.ticker === e.marketId) ??
    sameExpiry.sort(
      (a, b) => Math.abs(a.floor_strike! - e.strike) - Math.abs(b.floor_strike! - e.strike),
    )[0];
  const p = market ? kalshiProbability(market) : null;
  if (!market || p === null) return null;
  return {
    voice: 'kalshi',
    p,
    expiryMs: closeMs(market),
    strike: market.floor_strike!,
    oracle: 'BRTI',
  };
}

/** Kalshi's official result for a closed market: 1 (yes), 0 (no), or null while pending. */
export async function kalshiResult(
  ticker: string,
): Promise<{ outcome: number; price: number | null } | null> {
  const { market } = await getJson<{ market: KalshiMarket }>(
    `/markets/${encodeURIComponent(ticker)}`,
  );
  if (market.result !== 'yes' && market.result !== 'no') return null;
  return { outcome: market.result === 'yes' ? 1 : 0, price: dollars(market.expiration_value) };
}

// ---------- history (backfill) ----------

type Candle = {
  end_period_ts: number;
  yes_bid?: { close_dollars?: string | null };
  yes_ask?: { close_dollars?: string | null };
  price?: { close_dollars?: string | null };
};

/** Settled 15-minute markets that closed in [fromMs, toMs], oldest first. */
export async function settledMarkets(fromMs: number, toMs: number): Promise<KalshiMarket[]> {
  const out: KalshiMarket[] = [];
  let cursor = '';
  do {
    const page = await getJson<{ markets: KalshiMarket[]; cursor?: string }>(
      `/markets?series_ticker=KXBTC15M&status=settled&min_close_ts=${Math.floor(fromMs / 1000)}` +
        `&max_close_ts=${Math.floor(toMs / 1000)}&limit=1000${cursor ? `&cursor=${cursor}` : ''}`,
    );
    out.push(...page.markets);
    cursor = page.cursor ?? '';
  } while (cursor);
  return out
    .filter((m) => m.result === 'yes' || m.result === 'no')
    .sort((a, b) => closeMs(a) - closeMs(b));
}

/** The market's probability as of `atMs`, from its one-minute candles (same rule as live). */
export async function probabilityAt(ticker: string, atMs: number): Promise<number | null> {
  const end = Math.floor(atMs / 1000);
  const { candlesticks } = await getJson<{ candlesticks: Candle[] }>(
    `/series/KXBTC15M/markets/${encodeURIComponent(ticker)}/candlesticks?start_ts=${end - 300}&end_ts=${end}&period_interval=1`,
  );
  const last = candlesticks.filter((c) => c.end_period_ts <= end).at(-1);
  if (!last) return null;
  return kalshiProbability({
    ticker,
    event_ticker: ticker,
    close_time: '',
    yes_bid_dollars: last.yes_bid?.close_dollars,
    yes_ask_dollars: last.yes_ask?.close_dollars,
    last_price_dollars: last.price?.close_dollars,
  });
}
