/**
 * Proves the brain lives in Walrus: checkpoint, wipe the local beliefs, rebuild them from Walrus
 * only, and show that Sibyl's next decisions are unchanged. Stop the app first (or use the
 * dashboard button, which pauses the worker).
 *
 *   pnpm restore-test            # uses DB_PATH (default ./data/sibyl.db)
 */
import { amnesiaTest } from '../src/brain/restore-check.js';

const report = await amnesiaTest();
console.log(`memory backend: ${report.backend}`);
console.log(`restored from Walrus:`, report.restored);
for (const diff of report.changed) {
  console.log(
    `DIFF ${diff.ctx}\n  before ${JSON.stringify(diff.before)}\n  after  ${JSON.stringify(diff.after)}`,
  );
}
console.log(
  report.pass
    ? `PASS: identical next decisions in all ${report.contexts} contexts (${report.tookMs} ms)`
    : `FAIL: ${report.changed.length} of ${report.contexts} contexts differ`,
);
process.exit(report.pass ? 0 : 1);
