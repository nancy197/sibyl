/**
 * Buyer agent. Before each paid signal it asks memory: "has this analyst made the ensemble better,
 * here, by more than it costs?" (value of information). It buys if yes, explores 10% of the time
 * so the estimate keeps learning, and never buys an analyst a promoted lesson has excluded.
 * On 1-minute events analysts give free samples, which seed the estimate for the paid horizons.
 */
import { createHash } from 'node:crypto';
import { Receipt } from 'mppx';
import { Mppx } from 'mppx/client';
import { sui as suiMethod } from '@suimpp/mpp/client';
import { config } from '../config.js';
import { one, rows, run, startOfUtcDay } from '../db.js';
import type { Event, Quote, VolRegime } from '../events.js';
import { errorText } from '../log.js';
import { brier, mean } from '../math.js';
import { analystQuote, type Agent } from '../analysts/index.js';
import { corrections, MARKET_VOICE, memoryEnsemble } from '../scoring.js';
import { signerFromKey, writeSui } from '../sui.js';
import { paymentCurrency, signalPrice } from './server.js';

const FREE_SAMPLE_HORIZON = '1m';
/** Share of "not worth it" signals bought anyway, so the value estimate keeps learning. */
export const EXPLORATION = 0.1;
/** Past events needed before trusting a value estimate. */
const MIN_VOI_SAMPLES = 10;
const VOI_WINDOW = 100;
/** A Brier gain of g on a forecast that guides a stake S is worth about g x S USDC of edge. */
const USDC_PER_BRIER_PER_STAKE = 1;

export type Decision =
  'sample' | 'bought' | 'paid' | 'skip' | 'excluded' | 'over-budget' | 'failed' | 'off';

/** Deterministic coin flip per (event, agent), so a replay makes the same choices. */
export function explores(eventId: string, agent: string): boolean {
  const digest = createHash('sha256').update(`${eventId}:${agent}`).digest();
  return digest.readUInt32BE(0) / 2 ** 32 < EXPLORATION;
}

/**
 * Expected USDC value of adding the analyst to the ensemble, from past resolved events:
 * mean Brier(ensemble without it) - Brier(ensemble with it), times the stake it would guide.
 * Uses the same context first, then the same regime and session at any horizon (free samples).
 */
export function valueOfInformation(agent: Agent, ctx: string): { voi: number; n: number } {
  const voice = `analyst:${agent}`;
  const [, regime, session] = ctx.split('/');
  const pick = (where: string, arg: string) =>
    rows<{ event_id: string; ctx: string; outcome: number }>(
      `SELECT event_id, ctx, outcome FROM scores WHERE voice = ? AND ${where} ORDER BY at_ms DESC LIMIT ?`,
      voice,
      arg,
      VOI_WINDOW,
    );
  let past = pick('ctx = ?', ctx);
  if (past.length < MIN_VOI_SAMPLES) past = pick('ctx LIKE ?', `%/${regime}/${session}`);
  if (past.length < MIN_VOI_SAMPLES) return { voi: Infinity, n: past.length };

  const gains = past.map((event) => {
    const quotes = rows<{ voice: string; p: number }>(
      `SELECT voice, p FROM forecasts WHERE event_id = ? AND voice NOT LIKE 'ensemble:%'`,
      event.event_id,
    );
    const withIt = memoryEnsemble(event.ctx, quotes, MARKET_VOICE);
    const withoutIt = memoryEnsemble(
      event.ctx,
      quotes.filter((q) => q.voice !== voice),
      MARKET_VOICE,
    );
    if (withIt === null || withoutIt === null) return 0;
    return brier(withoutIt, event.outcome) - brier(withIt, event.outcome);
  });
  return {
    voi: Math.max(0, mean(gains)) * USDC_PER_BRIER_PER_STAKE * config.maxStake,
    n: past.length,
  };
}

function spentToday(): number {
  return one<{ total: number }>(
    `SELECT COALESCE(SUM(price), 0) total FROM payments WHERE decision = 'paid' AND at_ms >= ?`,
    startOfUtcDay(),
  )!.total;
}

type Plan = { decision: Decision; price: number; voi: number; reason: string };

export function planPurchase(agent: Agent, e: Event, ctx: string): Plan {
  const price = e.horizon === FREE_SAMPLE_HORIZON ? 0 : signalPrice(agent, ctx);
  if (config.paymentsMode === 'off')
    return { decision: 'off', price, voi: 0, reason: 'payments off' };
  if (price === 0) return { decision: 'sample', price, voi: 0, reason: 'free 1m sample' };
  const excluded = corrections(ctx).get(`analyst:${agent}`)?.excluded;
  if (excluded && config.buyPolicy === 'value')
    return {
      decision: 'excluded',
      price,
      voi: 0,
      reason: 'a promoted lesson excluded this analyst here',
    };
  if (price > config.maxPayment || spentToday() + price > config.maxDailyPayments)
    return { decision: 'over-budget', price, voi: 0, reason: 'daily or per-signal cap reached' };

  const { voi, n } = valueOfInformation(agent, ctx);
  if (config.buyPolicy === 'always') {
    const valued = Number.isFinite(voi)
      ? `memory values it at ${voi.toFixed(4)}`
      : `memory has ${n} past samples`;
    return {
      decision: 'bought',
      price,
      voi: Number.isFinite(voi) ? voi : 0,
      reason: `always-buy mode; ${valued}${excluded ? ', a lesson excludes it from bets here' : ''}`,
    };
  }
  if (!Number.isFinite(voi))
    return { decision: 'bought', price, voi: 0, reason: `cold start (${n} past samples)` };
  if (voi > price)
    return { decision: 'bought', price, voi, reason: `value ${voi.toFixed(4)} > price ${price}` };
  if (explores(e.id, agent))
    return { decision: 'bought', price, voi, reason: `exploration (${EXPLORATION * 100}%)` };
  return { decision: 'skip', price, voi, reason: `value ${voi.toFixed(4)} <= price ${price}` };
}

const client =
  config.paymentsMode === 'live' && config.buyerKey
    ? Mppx.create({
        methods: [
          suiMethod({
            client: writeSui,
            signer: signerFromKey(config.buyerKey),
            currency: paymentCurrency,
          }),
        ],
      })
    : null;

/** Payments from one wallet go one at a time: simpler to reason about and gentler on the RPC. */
let paymentQueue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const result = paymentQueue.then(work, work);
  paymentQueue = result.catch(() => {});
  return result;
}

/** A purchase (402 challenge, payment, verification, delivery) must finish within this. */
const PURCHASE_TIMEOUT_MS = 45_000;

/** Pay the analyst over MPP and return its quote with the payment digest. */
async function payForSignal(agent: Agent, e: Event): Promise<{ quote: Quote; digest: string }> {
  if (!client) throw new Error('live payments need BUYER_PRIVATE_KEY');
  const url = `http://127.0.0.1:${config.port}/signal/${agent}?event=${encodeURIComponent(e.id)}`;
  const response = await oneAtATime(() =>
    client.fetch(url, { signal: AbortSignal.timeout(PURCHASE_TIMEOUT_MS) }),
  );
  if (!response.ok) throw new Error(`signal ${agent} answered ${response.status}`);
  const digest = Receipt.fromResponse(response).reference;
  return { quote: (await response.json()) as Quote, digest };
}

/**
 * Decide, pay if needed, and record the decision. `used` is the quote Sibyl may act on (bought or
 * a free sample). `unused` is the analyst's public call when it was not bought: it is recorded
 * and scored (that is how Sibyl learns what a signal would have been worth) but never used.
 */
export async function acquireSignal(
  agent: Agent,
  e: Event,
  ctx: string,
  regime: VolRegime,
): Promise<{ used: Quote | null; unused: Quote | null }> {
  const plan = planPurchase(agent, e, ctx);
  let quote: Quote | null = null;
  let digest: string | null = null;
  let { decision, reason } = plan;
  try {
    if (decision === 'sample') {
      quote = await analystQuote(agent, e, regime);
    } else if (decision === 'bought' && config.paymentsMode === 'live') {
      ({ quote, digest } = await payForSignal(agent, e));
      decision = 'paid';
    } else if (decision === 'bought') {
      quote = await analystQuote(agent, e, regime); // dry run: same quote, no transfer
    }
  } catch (error) {
    decision = 'failed';
    reason = errorText(error).slice(0, 200);
  }
  run(
    `INSERT OR REPLACE INTO payments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `${e.id}:${agent}`,
    e.id,
    agent,
    ctx,
    plan.price,
    plan.voi,
    decision,
    reason,
    digest,
    Date.now(),
  );
  if (quote || decision === 'off' || decision === 'failed') return { used: quote, unused: null };
  return { used: null, unused: await analystQuote(agent, e, regime).catch(() => null) };
}
