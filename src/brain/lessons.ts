/**
 * Lesson engine: deterministic hypothesis tests over scored forecasts. No LLM decides anything.
 *
 * Council hypotheses per context:
 *   beats(A, B)       A's Brier is lower than B's on the same events  -> B leaves the trade signal
 *   bias(V)           V's mean error p - outcome differs from 0       -> subtract the bias from V
 *   overconfident(V)  slope of outcome on V's p is below 1            -> shrink V toward 0.5
 * Analyst hypothesis per analyst and horizon/regime:
 *   self-overconfident -> the analyst shrinks its own calls before selling them
 *
 * A hypothesis is PROMOTED when p < alpha / m (Bonferroni over the m hypotheses tested together)
 * with at least 30 samples, and RETIRED when its evidence fades (p > 0.2) or the sign flips.
 * Only promoted or retired lessons are stored and written to Walrus.
 */
import { one, rows, run } from '../db.js';
import { clamp, mean, meanTest, slope, twoSidedP } from '../math.js';
import { isEnsemble, MEMORY } from '../scoring.js';
import { remember } from './memwal.js';
import {
  fixed,
  memoryLine,
  NS,
  type Lesson,
  type LessonKind,
  type LessonStatus,
} from './schema.js';

export const MIN_SAMPLES = 30;
const ALPHA = 0.05;
/** Retire only when evidence is clearly gone; the gap to alpha stops lessons flip-flopping. */
const RETIRE_P = 0.2;
/** Most recent events per context used in a test. */
const TEST_WINDOW = 300;
/** A promoted lesson is re-written only when its numeric effect moves by more than this. */
const EFFECT_STEP = 0.02;
/** Calibration slopes are kept in this range so one bad sample cannot flatten a voice. */
const SLOPE_RANGE: [number, number] = [0.3, 1];

type Score = { event_id: string; voice: string; p: number; outcome: number; brier: number };

export type TestResult = Omit<Lesson, 'status' | 'scope'> & { significant: boolean };

// ---------- pure tests ----------

/** Paired test on per-event Brier differences of two voices. */
export function testBeats(
  ctx: string,
  a: string,
  b: string,
  data: Score[],
  m: number,
): TestResult | null {
  const byEvent = new Map(data.filter((s) => s.voice === b).map((s) => [s.event_id, s.brier]));
  const diffs = data
    .filter((s) => s.voice === a && byEvent.has(s.event_id))
    .map((s) => s.brier - byEvent.get(s.event_id)!);
  if (diffs.length < MIN_SAMPLES) return null;
  const t = meanTest(diffs);
  const [winner, loser] = t.mean < 0 ? [a, b] : [b, a];
  return {
    kind: 'beats',
    id: `beats:${ctx}:${[a, b].sort().join('|')}`,
    ctx,
    voice: loser,
    effect: Math.abs(t.mean),
    direction: Math.sign(t.mean),
    statement: `${winner} beats ${loser} in ${ctx} by ${fixed(Math.abs(t.mean), 4)} Brier`,
    action: `leave ${loser} out of the trade signal${loser.startsWith('analyst:') ? ' and stop buying it' : ''} in ${ctx}`,
    pValue: t.p,
    n: t.n,
    significant: t.p < ALPHA / m,
  };
}

/** Does the voice lean up or down on average? */
export function testBias(ctx: string, voice: string, own: Score[], m: number): TestResult | null {
  if (own.length < MIN_SAMPLES) return null;
  const t = meanTest(own.map((s) => s.p - s.outcome));
  return {
    kind: 'bias',
    id: `bias:${ctx}:${voice}`,
    ctx,
    voice,
    effect: t.mean,
    direction: Math.sign(t.mean),
    statement: `${voice} is biased ${t.mean > 0 ? 'up' : 'down'} by ${fixed(Math.abs(t.mean), 3)} in ${ctx}`,
    action: `subtract ${fixed(t.mean, 3)} from ${voice} before pooling in ${ctx}`,
    pValue: t.p,
    n: t.n,
    significant: t.p < ALPHA / m,
  };
}

/** Calibration slope of outcomes on probabilities; below 1 means the voice is overconfident. */
export function testOverconfidence(
  ctx: string,
  voice: string,
  own: { p: number; outcome: number }[],
  m: number,
  kind: LessonKind = 'overconfident',
  idPrefix = 'overconfident',
): TestResult | null {
  if (own.length < MIN_SAMPLES) return null;
  const fit = slope(
    own.map((s) => s.p),
    own.map((s) => s.outcome),
  );
  const pValue = Number.isFinite(fit.se) && fit.se > 0 ? twoSidedP((fit.slope - 1) / fit.se) : 1;
  const effect = clamp(fit.slope, ...SLOPE_RANGE);
  return {
    kind,
    id: `${idPrefix}:${ctx}:${voice}`,
    ctx,
    voice,
    effect,
    direction: fit.slope < 1 ? -1 : 1,
    statement: `${voice} is overconfident in ${ctx}: calibration slope ${fixed(fit.slope)}`,
    action: `shrink ${voice} toward 0.5 by ${fixed(effect)} in ${ctx}`,
    pValue,
    n: own.length,
    significant: fit.slope < 1 && pValue < ALPHA / m,
  };
}

/**
 * State machine for one hypothesis. Returns the new status, or null when nothing changes.
 *   none/RETIRED + significant           -> PROMOTED
 *   PROMOTED + (p > 0.2 or sign flipped) -> RETIRED
 *   PROMOTED + effect moved materially   -> PROMOTED (updated effect)
 */
export function nextStatus(
  previous: { status: LessonStatus; effect: number; direction: number } | undefined,
  result: TestResult,
): LessonStatus | null {
  if (previous?.status !== 'PROMOTED') return result.significant ? 'PROMOTED' : null;
  if (result.pValue > RETIRE_P || result.direction !== previous.direction) return 'RETIRED';
  if (result.significant && Math.abs(result.effect - previous.effect) > EFFECT_STEP)
    return 'PROMOTED';
  return null;
}

// ---------- persistence ----------

function previousOf(id: string) {
  return one<{ status: LessonStatus; effect: number; direction: number }>(
    `SELECT status, effect, direction FROM lessons WHERE id = ?`,
    id,
  );
}

export function saveLesson(lesson: Lesson, at = Date.now()) {
  run(
    `INSERT OR REPLACE INTO lessons VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    lesson.id,
    lesson.scope,
    lesson.ctx,
    lesson.kind,
    lesson.voice,
    lesson.status,
    lesson.effect,
    lesson.direction,
    lesson.statement,
    lesson.action,
    lesson.pValue,
    lesson.n,
    at,
  );
}

function lessonMemory(lesson: Lesson): string {
  const head = `LESSON ${lesson.status} "${lesson.statement}" p=${lesson.pValue.toExponential(2)} n=${lesson.n} effect: ${lesson.action}`;
  return memoryLine(head, { kind: 'lesson', lesson });
}

function rememberLesson(lesson: Lesson) {
  const namespace =
    lesson.scope === 'sibyl' ? NS.lessons : NS.analyst(lesson.scope.replace('analyst:', ''));
  remember(namespace, lessonMemory(lesson));
}

function apply(result: TestResult, scope: string): Lesson | null {
  const status = nextStatus(previousOf(result.id), result);
  if (!status) return null;
  const { significant: _significant, ...fields } = result;
  const lesson: Lesson = { ...fields, scope, status };
  saveLesson(lesson);
  rememberLesson(lesson);
  return lesson;
}

type LessonRow = Omit<Lesson, 'pValue'> & { p_value: number };

/** Re-write every stored lesson and policy as the latest record (a checkpoint of beliefs). */
export function checkpointLessonsAndPolicy() {
  for (const { p_value, ...row } of rows<LessonRow>(
    `SELECT id, scope, ctx, kind, voice, status, effect, direction, statement, action, p_value, n FROM lessons`,
  )) {
    rememberLesson({ ...row, pValue: p_value });
  }
  for (const p of rows<{ ctx: string; edge_threshold: number; reason: string }>(
    `SELECT * FROM policy`,
  )) {
    rememberPolicy(p.ctx, p.edge_threshold, p.reason);
  }
}

// ---------- runners ----------

function recentScores(ctx: string): Score[] {
  return rows<Score>(
    `SELECT s.event_id, s.voice, s.p, s.outcome, s.brier FROM scores s
     WHERE s.ctx = ? AND s.event_id IN (
       SELECT event_id FROM scores WHERE ctx = ? GROUP BY event_id ORDER BY MAX(at_ms) DESC LIMIT ?)`,
    ctx,
    ctx,
    TEST_WINDOW,
  );
}

/** Test every council hypothesis in a context and apply status changes. */
export function runCouncilLessons(ctx: string): Lesson[] {
  const data = recentScores(ctx);
  const voices = [...new Set(data.map((s) => s.voice))].filter((v) => !isEnsemble(v)).sort();
  const pairs = voices.flatMap((a, i) => voices.slice(i + 1).map((b) => [a, b] as const));
  const m = Math.max(1, pairs.length + 2 * voices.length);
  const results: (TestResult | null)[] = [
    ...pairs.map(([a, b]) => testBeats(ctx, a, b, data, m)),
    ...voices.flatMap((v) => {
      const own = data.filter((s) => s.voice === v);
      return [testBias(ctx, v, own, m), testOverconfidence(ctx, v, own, m)];
    }),
  ];
  return results
    .flatMap((r) => (r ? [apply(r, 'sibyl')] : []))
    .filter((l): l is Lesson => l !== null);
}

/** Each analyst checks its own raw calls per horizon/regime and learns how much to shrink them. */
export function runAnalystLessons(agent: string, key: string): Lesson[] {
  const calls = rows<{ p: number; outcome: number }>(
    `SELECT c.raw_p p, e.outcome FROM analyst_calls c JOIN events e ON e.id = c.event_id
     WHERE c.agent = ? AND c.self_ctx = ? AND e.status = 'resolved' ORDER BY c.at_ms DESC LIMIT ?`,
    agent,
    key,
    TEST_WINDOW,
  );
  const result = testOverconfidence(
    key,
    `analyst:${agent}`,
    calls,
    1,
    'self-overconfident',
    `self:${agent}`,
  );
  const lesson = result
    ? apply(
        {
          ...result,
          action: `analyst ${agent} shrinks its own ${key} calls by ${fixed(result.effect)}`,
        },
        `analyst:${agent}`,
      )
    : null;
  return lesson ? [lesson] : [];
}

/** The shrink factor an analyst applies to its own calls (1 = no lesson). */
export function selfShrink(agent: string, key: string): number {
  const row = one<{ effect: number }>(
    `SELECT effect FROM lessons WHERE id = ? AND status = 'PROMOTED'`,
    `self:${agent}:${key}`,
  );
  return row?.effect ?? 1;
}

// ---------- trade policy ----------

/** Minimum edge to trade: 0.02 USDC order fee on a ~1 USDC stake plus a few points of model error. */
export const BASE_EDGE = 0.05;
const MAX_EDGE = 0.2;
const POLICY_STEP = 0.01;
const CALIBRATION_BINS = 5;

/** Weighted mean |forecast - observed| over probability bins (expected calibration error). */
export function calibrationError(data: { p: number; outcome: number }[]): number {
  if (!data.length) return 0;
  let total = 0;
  for (let bin = 0; bin < CALIBRATION_BINS; bin++) {
    const inBin = data.filter(
      (x) => Math.min(CALIBRATION_BINS - 1, Math.floor(x.p * CALIBRATION_BINS)) === bin,
    );
    if (inBin.length)
      total +=
        inBin.length * Math.abs(mean(inBin.map((x) => x.p)) - mean(inBin.map((x) => x.outcome)));
  }
  return total / data.length;
}

export function edgeThreshold(ctx: string): number {
  return (
    one<{ edge_threshold: number }>(`SELECT edge_threshold FROM policy WHERE ctx = ?`, ctx)
      ?.edge_threshold ?? BASE_EDGE
  );
}

/** Raise the edge needed to trade in a context by how miscalibrated Sibyl itself has been there. */
export function updatePolicy(ctx: string): number | null {
  const own = rows<{ p: number; outcome: number }>(
    `SELECT p, outcome FROM scores WHERE ctx = ? AND voice = ? ORDER BY at_ms DESC LIMIT ?`,
    ctx,
    MEMORY,
    TEST_WINDOW,
  );
  if (own.length < MIN_SAMPLES) return null;
  const error = calibrationError(own);
  const threshold = clamp(BASE_EDGE + error, BASE_EDGE, MAX_EDGE);
  if (Math.abs(threshold - edgeThreshold(ctx)) < POLICY_STEP) return null;
  const reason = `memory ensemble calibration error ${fixed(error, 3)} over ${own.length} events`;
  run(`INSERT OR REPLACE INTO policy VALUES (?, ?, ?, ?)`, ctx, threshold, reason, Date.now());
  rememberPolicy(ctx, threshold, reason);
  return threshold;
}

function rememberPolicy(ctx: string, threshold: number, reason: string) {
  const excluded = rows<{ voice: string }>(
    `SELECT voice FROM lessons WHERE scope = 'sibyl' AND kind = 'beats' AND status = 'PROMOTED' AND ctx = ?`,
    ctx,
  ).map((r) => r.voice);
  const head = `POLICY ctx=${ctx} edge>=${fixed(threshold, 3)} exclude=[${excluded.join(',')}] reason="${reason}"`;
  remember(NS.policy, memoryLine(head, { kind: 'policy', ctx, edgeThreshold: threshold, reason }));
}
