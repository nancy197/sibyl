# Sibyl: spec

A BTC forecasting council that remembers who was right.
Hackathon: Tatum x Walrus "Total Recall", Track 1 (Markets & Sports Prediction).
Deadline: **Tue 10 Nov 2026, 17:00 UTC**. Also targets the special prizes "Best Walrus Memory" and "Best Use of Agent Payments" (x402/MPP settled on Sui).

## Judging (design for this)
- 30% Walrus + Tatum integration: meaningful Walrus Memory use, Tatum Sui RPC/Data APIs.
- 30% Technical quality: clean code, successful Tatum Sui RPC integration.
- 20% Creativity. 20% Presentation (docs + working demo).
- Hard requirements: Walrus Memory writing on **Mainnet** (at least 10 memories, we want hundreds), Tatum RPC used for onchain data, public repo, demo, blog post.

## One-line pitch
Several "voices" forecast the same BTC event. Sibyl scores every voice per context, keeps its trust beliefs and tested lessons in Walrus Memory, pays AI analyst voices per signal in USDC over MPP on Sui (only when memory says the signal is worth its price), and trades small size on DeepBook Predict (Sui mainnet) when trusted voices disagree with the onchain price. Every forecast is committed onchain before expiry.

## Verified facts (checked 6 Nov 2026)
- DeepBook Predict is live on Sui **mainnet**: `@mysten/deepbook-v3/predict`. BTC only. Cadences seen live: 1-minute and 5-minute expiries (2 live per cadence). Quote coin is Circle USDC. Mainnet uses **queued orders** (`read.planMint` + `tx.enqueuePlan`), immediate `mint` aborts. Min premium ~1 USDC, 0.02 USDC fee per queued order. Settlement = Pyth price at expiry (fallback Block Scholes).
  Working read code (tested):
  ```ts
  import { SuiGrpcClient } from '@mysten/sui/grpc';
  import { predict } from '@mysten/deepbook-v3/predict';
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' }).$extend(predict({ network: 'mainnet' }));
  const markets = await client.predict.read.markets(); // [{id, expiryMs, tickSize, admissionTickSize, mintPaused, referencePrice|null}]
  const pricer = await client.predict.read.pricer({ underlying: 'BTC', expiryMs: m.expiryMs });
  pricer.range(K, 1e9) // = P(BTC_T > K)
  // also: read.price(desc) -> {up, down}; read.settlement(desc); read.quoteMint; cost.*
  ```
- Tatum Sui gRPC mainnet: `https://sui-mainnet-grpc.gateway.tatum.io` (testnet: `sui-testnet-grpc...`). Auth header `x-api-key: <TATUM_API_KEY>`. Services: Ledger, State, MovePackage, TransactionExecution, Subscription (checkpoint streaming). Free tier ~3 req/s, so pace, batch and cache. Sui JSON-RPC is deprecated: **do not use JSON-RPC**; use gRPC (or GraphQL). Check how `SuiGrpcClient` accepts custom headers/transport by reading `node_modules/@mysten/sui/dist/grpc/*.d.mts`. All Sui reads/writes must go through Tatum when `TATUM_API_KEY` is set (fallback to public fullnode only if unset, and log that loudly).
- Kalshi public reads (no auth) work: `https://api.elections.kalshi.com/trade-api/v2/events?series_ticker=KXBTC15M&status=open`, `.../markets?event_ticker=...`. Series: `KXBTC15M` (15-min, `floor_strike` target, "BTC above target at close"), `KXBTCD` (hourly "BTC above strike"), `KXBTC` (hourly ranges). Use mid of yes_bid/yes_ask (cents) or last_price; fields may be null, so handle that. Kalshi settles on CF Benchmarks BRTI (different oracle than Pyth).
- Polymarket gamma API is **unreachable from the dev machine** (geo-block). Implement the source behind `ENABLE_POLYMARKET=false` default (slugs like `btc-updown-15m-<unix>`; Chainlink-resolved). Must never crash the worker.
- Pyth Hermes (`https://hermes.pyth.network`) gives BTC/USD spot and historical price at a timestamp (`/v2/updates/price/{publish_time}?ids[]=<BTC feed id>`). BTC/USD feed id: `e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afcf5ed6e60c43` (verify).
- Walrus Memory TS SDK `@mysten-incubation/memwal` (read the .d.mts files for exact types):
  `MemWal.create({ key, accountId, serverUrl?='https://relayer.memory.walrus.xyz', namespace? })`;
  `remember(text, ns?)` returns a job; `rememberAndWait`; `rememberBulk(items<=20)`; `rememberBulkAndWait`; `recall({query, limit, namespace, sort:'relevance'|'recent', maxDistance})`; `analyze(text, ns?)`; `restore(namespace, limit)`; `listNamespaces()`; `listMemories({namespace, cursor})`; `health()`.
  Subpaths: `/manual` (`MemWalManual`, client-side encryption via Seal, `suiNetwork` default mainnet), `/ai` (`withMemWal`), `/account` (`generateDelegateKey`, `createAccount`, `addDelegateKey`, `removeDelegateKey`).
  Namespace = isolation unit. Memories are text. Relayer embeds them for semantic recall.
- MPP on Sui: `@suimpp/mpp` + `mppx` (no facilitator; server verifies the tx over gRPC; set `rpcUrl` to the Tatum gRPC endpoint).
  ```ts
  // server
  import { InMemoryDigestStore, USDC, sui } from '@suimpp/mpp/server';
  import { Mppx } from 'mppx';
  const mppx = Mppx.create({ methods: [sui({ currency: USDC, recipient, store: new InMemoryDigestStore(), rpcUrl, network: 'mainnet' })] });
  export const GET = mppx.charge({ amount: '0.01' })(() => Response.json({...}));
  // client
  import { USDC, sui } from '@suimpp/mpp/client';
  import { Mppx } from 'mppx/client';
  const mppx = Mppx.create({ methods: [sui({ client /* SuiGrpcClient */, signer /* Ed25519Keypair */, currency: USDC })] });
  const res = await mppx.fetch(url); // pays on 402 automatically
  ```
  `mppx.charge` returns a fetch-style handler `(Request) => Response`. Adapt it to Hono. Read the package .d.mts files for the exact API. Use a SQLite-backed digest store (replay protection must survive restarts).

## Architecture (TypeScript, Node >= 22.5, ESM, run with `tsx`)
Single package. Storage: built-in `node:sqlite` (no native deps). HTTP: Hono + `@hono/node-server`. UI: one static `web/index.html` (vanilla JS + a chart lib from a CDN with a pinned version), served by Hono.

```
src/
  config.ts          env parsing, feature flags, DRY_RUN modes
  log.ts             tiny structured logger
  db.ts              node:sqlite schema + helpers
  sui.ts             SuiGrpcClient via Tatum (headers), rate limiter (3 rps token bucket), retry on 429, call counter for the UI ("Tatum calls")
  math.ts            normal CDF/inverse, logit, Brier, log loss, lognormal strike shift, stats (paired t-test, Wilson CI)
  events.ts          canonical event model + normalisation
  sources/deepbook.ts   onchain voice (via Tatum gRPC)
  sources/kalshi.ts     Kalshi 15m + hourly voice
  sources/polymarket.ts optional voice (flag)
  sources/pyth.ts       spot, realized vol, resolution price at T
  analysts/          3 analyst agents (paid voices): momentum, meanrev, narrator (LLM optional, heuristic fallback)
  payments/server.ts MPP-charged routes for analysts, price = f(trust from memory)
  payments/buyer.ts  buyer agent: value-of-information decision + mppx client, budget caps
  scoring.ts         per-voice per-context scoring, Hedge weights, ensemble, calibration bins
  brain/memwal.ts    MemWal wrapper (dry/mock mode when keys missing, offline queue + retry, idempotency keys)
  brain/brain.ts     memory schema, write policy, restore-from-Walrus
  brain/lessons.ts   hypothesis engine: enumerate, test, promote, retire
  anchor.ts          Merkle batch of forecasts, onchain anchor via Move call through Tatum
  trader.ts          DeepBook Predict trading (memory policy) + shadow no-memory baseline (paper)
  worker.ts          scheduler loops
  server.ts          REST API + static UI + analyst routes
  main.ts            boots worker + server
move/sibyl/          Move package: sibyl::ledger
scripts/             setup-memwal.ts, restore-test.ts, probe.ts, publish-move.sh
test/                node:test unit tests (math, normalisation, scoring, lessons, merkle)
web/index.html       dashboard
```

### Canonical event
`E = { id, underlying:'BTC', expiryMs:T, strike:K, horizon:'1m'|'5m'|'15m'|'60m' }` meaning "Pyth BTC/USD at T > K".
- Event source of truth = DeepBook Predict markets (each market with a referencePrice gives K; for markets with null reference, use Pyth spot at window open, rounded to admissionTickSize, or skip until the reference is set).
- Also create events for Kalshi 15m closes (T = close_time, K = floor_strike) so all voices can be compared there too.
- Normalisation: a voice that quotes P' for (T', K') on a different oracle is mapped to (T, K) with a lognormal strike shift using sigma from the DeepBook pricer (or realized vol): `P(S_T>K) = Phi( PhiInv(P') + ln(K'/K) / (sigma*sqrt(tau)) )`. Only map when |T-T'| <= 60s. Log the mapping. Oracle mismatch (BRTI vs Pyth vs Chainlink) is itself a feature: record `oracle` per voice.
- Snapshot cadence: each voice is sampled at fixed lead times before T (e.g. T-4m for 5m events, T-10m for 15m events). One forecast per (event, voice, lead). Forecasts after the lock time are rejected.

### Voices
1. `deepbook`: onchain price, the market we may trade against.
2. `kalshi`: prediction market (BRTI oracle).
3. `polymarket`: optional.
4. `analyst:momentum`, `analyst:meanrev`, `analyst:narrator`: paid voices served behind MPP routes at `/signal/:agent?event=...`. Analysts are simple, honest models over Pyth/Hermes history (momentum on last N minutes, mean reversion on z-score, narrator = LLM over recent moves if `LLM_API_KEY` set, else a blended heuristic). Each analyst has its own MemWal namespace (`analyst:<name>`), writes its own self-lessons (e.g. "my calls in high-vol 5m are overconfident"), and applies them as a shrink factor. Its memory visibly changes its next forecasts.

### Contexts
`ctx = horizon x volRegime(low|mid|high by realized-vol terciles) x hourBucket(asia|eu|us)`. Keep it small enough for samples to accumulate.

### Scoring and learning (the core)
- On resolution (T + 60s): get Pyth price at T via Hermes; also read DeepBook settlement for markets we traded. outcome = price > K.
- Per voice per ctx: Brier, log loss, count, reliability bins (10), bias.
- Hedge / multiplicative weights per ctx over voices: `w_i *= exp(-eta * loss_i)` with eta set by the standard schedule `sqrt(8 ln N / t)`, plus a floor so no weight dies. Ensemble = weighted average in logit space. The baseline ensemble (`no-memory`) = equal weights, used for the A/B.
- The trust state per ctx is the "belief" stored in Walrus Memory.

### Walrus Memory schema (namespaces, plain-text lines with a JSON tail so they are human-readable AND parseable)
- `sibyl:episodes`: one memory per resolved event: `EPISODE 5m BTC>75690.52 @2026-11-07T10:05Z outcome=UP | deepbook .62 kalshi .58 momentum .55 ... | ensemble .64 | {json}`. Written with `rememberBulk` in batches of up to 20.
- `sibyl:trust`: versioned belief snapshots per ctx, written when a weight moves > 5 points or every 25 resolutions: `TRUST v17 ctx=5m/high/us kalshi .41 deepbook .33 ... (n=212) | {json}`.
- `sibyl:lessons`: `LESSON#12 PROMOTED "kalshi beats deepbook in 15m/high-vol" dBrier=-0.011 p=0.01 n=184 | {json}` and later `RETIRED`.
- `sibyl:policy`: trade policy parameters (edge threshold, Kelly fraction, voice exclusions) with the reason (link to the lesson id).
- `sibyl:payments`: purchase verdicts per analyst (paid, price, marginal value, decision).
- `analyst:<name>`: each analyst's self-lessons.
- Every memory written is also recorded locally (`memories` table: namespace, text, job_id, blob_id when known, status) for the UI, but **Walrus is the source of truth**: `scripts/restore-test.ts` wipes the local brain tables, calls `restore()` + `listMemories`/`recall(sort:'recent')` per namespace, rebuilds trust/lessons/policy, and prints a diff showing the same next decisions.
- Rate: avoid flooding. Episodes only for 5m+ events (skip 1m episodes, aggregate them into the 5m one). Target about 300 to 600 memories per day.
- Mock mode: if `MEMWAL_KEY`/`MEMWAL_ACCOUNT_ID` are missing, use a local file-backed mock with the same interface and show "MOCK MEMORY" in the UI.

### Lesson engine (deterministic, no LLM required)
- Candidate hypotheses are enumerated: for each ctx and each voice pair (A,B): "A beats B"; per voice: "overconfident" (calibration slope < 1), "biased up/down".
- Test with a paired t-test on per-event Brier differences (or a sign test), min n=30, alpha 0.05 with a simple Bonferroni-ish correction over active hypotheses.
- Promote → write LESSON + apply effect: (a) prior boost/penalty to Hedge weights in that ctx, (b) policy change (exclude a voice from the trade signal, raise the edge threshold in a ctx), (c) for the buyer: stop buying an analyst in ctx.
- Retire when the effect reverses or loses significance on the last N.
- Optional: if `LLM_API_KEY` is set, the LLM only phrases lessons in plain English. It never decides.

### Payments (agent payments prize)
- Analyst price per signal = `base (0.01 USDC) x (0.5 + trustScore)`, read from memory: trusted analysts earn more.
- Buyer computes value of information per analyst per ctx from memory: expected Brier improvement of the ensemble with vs without that analyst (counterfactual on past events where it was bought), converted to USDC via the trade edge model. Buy if VOI > price, else buy with exploration prob eps=0.1 so learning continues. Record every decision in `sibyl:payments`.
- Budget caps: per payment, per day. `PAYMENTS_MODE=off|dry|live`. `live` uses real USDC on Sui mainnet, with the server and buyer using separate keypairs (buyer pays the analyst server's address).
- Persist digests (replay protection) in SQLite. Show tx digests with Suiscan links in the UI.

### Onchain anchor (Move)
`move/sibyl/sources/ledger.move`: module `sibyl::ledger` with an `Anchor` event `{ root: vector<u8>, count: u64, window_start_ms: u64, window_end_ms: u64, sender: address }` and `public fun anchor(root: vector<u8>, count: u64, window_start_ms: u64, window_end_ms: u64, clock: &Clock, ctx: &TxContext)` that asserts `clock.timestamp_ms() >= window_end_ms` and emits the event. Keep it minimal. Note: the local `sui` CLI is 1.39 (old); write the package for a current edition and document `brew upgrade sui` + `sui client publish` in `scripts/publish-move.sh`.
- `anchor.ts`: every 60s, build a Merkle tree (sha256, sorted pairs) over forecasts locked in that window, store leaves + proofs locally, and call `ledger::anchor` through Tatum gRPC TransactionExecution (`ANCHOR_MODE=off|dry|live`, needs `SIBYL_PACKAGE_ID`). The proof endpoint returns leaf, proof path, root, tx digest, and the Walrus memory refs for that event.

### Trader (DeepBook Predict mainnet)
- Signal: `edge = ensemble(trusted voices, excluding deepbook) - deepbook price` for the 5m events, at a lead time.
- Trade if `|edge| > threshold(ctx)` where the threshold comes from memory (calibration error in that ctx + fees), size = fractional Kelly capped at `MAX_STAKE_USDC` (default 1-2), daily cap `MAX_DAILY_USDC`.
- `TRADE_MODE=off|paper|live`. Paper P&L for both the memory policy and the no-memory baseline always runs. Live uses `planMint` + `enqueuePlan`, signs with the trader key, executes through Tatum, and records results via `read.settlement`. Read the predict .d.mts to get the descriptor shape right.

### Worker loops
- every 10s: discover DeepBook markets + Kalshi events, create canonical events.
- at lead times: snapshot voices (buy analyst signals via buyer), lock forecasts.
- every 60s: anchor batch.
- every 15s: resolve due events → score → Hedge update → lessons → memory writes → trader settlement.
- every 5m: realized-vol regime, trust snapshots, memory flush.
- Every loop is wrapped so one failing source never kills the worker. Exponential backoff per source. Health per source shown in the UI.

### API + UI
REST: `/api/state` (health, modes, counters incl. Tatum calls, memory writes, payments), `/api/events?status=`, `/api/event/:id` (all voices, ensemble, outcome, proof, memories), `/api/trust` (weights per ctx + history), `/api/lessons`, `/api/memories?ns=`, `/api/payments`, `/api/trades` (memory vs baseline P&L), `/api/brain-diff?from=&to=` (belief changes between two times), `/api/curve` (rolling Brier: each voice, memory ensemble vs no-memory baseline, with Wilson/bootstrap bands).
UI `web/index.html`, one dark, tasteful page with these sections:
1. Live council: next events, each voice's probability, ensemble, DeepBook price, edge, countdown.
2. Learning curve: rolling Brier memory vs baseline vs voices.
3. Trust heatmap: ctx x voice, with a time slider ("brain diff").
4. Lessons: cards (promoted/retired) with evidence and what they changed.
5. Payments: analyst prices, buy/skip decisions with VOI, Suiscan links.
6. Trades: memory vs baseline P&L.
7. Proof explorer: pick an event → Merkle proof → Sui tx → Walrus memories.
8. Walrus panel: memory counts per namespace, latest writes, "MOCK" badge when mocked.

### Env (`.env.example`)
TATUM_API_KEY, SUI_NETWORK=mainnet, MEMWAL_KEY, MEMWAL_ACCOUNT_ID, MEMWAL_SERVER_URL, TRADER_PRIVATE_KEY, BUYER_PRIVATE_KEY, ANALYST_RECIPIENT_ADDRESS, ANALYST_PRIVATE_KEY(optional), SIBYL_PACKAGE_ID, LLM_API_KEY(optional), LLM_BASE_URL(optional, OpenAI-compatible), LLM_MODEL, ENABLE_POLYMARKET=false, PAYMENTS_MODE=dry, TRADE_MODE=paper, ANCHOR_MODE=dry, MAX_STAKE_USDC=1, MAX_DAILY_USDC=20, MAX_PAYMENT_USDC=0.05, MAX_DAILY_PAYMENTS_USDC=3, PORT=8787, DB_PATH=./data/sibyl.db.

### Quality bar
- `pnpm typecheck` passes with `strict: true`. `pnpm test` passes (unit tests for math, normalisation, Hedge, lesson tests, Merkle proofs, VOI).
- `pnpm start` with **no keys at all** runs end to end: real DeepBook + Kalshi + Pyth reads (public endpoints), mock memory, dry payments, paper trading, dry anchors. The UI shows live data within a minute.
- No secrets in logs. `.env` is in `.gitignore`. `data/` is in `.gitignore`.
- README.md: what it is, architecture diagram (mermaid), how memory changes behaviour, setup (Tatum key, MemWal account + delegate key via memory.walrus.xyz dashboard or `scripts/setup-memwal.ts`, wallets/USDC, publish Move), run modes, proofs, and a short "judging criteria → where in code" table.

## Changes after first pass (7 Nov, verified)
1. **Tatum gRPC is native gRPC, not gRPC-web.** `SuiGrpcClient` with `baseUrl` fails ("unexpected response content type: application/grpc"). Working setup (tested on mainnet and testnet):
   ```ts
   import { GrpcTransport } from '@protobuf-ts/grpc-transport';
   import { credentials } from '@grpc/grpc-js';
   const transport = new GrpcTransport({ host: `sui-${net}-grpc.gateway.tatum.io:443`, channelCredentials: credentials.createSsl(), meta: { 'x-api-key': TATUM_API_KEY } });
   const client = new SuiGrpcClient({ network: net, transport });
   ```
   Add deps `@protobuf-ts/grpc-transport` and `@grpc/grpc-js`. The free tier returns HTTP 429 quickly (`pricer()` alone triggers it), so ALL Tatum calls must go through one shared limiter (max ~3 req/s, queue, retry with backoff on 429) and cache `pricer`/`markets` per market for a few seconds.
2. **Split networks.**
   - `SUI_READ_NETWORK=mainnet`: voices read the real DeepBook Predict mainnet market (read-only, free).
   - `SUI_WRITE_NETWORK=testnet` (default): anchors, MPP payments and DeepBook trades run on testnet with test coins. Testnet Predict has 6 live BTC markets (1m/5m/15m/30m cadences) with the same reference prices as mainnet. Testnet uses immediate mint (Predict v7) as well as queued orders; read the SDK.
   - Walrus Memory is ALWAYS mainnet (hackathon rule) through the relayer.
   - Each write path can be flipped to mainnet by env alone (`SUI_WRITE_NETWORK=mainnet`), with the same budget caps.
   - One Tatum client per network, sharing the limiter.
3. MemWal: `MEMWAL_KEY` (delegate private key hex) is set; `MEMWAL_ACCOUNT_ID` may still be empty. If empty, stay in mock memory mode and say why in the UI and logs.

## Changes after second pass (7 Nov, rewritten by hand, verified live)
- Pyth Hermes now needs an API key. Analysts use Coinbase one-minute candles; each event resolves on its source's own settlement (DeepBook onchain settlement, Kalshi `result`).
- Kalshi prices are `yes_bid_dollars` / `yes_ask_dollars` strings (not cents).
- Analysts: momentum, meanrev, randomwalk (no LLM). Free samples on 1m events; paid on 5m/15m.
- Tatum limiter is a protobuf-ts interceptor; 20s gRPC deadline; payments serialized; every worker step has a 90s timeout.
- MPP server needs `MPP_SECRET_KEY`. Testnet balances are address balances (no coin objects).
- Verified: 38/38 forecasts anchored on testnet before expiry; 9 real MPP payments; Walrus restore-test PASS.

## Changes after third pass (7 Nov)
- Walrus recall in the decision loop (`src/brain/recall.ts`): situation sentence -> semantic recall over episodes -> council hit rate in similar situations -> trade threshold adjustment (-2..+4 pt, needs >= 5 matches).
- Shared pipeline (`src/pipeline.ts`) used by the worker and `scripts/backfill.ts` (Kalshi 15m historical replay).
- Memory records carry `v` (schema) and `at` (write time); restore keeps the latest per key. Belief namespaces are flushed before evidence.
- Dashboard: recall panel, trust time slider (`/api/trust-at`), amnesia button (`POST /api/amnesia`, verified PASS on 11 contexts / 15 lessons / 8 policies).

## Changes after fourth pass (7 Nov)
- Tatum allows SubscribeCheckpoints (not SubscribeEvents). Two streams: mainnet DeepBook `0x89aea622…::config_events::MarketSettled` (resolution ~2.5s after expiry) and testnet `<SIBYL_PACKAGE_ID>::ledger::Anchored` (anchor confirmation). Streams get their own 10-minute deadline and reconnect; polling remains the fallback; `applyResolution` ignores already-resolved events.
