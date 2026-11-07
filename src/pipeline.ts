/**
 * The steps every event goes through, shared by the live worker and the historical backfill:
 * persist -> lock forecasts -> resolve -> score -> learn -> remember.
 * Nothing here talks to the network; callers bring the quotes and the settlement.
 */
import { rows, run, transaction } from './db.js';
import { normalise, type Event, type Quote, type VolRegime } from './events.js';
import { log } from './log.js';
import { AGENTS, selfContext } from './analysts/index.js';
import { maybeRememberTrust, rememberEpisode } from './brain/brain.js';
import { runAnalystLessons, runCouncilLessons, updatePolicy } from './brain/lessons.js';
import {
  BASELINE,
  baselineEnsemble,
  MEMORY,
  memoryEnsemble,
  resolvedCount,
  scoreEvent,
  type VoiceP,
} from './scoring.js';
import { settleTrades } from './trader.js';

/** Re-test lessons in a context after this many new resolutions there. */
const LESSON_EVERY = 5;

// ---------- events ----------

type EventRow = {
  id: string;
  source: Event['source'];
  horizon: Event['horizon'];
  expiry_ms: number;
  strike: number;
  market_id: string;
  status: Event['status'];
  outcome: number | null;
  settle_price: number | null;
  ctx: string | null;
  created_ms: number;
};

const toEvent = (r: EventRow): Event => ({
  id: r.id,
  source: r.source,
  horizon: r.horizon,
  expiryMs: r.expiry_ms,
  strike: r.strike,
  marketId: r.market_id,
  status: r.status,
  outcome: r.outcome,
  settlePrice: r.settle_price,
  ctx: r.ctx,
  createdMs: r.created_ms,
});

export function getEvent(id: string): Event | undefined {
  const row = rows<EventRow>(`SELECT * FROM events WHERE id = ?`, id)[0];
  return row ? toEvent(row) : undefined;
}

export function openEvents(): Event[] {
  return rows<EventRow>(`SELECT * FROM events WHERE status = 'open' ORDER BY expiry_ms`).map(
    toEvent,
  );
}

/** Open events plus those that closed since `sinceMs` (so the dashboard can show results). */
export function liveEvents(sinceMs: number): Event[] {
  return rows<EventRow>(
    `SELECT * FROM events WHERE expiry_ms > ? AND status != 'void' AND id NOT LIKE 'backfill:%' ORDER BY expiry_ms`,
    sinceMs,
  ).map(toEvent);
}

export function saveEvent(e: Event) {
  run(
    `INSERT OR IGNORE INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    e.id,
    e.source,
    e.horizon,
    e.expiryMs,
    e.strike,
    e.marketId,
    e.status,
    e.outcome,
    e.settlePrice,
    e.ctx,
    e.createdMs,
  );
}

export const hasForecasts = (eventId: string) =>
  rows(`SELECT 1 FROM forecasts WHERE event_id = ? LIMIT 1`, eventId).length > 0;

export function voidEvent(e: Event) {
  run(`UPDATE events SET status = 'void' WHERE id = ?`, e.id);
}

// ---------- lock ----------

/**
 * Map every quote onto the event, then lock it together with the memory and baseline
 * ensembles. Locked forecasts are never changed; they are what gets anchored and scored.
 */
export function lockForecasts(
  e: Event,
  ctx: string,
  quotes: Quote[],
  sigmaSqrtTau: number,
  at = Date.now(),
  /** Analysts' public calls Sibyl did not buy: recorded and scored, never used in the decision. */
  unused: Quote[] = [],
): VoiceP[] {
  const locked: VoiceP[] = [];
  transaction(() => {
    run(`UPDATE events SET ctx = ? WHERE id = ?`, ctx, e.id);
    const all = [...quotes.map((q) => ({ q, used: 1 })), ...unused.map((q) => ({ q, used: 0 }))];
    for (const { q, used } of all) {
      const p = normalise(q, e, sigmaSqrtTau);
      if (p === null) continue;
      if (used) locked.push({ voice: q.voice, p });
      run(
        `INSERT OR IGNORE INTO forecasts (id, event_id, voice, p, raw_p, raw_strike, oracle, ctx, locked_ms, used)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `${e.id}:${q.voice}`,
        e.id,
        q.voice,
        p,
        q.p,
        q.strike,
        q.oracle,
        ctx,
        at,
        used,
      );
    }
    if (!locked.length) return;
    const ensembles = [
      { voice: MEMORY, p: memoryEnsemble(ctx, locked) },
      { voice: BASELINE, p: baselineEnsemble(locked) },
    ];
    for (const { voice, p } of ensembles) {
      if (p === null) continue;
      run(
        `INSERT OR IGNORE INTO forecasts (id, event_id, voice, p, raw_p, raw_strike, oracle, ctx, locked_ms)
         VALUES (?, ?, ?, ?, ?, NULL, 'ensemble', ?, ?)`,
        `${e.id}:${voice}`,
        e.id,
        voice,
        p,
        p,
        ctx,
        at,
      );
    }
  });
  return locked;
}

// ---------- resolve and learn ----------

export type Settlement = { outcome: number; price: number | null };

/** Score, update trust, settle paper trades, remember the episode, and learn. */
export function applyResolution(
  e: Event,
  result: Settlement,
  at = Date.now(),
  episodeTag?: string,
) {
  // The stream and the polling loop can both see a settlement; only the first one counts.
  if (getEvent(e.id)?.status !== 'open') return;
  run(
    `UPDATE events SET status = 'resolved', outcome = ?, settle_price = ? WHERE id = ?`,
    result.outcome,
    result.price,
    e.id,
  );
  const forecasts = rows<VoiceP & { ctx: string }>(
    `SELECT voice, p, ctx FROM forecasts WHERE event_id = ?`,
    e.id,
  );
  if (!forecasts.length) return;
  const ctx = forecasts[0].ctx;
  const resolved: Event = {
    ...e,
    status: 'resolved',
    outcome: result.outcome,
    settlePrice: result.price,
    ctx,
  };

  scoreEvent(e.id, ctx, result.outcome, forecasts, at);
  settleTrades(e.id, result.outcome);
  rememberEpisode(resolved, result.outcome, forecasts, episodeTag);
  maybeRememberTrust(ctx);
  if (resolvedCount(ctx) % LESSON_EVERY === 0) learn(ctx, e);
}

/** Run every hypothesis test touched by this context and update the trade policy. */
export function learn(ctx: string, e: Event) {
  const changed = runCouncilLessons(ctx);
  const [, regime] = ctx.split('/') as [string, VolRegime];
  for (const agent of AGENTS) changed.push(...runAnalystLessons(agent, selfContext(e, regime)));
  const threshold = updatePolicy(ctx);
  if (changed.length || threshold !== null) {
    log('info', 'brain updated', {
      ctx,
      lessons: changed.map((l) => `${l.status} ${l.id}`),
      threshold,
    });
  }
}
