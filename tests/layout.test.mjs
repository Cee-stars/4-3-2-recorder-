/** 画面の高さ：ボタンの下に余白が残らないこと（iOS のツールバー出入り対策）。 */
import { startServer, launch, createRunner, collectErrors } from './helpers.mjs';

const { base, close } = await startServer();
const { browser, context } = await launch();
const { step, done } = createRunner();
const errors = [];

const page = await context.newPage();
collectErrors(page, errors);
await page.goto(base);
await page.waitForTimeout(300);

/** 画面下端と、いちばん下のボタンの下端とのすき間 */
const gapBelow = (page, selector) => page.evaluate(sel => {
  const rect = document.querySelector(sel).getBoundingClientRect();
  return Math.round(window.innerHeight - rect.bottom);
}, selector);

await step('スタートボタンの下に余白が残らない', async () => {
  const gap = await gapBelow(page, '#btn-start');
  if (gap > 24) throw new Error(`${gap}px あいている`);
});

await step('表示領域の高さが CSS に渡っている', async () => {
  const value = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--app-height').trim());
  const inner = await page.evaluate(() => window.innerHeight);
  if (Math.abs(parseInt(value, 10) - inner) > 2) throw new Error(`${value} vs ${inner}px`);
});

await step('高さが変わっても画面が追従する', async () => {
  // iOS でツールバーが引っ込んで表示領域が広がる状況に相当。
  await page.setViewportSize({ width: 390, height: 920 });
  await page.waitForTimeout(300);
  const gap = await gapBelow(page, '#btn-start');
  if (gap > 24) throw new Error(`広げたあと ${gap}px あいている`);

  await page.setViewportSize({ width: 390, height: 700 });
  await page.waitForTimeout(300);
  const shrunk = await gapBelow(page, '#btn-start');
  if (shrunk > 24) throw new Error(`縮めたあと ${shrunk}px あいている`);
  if (shrunk < -1) throw new Error(`画面からはみ出している（${shrunk}px）`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
});

await step('ページ自体はスクロールしない（中身だけ動く）', async () => {
  const scrollable = await page.evaluate(() =>
    document.documentElement.scrollHeight > document.documentElement.clientHeight + 1);
  if (scrollable) throw new Error('body がスクロールする');
  const inner = await page.evaluate(() => {
    const el = document.querySelector('#screen-setup .scroll');
    el.scrollTop = 9999;
    return el.scrollTop > 0;
  });
  if (!inner) throw new Error('カード側がスクロールしない');
});

await step('他の画面もボタンが下端にそろう', async () => {
  await page.click('#btn-open-history');
  await page.waitForTimeout(200);
  const history = await gapBelow(page, '#btn-import-history');
  if (history > 24) throw new Error(`履歴で ${history}px`);

  await page.click('#btn-history-back');
  await page.fill('#input-topic', 'layout run');
  await page.click('#btn-start');
  await page.waitForSelector('#screen-session.is-active');
  await page.waitForTimeout(400);
  const session = await gapBelow(page, '#btn-skip');
  if (session > 24) throw new Error(`セッションで ${session}px`);
  const overflow = await page.evaluate(() => {
    const stage = document.querySelector('#stage');
    return stage.getBoundingClientRect().bottom > window.innerHeight + 1;
  });
  if (overflow) throw new Error('セッション画面がはみ出している');
});

await step('no console errors', () => {
  const real = errors.filter(e => !/favicon|sw\.js|ServiceWorker/i.test(e));
  if (real.length) throw new Error(real.join(' | '));
});

await browser.close();
await close();
done('layout');
