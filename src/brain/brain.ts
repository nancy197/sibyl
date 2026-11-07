/**
 * What Sibyl remembers in Walrus, and how it rebuilds its beliefs from Walrus alone.
 */
import { one, rows, run, transaction } from '../db.js';
import type { Event } from '../events.js';
import { isEnsemble, type VoiceP } from '../scoring.js';
import { readNamespace, remember } from './memwal.js';
import { councilRight, situationOf, type EpisodeSituation } from './recall.js';
import { saveLesson } from './lessons.js';
import {
  fixed,
  MEMORY_SCHEMA,
  memoryData,
  memoryLine,
  NS,
  type Lesson,
  type PolicyRecord,
  type TrustSnapshot,
} from './schema.js';

/** Write a trust snapshot when any weight moved this much since the last snapshot... */
const TRUST_MOVE = 0.05;
/** ...or after this many resolutions in the context, whichever comes first... */
const TRUST_EVERY = 25;
/** ...but at most once per this interval per context, to stay inside the daily write budget. */
const TRUST_MIN_INTERVAL_MS = 30 * 60_000;

/**
 * One memory per resolved 5m+ event (1m events are too many; their learning shows up in trust).
 * The situation sentence comes first so semantic recall matches on it.
 */
export function rememberEpisode(e: Event, outcome: number, forecasts: VoiceP[], tag = 'EPISODE') {
  if (e.horizon === '1m') return;
  const seen = situationOf(e.id);
  const situation: EpisodeSituation | undefined = seen && {
    description: seen.description,
    gap: seen.gap,
    councilRight: councilRight(seen.gap, outcome),
  };
  const verdict =
    situation?.councilRight == null
      ? ''
      : situation.councilRight
        ? ', council was right'
        : ', market was right';
  const voices = forecasts.filter((f) => !isEnsemble(f.voice));
  const ensembles = forecasts.filter((f) => isEnsemble(f.voice));
  const head = [
    `${tag} ${situation?.description ?? `${e.horizon} BTC`} -> outcome ${outcome ? 'UP' : 'DOWN'}${verdict}`,
    `BTC>${e.strike} @${new Date(e.expiryMs).toISOString()} ctx=${e.ctx}`,
    voices.map((f) => `${f.voice} ${fixed(f.p)}`).join(' '),
    ensembles.map((f) => `${f.voice.replace('ensemble:', '')} ${fixed(f.p)}`).join(' '),
  ].join(' | ');
  remember(
    NS.episodes,
    memoryLine(head, {
      kind: 'episode',
      eventId: e.id,
      horizon: e.horizon,
      ctx: e.ctx,
      outcome,
      settlePrice: e.settlePrice,
      situation,
      forecasts,
    }),
  );
}

let lastSnapshot = new Map<string, { at: number; weights: Record<string, number> }>();

/** Version the trust state of a context in Walrus when it changed enough to matter (or when forced). */
export function maybeRememberTrust(ctx: string, force = false) {
  const weights = rows<{ voice: string; weight: number; n: number }>(
    `SELECT voice, weight, n FROM trust WHERE ctx = ? ORDER BY weight DESC`,
    ctx,
  );
  if (!weights.length) return;
  const n = weights[0].n;
  const current = Object.fromEntries(weights.map((w) => [w.voice, w.weight]));
  const previous = lastSnapshot.get(ctx);
  const moved =
    !previous ||
    weights.some((w) => Math.abs(w.weight - (previous.weights[w.voice] ?? 0)) > TRUST_MOVE);
  const due = moved || n % TRUST_EVERY === 0;
  const tooSoon = previous !== undefined && Date.now() - previous.at < TRUST_MIN_INTERVAL_MS;
  if (!force && (!due || tooSoon)) return;
  lastSnapshot.set(ctx, { at: Date.now(), weights: current });
  const snapshot: TrustSnapshot = { kind: 'trust', ctx, n, weights: current };
  const head = `TRUST v${n} ctx=${ctx} ${weights.map((w) => `${w.voice} ${fixed(w.weight)}`).join(' ')} (n=${n})`;
  remember(NS.trust, memoryLine(head, snapshot));
}

/** Summarise a window of payment decisions (one memory per window keeps the write rate sane). */
export function rememberPayments(startMs: number, endMs: number) {
  const decisions = rows<{
    agent: string;
    ctx: string;
    price: number;
    voi: number;
    decision: string;
    digest: string | null;
  }>(
    `SELECT agent, ctx, price, voi, decision, digest FROM payments WHERE at_ms >= ? AND at_ms < ? ORDER BY at_ms`,
    startMs,
    endMs,
  );
  if (!decisions.length) return;
  const bought = decisions.filter((d) => d.decision === 'paid' || d.decision === 'bought');
  const spent = bought.reduce((a, d) => a + d.price, 0);
  const head = `PAYMENTS ${new Date(startMs).toISOString()} decisions=${decisions.length} bought=${bought.length} spent=${fixed(spent, 4)} USDC`;
  remember(NS.payments, memoryLine(head, { kind: 'payments', startMs, endMs, decisions }));
}

// ---------- restore ----------

type Stamped = { at?: number };

/** Keep the latest record per key, ranked by `rank` then write time (recall order is not trusted). */
function latestBy<T extends Stamped>(
  items: T[],
  key: (item: T) => string,
  rank: (item: T) => number = () => 0,
): T[] {
  const best = new Map<string, T>();
  for (const item of items) {
    const current = best.get(key(item));
    const newer =
      !current ||
      rank(item) > rank(current) ||
      (rank(item) === rank(current) && (item.at ?? 0) > (current.at ?? 0));
    if (newer) best.set(key(item), item);
  }
  return [...best.values()];
}

async function readRecords<T extends { kind: string } & Stamped>(
  namespace: string,
  kind: string,
): Promise<T[]> {
  const texts = await readNamespace(namespace);
  return texts
    .map((t) => memoryData<T & { v?: number }>(t))
    .filter((d): d is T & { v: number } => d?.kind === kind && d.v === MEMORY_SCHEMA);
}

export type RestoreSummary = { trust: number; lessons: number; policies: number };

/**
 * Rebuild trust, lessons and trade policy from Walrus only (latest record per key wins).
 * Raw scores stay local; they are evidence, not beliefs.
 */
export async function restoreBrain(agents: readonly string[]): Promise<RestoreSummary> {
  const trust = latestBy(
    await readRecords<TrustSnapshot & Stamped>(NS.trust, 'trust'),
    (s) => s.ctx,
    (s) => s.n,
  );
  type LessonRecord = { kind: 'lesson'; lesson: Lesson } & Stamped;
  const namespaces = [NS.lessons, ...agents.map(NS.analyst)];
  const lessonRecords = (
    await Promise.all(namespaces.map((ns) => readRecords<LessonRecord>(ns, 'lesson')))
  ).flat();
  const lessons = latestBy(lessonRecords, (r) => r.lesson.id).map((r) => r.lesson);
  const policies = latestBy(
    await readRecords<PolicyRecord & Stamped>(NS.policy, 'policy'),
    (p) => p.ctx,
  );

  transaction(() => {
    for (const snapshot of trust) {
      const local = one<{ n: number }>(
        `SELECT COALESCE(MAX(n), 0) n FROM trust WHERE ctx = ?`,
        snapshot.ctx,
      )!.n;
      if (local >= snapshot.n) continue;
      for (const [voice, weight] of Object.entries(snapshot.weights)) {
        run(
          `INSERT OR REPLACE INTO trust VALUES (?, ?, ?, ?, ?)`,
          snapshot.ctx,
          voice,
          weight,
          snapshot.n,
          Date.now(),
        );
      }
      lastSnapshot.set(snapshot.ctx, { at: Date.now(), weights: snapshot.weights });
    }
    for (const lesson of lessons) saveLesson(lesson);
    for (const policy of policies) {
      run(
        `INSERT OR REPLACE INTO policy VALUES (?, ?, ?, ?)`,
        policy.ctx,
        policy.edgeThreshold,
        policy.reason,
        Date.now(),
      );
    }
  });
  return { trust: trust.length, lessons: lessons.length, policies: policies.length };
}

/** Forget the brain (not the evidence). Used by the restore test. */
export function wipeBrain() {
  transaction(() => {
    run(`DELETE FROM trust`);
    run(`DELETE FROM trust_history`);
    run(`DELETE FROM lessons`);
    run(`DELETE FROM policy`);
  });
  lastSnapshot = new Map();
}
