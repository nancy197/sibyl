/**
 * Analysts sell signals over MPP (HTTP 402) and get paid in USDC on Sui, with no facilitator:
 * the server checks the payment transaction on chain itself. Trusted analysts charge more.
 */
import { USDC, USDC_TESTNET, sui as suiMethod, type DigestStore } from '@suimpp/mpp/server';
import { Mppx } from 'mppx/server';
import { config } from '../config.js';
import { one, run } from '../db.js';
import type { Event } from '../events.js';
import { log } from '../log.js';
import { analystQuote, type Agent } from '../analysts/index.js';
import { publicFullnode } from '../sui.js';
import type { VolRegime } from '../events.js';

/** Base price of one signal in USDC; scaled by trust as in the spec: base x (0.5 + trust). */
const BASE_PRICE_USDC = 0.01;
const DEFAULT_TRUST = 0.5;

export const paymentCurrency = config.writeNetwork === 'mainnet' ? USDC : USDC_TESTNET;

/** Replay protection that survives restarts: a payment digest is redeemable once. */
class SqliteDigestStore implements DigestStore {
  async has(digest: string) {
    return one(`SELECT 1 FROM payment_digests WHERE digest = ?`, digest) !== undefined;
  }
  async set(digest: string) {
    run(`INSERT OR IGNORE INTO payment_digests VALUES (?, ?)`, digest, Date.now());
  }
}

/** Price of an analyst's signal in a context, from the trust Sibyl has learned for it. */
export function signalPrice(agent: Agent, ctx: string): number {
  const trust = one<{ weight: number }>(
    `SELECT weight FROM trust WHERE ctx = ? AND voice = ?`,
    ctx,
    `analyst:${agent}`,
  )?.weight;
  return Number((BASE_PRICE_USDC * (0.5 + (trust ?? DEFAULT_TRUST))).toFixed(6));
}

function createSeller() {
  if (config.paymentsMode !== 'live') return null;
  // @suimpp/mpp verifies over gRPC-web, which Tatum's native gRPC gateway does not speak,
  // so verification alone reads the public fullnode. Payments themselves go through Tatum.
  log('info', 'MPP verification uses the public fullnode', { network: config.writeNetwork });
  return Mppx.create({
    secretKey: config.mppSecret,
    methods: [
      suiMethod({
        currency: paymentCurrency,
        recipient: config.analystRecipient,
        store: new SqliteDigestStore(),
        rpcUrl: publicFullnode(config.writeNetwork),
        network: config.writeNetwork,
      }),
    ],
  });
}

const seller = createSeller();

/** GET /signal/:agent?event=... : 402 until paid (live mode), then the analyst's quote. */
export async function sellSignal(
  request: Request,
  agent: Agent,
  e: Event,
  ctx: string,
  regime: VolRegime,
): Promise<Response> {
  const deliver = async () => Response.json(await analystQuote(agent, e, regime));
  if (!seller) return deliver();
  const result = await seller.charge({ amount: String(signalPrice(agent, ctx)) })(request);
  if (result.status === 402) return result.challenge;
  return result.withReceipt(await deliver());
}
