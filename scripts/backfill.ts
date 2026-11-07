/**
 * Historical replay, so lessons and recall have evidence from day one. Settled Kalshi 15-minute
 * markets of the last few days are replayed in order through the same pipeline as live events:
 *   lock at T-10m (Kalshi's price then + analysts on the candles available then) -> resolve on
 *   Kalshi's official result -> score -> Hedge -> lessons -> Walrus memories.
 * Backfilled events are marked "backfill:", never anchored (they are past), and never paid for.
 * DeepBook has no price history to replay, so it is absent from these events.
 *
 *   pnpm backfill [days=2]      # stop the app first
 */
import { rows } from '../src/db.js';
import { contextKey, hourBucket, LEAD_MS, newEvent, type Quote } from '../src/events.js';
import { AGENTS, analystCall, rawProbability } from '../src/analysts/index.js';
import { maybeRememberTrust } from '../src/brain/brain.js';
import { describeSituation, saveSituation } from '../src/brain/recall.js';
import { applyResolution, lockForecasts, saveEvent } from '../src/pipeline.js';
import { probabilityAt, settledMarkets } from '../src/sources/kalshi.js';
import {
  candlesBetween,
  sigmaPerMinute,
  VOL_WINDOW_MIN,
  type Candle,
} from '../src/sources/spot.js';
import { recordVolatility, regimeOf } from '../src/volatility.js';

const days = Number(process.argv[2] ?? 2);
const LEAD = LEAD_MS['15m'];
/** Candles of history each analyst sees (enough for the 30-minute volatility window and more). */
const HISTORY_MIN = 60;
const KALSHI_PAUSE_MS = 120;

const now = Date.now();
const markets = (await settledMarkets(now - days * 86_400_000, now - 60_000)).filter(
  (m) => m.floor_strike && !rows(`SELECT 1 FROM events WHERE id LIKE ?`, `%${m.ticker}%`).length,
);
console.log(`${markets.length} settled Kalshi 15m markets to replay over ${days} day(s)`);
if (!markets.length) process.exit(0);

const firstLock = Date.parse(markets[0].close_time) - LEAD;
const lastLock = Date.parse(markets.at(-1)!.close_time) - LEAD;
const candles = await candlesBetween(firstLock - HISTORY_MIN * 60_000 - 2 * 3_600_000, lastLock);
console.log(`${candles.length} one-minute candles loaded`);

/** Closed candles before `atMs` (the one still forming at `atMs` is not known yet). */
const historyAt = (atMs: number): Candle[] => {
  const known = candles.filter((c) => c.startMs + 60_000 <= atMs);
  return known.slice(-HISTORY_MIN);
};

// Volatility samples first, so contexts are classified with the terciles of that time.
for (let i = VOL_WINDOW_MIN + 1; i < candles.length; i++) {
  const at = candles[i].startMs + 60_000;
  recordVolatility(sigmaPerMinute(candles.slice(i - VOL_WINDOW_MIN, i + 1)), at);
}

const contexts = new Set<string>();
let replayed = 0;
for (const market of markets) {
  const closeMs = Date.parse(market.close_time);
  const lockMs = closeMs - LEAD;
  const series = historyAt(lockMs);
  if (series.length < VOL_WINDOW_MIN + 1) continue;

  const live = newEvent('kalshi', '15m', closeMs, market.floor_strike!, market.ticker);
  const e = { ...live, id: `backfill:${live.id}`, createdMs: lockMs };
  const sigma = sigmaPerMinute(series);
  const regime = regimeOf(sigma, lockMs);
  const ctx = contextKey('15m', regime, hourBucket(closeMs));

  const kalshi = await probabilityAt(market.ticker, lockMs);
  await new Promise((resolve) => setTimeout(resolve, KALSHI_PAUSE_MS));
  const quotes: Quote[] = AGENTS.map((agent) =>
    analystCall(agent, e, regime, rawProbability(agent, series, e.strike, LEAD / 60_000), lockMs),
  );
  if (kalshi !== null)
    quotes.unshift({
      voice: 'kalshi',
      p: kalshi,
      expiryMs: closeMs,
      strike: e.strike,
      oracle: 'BRTI',
    });

  saveEvent(e);
  const locked = lockForecasts(e, ctx, quotes, sigma * Math.sqrt(LEAD / 60_000), lockMs);
  const situation = describeSituation(e, ctx, locked);
  if (situation) saveSituation(situation, null, lockMs);
  applyResolution(
    e,
    { outcome: market.result === 'yes' ? 1 : 0, price: Number(market.expiration_value) || null },
    closeMs,
    'BACKFILL',
  );
  contexts.add(ctx);
  if (++replayed % 25 === 0) console.log(`  ${replayed}/${markets.length}`);
}

for (const ctx of contexts) maybeRememberTrust(ctx, true);
const lessons = rows<{ status: string; statement: string }>(
  `SELECT status, statement FROM lessons ORDER BY at_ms`,
);
const queued = rows(`SELECT 1 FROM memories WHERE status = 'queued'`).length;
console.log(`replayed ${replayed} events in ${contexts.size} contexts`);
for (const l of lessons) console.log(`  ${l.status} ${l.statement}`);
console.log(`${queued} memories queued for Walrus (the app sends them, within the daily budget)`);
process.exit(0);
