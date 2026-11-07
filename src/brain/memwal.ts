/**
 * Walrus Memory (mainnet relayer) behind a small interface, with a file-backed mock when no
 * account is configured. Writes go through a local outbox so a relayer outage never loses a
 * memory: queued -> submitted (job id) -> done (blob id) | failed.
 */
import { MemWal } from '@mysten-incubation/memwal';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from '../config.js';
import { one, rows, run, startOfUtcDay } from '../db.js';
import { errorText, log } from '../log.js';

export type MemoryItem = { namespace: string; text: string };
type JobState = { jobId: string; status: string; blobId?: string; error?: string };

/** The relayer accepts at most 20 items per bulk call. */
const BULK_LIMIT = 20;
/** Statuses checked per poll, asked 20 at a time (the relayer's per-request maximum). */
const POLL_BATCH = 100;
/** Hundreds of memories a day (more on a backfill day), never an unbounded flood. */
export const DAILY_WRITE_BUDGET = 1000;
/** Namespaces we rebuild from are small (snapshots and lessons), so one page is enough. */
const READ_LIMIT = 500;

interface Backend {
  readonly mode: 'WALRUS' | 'MOCK MEMORY';
  submit(items: MemoryItem[], idempotencyKey: string): Promise<string[]>;
  status(jobIds: string[]): Promise<JobState[]>;
  /** All memories in a namespace, newest first. */
  readAll(namespace: string): Promise<string[]>;
  /** The memories most similar to `query` (semantic search). */
  recall(namespace: string, query: string, limit: number): Promise<string[]>;
  health(): Promise<unknown>;
}

class WalrusBackend implements Backend {
  readonly mode = 'WALRUS' as const;
  constructor(private readonly client: MemWal) {}

  async submit(items: MemoryItem[], idempotencyKey: string) {
    return (await this.client.rememberBulk(items, { idempotencyKey })).job_ids;
  }

  async status(jobIds: string[]) {
    const { results } = await this.client.getRememberBulkStatus(jobIds);
    return results.map((r) => ({
      jobId: r.job_id,
      status: r.status,
      blobId: r.blob_id,
      error: r.error,
    }));
  }

  /**
   * Re-index the namespace from Walrus blobs first (`restore`), then read it back newest first.
   * This is what makes Walrus, not the local database, the source of truth.
   */
  async readAll(namespace: string) {
    const restored = await this.client.restore(namespace, READ_LIMIT);
    if (restored.truncated)
      log('warn', 'Walrus restore truncated', { namespace, total: restored.total });
    const { results } = await this.client.recall({
      query: namespace,
      namespace,
      sort: 'recent',
      limit: READ_LIMIT,
    });
    if (results.length >= READ_LIMIT)
      log('warn', 'Walrus recall hit the read limit', { namespace });
    return results.map((r) => r.text);
  }

  async recall(namespace: string, query: string, limit: number) {
    const { results } = await this.client.recall({ query, namespace, limit });
    return results.map((r) => r.text);
  }

  health() {
    return this.client.health();
  }
}

/** Same interface, stored in a JSONL file next to the database. */
class MockBackend implements Backend {
  readonly mode = 'MOCK MEMORY' as const;
  private readonly path = join(
    dirname(config.dbPath === ':memory:' ? './data/x' : config.dbPath),
    'mock-memory.jsonl',
  );

  async submit(items: MemoryItem[]) {
    return items.map((item) => {
      const jobId = createHash('sha256')
        .update(item.namespace + item.text)
        .digest('hex')
        .slice(0, 16);
      appendFileSync(this.path, JSON.stringify({ ...item, jobId, at: Date.now() }) + '\n');
      return jobId;
    });
  }

  async status(jobIds: string[]) {
    return jobIds.map((jobId) => ({ jobId, status: 'done', blobId: `mock-${jobId}` }));
  }

  async readAll(namespace: string) {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as MemoryItem)
      .filter((item) => item.namespace === namespace)
      .map((item) => item.text)
      .reverse();
  }

  /** No embeddings offline: the most recent memories stand in for the most similar. */
  async recall(namespace: string, _query: string, limit: number) {
    return (await this.readAll(namespace)).slice(0, limit);
  }

  async health() {
    return { status: 'mock' };
  }
}

function createBackend(): Backend {
  if (!config.memwalKey || !config.memwalAccount) {
    log(
      'warn',
      'MEMWAL_KEY or MEMWAL_ACCOUNT_ID missing: using MOCK MEMORY (nothing reaches Walrus)',
    );
    return new MockBackend();
  }
  return new WalrusBackend(
    MemWal.create({
      key: config.memwalKey,
      accountId: config.memwalAccount,
      serverUrl: config.memwalUrl,
    }),
  );
}

/** Episodes and payment logs are evidence; beliefs (trust, lessons, policy) are sent first. */
const IS_EVIDENCE = `(namespace LIKE '%:episodes' OR namespace LIKE '%:payments')`;

/** Belief memories not yet stored in Walrus. */
export const pendingBeliefs = () =>
  one<{ n: number }>(
    `SELECT COUNT(*) n FROM memories WHERE status IN ('queued', 'submitted') AND NOT ${IS_EVIDENCE}`,
  )!.n;

const backend = createBackend();
export const memoryMode = backend.mode;
export const memoryHealth = () => backend.health();
export const readNamespace = (namespace: string) => backend.readAll(namespace);
export const recallMemories = (namespace: string, query: string, limit: number) =>
  backend.recall(namespace, query, limit);

const memoryId = (item: MemoryItem) =>
  createHash('sha256').update(`${item.namespace}\n${item.text}`).digest('hex');

/** Queue a memory. Identical memories are written once. */
export function remember(namespace: string, text: string) {
  run(
    `INSERT OR IGNORE INTO memories (id, namespace, text, status, at_ms) VALUES (?, ?, ?, 'queued', ?)`,
    memoryId({ namespace, text }),
    namespace,
    text,
    Date.now(),
  );
}

function writtenToday(): number {
  return one<{ n: number }>(
    `SELECT COUNT(*) n FROM memories WHERE status IN ('submitted', 'done') AND at_ms >= ?`,
    startOfUtcDay(),
  )!.n;
}

/** Send queued memories in bulk. Failed sends stay queued and are retried on the next flush. */
export async function flushOutbox(): Promise<number> {
  const room = DAILY_WRITE_BUDGET - writtenToday();
  if (room <= 0) return 0;
  const queued = rows<{ id: string } & MemoryItem>(
    `SELECT id, namespace, text FROM memories WHERE status = 'queued'
     ORDER BY ${IS_EVIDENCE} , at_ms LIMIT ?`,
    Math.min(BULK_LIMIT, room),
  );
  if (!queued.length) return 0;
  const items = queued.map(({ namespace, text }) => ({ namespace, text }));
  const idempotencyKey = createHash('sha256')
    .update(queued.map((m) => m.id).join())
    .digest('hex');
  try {
    const jobIds = await backend.submit(items, idempotencyKey);
    queued.forEach((m, i) =>
      run(
        `UPDATE memories SET status = 'submitted', job_id = ?, error = NULL WHERE id = ?`,
        jobIds[i] ?? null,
        m.id,
      ),
    );
    return queued.length;
  } catch (error) {
    for (const m of queued)
      run(`UPDATE memories SET error = ? WHERE id = ?`, errorText(error), m.id);
    throw error;
  }
}

/** Ask the relayer how submitted jobs ended. Failed jobs go back to the queue once. */
export async function pollOutbox(): Promise<void> {
  const submitted = rows<{ id: string; job_id: string; error: string | null }>(
    `SELECT id, job_id, error FROM memories WHERE status = 'submitted' AND job_id IS NOT NULL ORDER BY at_ms LIMIT ?`,
    POLL_BATCH,
  );
  if (!submitted.length) return;
  const states = new Map<string, JobState>();
  for (let i = 0; i < submitted.length; i += BULK_LIMIT) {
    const chunk = submitted.slice(i, i + BULK_LIMIT).map((m) => m.job_id);
    for (const state of await backend.status(chunk)) states.set(state.jobId, state);
  }
  for (const m of submitted) {
    const state = states.get(m.job_id);
    if (state?.status === 'done') {
      run(
        `UPDATE memories SET status = 'done', blob_id = ? WHERE id = ?`,
        state.blobId ?? null,
        m.id,
      );
    } else if (state?.status === 'failed' || state?.status === 'not_found') {
      const retry = m.error === null;
      run(
        `UPDATE memories SET status = ?, error = ? WHERE id = ?`,
        retry ? 'queued' : 'failed',
        state.error ?? state.status,
        m.id,
      );
    }
  }
}

export function memoryCounts() {
  return rows<{ namespace: string; status: string; n: number }>(
    `SELECT namespace, status, COUNT(*) n FROM memories GROUP BY namespace, status`,
  );
}
