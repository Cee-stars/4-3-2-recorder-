/** 通しの操作：準備 → 3 ラウンド → 結果 → 履歴 */
import { startServer, launch, createRunner, collectErrors } from './helpers.mjs';

const { base, close } = await startServer();
const { browser, context } = await launch();
const { step, done } = createRunner();
const errors = [];
const page = await context.newPage();
collectErrors(page, errors);

await page.goto(base);

await page.waitForTimeout(300);

await step('setup screen visible', async () => {
  if (!(await page.locator('#screen-setup').isVisible())) throw new Error('not visible');
});

await step('start blocked without a topic', async () => {
  await page.click('#btn-start');
  await page.waitForTimeout(200);
  const toast = await page.locator('#toast').textContent();
  if (!toast.includes('話題')) throw new Error(`toast was "${toast}"`);
  if (await page.locator('#screen-session').isVisible()) throw new Error('session started anyway');
});

await step('topic suggestion fills the field', async () => {
  await page.locator('#topic-suggestions .chip').first().click();
  const v = await page.inputValue('#input-topic');
  if (!v) throw new Error('empty');
});

await step('memo caps at 4 words', async () => {
  for (const w of ['coffee', 'train', 'inbox', 'lunch']) {
    await page.fill('#input-memo', w);
    await page.locator('#btn-add-memo').click();
    await page.waitForTimeout(50);
  }
  const n = await page.locator('#memo-list .chip').count();
  if (n !== 4) throw new Error(`got ${n} chips`);
  if (await page.locator('#memo-count').textContent() !== '4') throw new Error('counter mismatch');
  if (!await page.locator('#input-memo').isDisabled()) throw new Error('input still enabled at cap');
});

await step('memo chip removal', async () => {
  await page.locator('#memo-list .chip').nth(3).click();
  if (await page.locator('#memo-list .chip').count() !== 3) throw new Error('not removed');
});

await step('plan preview lists 5 phases', async () => {
  const n = await page.locator('#plan-preview li').count();
  if (n !== 5) throw new Error(`got ${n}`);
});

await step('transcription toggle persists', async () => {
  await page.locator('#toggle-transcribe').locator('xpath=following-sibling::span[1]').click();
  if (!await page.locator('#toggle-transcribe').isChecked()) throw new Error('label click did not toggle');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('432recorder.settings.v1')).transcribe);
  if (stored !== true) throw new Error('not saved');
});

await step('session starts and records', async () => {
  await page.click('#btn-start');
  await page.waitForSelector('#screen-session.is-active', { timeout: 4000 });
  await page.waitForTimeout(1200);
  if (!await page.locator('#rec-indicator.is-on').isVisible()) throw new Error('REC indicator off');
  const badge = await page.locator('#phase-badge').textContent();
  if (!badge.startsWith('1ラウンド目')) throw new Error(`badge "${badge}"`);
  if (!await page.locator('#session-memo .chip').first().isVisible()) throw new Error('memo hidden in round');
  const clock = await page.locator('#clock').textContent();
  if (!/^3:5\d$/.test(clock)) throw new Error(`clock "${clock}"`);
});

await step('break 1 shows the word-notes panel', async () => {
  await page.waitForTimeout(800);
  await page.click('#btn-skip');
  await page.waitForTimeout(500);
  if (!await page.locator('#break-notes').isVisible()) throw new Error('notes panel hidden');
  if (await page.locator('#rec-indicator').isVisible()) throw new Error('still recording');
  if (await page.locator('#session-memo').isVisible()) throw new Error('memo shown in break');
  await page.fill('#input-gap', '締め切り');
  await page.locator('#gap-form button').click();
  await page.waitForTimeout(100);
  if (await page.locator('#gap-list li').count() !== 1) throw new Error('gap not added');
});

await step('round 2 restarts recording', async () => {
  await page.waitForTimeout(800);
  await page.click('#btn-skip');
  await page.waitForTimeout(1200);
  const badge = await page.locator('#phase-badge').textContent();
  if (!badge.startsWith('2ラウンド目')) throw new Error(`badge "${badge}"`);
  if (!await page.locator('#rec-indicator.is-on').isVisible()) throw new Error('not recording');
  const cue = await page.locator('#cue').textContent();
  if (!cue.includes('無駄に削って')) throw new Error(`cue "${cue}"`);
});

await step('break 2 hides everything but the breathing circle', async () => {
  await page.waitForTimeout(800);
  await page.click('#btn-skip');
  await page.waitForTimeout(400);
  if (!await page.locator('#break-breathe').isVisible()) throw new Error('breathe panel hidden');
  if (await page.locator('#cue').isVisible()) throw new Error('cue visible');
  if (await page.locator('#session-memo').isVisible()) throw new Error('memo visible');
  if (await page.locator('#break-notes').isVisible()) throw new Error('notes visible');
});

await step('round 3 then finish', async () => {
  await page.waitForTimeout(800);
  await page.click('#btn-skip');
  await page.waitForTimeout(1200);
  const badge = await page.locator('#phase-badge').textContent();
  if (!badge.startsWith('3ラウンド目')) throw new Error(`badge "${badge}"`);
  await page.waitForTimeout(800);
  await page.click('#btn-skip');
  await page.waitForSelector('#screen-result.is-active', { timeout: 5000 });
});

await step('result shows 3 playable rounds', async () => {
  const cards = await page.locator('#result-rounds .round-card').count();
  if (cards !== 3) throw new Error(`${cards} cards`);
  const audios = await page.locator('#result-rounds audio').count();
  if (audios !== 3) throw new Error(`${audios} audio elements`);
  const dur = await page.evaluate(async () => {
    const a = document.querySelector('#result-rounds audio');
    if (a.readyState >= 1) return a.duration;
    await new Promise(r => { a.onloadedmetadata = r; setTimeout(r, 3000); });
    return a.duration;
  });
  if (!(dur > 0)) throw new Error(`audio duration ${dur}`);
  const meta = await page.locator('#result-rounds .meta').first().textContent();
  if (!/\d+分\d\d秒/.test(meta)) throw new Error(`meta "${meta}"`);
});

await step('result shows memo, topic and gap words', async () => {
  if (!(await page.locator('#result-topic').textContent()).trim()) throw new Error('no topic');
  if (await page.locator('#result-memo .chip').count() !== 3) throw new Error('memo chips missing');
  if (!await page.locator('#result-gap-card').isVisible()) throw new Error('gap card hidden');
  const gap = await page.locator('#result-gaps li .word').first().textContent();
  if (gap !== '締め切り') throw new Error(`gap "${gap}"`);
  const href = await page.locator('#result-gaps li a').first().getAttribute('href');
  if (!href.startsWith('https://')) throw new Error('bad search link');
});

await step('download link is wired to the recording', async () => {
  const a = page.locator('#result-rounds a.btn').first();
  const [href, name] = [await a.getAttribute('href'), await a.getAttribute('download')];
  if (!href.startsWith('blob:')) throw new Error(`href ${href}`);
  if (!/^432_\d{4}-\d\d-\d\d_R1\.\w+$/.test(name)) throw new Error(`name ${name}`);
});

await step('history lists the session and reopens it', async () => {
  await page.click('#btn-result-back');
  await page.click('#btn-open-history');
  await page.waitForTimeout(400);
  const items = await page.locator('.history-item').count();
  if (items !== 1) throw new Error(`${items} items`);
  await page.locator('.history-item').first().click();
  await page.waitForSelector('#screen-result.is-active');
  await page.waitForTimeout(300);
  if (await page.locator('#result-rounds audio').count() !== 3) throw new Error('rounds not restored');
});

await step('recordings survive a reload (IndexedDB)', async () => {
  await page.reload();
  await page.waitForTimeout(400);
  await page.click('#btn-open-history');
  await page.waitForTimeout(500);
  if (await page.locator('.history-item').count() !== 1) throw new Error('history lost');
  await page.locator('.history-item').first().click();
  await page.waitForTimeout(400);
  if (await page.locator('#result-rounds audio').count() !== 3) throw new Error('audio lost');
});

await step('delete removes the record', async () => {
  page.once('dialog', d => d.accept());
  await page.click('#btn-result-delete');
  await page.waitForTimeout(400);
  await page.click('#btn-open-history');
  await page.waitForTimeout(400);
  if (!(await page.locator('#history-list').textContent()).includes('まだ記録がありません')) {
    throw new Error('still there');
  }
});

await step('settings edit the plan', async () => {
  await page.click('#btn-history-back');
  await page.click('#btn-open-settings');
  await page.fill('#set-r1', '6');
  await page.dispatchEvent('#set-r1', 'change');
  await page.click('#btn-settings-back');
  const first = await page.locator('#plan-preview li .t').first().textContent();
  if (!first.includes('6分')) throw new Error(`"${first}"`);
  await page.click('#btn-open-settings');
  await page.click('#btn-reset-times');
  await page.click('#btn-settings-back');
  const back = await page.locator('#plan-preview li .t').first().textContent();
  if (!back.includes('4分')) throw new Error(`"${back}"`);
});

await step('no console errors', () => {
  const real = errors.filter(e => !/favicon|sw\.js|ServiceWorker/i.test(e));
  if (real.length) throw new Error(real.join(' | '));
});


await browser.close();
await close();
done('flow');
