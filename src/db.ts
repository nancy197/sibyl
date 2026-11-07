import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { config } from './config.js';

if (config.dbPath !== ':memory:') mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);

db.exec(`
PRAGMA journal_mode = WAL;

-- Canonical events: "BTC price at expiry > strike".
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, source TEXT, horizon TEXT, expiry_ms INTEGER, strike REAL,
  market_id TEXT, status TEXT, outcome INTEGER, settle_price REAL, ctx TEXT, created_ms INTEGER
);
-- One locked forecast per (event, voice), already normalised to the event's strike and expiry.
-- used = 0: an analyst's public call that Sibyl did not buy, so it was not used in the decision.
CREATE TABLE IF NOT EXISTS forecasts (
  id TEXT PRIMARY KEY, event_id TEXT, voice TEXT, p REAL, raw_p REAL, raw_strike REAL,
  oracle TEXT, ctx TEXT, locked_ms INTEGER, used INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS scores (
  event_id TEXT, voice TEXT, ctx TEXT, p REAL, outcome INTEGER, brier REAL, log_loss REAL,
  at_ms INTEGER, PRIMARY KEY (event_id, voice)
);
-- Hedge weights per context. "n" counts resolved events in the context.
CREATE TABLE IF NOT EXISTS trust (
  ctx TEXT, voice TEXT, weight REAL, n INTEGER, updated_ms INTEGER, PRIMARY KEY (ctx, voice)
);
CREATE TABLE IF NOT EXISTS trust_history (
  ctx TEXT, voice TEXT, weight REAL, n INTEGER, at_ms INTEGER, PRIMARY KEY (ctx, voice, n)
);
-- Tested hypotheses. Only promoted (or later retired) lessons are stored.
CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY, scope TEXT, ctx TEXT, kind TEXT, voice TEXT, status TEXT, effect REAL,
  direction INTEGER, statement TEXT, action TEXT, p_value REAL, n INTEGER, at_ms INTEGER
);
-- Analysts' own raw calls (before their self-shrink), for their self-lessons.
CREATE TABLE IF NOT EXISTS analyst_calls (
  event_id TEXT, agent TEXT, self_ctx TEXT, raw_p REAL, at_ms INTEGER, PRIMARY KEY (event_id, agent)
);
CREATE TABLE IF NOT EXISTS policy (ctx TEXT PRIMARY KEY, edge_threshold REAL, reason TEXT, at_ms INTEGER);
-- Outbox and local mirror of Walrus memories. Walrus is the source of truth.
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, namespace TEXT, text TEXT, status TEXT, job_id TEXT, blob_id TEXT,
  error TEXT, at_ms INTEGER
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, event_id TEXT, agent TEXT, ctx TEXT, price REAL, voi REAL, decision TEXT,
  reason TEXT, digest TEXT, at_ms INTEGER
);
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY, event_id TEXT, model TEXT, side TEXT, belief REAL, price REAL, stake REAL,
  pnl REAL, digest TEXT, at_ms INTEGER
);
CREATE TABLE IF NOT EXISTS anchors (
  root TEXT PRIMARY KEY, count INTEGER, window_start_ms INTEGER, window_end_ms INTEGER,
  digest TEXT, status TEXT, at_ms INTEGER
);
CREATE TABLE IF NOT EXISTS proofs (forecast_id TEXT PRIMARY KEY, leaf TEXT, proof TEXT, root TEXT);
-- What the council saw at lock time, and what Walrus recall said about similar past situations.
CREATE TABLE IF NOT EXISTS situations (
  event_id TEXT PRIMARY KEY, description TEXT, market_voice TEXT, market REAL, signal REAL, gap REAL,
  recalled INTEGER, hits INTEGER, adjustment REAL, matches TEXT, at_ms INTEGER
);
-- Chain events seen live on Tatum's checkpoint stream.
CREATE TABLE IF NOT EXISTS chain_events (
  id TEXT PRIMARY KEY, network TEXT, kind TEXT, checkpoint INTEGER, digest TEXT, data TEXT, at_ms INTEGER
);
CREATE TABLE IF NOT EXISTS vol_samples (at_ms INTEGER PRIMARY KEY, vol REAL);
-- MPP replay protection: a payment digest can only be redeemed once.
CREATE TABLE IF NOT EXISTS payment_digests (digest TEXT PRIMARY KEY, at_ms INTEGER);

CREATE INDEX IF NOT EXISTS forecasts_event ON forecasts (event_id);
CREATE INDEX IF NOT EXISTS forecasts_locked ON forecasts (locked_ms);
CREATE INDEX IF NOT EXISTS scores_ctx ON scores (ctx, voice, at_ms);
CREATE INDEX IF NOT EXISTS events_status ON events (status, expiry_ms);
CREATE INDEX IF NOT EXISTS memories_status ON memories (status, at_ms);
`);

/** Columns added after the first release; older databases get them here. */
function addColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column))
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('forecasts', 'used', 'INTEGER NOT NULL DEFAULT 1');

type Param = SQLInputValue;

export const rows = <T>(sql: string, ...params: Param[]) => db.prepare(sql).all(...params) as T[];
export const one = <T>(sql: string, ...params: Param[]) =>
  db.prepare(sql).get(...params) as T | undefined;
export const run = (sql: string, ...params: Param[]) => db.prepare(sql).run(...params);

/** Run a block atomically. */
export function transaction<T>(work: () => T): T {
  db.exec('BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export const startOfUtcDay = (now = Date.now()) => new Date(now).setUTCHours(0, 0, 0, 0);
