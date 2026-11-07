/**
 * Canonical event: "BTC price at `expiryMs` is above `strike`".
 * Every voice is mapped onto this one question so they can be scored against each other.
 */
import { shiftStrike } from './math.js';

export type Horizon = '1m' | '5m' | '15m' | '30m' | '60m';
export type EventSource = 'deepbook' | 'kalshi';
export type EventStatus = 'open' | 'resolved' | 'void';

export type Event = {
  id: string;
  source: EventSource;
  horizon: Horizon;
  expiryMs: number;
  strike: number;
  /** DeepBook market object ID or Kalshi ticker. Resolution uses the source's own settlement. */
  marketId: string;
  status: EventStatus;
  outcome: number | null;
  settlePrice: number | null;
  ctx: string | null;
  createdMs: number;
};

/** A voice's raw view, possibly for a nearby strike and expiry. */
export type Quote = { voice: string; p: number; expiryMs: number; strike: number; oracle: string };

export const HORIZON_MS: Record<Horizon, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '60m': 3_600_000,
};

/**
 * When voices are sampled, measured back from expiry. Each forecast is locked once and
 * anchored onchain before expiry, so late information cannot leak into the score.
 */
export const LEAD_MS: Record<Horizon, number> = {
  '1m': 40_000,
  '5m': 240_000,
  '15m': 600_000,
  '30m': 1_200_000,
  '60m': 1_800_000,
};

/** No forecast is accepted this close to expiry. */
export const LOCK_FLOOR_MS = 15_000;
/** Quotes are only mapped onto an event if their expiries are this close. */
export const MAX_EXPIRY_GAP_MS = 60_000;

/** Pick the horizon whose window length is closest to `windowMs`, within 10%. */
export function horizonFromWindow(windowMs: number): Horizon | null {
  let best: Horizon | null = null;
  for (const [horizon, length] of Object.entries(HORIZON_MS) as [Horizon, number][]) {
    if (Math.abs(windowMs - length) <= length * 0.1) best = horizon;
  }
  return best;
}

export function newEvent(
  source: EventSource,
  horizon: Horizon,
  expiryMs: number,
  strike: number,
  marketId: string,
): Event {
  return {
    id: `${source}:${horizon}:${expiryMs}:${strike}`,
    source,
    horizon,
    expiryMs,
    strike,
    marketId,
    status: 'open',
    outcome: null,
    settlePrice: null,
    ctx: null,
    createdMs: Date.now(),
  };
}

/** True while the event is inside its sampling window. */
export function isSnapshotDue(e: Event, now = Date.now()) {
  return now >= e.expiryMs - LEAD_MS[e.horizon] && now < e.expiryMs - LOCK_FLOOR_MS;
}

/**
 * Map a quote onto the event's strike. Returns null when the quote is for a different expiry.
 * `sigmaSqrtTau` is the log-price standard deviation until expiry (implied or realised).
 */
export function normalise(q: Quote, e: Event, sigmaSqrtTau: number): number | null {
  if (Math.abs(q.expiryMs - e.expiryMs) > MAX_EXPIRY_GAP_MS) return null;
  return shiftStrike(q.p, q.strike, e.strike, sigmaSqrtTau);
}

export type VolRegime = 'low' | 'mid' | 'high';
export type HourBucket = 'asia' | 'eu' | 'us';

export function volRegime(vol: number, terciles: [number, number]): VolRegime {
  return vol < terciles[0] ? 'low' : vol < terciles[1] ? 'mid' : 'high';
}

export function hourBucket(ms: number): HourBucket {
  const hour = new Date(ms).getUTCHours();
  return hour < 8 ? 'asia' : hour < 16 ? 'eu' : 'us';
}

/** Context = horizon x volatility regime x session. Small enough for samples to accumulate. */
export const contextKey = (horizon: Horizon, regime: VolRegime, bucket: HourBucket) =>
  `${horizon}/${regime}/${bucket}`;
