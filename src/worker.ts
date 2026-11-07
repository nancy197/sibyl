/**
 * The live worker: discover events, lock forecasts at lead time, recall similar situations,
 * anchor, resolve, learn and write memories. Every step is guarded, so one failing source
 * never stops the rest.
 */
import {
  contextKey,
  hourBucket,
  isSnapshotDue,
  type Event,
  type Quote,
  type VolRegime,
} from './events.js';
import { errorText, log } from './log.js';
import { AGENTS } from './analysts/index.js';
import { anchorPending } from './anchor.js';
import { rememberPayments, restoreBrain } from './brain/brain.js';
import { flushOutbox, pollOutbox } from './brain/memwal.js';
import { describeSituation, recallEvidence, saveSituation } from './brain/recall.js';
import { acquireSignal } from './payments/buyer.js';
import {
  applyResolution,
  hasForecasts,
  lockForecasts,
  openEvents,
  saveEvent,
  voidEvent,
  type Settlement,
} from './pipeline.js';
import {
  deepbookEvents,
  deepbookQuote,
  deepbookSettlement,
  impliedSpread,
} from './sources/deepbook.js';
import {
  kalshiEvents,
  kalshiMarkets,
  kalshiQuote,
  kalshiResult,
  type KalshiMarket,
} from './sources/kalshi.js';
import { polymarketQuote } from './sources/polymarket.js';
import { candles, sigmaPerMinute } from './sources/spot.js';
import { tradeEvent } from './trader.js';
import { startStreams } from './sources/stream.js';
import { startTicker } from './sources/ticker.js';
import { run } from './db.js';
import { recordVolatility, regimeOf, terciles } from './volatility.js';

const TICK_MS = 10_000;
const ANCHOR_MS = 15_000;
const MEMORY_FLUSH_MS = 15_000;
const MEMORY_POLL_MS = 30_000;
const VOL_MS = 60_000;
/** One payments summary memory per half hour keeps the write rate near 50 a day. */
const PAYMENT_SUMMARY_MS = 1_800_000;
/** Settlement is published shortly after expiry; check from then on. */
const RESOLVE_AFTER_MS = 30_000;
/** Give up on an event whose settlement never shows up. */
const VOID_AFTER_MS = 3_600_000;
/** Resolutions per tick, so a backlog cannot delay forecast locks. */
const RESOLVES_PER_TICK = 6;
/** No single step may hold up its loop longer than this. */
const STEP_TIMEOUT_MS = 90_000;
/** Episodes (and so recall) exist only for these horizons. */
const RECALL_HORIZONS = new Set(['5m', '15m']);

// ---------- guarded steps and health ----------

export type SourceHealth = { ok: boolean; at: number; error?: string; failures: number };
export const health: Record<string, SourceHealth> = {};
const retryAt: Record<string, number> = {};

function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Run a step; on failure back off exponentially (capped at a minute) and record health. */
async function guarded<T>(name: string, step: () => Promise<T>): Promise<T | undefined> {
  if (Date.now() < (retryAt[name] ?? 0)) return undefined;
  try {
    const result = await withTimeout(step(), STEP_TIMEOUT_MS, name);
    health[name] = { ok: true, at: Date.now(), failures: 0 };
    return result;
  } catch (error) {
    const failures = (health[name]?.failures ?? 0) + 1;
    retryAt[name] = Date.now() + Math.min(60_000, 1_000 * 2 ** Math.min(6, failures));
    health[name] = { ok: false, at: Date.now(), error: errorText(error).slice(0, 300), failures };
    log('warn', `${name} failed`, { error: errorText(error), failures });
    return undefined;
  }
}

// ---------- volatility ----------

let sigma: number | null = null;

async function refreshVolatility() {
  sigma = sigmaPerMinute(await candles());
  recordVolatility(sigma);
}

export const currentRegime = (): VolRegime => regimeOf(sigma ?? terciles()[0]);
export const volatility = () => ({
  sigmaPerMinute: sigma,
  terciles: terciles(),
  regime: currentRegime(),
});

// ---------- discovery ----------

let kalshiBook: KalshiMarket[] = [];

async function discover() {
  const [deepbook, kalshi] = await Promise.all([
    guarded('deepbook', deepbookEvents),
    guarded('kalshi', kalshiMarkets),
  ]);
  deepbook?.forEach(saveEvent);
  if (kalshi) {
    kalshiBook = kalshi;
    kalshiEvents(kalshi).forEach(saveEvent);
  }
}

// ---------- forecast lock ----------

/** Gather every voice, lock the forecasts, recall similar situations, then let the trader act. */
async function snapshot(e: Event) {
  const regime = currentRegime();
  const ctx = contextKey(e.horizon, regime, hourBucket(e.expiryMs));
  // Saved before asking analysts: the paid /signal route looks the event's context up.
  run(`UPDATE events SET ctx = ? WHERE id = ?`, ctx, e.id);
  const minutes = Math.max(0.25, (e.expiryMs - Date.now()) / 60_000);
  const realised = (sigma ?? terciles()[0]) * Math.sqrt(minutes);
  const spread = (await guarded('deepbook-spread', () => impliedSpread(e.expiryMs))) ?? realised;

  const [deepbook, polymarket, ...analysts] = await Promise.all([
    guarded('deepbook-price', () => deepbookQuote(e)),
    guarded('polymarket', () => polymarketQuote(e)),
    ...AGENTS.map((agent) =>
      guarded(`analyst:${agent}`, () => acquireSignal(agent, e, ctx, regime)),
    ),
  ]);
  const used = [deepbook, kalshiQuote(e, kalshiBook), polymarket, ...analysts.map((a) => a?.used)];
  const unused = analysts.map((a) => a?.unused).filter((q): q is Quote => !!q);
  const locked = lockForecasts(
    e,
    ctx,
    used.filter((q): q is Quote => !!q),
    spread,
    Date.now(),
    unused,
  );
  if (!locked.length) return;

  const situation = describeSituation(e, ctx, locked);
  if (situation) {
    const evidence = RECALL_HORIZONS.has(e.horizon)
      ? ((await guarded('walrus-recall', () => recallEvidence(situation))) ?? null)
      : null;
    saveSituation(situation, evidence);
  }
  await guarded('trader', () => tradeEvent(e, ctx, locked));
}

// ---------- resolution ----------

async function settlement(e: Event): Promise<Settlement | null> {
  if (e.source === 'kalshi') return kalshiResult(e.marketId);
  const price = await deepbookSettlement(e);
  return price === null ? null : { outcome: Number(price > e.strike), price };
}

async function resolve(e: Event) {
  if (!hasForecasts(e.id)) return voidEvent(e); // never sampled (for example, started too late)
  const result = await settlement(e);
  if (result) return applyResolution(e, result);
  if (Date.now() > e.expiryMs + VOID_AFTER_MS) voidEvent(e);
}

/** Paused while the brain is wiped and restored, so no update lands in between. */
let paused = false;
export async function whilePaused<T>(work: () => Promise<T>): Promise<T> {
  paused = true;
  try {
    return await work();
  } finally {
    paused = false;
  }
}

async function tick() {
  if (paused) return;
  await discover();
  const now = Date.now();
  const events = openEvents();
  for (const e of events.filter((x) => isSnapshotDue(x, now) && !hasForecasts(x.id))) {
    await guarded('snapshot', () => snapshot(e));
  }
  const due = events
    .filter((x) => now >= x.expiryMs + RESOLVE_AFTER_MS)
    .slice(0, RESOLVES_PER_TICK);
  for (const e of due) await guarded(`resolve:${e.source}`, () => resolve(e));
}

// ---------- live chain events (Tatum checkpoint stream) ----------

/** How quickly the stream turns a DeepBook settlement into a scored event. */
export const streamResolutions = { count: 0, totalLatencyMs: 0 };

function onSettled(marketId: string, expiryMs: number, price: number) {
  const e = openEvents().find((x) => x.source === 'deepbook' && x.marketId === marketId);
  if (!e || !hasForecasts(e.id)) return;
  applyResolution(e, { outcome: Number(price > e.strike), price });
  streamResolutions.count++;
  streamResolutions.totalLatencyMs += Date.now() - expiryMs;
}

function onAnchored(digest: string) {
  run(`UPDATE anchors SET status = 'confirmed' WHERE digest = ?`, digest);
}

// ---------- loops ----------

/** Run `step` now and then every `ms`, never overlapping itself. */
function every(name: string, ms: number, step: () => Promise<unknown>) {
  let running = false;
  const go = async () => {
    if (running) return;
    running = true;
    await guarded(name, step);
    running = false;
  };
  void go();
  return setInterval(go, ms);
}

function paymentWindow(): [number, number] {
  const end = Math.floor(Date.now() / PAYMENT_SUMMARY_MS) * PAYMENT_SUMMARY_MS;
  return [end - PAYMENT_SUMMARY_MS, end];
}

export async function startWorker() {
  const restored = await guarded('restore', () => restoreBrain(AGENTS));
  if (restored) log('info', 'brain restored from memory', restored);
  await guarded('volatility', refreshVolatility);

  startStreams({ onSettled, onAnchored });
  startTicker();
  every('tick', TICK_MS, tick);
  every('anchor', ANCHOR_MS, anchorPending);
  every('volatility', VOL_MS, refreshVolatility);
  every('memory-flush', MEMORY_FLUSH_MS, flushOutbox);
  every('memory-poll', MEMORY_POLL_MS, pollOutbox);
  every('payments-memory', PAYMENT_SUMMARY_MS, async () => rememberPayments(...paymentWindow()));
  log('info', 'worker started');
}
