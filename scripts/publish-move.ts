/**
 * Publish the `sibyl::ledger` Move package with the trader key, through Tatum's Sui gRPC gateway.
 *
 *   pnpm publish:move            # uses SUI_WRITE_NETWORK (default testnet)
 *
 * Prints the package ID to put in `.env` as SIBYL_PACKAGE_ID.
 */
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { credentials } from '@grpc/grpc-js';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';

type Network = 'mainnet' | 'testnet';

const network = (process.env.SUI_WRITE_NETWORK ?? 'testnet') as Network;
const tatumKey = process.env.TATUM_API_KEY;
const traderKey = process.env.TRADER_PRIVATE_KEY;
if (!tatumKey || !traderKey) throw new Error('TATUM_API_KEY and TRADER_PRIVATE_KEY are required');

function buildPackage(): { modules: string[]; dependencies: string[] } {
  const out = execFileSync(
    'sui',
    ['move', 'build', '--dump-bytecode-as-base64', '--build-env', network, '--path', 'move/sibyl'],
    { encoding: 'utf8' },
  );
  // The JSON payload is the last line; earlier lines are build progress.
  return JSON.parse(out.trim().split('\n').at(-1)!);
}

const client = new SuiGrpcClient({
  network,
  transport: new GrpcTransport({
    host: `sui-${network}-grpc.gateway.tatum.io:443`,
    channelCredentials: credentials.createSsl(),
    meta: { 'x-api-key': tatumKey },
  }),
});
const signer = Ed25519Keypair.fromSecretKey(traderKey);

const { modules, dependencies } = buildPackage();
const tx = new Transaction();
const upgradeCap = tx.publish({ modules, dependencies });
tx.transferObjects([upgradeCap], signer.toSuiAddress());

const result = await client.signAndExecuteTransaction({
  transaction: tx,
  signer,
  include: { effects: true, objectTypes: true },
});
const executed = result.$kind === 'Transaction' ? result.Transaction : result.FailedTransaction;
if (!executed.effects?.status.success) {
  throw new Error(`publish failed: ${JSON.stringify(executed.effects?.status)}`);
}

const published = executed.effects.changedObjects.find((o) => o.outputState === 'PackageWrite');
console.log(`network:    ${network}`);
console.log(`digest:     ${executed.digest}`);
console.log(`SIBYL_PACKAGE_ID=${published?.objectId}`);
process.exit(0);
