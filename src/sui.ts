import { credentials } from '@grpc/grpc-js';
import { predict } from '@mysten/deepbook-v3/predict';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { UnaryCall, type RpcInterceptor } from '@protobuf-ts/runtime-rpc';
import { config, type Network } from './config.js';
import { RateLimiter } from './limiter.js';
import { log } from './log.js';

/** 350 ms between calls keeps us just under Tatum's free tier of ~3 requests per second. */
const TATUM_INTERVAL_MS = 350;
/** Deadline per gRPC call, so a stalled stream fails (and is retried) instead of hanging. */
const GRPC_TIMEOUT_MS = 20_000;
export const tatum = new RateLimiter(TATUM_INTERVAL_MS);

/** Swallow rejections on promises that callers may never await (the error still reaches `response`). */
function quiet<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {});
  return promise;
}

/** Route every unary gRPC call through the shared limiter, counted per network. */
function paced(network: Network): RpcInterceptor {
  return {
    interceptUnary(next, method, input, options) {
      const done = tatum.run(network, async () => await next(method, input, options));
      return new UnaryCall(
        method,
        options.meta ?? {},
        input,
        quiet(done.then((call) => call.headers)),
        done.then((call) => call.response),
        quiet(done.then((call) => call.status)),
        quiet(done.then((call) => call.trailers)),
      );
    },
  };
}

function createClient(network: Network) {
  if (!config.tatumKey) {
    log('warn', `TATUM_API_KEY is not set: using the public ${network} fullnode instead of Tatum`);
    return new SuiGrpcClient({ network, baseUrl: publicFullnode(network) }).$extend(
      predict({ network }),
    );
  }
  const transport = new GrpcTransport({
    host: `sui-${network}-grpc.gateway.tatum.io:443`,
    channelCredentials: credentials.createSsl(),
    meta: { 'x-api-key': config.tatumKey },
    timeout: GRPC_TIMEOUT_MS,
    interceptors: [paced(network)],
  });
  return new SuiGrpcClient({ network, transport }).$extend(predict({ network }));
}

export const publicFullnode = (network: Network) => `https://fullnode.${network}.sui.io:443`;

/** Reads (voices, DeepBook prices). */
export const readSui = createClient(config.readNetwork);
/** Writes (anchors, payments, trades). Shares the client when both networks match. */
export const writeSui =
  config.writeNetwork === config.readNetwork ? readSui : createClient(config.writeNetwork);

export type SuiClient = typeof readSui;

export function signerFromKey(secret: string): Ed25519Keypair {
  if (secret.startsWith('suiprivkey')) return Ed25519Keypair.fromSecretKey(secret);
  const hex = secret.replace(/^0x/, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex))
    throw new Error('private key must be suiprivkey… or 32-byte hex');
  return Ed25519Keypair.fromSecretKey(Buffer.from(hex, 'hex'));
}

/** Digest of an executed transaction, throwing if it failed on chain. */
export function executedDigest(
  result: Awaited<ReturnType<SuiClient['signAndExecuteTransaction']>>,
): string {
  if (result.$kind === 'FailedTransaction') {
    const failed = result.FailedTransaction;
    throw new Error(`transaction ${failed.digest} failed: ${JSON.stringify(failed.status)}`);
  }
  return result.Transaction.digest;
}
