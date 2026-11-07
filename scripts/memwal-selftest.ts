/**
 * Round trip against the real Walrus Memory relayer in a tiny namespace (2 writes).
 *   pnpm memwal:selftest
 */
import 'dotenv/config';
import { MemWal } from '@mysten-incubation/memwal';

const { MEMWAL_KEY, MEMWAL_ACCOUNT_ID, MEMWAL_SERVER_URL } = process.env;
if (!MEMWAL_KEY || !MEMWAL_ACCOUNT_ID)
  throw new Error('MEMWAL_KEY and MEMWAL_ACCOUNT_ID are required');
const memwal = MemWal.create({
  key: MEMWAL_KEY,
  accountId: MEMWAL_ACCOUNT_ID,
  serverUrl: MEMWAL_SERVER_URL,
});
const namespace = 'sibyl:selftest';
const stamp = new Date().toISOString();

console.log('health', await memwal.health());
const written = await memwal.rememberBulkAndWait([
  { namespace, text: `SELFTEST ${stamp} first | {"kind":"selftest","i":1}` },
  { namespace, text: `SELFTEST ${stamp} second | {"kind":"selftest","i":2}` },
]);
console.log(
  'written',
  written.results.map((r) => ({ status: r.status, blob: r.blob_id })),
);
const { results } = await memwal.recall({
  query: `SELFTEST ${stamp}`,
  namespace,
  sort: 'recent',
  limit: 5,
});
console.log(
  'recalled',
  results.map((r) => r.text),
);
const page = await memwal.listMemories({ namespace, limit: 100 });
console.log('listed', page.memories.length, 'memories in', namespace);
const ok = written.succeeded === 2 && results.some((r) => r.text.includes(stamp));
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
