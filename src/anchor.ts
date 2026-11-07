/**
 * Commit locked forecasts on chain before their events expire: a Merkle root per time window,
 * emitted by `sibyl::ledger::anchor` on the write network through Tatum gRPC. The Tatum
 * checkpoint stream later marks each anchor 'confirmed' when its event is seen on chain.
 */
import { Transaction } from '@mysten/sui/transactions';
import { config } from './config.js';
import { one, rows, run, transaction } from './db.js';
import { buildTree } from './merkle.js';
import { executedDigest, signerFromKey, writeSui } from './sui.js';
import { isConfirmed } from './sources/stream.js';

/** The shared Sui clock object. */
const CLOCK_ID = '0x6';
/** The Move call asserts clock >= window end; stay a little behind "now" for clock skew. */
const CLOCK_SLACK_MS = 2_000;

type LockedForecast = { id: string; event_id: string; voice: string; p: number; locked_ms: number };

/** Canonical leaf text for a forecast. Anyone can rebuild it from the API and check the proof. */
export const leafOf = (f: LockedForecast) =>
  JSON.stringify({ id: f.id, eventId: f.event_id, voice: f.voice, p: f.p, lockedMs: f.locked_ms });

let windowStartMs: number | null = null;

function nextWindowStart(): number {
  windowStartMs ??=
    one<{ end: number | null }>(`SELECT MAX(window_end_ms) end FROM anchors`)?.end ??
    one<{ first: number | null }>(
      `SELECT MIN(locked_ms) first FROM forecasts WHERE event_id NOT LIKE 'backfill:%'`,
    )?.first ??
    Date.now();
  return windowStartMs;
}

async function submitRoot(
  root: string,
  count: number,
  startMs: number,
  endMs: number,
): Promise<string> {
  const signer = signerFromKey(config.traderKey);
  const tx = new Transaction();
  tx.moveCall({
    target: `${config.packageId}::ledger::anchor`,
    arguments: [
      tx.pure.vector('u8', Buffer.from(root, 'hex')),
      tx.pure.u64(count),
      tx.pure.u64(startMs),
      tx.pure.u64(endMs),
      tx.object(CLOCK_ID),
    ],
  });
  return executedDigest(await writeSui.signAndExecuteTransaction({ transaction: tx, signer }));
}

/**
 * Anchor every forecast locked since the last anchored window. If the transaction fails the
 * window is not advanced, so the same forecasts are retried next time.
 */
export async function anchorPending(
  now = Date.now(),
): Promise<{ root: string; count: number } | null> {
  if (config.anchorMode === 'off') return null;
  const startMs = nextWindowStart();
  const endMs = now - CLOCK_SLACK_MS;
  if (endMs <= startMs) return null;

  const forecasts = rows<LockedForecast>(
    `SELECT id, event_id, voice, p, locked_ms FROM forecasts
     WHERE locked_ms >= ? AND locked_ms < ? AND event_id NOT LIKE 'backfill:%' ORDER BY id`,
    startMs,
    endMs,
  );
  if (!forecasts.length) {
    windowStartMs = endMs;
    return null;
  }
  const leaves = forecasts.map(leafOf);
  const tree = buildTree(leaves);
  const digest =
    config.anchorMode === 'live'
      ? await submitRoot(tree.root, forecasts.length, startMs, endMs)
      : null;

  transaction(() => {
    run(
      `INSERT OR REPLACE INTO anchors VALUES (?, ?, ?, ?, ?, ?, ?)`,
      tree.root,
      forecasts.length,
      startMs,
      endMs,
      digest,
      digest ? (isConfirmed(digest) ? 'confirmed' : 'onchain') : 'dry',
      Date.now(),
    );
    forecasts.forEach((f, i) =>
      run(
        `INSERT OR REPLACE INTO proofs VALUES (?, ?, ?, ?)`,
        f.id,
        leaves[i],
        JSON.stringify(tree.proofs[i]),
        tree.root,
      ),
    );
  });
  windowStartMs = endMs;
  return { root: tree.root, count: forecasts.length };
}
