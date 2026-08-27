/** 休憩の手動送りと呼吸ガイド */
import { startServer, launch, createRunner, collectErrors, advance } from './helpers.mjs';

const { base, close } = await startServer();
const { browser, context } = await launch();
const { step, done } = createRunner();
const errors = [];
await context.addInitScript(() => {
  localStorage.setItem('432recorder.settings.v1', JSON.stringify({ autoNextBreak: false }));
});
const page = await context.newPage();
collectErrors(page, errors);

await page.clock.install();
await page.goto(base);
await page.waitForTimeout(200);

await step('setting is read back into the session', async () => {
  await page.fill('#input-topic', 'hold run');
  await page.click('#btn-start');
  await page.waitForSelector('#screen-session.is-active');
});

await step('round 1 ends into the break', async () => {
  await advance(page, 245);
  await page.waitForTimeout(500);
  const badge = await page.locator('#phase-badge').textContent();
  if (!badge.startsWith('休憩')) throw new Error(`badge ${badge}`);
});

await step('break holds at 0:00 instead of auto-advancing', async () => {
  await advance(page, 60);
  await page.waitForTimeout(300);
  await advance(page, 120);
  await page.waitForTimeout(300);
  const clock = await page.locator('#clock').textContent();
  if (clock !== '0:00') throw new Error(`clock ${clock}`);
  const badge = await page.locator('#phase-badge').textContent();
  if (!badge.includes('準備ができたら次へ')) throw new Error(`badge ${badge}`);
  if (!await page.locator('#break-notes').isVisible()) throw new Error('notes panel gone');
});

await step('the button resumes into round 2', async () => {
  await page.click('#btn-skip');
  await page.waitForTimeout(500);
  const badge = await page.locator('#phase-badge').textContent();
  if (!badge.startsWith('2ラウンド目')) throw new Error(`badge ${badge}`);
  if (await page.locator('#clock').textContent() !== '3:00') throw new Error('clock did not reset');
  if (!await page.locator('#rec-indicator.is-on').isVisible()) throw new Error('not recording');
});

await step('breathing guide alternates in break 2', async () => {
  await advance(page, 2);                  // 画面が変わった直後の誤タップ扱いを避ける
  await page.click('#btn-skip');           // ラウンド 2 を終える
  await page.waitForTimeout(500);
  if (!await page.locator('#break-breathe').isVisible()) throw new Error('breathe panel hidden');
  if (await page.locator('#breathe-text').textContent() !== '吸って') throw new Error('starts wrong');
  await advance(page, 4);
  await page.waitForTimeout(200);
  if (await page.locator('#breathe-text').textContent() !== '吐いて') throw new Error('did not switch to 吐いて');
  await advance(page, 4);
  await page.waitForTimeout(200);
  if (await page.locator('#breathe-text').textContent() !== '吸って') throw new Error('did not switch back');
});

await step('no console errors', () => { if (errors.length) throw new Error(errors.join(' | ')); });
await browser.close();
await close();
done('breaks');
