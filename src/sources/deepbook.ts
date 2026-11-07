/**
 * DeepBook Predict (read network): event discovery, the onchain voice, implied volatility
 * and settlement. All calls go through Tatum gRPC and are cached to respect the rate limit.
 */
import type { ActiveMarket } from '@mysten/deepbook-v3/predict';
import { horizonFromWindow, newEvent, type Event, type Horizon, type Quote } from '../events.js';
import { impliedSigmaSqrtTau } from '../math.js';
import { readSui } from '../sui.js';

type Pricer = Awaited<ReturnType<typeof readSui.predict.read.pricer>>;

/** A pricer snapshot is several gRPC reads; a few seconds of staleness is fine for 1m+ horizons. */
const CACHE_MS = 5_000;
/** Probabilities used to read the implied spread off the pricer, around the money. */
const SPREAD_PROBS: [number, number] = [0.7, 0.3];

type Cached<T> = { value: T; until: number };
let marketCache: Cached<ActiveMarket[]> | null = null;
const pricerCache = new Map<number, Cached<Pricer>>();
/** A market's horizon never changes, so it is looked up once per market object. */
const horizonByMarket = new Map<string, Horizon | null>();

export async function markets(): Promise<ActiveMarket[]> {
  if (marketCache && Date.now() < marketCache.until) return marketCache.value;
  const value = await readSui.predict.read.markets();
  marketCache = { value, until: Date.now() + CACHE_MS };
  return value;
}

export async function pricer(expiryMs: number): Promise<Pricer> {
  const hit = pricerCache.get(expiryMs);
  if (hit && Date.now() < hit.until) return hit.value;
  const value = await readSui.predict.read.pricer({ underlying: 'BTC', expiryMs });
  pricerCache.set(expiryMs, { value, until: Date.now() + CACHE_MS });
  for (const [key, entry] of pricerCache) if (entry.until < Date.now()) pricerCache.delete(key);
  return value;
}

/**
 * A market's window opens when its reference price is observed; the window length gives the
 * cadence (1m, 5m, ...). The SDK does not expose cadence directly, so it is read from the object.
 */
async function lookupHorizons(fresh: ActiveMarket[]) {
  if (!fresh.length) return;
  const { objects } = await readSui.getObjects({
    objectIds: fresh.map((m) => m.id),
    include: { json: true },
  });
  fresh.forEach((market, i) => {
    const object = objects[i];
    const exposure = object && 'json' in object ? object.json?.strike_exposure : undefined;
    const openedMs =
      exposure && typeof exposure === 'object' && 'reference_tick_source_timestamp_ms' in exposure
        ? Number(exposure.reference_tick_source_timestamp_ms)
        : NaN;
    horizonByMarket.set(
      market.id,
      Number.isFinite(openedMs) ? horizonFromWindow(Number(market.expiryMs) - openedMs) : null,
    );
  });
}

/** Live markets with a reference price become canonical events (strike = reference price). */
export async function deepbookEvents(): Promise<Event[]> {
  const now = Date.now();
  const live = (await markets()).filter(
    (m) => Number(m.expiryMs) > now && m.referencePrice !== null && !m.mintPaused,
  );
  await lookupHorizons(live.filter((m) => !horizonByMarket.has(m.id)));
  return live.flatMap((m) => {
    const horizon = horizonByMarket.get(m.id);
    return horizon
      ? [newEvent('deepbook', horizon, Number(m.expiryMs), m.referencePrice!, m.id)]
      : [];
  });
}

/** True if DeepBook lists a market expiring exactly at `expiryMs`. */
export async function hasMarketAt(expiryMs: number) {
  return (await markets()).some((m) => Number(m.expiryMs) === expiryMs);
}

/** The onchain voice: P(BTC at expiry > strike) from the market's own pricer. */
export async function deepbookQuote(e: Event): Promise<Quote | null> {
  if (!(await hasMarketAt(e.expiryMs))) return null;
  const surface = await pricer(e.expiryMs);
  return {
    voice: 'deepbook',
    p: surface.up(e.strike),
    expiryMs: e.expiryMs,
    strike: e.strike,
    oracle: 'Pyth',
  };
}

/** Log-price standard deviation until expiry, implied by the DeepBook pricer. */
export async function impliedSpread(expiryMs: number): Promise<number | null> {
  if (!(await hasMarketAt(expiryMs))) return null;
  const surface = await pricer(expiryMs);
  const [pLow, pHigh] = SPREAD_PROBS;
  const k1 = surface.strikeAtProbability(pLow);
  const k2 = surface.strikeAtProbability(pHigh);
  if (k1 === null || k2 === null) return null;
  return impliedSigmaSqrtTau(k1, pLow, k2, pHigh);
}

/** Settlement price once a keeper has settled the market, else null. */
export async function deepbookSettlement(e: Event): Promise<number | null> {
  const result = await readSui.predict.read.settlement({
    underlying: 'BTC',
    expiryMs: e.expiryMs,
    marketId: e.marketId,
  });
  return result.settled ? result.settlementPrice : null;
}

/**
 * The on-chain forward for an expiry (Pyth-based): the market at that expiry, else the nearest
 * live one. Analysts use it as their price level.
 */
export async function anchorPrice(expiryMs: number): Promise<number> {
  const live = (await markets()).filter((m) => Number(m.expiryMs) > Date.now());
  if (!live.length) throw new Error('no live DeepBook market for a price anchor');
  const nearest = live.reduce((a, b) =>
    Math.abs(Number(a.expiryMs) - expiryMs) <= Math.abs(Number(b.expiryMs) - expiryMs) ? a : b,
  );
  return (await pricer(Number(nearest.expiryMs))).forward;
}
