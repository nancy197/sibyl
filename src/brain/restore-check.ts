/**
 * The "amnesia test": checkpoint the brain to Walrus, wipe local beliefs, rebuild them from
 * Walrus only, and compare the next decisions. Used by `pnpm restore-test` and the dashboard.
 */
import { rows } from '../db.js';
import { AGENTS } from '../analysts/index.js';
import { signalPrice } from '../payments/server.js';
import { corrections, trustWeights } from '../scoring.js';
import { maybeRememberTrust, restoreBrain, wipeBrain, type RestoreSummary } from './brain.js';
import { checkpointLessonsAndPolicy, edgeThreshold } from './lessons.js';
import { flushOutbox, memoryMode, pendingBeliefs, pollOutbox } from './memwal.js';

const round = (x: number) => Math.round(x * 1e4) / 1e4;

/** JSON with object keys sorted, so equal beliefs compare equal whatever order rows came back in. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}
const DRAIN_ATTEMPTS = 60;
const DRAIN_PAUSE_MS = 3_000;

/** Everything that drives the next forecast, trade and purchase, per context. */
export function nextDecisions() {
  const contexts = rows<{ ctx: string }>(`SELECT DISTINCT ctx FROM trust ORDER BY ctx`).map(
    (r) => r.ctx,
  );
  return Object.fromEntries(
    contexts.map((ctx) => {
      const voices = rows<{ voice: string }>(
        `SELECT voice FROM trust WHERE ctx = ? ORDER BY voice`,
        ctx,
      ).map((r) => r.voice);
      const weights = Object.fromEntries(
        Object.entries(trustWeights(ctx, voices)).map(([v, w]) => [v, round(w)]),
      );
      return [
        ctx,
        {
          weights,
          corrections: Object.fromEntries(corrections(ctx)),
          edgeThreshold: round(edgeThreshold(ctx)),
          prices: Object.fromEntries(AGENTS.map((a) => [a, signalPrice(a, ctx)])),
        },
      ];
    }),
  );
}

/** Wait until every belief memory is stored in Walrus (recall only sees finished writes). */
async function drainOutbox() {
  const pending = pendingBeliefs;
  for (let attempt = 0; attempt < DRAIN_ATTEMPTS && pending(); attempt++) {
    await flushOutbox();
    await new Promise((resolve) => setTimeout(resolve, DRAIN_PAUSE_MS));
    await pollOutbox();
  }
  if (pending()) throw new Error(`${pending()} memories still pending; try again in a minute`);
}

export type AmnesiaReport = {
  backend: string;
  contexts: number;
  restored: RestoreSummary;
  changed: { ctx: string; before: unknown; after: unknown }[];
  pass: boolean;
  tookMs: number;
};

export async function amnesiaTest(): Promise<AmnesiaReport> {
  const started = Date.now();
  const contexts = rows<{ ctx: string }>(`SELECT DISTINCT ctx FROM trust`).map((r) => r.ctx);
  // Checkpoint the latest beliefs, so Walrus holds exactly what we are about to forget.
  for (const ctx of contexts) maybeRememberTrust(ctx, true);
  checkpointLessonsAndPolicy();
  await drainOutbox();

  const before = nextDecisions();
  wipeBrain();
  const restored = await restoreBrain(AGENTS);
  const after = nextDecisions();

  const changed = Object.keys({ ...before, ...after })
    .filter((ctx) => canonical(before[ctx]) !== canonical(after[ctx]))
    .map((ctx) => ({ ctx, before: before[ctx], after: after[ctx] }));
  return {
    backend: memoryMode,
    contexts: Object.keys(before).length,
    restored,
    changed,
    pass: changed.length === 0,
    tookMs: Date.now() - started,
  };
}
