/**
 * Screen recordings of the live dashboard (http://localhost:8787) for the demo video.
 *   node scripts/record.mjs tabs    -> public/rec/tabs.webm  + public/rec/tabs.json  (tab walkthrough)
 *   node scripts/record.mjs round   -> public/rec/round.webm + public/rec/round.json (one real 5m round)
 * A fake glowing cursor is injected, because headless Chrome does not draw the mouse.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:8787';
const OUT = new URL('../public/rec/', import.meta.url).pathname;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEW = { width: 1440, height: 810 };
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path) => (await fetch(BASE + path)).json();

const CURSOR = `
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;' +
      'border:2px solid #00f0ff;box-shadow:0 0 14px #00f0ff;background:rgba(0,240,255,0.18);z-index:99999;pointer-events:none;transition:transform .12s';
    document.body.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; });
    addEventListener('mousedown', () => { c.style.transform = 'scale(0.6)'; });
    addEventListener('mouseup', () => { c.style.transform = 'scale(1)'; });
  });`;

async function open(name, view = VIEW) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: view, deviceScaleFactor: 1, recordVideo: { dir: OUT, size: view } });
  await context.addInitScript(CURSOR);
  const page = await context.newPage();
  const t0 = Date.now();
  const at = () => (Date.now() - t0) / 1000;
  const finish = async (marks) => {
    const video = page.video();
    await context.close();
    await browser.close();
    renameSync(await video.path(), `${OUT}${name}.webm`);
    writeFileSync(`${OUT}${name}.json`, JSON.stringify(marks, null, 2));
    console.log(`saved ${name}.webm`, marks);
  };
  return { page, at, finish };
}

/** Glide the cursor to an element and click it. */
async function clickOn(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 30 });
  await sleep(250);
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
}

/** Smooth scroll to `top` over `ms`. */
async function scrollTo(page, top, ms = 2500) {
  await page.evaluate(
    ([target, duration]) =>
      new Promise((done) => {
        const start = scrollY;
        const t0 = performance.now();
        const step = (now) => {
          const k = Math.min(1, (now - t0) / duration);
          scrollTo(0, start + (target - start) * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2));
          k < 1 ? requestAnimationFrame(step) : done();
        };
        requestAnimationFrame(step);
      }),
    [top, ms],
  );
}

async function tabs() {
  const { page, at, finish } = await open('tabs');
  const marks = {};
  await page.goto(BASE + '/');
  await page.mouse.move(900, 300);
  await sleep(3000);

  const visit = async (tab, hold) => {
    await scrollTo(page, 0, 600);
    marks[tab] = at();
    await clickOn(page, `#tabs button[data-tab="${tab}"]`);
    await sleep(1500);
    await hold();
  };

  await visit('track', async () => {
    await page.mouse.move(700, 600, { steps: 40 });
    await sleep(2500);
    await scrollTo(page, 650, 3500);
    await page.mouse.move(1000, 420, { steps: 40 });
    await sleep(3000);
  });
  await visit('lessons', async () => {
    await page.mouse.move(900, 450, { steps: 40 });
    await sleep(1500);
    await scrollTo(page, 900, 6000);
    await sleep(1500);
  });
  await visit('payments', async () => {
    await page.mouse.move(600, 330, { steps: 40 });
    await sleep(2000);
    await scrollTo(page, 500, 4000);
    await page.mouse.move(1100, 480, { steps: 40 });
    await sleep(2500);
  });
  await visit('proofs', async () => {
    await page.waitForSelector('#resolved tr.click');
    await sleep(800);
    await clickOn(page, '#resolved tr.click');
    await page.waitForSelector('#detail table', { timeout: 15_000 });
    await sleep(1500);
    await page.mouse.move(1050, 420, { steps: 40 });
    await scrollTo(page, 400, 4000);
    await sleep(3000);
  });
  await visit('hood', async () => {
    await page.mouse.move(800, 400, { steps: 30 });
    await sleep(1000);
    await scrollTo(page, 520, 3000);
    await page.mouse.move(900, 500, { steps: 40 });
    await sleep(4500);
  });
  marks.end = at();
  await finish(marks);
}

async function round() {
  // Next DeepBook 5m call whose lock is at least 20 seconds away.
  let target;
  for (;;) {
    const council = await api('/api/council');
    target = council
      .filter((e) => e.source === 'deepbook' && e.horizon === '5m' && e.locksAtMs > Date.now() + 20_000)
      .sort((a, b) => a.locksAtMs - b.locksAtMs)[0];
    if (target) break;
    await sleep(10_000);
  }
  console.log('target', target.id, 'locks in', Math.round((target.locksAtMs - Date.now()) / 1000), 's');
  await sleep(Math.max(0, target.locksAtMs - Date.now() - 14_000));

  // Tall viewport: the hero and the live price chart are both on screen; the video pans between them.
  const { page, at, finish } = await open('round', { width: 1440, height: 1500 });
  const marks = { eventId: target.id, horizon: target.horizon };
  await page.goto(BASE + '/');
  await page.mouse.move(1100, 120);
  await sleep(2500);
  const time = new Date(target.expiryMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  await clickOn(page, `#hero .chip:has-text("5m · ${time} · deepbook")`);
  marks.featured = at();
  await page.mouse.move(1350, 1400, { steps: 30 });

  for (;;) {
    const e = (await api('/api/council')).find((x) => x.id === target.id);
    const now = at();
    if (e?.forecasts.length && marks.locked == null) marks.locked = now;
    if (e?.anchor && marks.onSui == null) marks.onSui = now;
    if (Date.now() >= target.expiryMs && marks.closed == null) marks.closed = now;
    if (e?.status === 'resolved' && marks.settled == null) marks.settled = now;
    if (marks.settled != null && now - marks.settled > 12) break;
    if (Date.now() > target.expiryMs + 120_000) break;
    await sleep(1000);
  }
  marks.end = at();
  await finish(marks);
}

const which = process.argv[2];
if (which === 'tabs') await tabs();
else if (which === 'round') await round();
else console.log('usage: node scripts/record.mjs tabs|round');
