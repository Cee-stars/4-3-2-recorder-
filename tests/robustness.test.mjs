/** 二度押しと、途中で落ちたときの録音の残り方。 */
import { startServer, launch, createRunner, collectErrors } from './helpers.mjs';

const { base, close } = await startServer();
const { browser, context } = await launch();
const { step, done } = createRunner();
const errors = [];

const page = await context.newPage();
collectErrors(page, errors);
await page.goto(base);
await page.waitForTimeout(300);

const badge = () => page.locator('#phase-badge').textContent();
const doubleTap = async () => {
  // 指が滑って 2 回入ったときの状況を作る（クリック間の待ちを挟まない）。
  await page.locator('#btn-skip').dispatchEvent('click');
  await page.locator('#btn-skip').dispatchEvent('click');
};

await step('ラウンド中に二度押ししても休憩が飛ばない', async () => {
  await page.fill('#input-topic', 'double tap');
  await page.click('#btn-start');
  await page.waitForSelector('#screen-session.is-active');
  await page.waitForTimeout(1100);
  await doubleTap();
  await page.waitForTimeout(1200);
  const now = await badge();
  if (!now.startsWith('休憩')) throw new Error(`休憩を飛ばした：${now}`);
});

await step('休憩中に二度押ししてもラウンドが飛ばない', async () => {
  await doubleTap();
  await page.waitForTimeout(1200);
  const now = await badge();
  if (!now.startsWith('2ラウンド目')) throw new Error(`2ラウンド目に来ていない：${now}`);
});

await step('二度押しを挟んでも 3 ラウンドすべて録音される', async () => {
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(1100);
    await doubleTap();
  }
  await page.waitForSelector('#screen-result.is-active', { timeout: 8000 });
  const cards = await page.locator('#result-rounds .round-card').count();
  if (cards !== 3) throw new Error(`${cards} ラウンドしかない`);
  const sizes = await page.evaluate(async () => {
    const out = [];
    for (const a of document.querySelectorAll('#result-rounds audio')) {
      out.push((await (await fetch(a.src)).blob()).size);
    }
    return out;
  });
  if (sizes.length !== 3 || sizes.some(s => s < 100)) throw new Error(`音声サイズ ${sizes.join(',')}`);
});

await step('途中でアプリが落ちても、終わったラウンドは残る', async () => {
  const fresh = await browser.newContext({ permissions: ['microphone'], viewport: { width: 390, height: 844 } });
  const p2 = await fresh.newPage();
  collectErrors(p2, errors);
  await p2.goto(base);
  await p2.waitForTimeout(300);
  await p2.fill('#input-topic', 'crash run');
  await p2.click('#btn-start');
  await p2.waitForSelector('#screen-session.is-active');
  await p2.waitForTimeout(1200);
  await p2.click('#btn-skip');            // 1 ラウンド目を終える
  await p2.waitForTimeout(1200);

  // セッションの途中でページが捨てられた状況
  await p2.evaluate(() => window.removeEventListener('beforeunload', () => {}));
  await p2.goto(base);
  await p2.waitForTimeout(500);
  await p2.click('#btn-open-history');
  await p2.waitForTimeout(600);
  if (await p2.locator('.history-item').count() !== 1) throw new Error('履歴に残っていない');
  const sub = await p2.locator('.history-item .h-sub').first().textContent();
  if (!sub.includes('途中まで')) throw new Error(`「途中まで」が出ない：${sub}`);
  if (!sub.includes('1 ラウンド')) throw new Error(`ラウンド数が違う：${sub}`);

  await p2.locator('.history-item').first().click();
  await p2.waitForSelector('#screen-result.is-active');
  await p2.waitForTimeout(400);
  const playable = await p2.evaluate(async () => {
    const a = document.querySelector('#result-rounds audio');
    return !!a && (await (await fetch(a.src)).blob()).size > 100;
  });
  if (!playable) throw new Error('残った録音が再生できない');
  await fresh.close();
});

await step('自分で中断したときは途中の録音を残さない', async () => {
  const fresh = await browser.newContext({ permissions: ['microphone'], viewport: { width: 390, height: 844 } });
  const p3 = await fresh.newPage();
  collectErrors(p3, errors);
  await p3.goto(base);
  await p3.waitForTimeout(300);
  await p3.fill('#input-topic', 'abort run');
  await p3.click('#btn-start');
  await p3.waitForSelector('#screen-session.is-active');
  await p3.waitForTimeout(1200);
  await p3.click('#btn-skip');
  await p3.waitForTimeout(1200);
  p3.once('dialog', d => d.accept());
  await p3.click('#btn-abort');
  await p3.waitForTimeout(800);
  await p3.click('#btn-open-history');
  await p3.waitForTimeout(600);
  const text = await p3.locator('#history-list').textContent();
  if (!text.includes('まだ記録がありません')) throw new Error('中断したのに履歴に残っている');
  await fresh.close();
});

await step('no console errors', () => {
  const real = errors.filter(e => !/favicon|sw\.js|ServiceWorker/i.test(e));
  if (real.length) throw new Error(real.join(' | '));
});

await browser.close();
await close();
done('robustness');
