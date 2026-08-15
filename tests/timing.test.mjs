/** 自動進行：時計を早送りして 4/3/2 が自分で回りきることを確かめる */
import { startServer, launch, createRunner, collectErrors, advance } from './helpers.mjs';

const { base, close } = await startServer();
const { browser, context } = await launch();
const { step, done } = createRunner();
const errors = [];
const page = await context.newPage();
collectErrors(page, errors);

// 自動進行（休憩も自動）
await page.clock.install();
await page.goto(base);
await page.waitForTimeout(200);
await page.fill('#input-topic', 'auto run');
await page.click('#btn-start');
await page.waitForSelector('#screen-session.is-active');

await step('round 1 counts down', async () => {
  await advance(page, 180);
  const c = await page.locator('#clock').textContent();
  if (c !== '1:00') throw new Error(`clock ${c}`);
  if (!await page.locator('#stage').evaluate(el => !el.classList.contains('is-final'))) throw new Error('final too early');
});

await step('last 10 seconds turn red', async () => {
  await advance(page, 55);
  if (!await page.locator('#stage.is-final').count()) throw new Error('not final');
});

await step('round 1 auto-ends into break 1', async () => {
  await advance(page, 10);
  await page.waitForTimeout(300);
  const badge = await page.locator('#phase-badge').textContent();
  if (!badge.startsWith('休憩')) throw new Error(`badge ${badge}`);
  if (!await page.locator('#break-notes').isVisible()) throw new Error('notes panel hidden');
});

await step('break auto-advances to round 2', async () => {
  await advance(page, 65);
  await page.waitForTimeout(300);
  const badge = await page.locator('#phase-badge').textContent();
  if (!badge.startsWith('2ラウンド目')) throw new Error(`badge ${badge}`);
});

await step('whole session runs to the result screen on its own', async () => {
  await advance(page, 185);   // round 2
  await page.waitForTimeout(200);
  await advance(page, 65);   // break 2
  await page.waitForTimeout(200);
  const badge = await page.locator('#phase-badge').textContent();
  if (!badge.startsWith('3ラウンド目')) throw new Error(`badge ${badge}`);
  await advance(page, 125);   // round 3
  await page.waitForSelector('#screen-result.is-active', { timeout: 8000 });
  const cards = await page.locator('#result-rounds .round-card').count();
  if (cards !== 3) throw new Error(`${cards} round cards`);
});

await step('durations reflect the planned lengths', async () => {
  const metas = await page.locator('#result-rounds .meta').allTextContents();
  const mins = metas.map(t => Number(t.match(/(\d+)分/)[1]));
  if (JSON.stringify(mins) !== JSON.stringify([4,3,2])) throw new Error(metas.join(' / '));
});

await step('no console errors', () => { if (errors.length) throw new Error(errors.join(' | ')); });

await browser.close();
await close();
done('timing');
