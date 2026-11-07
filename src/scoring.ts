/**
 * Scoring and trust. Each context keeps Hedge (multiplicative) weights over voices; the memory
 * ensemble pools voices in logit space with those weights, after applying promoted lessons.
 * The baseline ensemble uses equal weights and no lessons: the A/B that shows memory matters.
 */
import { one, rows, run, transaction } from './db.js';
import { brier, clampP, logit, logLoss, sigmoid } from './math.js';

export const MEMORY = 'ensemble:memory';
export const BASELINE = 'ensemble:baseline';
export const isEnsemble = (voice: string) => voice.startsWith('ensemble:');
/** The market we trade against never votes in the trade signal. */
export const MARKET_VOICE = 'deepbook';

/**
 * Hedge's schedule eta = sqrt(8 ln N / t) is very aggressive for the first few events. Counting
 * this many virtual events up front keeps one lucky call from deciding trust in a new context.
 */
const HEDGE_WARMUP_EVENTS = 20;
/** A voice keeps at least this share of each update, so it can earn trust back after a bad run. */
const WEIGHT_FLOOR = 0.02;

export type VoiceP = { voice: string; p: number };

/** Hedge weights for `voices` in a context, normalised to sum to 1. Unseen voices start equal. */
export function trustWeights(ctx: string, voices: string[]): Record<string, number> {
  const saved = new Map(
    rows<{ voice: string; weight: number }>(
      `SELECT voice, weight FROM trust WHERE ctx = ?`,
      ctx,
    ).map((r) => [r.voice, r.weight]),
  );
  const fallback = 1 / Math.max(1, voices.length);
  const raw = voices.map((v) => saved.get(v) ?? fallback);
  const total = raw.reduce((a, b) => a + b, 0);
  return Object.fromEntries(voices.map((v, i) => [v, raw[i] / total]));
}

export function resolvedCount(ctx: string): number {
  return one<{ n: number }>(`SELECT COALESCE(MAX(n), 0) n FROM trust WHERE ctx = ?`, ctx)!.n;
}

/**
 * Hedge update after one resolved event:  w_i <- w_i * exp(-eta * Brier_i),
 * with the standard schedule eta = sqrt(8 ln N / t) (t offset by a short warm-up).
 * "Sleeping experts": only voices that spoke compete, and their total weight is preserved,
 * so a voice that was silent on this event neither gains nor loses.
 */
export function hedgeUpdate(
  ctx: string,
  losses: { voice: string; loss: number }[],
  at = Date.now(),
) {
  if (!losses.length) return;
  const t = resolvedCount(ctx) + 1;
  const known = rows<{ voice: string }>(`SELECT voice FROM trust WHERE ctx = ?`, ctx).map(
    (r) => r.voice,
  );
  const voices = [...new Set([...known, ...losses.map((l) => l.voice)])];
  const eta = Math.sqrt((8 * Math.log(Math.max(2, voices.length))) / (t + HEDGE_WARMUP_EVENTS));
  const before = trustWeights(ctx, voices);
  const lossOf = new Map(losses.map((l) => [l.voice, l.loss]));

  const awake = voices.filter((v) => lossOf.has(v));
  const awakeMass = awake.reduce((a, v) => a + before[v], 0);
  const updated = awake.map((v) => before[v] * Math.exp(-eta * lossOf.get(v)!));
  // Floor each awake voice's share of the awake mass, then hand that mass back unchanged.
  const shares = updated.map((w) => Math.max(WEIGHT_FLOOR, w / updated.reduce((a, b) => a + b, 0)));
  const shareTotal = shares.reduce((a, b) => a + b, 0);
  const next = new Map(awake.map((v, i) => [v, (shares[i] / shareTotal) * awakeMass]));

  transaction(() =>
    voices.forEach((voice) => {
      const weight = next.get(voice) ?? before[voice];
      run(
        `INSERT INTO trust (ctx, voice, weight, n, updated_ms) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (ctx, voice) DO UPDATE SET weight = excluded.weight, n = excluded.n, updated_ms = excluded.updated_ms`,
        ctx,
        voice,
        weight,
        t,
        at,
      );
      run(`INSERT OR REPLACE INTO trust_history VALUES (?, ?, ?, ?, ?)`, ctx, voice, weight, t, at);
    }),
  );
}

/** How promoted council lessons change one voice in one context. */
export type Correction = { bias: number; slope: number; excluded: boolean };
const NO_CORRECTION: Correction = { bias: 0, slope: 1, excluded: false };

export function corrections(ctx: string): Map<string, Correction> {
  const lessons = rows<{ kind: string; voice: string; effect: number }>(
    `SELECT kind, voice, effect FROM lessons WHERE scope = 'sibyl' AND ctx = ? AND status = 'PROMOTED'`,
    ctx,
  );
  const out = new Map<string, Correction>();
  for (const lesson of lessons) {
    const c = { ...(out.get(lesson.voice) ?? NO_CORRECTION) };
    if (lesson.kind === 'bias') c.bias = lesson.effect;
    if (lesson.kind === 'overconfident') c.slope = lesson.effect;
    if (lesson.kind === 'beats') c.excluded = true;
    out.set(lesson.voice, c);
  }
  return out;
}

/** Remove a learned bias, then shrink toward 0.5 by the learned calibration slope. */
export function applyCorrection(p: number, c: Correction = NO_CORRECTION): number {
  return clampP(0.5 + c.slope * (p - c.bias - 0.5));
}

/** Weighted average in logit space. */
export function logitPool(items: { p: number; w: number }[]): number {
  const total = items.reduce((a, x) => a + x.w, 0);
  if (!items.length || total <= 0) return 0.5;
  return clampP(sigmoid(items.reduce((a, x) => a + x.w * logit(x.p), 0) / total));
}

/** The venue whose own price an event is traded (or compared) against. */
export const marketVoiceFor = (source: string) => (source === 'kalshi' ? 'kalshi' : MARKET_VOICE);

/**
 * Sibyl's forecast. Given a `market` voice (the price we would trade against), that voice and
 * any voice a lesson excluded are left out: the result is the council's independent view.
 */
export function memoryEnsemble(ctx: string, quotes: VoiceP[], market?: string): number | null {
  const fixes = corrections(ctx);
  const usable = quotes.filter(
    (q) =>
      !isEnsemble(q.voice) && !(market && (q.voice === market || fixes.get(q.voice)?.excluded)),
  );
  if (!usable.length) return null;
  const weights = trustWeights(
    ctx,
    usable.map((q) => q.voice),
  );
  return logitPool(
    usable.map((q) => ({ p: applyCorrection(q.p, fixes.get(q.voice)), w: weights[q.voice] })),
  );
}

/** Equal weights, no lessons. */
export function baselineEnsemble(quotes: VoiceP[], market?: string): number | null {
  const usable = quotes.filter((q) => !isEnsemble(q.voice) && q.voice !== market);
  return usable.length ? logitPool(usable.map((q) => ({ p: q.p, w: 1 }))) : null;
}

/** Store scores for every locked forecast of a resolved event, then update trust. */
export function scoreEvent(
  eventId: string,
  ctx: string,
  outcome: number,
  forecasts: VoiceP[],
  at = Date.now(),
) {
  transaction(() => {
    for (const f of forecasts) {
      run(
        `INSERT OR IGNORE INTO scores VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        eventId,
        f.voice,
        ctx,
        f.p,
        outcome,
        brier(f.p, outcome),
        logLoss(f.p, outcome),
        at,
      );
    }
  });
  hedgeUpdate(
    ctx,
    forecasts
      .filter((f) => !isEnsemble(f.voice))
      .map((f) => ({ voice: f.voice, loss: brier(f.p, outcome) })),
    at,
  );
}

/** Ten-bin reliability diagram data for one voice in one context. */
export function reliability(ctx: string, voice: string) {
  const data = rows<{ p: number; outcome: number }>(
    `SELECT p, outcome FROM scores WHERE ctx = ? AND voice = ?`,
    ctx,
    voice,
  );
  return Array.from({ length: 10 }, (_, bin) => {
    const inBin = data.filter((x) => Math.min(9, Math.floor(x.p * 10)) === bin);
    const avg = (f: (x: { p: number; outcome: number }) => number) =>
      inBin.length ? inBin.reduce((a, x) => a + f(x), 0) / inBin.length : null;
    return { bin, n: inBin.length, forecast: avg((x) => x.p), observed: avg((x) => x.outcome) };
  });
}
