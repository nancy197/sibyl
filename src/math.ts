/** Numeric helpers: normal distribution, probability transforms, scoring rules and small stats. */

const EPS = 1e-6;

/** Keep probabilities away from 0 and 1 so logs and logits stay finite. */
export const clampP = (p: number) => Math.min(1 - EPS, Math.max(EPS, p));
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)));
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Brier score: squared error of a probability against a 0/1 outcome (lower is better). */
export const brier = (p: number, outcome: number) => (p - outcome) ** 2;
/** Log loss in nats (lower is better). */
export const logLoss = (p: number, outcome: number) =>
  -(outcome * Math.log(clampP(p)) + (1 - outcome) * Math.log(1 - clampP(p)));

/** Standard normal CDF (Abramowitz and Stegun 26.2.17, absolute error < 7.5e-8). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const density = Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);
  const poly =
    t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const upper = density * poly;
  return x >= 0 ? 1 - upper : upper;
}

/** Inverse standard normal CDF (Acklam's rational approximation, relative error < 1.2e-9). */
export function normalInv(p: number): number {
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716,
    2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972,
    -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const q = clampP(p);
  const tail = 0.02425;
  if (q < tail || q > 1 - tail) {
    const r = Math.sqrt(-2 * Math.log(q < tail ? q : 1 - q));
    const x =
      (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) /
      ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
    return q < tail ? x : -x;
  }
  const s = q - 0.5;
  const r = s * s;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * s) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/**
 * Move a digital "S_T > K'" probability to another strike K under a lognormal model:
 *   P(S_T > K) = Phi( PhiInv(P') + ln(K'/K) / (sigma * sqrt(tau)) )
 * `sigmaSqrtTau` is the log-price standard deviation until expiry.
 */
export function shiftStrike(p: number, fromStrike: number, toStrike: number, sigmaSqrtTau: number) {
  if (fromStrike === toStrike) return clampP(p);
  const spread = Math.max(sigmaSqrtTau, EPS);
  return clampP(normalCdf(normalInv(p) + Math.log(fromStrike / toStrike) / spread));
}

/**
 * Implied log-price standard deviation from two digital prices on the same expiry:
 *   sigma * sqrt(tau) = ln(K2/K1) / (PhiInv(P1) - PhiInv(P2)),  with K1 < K2 and P1 > P2.
 */
export function impliedSigmaSqrtTau(k1: number, p1: number, k2: number, p2: number): number {
  const gap = normalInv(p1) - normalInv(p2);
  if (!(k1 > 0 && k2 > k1 && gap > 0)) throw new Error('strike probabilities are not monotone');
  return Math.log(k2 / k1) / gap;
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((sum, x) => sum + x, 0) / xs.length : 0;
}

export function sampleSd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Two-sided p-value of a z statistic. */
export const twoSidedP = (z: number) => 2 * (1 - normalCdf(Math.abs(z)));

/**
 * Test whether the mean of `xs` differs from zero (paired test on differences).
 * Uses the normal approximation, so callers should require n >= 30.
 */
export function meanTest(xs: number[]): { n: number; mean: number; z: number; p: number } {
  const n = xs.length;
  const m = mean(xs);
  const se = sampleSd(xs) / Math.sqrt(n);
  if (n < 2) return { n, mean: m, z: 0, p: 1 };
  if (se === 0) return { n, mean: m, z: m === 0 ? 0 : Infinity, p: m === 0 ? 1 : 0 };
  const z = m / se;
  return { n, mean: m, z, p: twoSidedP(z) };
}

/** Least-squares slope of y on x with its standard error. */
export function slope(xs: number[], ys: number[]): { slope: number; se: number } {
  const mx = mean(xs);
  const my = mean(ys);
  const sxx = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
  if (xs.length < 3 || sxx < 1e-12) return { slope: 1, se: Infinity };
  const b = xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0) / sxx;
  const residuals = xs.map((x, i) => ys[i] - my - b * (x - mx));
  const sse = residuals.reduce((sum, r) => sum + r * r, 0);
  return { slope: b, se: Math.sqrt(sse / (xs.length - 2) / sxx) };
}

/** Deterministic bootstrap 95% band for the mean (seeded so the chart does not flicker). */
export function bootstrapBand(values: number[], draws = 200): [number, number] {
  if (values.length < 2) return [values[0] ?? 0, values[0] ?? 0];
  let seed = (values.length * 2654435761) >>> 0;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const means: number[] = [];
  for (let i = 0; i < draws; i++) {
    let sum = 0;
    for (let j = 0; j < values.length; j++) sum += values[next() % values.length];
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(0.025 * (draws - 1))], means[Math.ceil(0.975 * (draws - 1))]];
}
