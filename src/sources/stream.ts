/**
 * Live chain events over Tatum's gRPC checkpoint stream (SubscriptionService/SubscribeCheckpoints;
 * Tatum does not allow SubscribeEvents). The filter selects checkpoints that contain our event
 * types; the stream returns whole checkpoints, so events are picked out here.
 *   read network:  DeepBook Predict MarketSettled -> resolve the event seconds after expiry
 *   write network: sibyl::ledger::Anchored        -> confirm our forecast commitments
 * Polling stays in place as the fallback; the stream only makes things faster and visible.
 */
import { config, type Network } from '../config.js';
import { one, rows, run } from '../db.js';
import { errorText, log } from '../log.js';
import { readSui, writeSui, type SuiClient } from '../sui.js';

/** DeepBook Predict's original package (event types keep the package that defined them). */
const PREDICT_EVENTS_PACKAGE: Record<Network, string> = {
  mainnet: '0x89aea622e7bb3bdd598bde87dde40ee31c9eed4971b9546e23ec83de3c48bbba',
  testnet: '',
};
/** DeepBook prices are fixed point with 9 decimals. */
const PRICE_SCALE = 1e9;
/** Streams are reopened on this cadence anyway, so a silently stalled stream cannot linger. */
const STREAM_DEADLINE_MS = 10 * 60_000;
const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
const FEED_SIZE = 50;

export type ChainEvent = {
  id: string;
  network: Network;
  kind: 'settled' | 'anchored';
  checkpoint: number;
  digest: string;
  data: Record<string, unknown>;
  atMs: number;
};

type Handlers = {
  onSettled: (marketId: string, expiryMs: number, price: number, atMs: number) => void;
  onAnchored: (digest: string, checkpoint: number) => void;
};

export type StreamStatus = {
  network: Network;
  eventTypes: string[];
  connected: boolean;
  messages: number;
  lastCheckpoint: number | null;
  lastMessageMs: number | null;
  matched: number;
  reconnects: number;
  error: string | null;
};
export const streams: StreamStatus[] = [];

// ---------- protobuf Value -> plain JSON ----------

type ProtoValue = {
  kind:
    | { oneofKind: 'stringValue'; stringValue: string }
    | { oneofKind: 'numberValue'; numberValue: number }
    | { oneofKind: 'boolValue'; boolValue: boolean }
    | { oneofKind: 'structValue'; structValue: { fields: Record<string, ProtoValue> } }
    | { oneofKind: 'listValue'; listValue: { values: ProtoValue[] } }
    | { oneofKind: 'nullValue' | undefined };
};

export function plain(value: ProtoValue | undefined): unknown {
  const kind = value?.kind;
  switch (kind?.oneofKind) {
    case 'stringValue':
      return kind.stringValue;
    case 'numberValue':
      return kind.numberValue;
    case 'boolValue':
      return kind.boolValue;
    case 'structValue':
      return Object.fromEntries(
        Object.entries(kind.structValue.fields).map(([k, v]) => [k, plain(v)]),
      );
    case 'listValue':
      return kind.listValue.values.map(plain);
    default:
      return null;
  }
}

// ---------- feed ----------

function record(event: ChainEvent) {
  run(
    `INSERT OR IGNORE INTO chain_events VALUES (?, ?, ?, ?, ?, ?, ?)`,
    event.id,
    event.network,
    event.kind,
    event.checkpoint,
    event.digest,
    JSON.stringify(event.data),
    event.atMs,
  );
}

export function recentChainEvents(limit = FEED_SIZE) {
  return rows<{
    id: string;
    network: string;
    kind: string;
    checkpoint: number;
    digest: string;
    data: string;
    at_ms: number;
  }>(`SELECT * FROM chain_events ORDER BY at_ms DESC LIMIT ?`, limit).map((r) => ({
    ...r,
    data: JSON.parse(r.data) as Record<string, unknown>,
  }));
}

// ---------- one stream ----------

type Interpreter = (
  network: Network,
  digest: string,
  checkpoint: number,
  data: Record<string, unknown>,
) => ChainEvent['kind'];

async function follow(client: SuiClient, status: StreamStatus, interpret: Interpreter) {
  const literal = (eventType: string) => ({
    negated: false,
    predicate: { oneofKind: 'eventType' as const, eventType: { eventType } },
  });
  const call = client.subscriptionService.subscribeCheckpoints(
    {
      filter: { terms: status.eventTypes.map((t) => ({ literals: [literal(t)] })) },
      readMask: {
        paths: [
          'sequence_number',
          'transactions.digest',
          'transactions.events.events.event_type',
          'transactions.events.events.json',
        ],
      },
    },
    { timeout: STREAM_DEADLINE_MS },
  );
  status.connected = true;
  for await (const message of call.responses) {
    status.messages++;
    status.lastMessageMs = Date.now();
    status.lastCheckpoint = Number(
      message.cursor ?? message.checkpoint?.sequenceNumber ?? status.lastCheckpoint,
    );
    for (const tx of message.checkpoint?.transactions ?? []) {
      tx.events?.events.forEach((event, index) => {
        if (!status.eventTypes.includes(event.eventType ?? '')) return;
        const data = plain(event.json as ProtoValue) as Record<string, unknown>;
        const checkpoint = status.lastCheckpoint ?? 0;
        const kind = interpret(status.network, tx.digest ?? '', checkpoint, data);
        status.matched++;
        record({
          id: `${tx.digest}:${index}`,
          network: status.network,
          kind,
          checkpoint,
          digest: tx.digest ?? '',
          data,
          atMs: Date.now(),
        });
      });
    }
  }
}

/** Keep a stream open forever: reconnect with backoff after errors or the periodic deadline. */
async function keepFollowing(client: SuiClient, status: StreamStatus, interpret: Interpreter) {
  let delay = RECONNECT_MIN_MS;
  for (;;) {
    const started = Date.now();
    try {
      await follow(client, status, interpret);
      status.error = null;
    } catch (error) {
      const text = errorText(error);
      const routine = /DEADLINE_EXCEEDED|Deadline exceeded/.test(text);
      status.error = routine ? null : text.slice(0, 200);
      if (!routine)
        log('warn', 'Tatum stream dropped', { network: status.network, error: text.slice(0, 200) });
    }
    status.connected = false;
    status.reconnects++;
    delay =
      Date.now() - started > RECONNECT_MAX_MS
        ? RECONNECT_MIN_MS
        : Math.min(RECONNECT_MAX_MS, delay * 2);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

// ---------- start ----------

export function startStreams(handlers: Handlers) {
  if (!config.tatumKey)
    return log('warn', 'no TATUM_API_KEY: chain streams disabled, polling only');

  const predictPackage = PREDICT_EVENTS_PACKAGE[config.readNetwork];
  if (predictPackage) {
    const status = newStatus(config.readNetwork, [
      `${predictPackage}::config_events::MarketSettled`,
    ]);
    void keepFollowing(readSui, status, (_network, _digest, _checkpoint, data) => {
      const price = Number(data.settlement_price) / PRICE_SCALE;
      handlers.onSettled(
        String(data.expiry_market_id),
        Number(data.expiry),
        price,
        Number(data.onchain_timestamp_ms),
      );
      return 'settled';
    });
  }
  if (config.packageId) {
    const status = newStatus(config.writeNetwork, [`${config.packageId}::ledger::Anchored`]);
    void keepFollowing(writeSui, status, (_network, digest, checkpoint) => {
      handlers.onAnchored(digest, checkpoint);
      return 'anchored';
    });
  }
}

function newStatus(network: Network, eventTypes: string[]): StreamStatus {
  const status: StreamStatus = {
    network,
    eventTypes,
    connected: false,
    messages: 0,
    lastCheckpoint: null,
    lastMessageMs: null,
    matched: 0,
    reconnects: 0,
    error: null,
  };
  streams.push(status);
  return status;
}

/** True if a stream event already confirmed this anchor transaction. */
export const isConfirmed = (digest: string) =>
  one(`SELECT 1 FROM chain_events WHERE kind = 'anchored' AND digest = ?`, digest) !== undefined;
