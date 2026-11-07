/**
 * Memory line format: a human-readable head, then " | ", then a JSON tail that restore parses.
 *   TRUST v17 ctx=5m/high/us kalshi 0.41 deepbook 0.33 (n=212) | {"ctx":"5m/high/us",...}
 */
/** Set MEMORY_NAMESPACE (for example "sibyl-dev") to keep test runs out of the real brain. */
const PREFIX = process.env.MEMORY_NAMESPACE?.trim() || 'sibyl';
const ANALYST_PREFIX = PREFIX === 'sibyl' ? 'analyst' : `${PREFIX}:analyst`;

export const NS = {
  episodes: `${PREFIX}:episodes`,
  trust: `${PREFIX}:trust`,
  lessons: `${PREFIX}:lessons`,
  policy: `${PREFIX}:policy`,
  payments: `${PREFIX}:payments`,
  analyst: (agent: string) => `${ANALYST_PREFIX}:${agent}`,
} as const;

/**
 * Record format version (restore ignores other versions, since memories cannot be deleted) and
 * write time (restore keeps the latest record per key, whatever order recall returns).
 */
export const MEMORY_SCHEMA = 2;

export function memoryLine(head: string, data: object): string {
  return `${head} | ${JSON.stringify({ ...data, v: MEMORY_SCHEMA, at: Date.now() })}`;
}

/** Parse the JSON tail of a memory line, or null if the line has none. */
export function memoryData<T>(text: string): T | null {
  const start = text.lastIndexOf(' | {');
  if (start < 0) return null;
  try {
    return JSON.parse(text.slice(start + 3)) as T;
  } catch {
    return null;
  }
}

export const fixed = (x: number, digits = 2) => x.toFixed(digits);

export type TrustSnapshot = {
  kind: 'trust';
  ctx: string;
  n: number;
  weights: Record<string, number>;
};

export type LessonStatus = 'PROMOTED' | 'RETIRED';
export type LessonKind = 'beats' | 'bias' | 'overconfident' | 'self-overconfident';
export type Lesson = {
  kind: LessonKind;
  /** Stable hypothesis ID: the same hypothesis can be promoted, retired and promoted again. */
  id: string;
  /** "sibyl" for council lessons, "analyst:<name>" for an analyst's own lessons. */
  scope: string;
  ctx: string;
  /** The voice whose treatment changes. */
  voice: string;
  status: LessonStatus;
  /** Numeric effect: Brier gap, bias, or calibration slope, depending on kind. */
  effect: number;
  /** Sign of the tested quantity; a flip retires the lesson. */
  direction: number;
  statement: string;
  /** What Sibyl does differently because of this lesson. */
  action: string;
  pValue: number;
  n: number;
};

export type PolicyRecord = { kind: 'policy'; ctx: string; edgeThreshold: number; reason: string };
