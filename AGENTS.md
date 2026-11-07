# Agent instructions

- Read SPEC.md first. It is the source of truth for scope, architecture and verified API facts.
- Dependencies are already installed (see package.json). Read the real types in node_modules (*.d.mts / *.d.ts) before using @mysten/sui, @mysten/deepbook-v3/predict, @mysten-incubation/memwal, @suimpp/mpp and mppx. Do not guess APIs.
- You may add small dependencies only if clearly needed. Prefer node built-ins (node:sqlite, node:crypto, node:test).
- TypeScript strict, ESM, run with tsx. Keep modules small and readable. Short comments only where they help.
- Never print or commit secrets. Never send real funds: keep PAYMENTS_MODE/TRADE_MODE/ANCHOR_MODE defaults non-live.
- Verify your work: run `pnpm typecheck`, `pnpm test`, and a short `pnpm start` smoke run (hit /api/state). Fix what fails.
- Do not commit; leave changes in the working tree.
