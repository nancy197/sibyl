/**
 * REST API, the dashboard, and the analysts' paid signal routes.
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { config, txUrl } from './config.js';
import { one, rows } from './db.js';
import { isSnapshotDue, LEAD_MS, type VolRegime } from './events.js';
import { bootstrapBand, mean } from './math.js';
import { verifyProof } from './merkle.js';
import { isAgent } from './analysts/index.js';
import { DAILY_WRITE_BUDGET, memoryCounts, memoryMode } from './brain/memwal.js';
import { edgeThreshold } from './brain/lessons.js';
import { sellSignal } from './payments/server.js';
import { isEnsemble, marketVoiceFor, memoryEnsemble } from './scoring.js';
import { tatum } from './sui.js';
import { getEvent, liveEvents } from './pipeline.js';
import { ticksSince } from './sources/ticker.js';
import { health, streamResolutions, volatility, whilePaused } from './worker.js';
import { recentChainEvents, streams } from './sources/stream.js';
import { situationOf, type Match } from './brain/recall.js';
import { amnesiaTest, type AmnesiaReport } from './brain/restore-check.js';
import { errorText } from './log.js';

const app = new Hono();

/** Recall evidence for an event, with matches parsed for the UI. */
function situationView(eventId: string) {
  const row = situationOf(eventId);
  if (!row) return null;
  return { ...row, matches: JSON.parse(row.matches) as Match[] };
}
const dashboard = () => readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
const count = (sql: string, ...args: (string | number)[]) => one<{ n: number }>(sql, ...args)!.n;
const limitOf = (value: string | undefined, fallback: number) =>
  Math.min(1000, Math.max(1, Number(value) || fallback));

app.get('/', (c) => c.html(dashboard()));

app.get('/api/state', (c) =>
  c.json({
    now: Date.now(),
    modes: {
      memory: memoryMode,
      payments: config.paymentsMode,
      trade: config.tradeMode,
      anchor: config.anchorMode,
      readNetwork: config.readNetwork,
      writeNetwork: config.writeNetwork,
      rpc: config.tatumKey ? 'Tatum gRPC' : 'public fullnode',
      polymarket: config.polymarket,
    },
    packageId: config.packageId || null,
    tatum: { calls: tatum.calls, throttled: tatum.throttled },
    memory: { budgetPerDay: DAILY_WRITE_BUDGET, byNamespace: memoryCounts() },
    counts: {
      open: count(`SELECT COUNT(*) n FROM events WHERE status = 'open'`),
      resolved: count(`SELECT COUNT(*) n FROM events WHERE status = 'resolved'`),
      forecasts: count(`SELECT COUNT(*) n FROM forecasts`),
      anchors: count(`SELECT COUNT(*) n FROM anchors`),
      lessons: count(`SELECT COUNT(*) n FROM lessons WHERE status = 'PROMOTED'`),
      payments: count(`SELECT COUNT(*) n FROM payments`),
      trades: count(`SELECT COUNT(*) n FROM trades`),
    },
    volatility: volatility(),
    streams,
    streamResolutions,
    health,
  }),
);

const RECENT_RESULTS_MS = 5 * 60_000;

/** Live council: each upcoming event with every locked voice, both ensembles and the edge. */
app.get('/api/council', (c) => {
  const now = Date.now();
  // Upcoming events, plus those that closed in the last few minutes (settling or settled).
  const events = liveEvents(now - RECENT_RESULTS_MS).slice(0, 24);
  return c.json(
    events.map((e) => {
      const forecasts = rows<{
        voice: string;
        p: number;
        raw_p: number;
        raw_strike: number | null;
        oracle: string;
        locked_ms: number;
        used: number;
      }>(
        `SELECT voice, p, raw_p, raw_strike, oracle, locked_ms, used FROM forecasts WHERE event_id = ? ORDER BY voice`,
        e.id,
      );
      // Only forecasts Sibyl actually used count toward its view; unbought analyst calls are shown apart.
      const voices = forecasts.filter((f) => !isEnsemble(f.voice) && f.used);
      const marketVoice = marketVoiceFor(e.source);
      const market = voices.find((f) => f.voice === marketVoice)?.p ?? null;
      const signal = e.ctx ? memoryEnsemble(e.ctx, voices, marketVoice) : null;
      const policy = e.ctx ? edgeThreshold(e.ctx) : null;
      const recall = situationView(e.id);
      return {
        ...e,
        locksAtMs: e.expiryMs - LEAD_MS[e.horizon],
        sampling: isSnapshotDue(e, now),
        forecasts,
        market,
        tradeSignal: signal,
        edge: signal !== null && market !== null ? signal - market : null,
        marketVoice,
        edgeThreshold: policy === null ? null : Math.max(0, policy + (recall?.adjustment ?? 0)),
        recall,
        payments: rows(
          `SELECT agent, price, voi, decision, reason, digest FROM payments WHERE event_id = ?`,
          e.id,
        ),
        trades: rows(
          `SELECT model, side, belief, price, stake, pnl, digest FROM trades WHERE event_id = ?`,
          e.id,
        ),
        anchor:
          one(
            `SELECT a.digest, a.status, a.at_ms FROM proofs p JOIN anchors a ON a.root = p.root
             WHERE p.forecast_id LIKE ? LIMIT 1`,
            `${e.id}:%`,
          ) ?? null,
        trust: e.ctx
          ? rows(`SELECT voice, weight FROM trust WHERE ctx = ? ORDER BY weight DESC`, e.ctx)
          : [],
        lessons: e.ctx
          ? rows(
              `SELECT kind, voice, statement, action FROM lessons WHERE scope = 'sibyl' AND ctx = ? AND status = 'PROMOTED'`,
              e.ctx,
            )
          : [],
      };
    }),
  );
});

app.get('/api/events', (c) => {
  const status = c.req.query('status') ?? 'resolved';
  const events = rows<{ id: string }>(
    `SELECT * FROM events WHERE status = ? ORDER BY expiry_ms DESC LIMIT ?`,
    status,
    limitOf(c.req.query('limit'), 100),
  );
  return c.json(
    events.map((e) => ({
      ...e,
      forecasts: rows(`SELECT voice, p FROM forecasts WHERE event_id = ?`, e.id),
    })),
  );
});

app.get('/api/event/:id', (c) => {
  const e = getEvent(c.req.param('id'));
  if (!e) return c.json({ error: 'event not found' }, 404);
  return c.json({
    event: e,
    forecasts: rows(`SELECT * FROM forecasts WHERE event_id = ? ORDER BY voice`, e.id),
    scores: rows(`SELECT voice, brier, log_loss FROM scores WHERE event_id = ?`, e.id),
    payments: rows(`SELECT * FROM payments WHERE event_id = ?`, e.id),
    trades: rows(`SELECT * FROM trades WHERE event_id = ?`, e.id),
    recall: situationView(e.id),
    memories: rows(
      `SELECT namespace, text, status, blob_id FROM memories WHERE text LIKE ?`,
      `%"eventId":"${e.id}"%`,
    ),
  });
});

/** Merkle proof for one locked forecast, checked server-side, with its anchor transaction. */
app.get('/api/proof/:forecastId', (c) => {
  const proof = one<{ forecast_id: string; leaf: string; proof: string; root: string }>(
    `SELECT * FROM proofs WHERE forecast_id = ?`,
    c.req.param('forecastId'),
  );
  if (!proof) return c.json({ error: 'not anchored yet' }, 404);
  const path = JSON.parse(proof.proof) as string[];
  const anchor = one<{
    digest: string | null;
    status: string;
    window_start_ms: number;
    window_end_ms: number;
  }>(
    `SELECT digest, status, window_start_ms, window_end_ms FROM anchors WHERE root = ?`,
    proof.root,
  );
  return c.json({
    ...proof,
    proof: path,
    valid: verifyProof(proof.leaf, path, proof.root),
    anchor: anchor ? { ...anchor, url: anchor.digest ? txUrl(anchor.digest) : null } : null,
  });
});

app.get('/api/trust', (c) => {
  const weights = rows(`SELECT * FROM trust ORDER BY ctx, weight DESC`);
  if (c.req.query('history') !== 'true') return c.json(weights);
  return c.json({
    weights,
    history: rows(`SELECT * FROM trust_history ORDER BY at_ms DESC LIMIT 2000`),
  });
});

/** How beliefs changed between two times: weight per (ctx, voice) at `from` and at `to`. */
app.get('/api/brain-diff', (c) => {
  const to = Number(c.req.query('to')) || Date.now();
  const from = Number(c.req.query('from')) || 0;
  const at = (time: number) =>
    rows<{ ctx: string; voice: string; weight: number }>(
      `SELECT h.ctx, h.voice, h.weight FROM trust_history h
       JOIN (SELECT ctx, voice, MAX(n) n FROM trust_history WHERE at_ms <= ? GROUP BY ctx, voice) last
       ON h.ctx = last.ctx AND h.voice = last.voice AND h.n = last.n`,
      time,
    );
  const before = new Map(at(from).map((r) => [`${r.ctx}|${r.voice}`, r.weight]));
  return c.json(
    at(to).map((r) => ({
      ...r,
      before: before.get(`${r.ctx}|${r.voice}`) ?? null,
      delta: r.weight - (before.get(`${r.ctx}|${r.voice}`) ?? r.weight),
    })),
  );
});

/** Trust weights as they stood at time `at` (for the dashboard's time slider). */
app.get('/api/trust-at', (c) => {
  const at = Number(c.req.query('at')) || Date.now();
  const range = one<{ first: number | null; last: number | null }>(
    `SELECT MIN(at_ms) first, MAX(at_ms) last FROM trust_history`,
  )!;
  const weights = rows(
    `SELECT h.ctx, h.voice, h.weight, h.n FROM trust_history h
     JOIN (SELECT ctx, voice, MAX(n) n FROM trust_history WHERE at_ms <= ? GROUP BY ctx, voice) last
     ON h.ctx = last.ctx AND h.voice = last.voice AND h.n = last.n`,
    at,
  );
  return c.json({ at, first: range.first, last: range.last, weights });
});

/** Amnesia test from the dashboard: pause the worker, wipe beliefs, rebuild from Walrus. */
const AMNESIA_COOLDOWN_MS = 120_000;
let lastAmnesia = 0;
let lastAmnesiaReport: (AmnesiaReport & { atMs: number }) | null = null;
app.get('/api/amnesia', (c) => c.json(lastAmnesiaReport));
app.post('/api/amnesia', async (c) => {
  if (Date.now() - lastAmnesia < AMNESIA_COOLDOWN_MS)
    return c.json({ error: 'just ran; try again in two minutes' }, 429);
  lastAmnesia = Date.now();
  try {
    lastAmnesiaReport = { ...(await whilePaused(amnesiaTest)), atMs: Date.now() };
    return c.json(lastAmnesiaReport);
  } catch (error) {
    return c.json({ error: errorText(error) }, 500);
  }
});

/** Live BTC ticks for the chart. */
app.get('/api/ticks', (c) =>
  c.json(ticksSince(Number(c.req.query('since')) || Date.now() - 15 * 60_000)),
);

/** Live feed from Tatum's checkpoint stream. */
app.get('/api/chain-events', (c) => c.json(recentChainEvents(limitOf(c.req.query('limit'), 50))));

/** Mean Brier per voice, all time and last 24 hours, plus the last on-chain anchor. */
app.get('/api/scoreboard', (c) => {
  const since = Date.now() - 86_400_000;
  const board = (where: string, ...args: number[]) =>
    rows<{ voice: string; brier: number; n: number }>(
      `SELECT voice, AVG(brier) brier, COUNT(*) n FROM scores ${where} GROUP BY voice ORDER BY brier`,
      ...args,
    );
  const lastAnchor = one<{
    digest: string;
    count: number;
    window_end_ms: number;
    status: string;
    at_ms: number;
  }>(
    `SELECT digest, count, window_end_ms, status, at_ms FROM anchors WHERE digest IS NOT NULL ORDER BY at_ms DESC LIMIT 1`,
  );
  const lead = one<{ lead_ms: number | null }>(
    `SELECT AVG(e.expiry_ms - a.at_ms) lead_ms FROM anchors a JOIN proofs p ON p.root = a.root
     JOIN forecasts f ON f.id = p.forecast_id JOIN events e ON e.id = f.event_id WHERE a.digest IS NOT NULL`,
  )?.lead_ms;
  const lastMemory = one<{ namespace: string; blob_id: string; at_ms: number }>(
    `SELECT namespace, blob_id, at_ms FROM memories WHERE status = 'done' ORDER BY at_ms DESC LIMIT 1`,
  );
  return c.json({
    allTime: board(''),
    lastDay: board('WHERE at_ms >= ?', since),
    lastAnchor: lastAnchor ? { ...lastAnchor, url: txUrl(lastAnchor.digest) } : null,
    anchorLeadMs: lead ?? null,
    lastMemory: lastMemory ?? null,
  });
});

app.get('/api/lessons', (c) => c.json(rows(`SELECT * FROM lessons ORDER BY at_ms DESC`)));

app.get('/api/memories', (c) => {
  const ns = c.req.query('ns');
  const limit = limitOf(c.req.query('limit'), 100);
  return c.json(
    ns
      ? rows(`SELECT * FROM memories WHERE namespace = ? ORDER BY at_ms DESC LIMIT ?`, ns, limit)
      : rows(`SELECT * FROM memories ORDER BY at_ms DESC LIMIT ?`, limit),
  );
});

app.get('/api/payments', (c) =>
  c.json({
    recent: rows(
      `SELECT * FROM payments ORDER BY at_ms DESC LIMIT ?`,
      limitOf(c.req.query('limit'), 100),
    ),
    byAgent: rows(
      `SELECT agent, decision, COUNT(*) n, SUM(price) spent, AVG(voi) voi FROM payments GROUP BY agent, decision`,
    ),
    network: config.writeNetwork,
  }),
);

app.get('/api/trades', (c) =>
  c.json({
    recent: rows(
      `SELECT * FROM trades ORDER BY at_ms DESC LIMIT ?`,
      limitOf(c.req.query('limit'), 100),
    ),
    summary: rows(
      `SELECT model, COUNT(*) n, SUM(stake) staked, COALESCE(SUM(pnl), 0) pnl,
              SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) wins, SUM(CASE WHEN pnl IS NOT NULL THEN 1 ELSE 0 END) settled
       FROM trades GROUP BY model`,
    ),
  }),
);

/** Rolling mean Brier per voice over resolved events, with a bootstrap band. */
app.get('/api/curve', (c) => {
  const window = limitOf(c.req.query('window'), 50);
  const scores = rows<{ voice: string; brier: number; at_ms: number }>(
    `SELECT voice, brier, at_ms FROM scores ORDER BY at_ms`,
  );
  const byVoice = new Map<string, { at: number; brier: number }[]>();
  for (const s of scores) {
    if (!byVoice.has(s.voice)) byVoice.set(s.voice, []);
    byVoice.get(s.voice)!.push({ at: s.at_ms, brier: s.brier });
  }
  const step = (n: number) => Math.max(1, Math.floor(n / 200)); // at most ~200 points per line
  return c.json(
    Object.fromEntries(
      [...byVoice].map(([voice, series]) => [
        voice,
        series
          .filter((_, i) => i % step(series.length) === 0 || i === series.length - 1)
          .map((point) => {
            const i = series.indexOf(point);
            const recent = series.slice(Math.max(0, i - window + 1), i + 1).map((x) => x.brier);
            const [lower, upper] = bootstrapBand(recent);
            return { at: point.at, n: i + 1, brier: mean(recent), lower, upper };
          }),
      ]),
    ),
  );
});

/** Paid analyst signal (MPP). In dry mode it answers without a payment. */
app.get('/signal/:agent', async (c) => {
  const agent = c.req.param('agent');
  if (!isAgent(agent)) return c.json({ error: 'unknown analyst' }, 404);
  const e = getEvent(c.req.query('event') ?? '');
  if (!e || !e.ctx) return c.json({ error: 'unknown or unsampled event' }, 404);
  const regime = e.ctx.split('/')[1] as VolRegime;
  return sellSignal(c.req.raw, agent, e, e.ctx, regime);
});

export function startServer() {
  return serve({ fetch: app.fetch, port: config.port });
}
