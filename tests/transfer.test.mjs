/** 書き出し → 別のブラウザ環境へ読み込み。3 ラウンド分の音声が戻ることを確かめる。 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer, launch, createRunner, collectErrors } from './helpers.mjs';

const { base, close } = await startServer();
const { browser, context } = await launch();
const { step, done } = createRunner();
const errors = [];

const page = await context.newPage();
collectErrors(page, errors);
await page.goto(base);
await page.waitForTimeout(300);

let exported = '';

await step('3 ラウンドすべてが録音される', async () => {
  await page.fill('#input-topic', 'export run');
  for (const w of ['coffee', 'train']) {
    await page.fill('#input-memo', w);
    await page.locator('#btn-add-memo').click();
  }
  await page.click('#btn-start');
  await page.waitForSelector('#screen-session.is-active');
  for (let i = 0; i < 5; i++) {          // 3 ラウンド + 休憩 2 回
    await page.waitForTimeout(1200);
    await page.click('#btn-skip');
  }
  await page.waitForSelector('#screen-result.is-active', { timeout: 8000 });
  const audios = await page.locator('#result-rounds audio').count();
  if (audios !== 3) throw new Error(`${audios} audio elements`);
  // 3 本とも中身のある音声か（「録音なし」が混じっていないか）
  const sizes = await page.evaluate(async () => {
    const out = [];
    for (const a of document.querySelectorAll('#result-rounds audio')) {
      out.push((await (await fetch(a.src)).blob()).size);
    }
    return out;
  });
  if (sizes.length !== 3 || sizes.some(s => s < 100)) throw new Error(`sizes ${sizes.join(',')}`);
});

await step('セッションをファイルに書き出せる', async () => {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#btn-export-session'),
  ]);
  const name = download.suggestedFilename();
  if (!/^432_\d{4}-\d\d-\d\d_export-run\.json$/.test(name)) throw new Error(`name ${name}`);
  exported = path.join(await fs.mkdtemp(path.join(os.tmpdir(), '432-')), name);
  await download.saveAs(exported);
  const payload = JSON.parse(await fs.readFile(exported, 'utf8'));
  if (payload.format !== '432recorder') throw new Error('bad format field');
  if (payload.sessions.length !== 1) throw new Error('session count');
  const rounds = payload.sessions[0].rounds;
  if (rounds.length !== 3) throw new Error(`${rounds.length} rounds in file`);
  if (rounds.some(r => !r.audio || r.audio.length < 100)) throw new Error('a round has no audio');
  if (payload.sessions[0].memo.join() !== 'coffee,train') throw new Error('memo missing');
});

await step('別の環境で読み込むと履歴に戻る', async () => {
  const fresh = await browser.newContext({ permissions: ['microphone'], viewport: { width: 390, height: 844 } });
  const p2 = await fresh.newPage();
  collectErrors(p2, errors);
  await p2.goto(base);
  await p2.waitForTimeout(300);
  await p2.click('#btn-open-history');
  await p2.waitForTimeout(300);
  if (!(await p2.locator('#history-list').textContent()).includes('まだ記録がありません')) {
    throw new Error('fresh profile was not empty');
  }
  await p2.setInputFiles('#import-file', exported);
  await p2.waitForTimeout(1200);
  if (await p2.locator('.history-item').count() !== 1) throw new Error('not listed');

  await p2.locator('.history-item').first().click();
  await p2.waitForSelector('#screen-result.is-active');
  await p2.waitForTimeout(400);
  if (await p2.locator('#result-rounds audio').count() !== 3) throw new Error('rounds not restored');
  if (await p2.locator('#result-memo .chip').count() !== 2) throw new Error('memo not restored');
  if ((await p2.locator('#result-topic').textContent()) !== 'export run') throw new Error('topic not restored');
  const playable = await p2.evaluate(async () => {
    const a = document.querySelector('#result-rounds audio');
    if (a.readyState < 1) await new Promise(r => { a.onloadedmetadata = r; setTimeout(r, 3000); });
    return a.duration > 0 && (await (await fetch(a.src)).blob()).size > 100;
  });
  if (!playable) throw new Error('restored audio is not playable');
  await fresh.close();
});

await step('二重に読み込んでも上書きされず 2 件になる', async () => {
  const fresh = await browser.newContext({ permissions: ['microphone'], viewport: { width: 390, height: 844 } });
  const p3 = await fresh.newPage();
  await p3.goto(base);
  await p3.waitForTimeout(300);
  await p3.click('#btn-open-history');
  const copy = path.join(path.dirname(exported), 'copy.json');
  await fs.copyFile(exported, copy);
  await p3.setInputFiles('#import-file', exported);
  await p3.waitForTimeout(1200);
  const afterFirst = await p3.locator('.history-item').count();
  if (afterFirst !== 1) throw new Error(`first import gave ${afterFirst}`);
  await p3.setInputFiles('#import-file', copy);
  await p3.waitForTimeout(1500);
  const n = await p3.locator('.history-item').count();
  if (n !== 2) throw new Error(`${n} items`);
  await fresh.close();
});

await step('関係ないファイルは断る', async () => {
  const junk = path.join(path.dirname(exported), 'junk.json');
  await fs.writeFile(junk, JSON.stringify({ hello: 'world' }));
  await page.click('#btn-result-back');
  await page.click('#btn-open-history');
  await page.setInputFiles('#import-file', junk);
  await page.waitForTimeout(600);
  const toast = await page.locator('#toast').textContent();
  if (!toast.includes('書き出しファイルではない')) throw new Error(`toast "${toast}"`);
});

await step('no console errors', () => {
  const real = errors.filter(e => !/favicon|sw\.js|ServiceWorker/i.test(e));
  if (real.length) throw new Error(real.join(' | '));
});

await browser.close();
await close();
done('transfer');
