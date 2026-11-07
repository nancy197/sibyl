/**
 * Trader: when the council disagrees with DeepBook by more than the context's edge threshold,
 * buy the cheap side. Two books run side by side on the same events:
 *   memory    trust weights + lessons + learned threshold, nudged by recalled episodes (can trade live)
 *   baseline  equal weights, fixed threshold (always paper)
 */
import { config } from './config.js';
import { one, rows, run, startOfUtcDay } from './db.js';
import type { Event } from './events.js';
import { log } from './log.js';
import { clamp } from './math.js';
import { BASE_EDGE, edgeThreshold } from './brain/lessons.js';
import { recallAdjustment } from './brain/recall.js';
import { baselineEnsemble, MARKET_VOICE, memoryEnsemble, type VoiceP } from './scoring.js';
import { executedDigest, signerFromKey, writeSui } from './sui.js';

/** DeepBook Predict's minimum premium per order, in USDC. */
const MIN_STAKE = 1;
/** Recall can lower the edge needed, but never below the order fee's worth. */
const MIN_EDGE = 0.03;
/** Flat fee per queued order, in USDC. */
const ORDER_FEE = 0.02;
/** Quarter Kelly: full Kelly is too aggressive for a model that is still learning. */
const KELLY_FRACTION = 0.25;
/** Only these horizons are traded (mainnet DeepBook lists 1m and 5m; 1m is too fast to queue). */
const TRADED_HORIZONS = new Set(['5m']);
/** Allowed price movement between plan and fill, in cents of probability. */
const SLIPPAGE_CENTS = 5;

export type Model = 'memory' | 'baseline';
type Side = 'up' | 'down';

/** Kelly fraction for buying a binary at `price` that we think wins with probability `belief`. */
export function kelly(belief: number, price: number): number {
  return price >= 1 ? 0 : (belief - price) / (1 - price);
}

function stakeFor(belief: number, price: number, model: Model): number {
  const spent = one<{ total: number }>(
    `SELECT COALESCE(SUM(stake), 0) total FROM trades WHERE model = ? AND at_ms >= ?`,
    model,
    startOfUtcDay(),
  )!.total;
  const room = config.maxDailyStake - spent;
  const sized = KELLY_FRACTION * kelly(belief, price) * config.maxDailyStake;
  const stake = clamp(sized, MIN_STAKE, config.maxStake);
  return stake <= room ? stake : 0;
}

/** Live order on DeepBook Predict (write network): plan a budget mint, then queue it. */
async function placeOrder(e: Event, side: Side, stake: number): Promise<string> {
  const signer = signerFromKey(config.traderKey);
  const owner = signer.toSuiAddress();
  // Market IDs differ between networks; the reference strike and expiry identify the same window.
  const sameNetwork = config.readNetwork === config.writeNetwork;
  const descriptor = {
    underlying: 'BTC',
    expiryMs: e.expiryMs,
    side,
    strike: e.source === 'deepbook' ? ('reference' as const) : e.strike,
    ...(sameNetwork ? { marketId: e.marketId } : {}),
  };
  const plan = await writeSui.predict.read.planMint(owner, descriptor, {
    amount: stake,
    slippageCents: SLIPPAGE_CENTS,
  });
  if (!plan.accepting)
    throw new Error(`DeepBook refused the order: ${plan.refusal ?? 'not accepting'}`);
  const order = await writeSui.predict.tx.enqueuePlan(owner, descriptor, plan);
  return executedDigest(
    await writeSui.signAndExecuteTransaction({ transaction: order.transaction, signer }),
  );
}

/** Decide and record trades for both books at forecast lock. */
export async function tradeEvent(e: Event, ctx: string, forecasts: VoiceP[]) {
  if (config.tradeMode === 'off' || !TRADED_HORIZONS.has(e.horizon)) return;
  const market = forecasts.find((f) => f.voice === MARKET_VOICE)?.p;
  if (market === undefined) return;

  const books: { model: Model; belief: number | null; threshold: number }[] = [
    {
      model: 'memory',
      belief: memoryEnsemble(ctx, forecasts, MARKET_VOICE),
      threshold: Math.max(MIN_EDGE, edgeThreshold(ctx) + recallAdjustment(e.id)),
    },
    { model: 'baseline', belief: baselineEnsemble(forecasts, MARKET_VOICE), threshold: BASE_EDGE },
  ];
  for (const { model, belief, threshold } of books) {
    if (belief === null || Math.abs(belief - market) < threshold) continue;
    const side: Side = belief > market ? 'up' : 'down';
    const price = side === 'up' ? market : 1 - market;
    const sideBelief = side === 'up' ? belief : 1 - belief;
    const stake = stakeFor(sideBelief, price, model);
    if (!stake) continue;

    let digest: string | null = null;
    if (model === 'memory' && config.tradeMode === 'live') {
      try {
        digest = await placeOrder(e, side, stake);
      } catch (error) {
        log('warn', 'live order failed; recorded as paper', { event: e.id, error: String(error) });
      }
    }
    run(
      `INSERT OR IGNORE INTO trades VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      `${e.id}:${model}`,
      e.id,
      model,
      side,
      sideBelief,
      price,
      stake,
      digest,
      Date.now(),
    );
  }
}

/** Paper P&L at resolution: a winning share pays 1 per unit; every order pays the flat fee. */
export function settleTrades(eventId: string, outcome: number) {
  const open = rows<{ id: string; side: Side; price: number; stake: number }>(
    `SELECT id, side, price, stake FROM trades WHERE event_id = ? AND pnl IS NULL`,
    eventId,
  );
  for (const t of open) {
    const won = (t.side === 'up') === (outcome === 1);
    const pnl = (won ? t.stake / t.price - t.stake : -t.stake) - ORDER_FEE;
    run(`UPDATE trades SET pnl = ? WHERE id = ?`, pnl, t.id);
  }
}
