/** モード：既定は 4/3/2 のまま、「ひとりで話す」が別の進行で回りきるか */
import { startServer, launch, createRunner, collectErrors, advance } from './helpers.mjs';

const { base, close } = await startServer();
const { browser, context } = await launch();
const { step, done } = createRunner();
const errors = [];
const page = await context.newPage();
collectErrors(page, errors);

await page.clock.install();
await page.goto(base);
await page.waitForTimeout(200);

/** フェーズの組み立てを、画面を通さずに直接見る。
 *  終了音とカウント音は鳴ったかを外から確かめられないので、
 *  「どのフェーズに立つ約束なのか」を契約として見る。 */
const phasesOf = (page, mode) => page.evaluate(async m => {
  const { buildPhases } = await import('/src/config.js');
  return buildPhases({ mode: m, roundMinutes: [4, 3, 2], breakMinutes: 1, autoNextBreak: true })
    .map(p => ({ label: p.label, ms: p.ms, records: !!p.records, last: !!p.last, tick: !!p.tick }));
}, mode);

await step('既定は 4/3/2（札が2つ、押されているのは 4/3/2）', async () => {
  const chips = await page.locator('#mode-picker .chip').allTextContents();
  if (chips.length !== 2) throw new Error(`札が ${chips.length} 個`);
  const pressed = await page.locator('#mode-picker .chip[aria-pressed="true"]').textContent();
  if (pressed !== '4/3/2') throw new Error(`押されているのは ${pressed}`);
  const plan = await page.locator('#plan-preview li').count();
  if (plan !== 5) throw new Error(`進行表が ${plan} 行`);
});

await step('4/3/2 の進行は変わっていない（録音3本・最後だけ last・カウント音あり）', async () => {
  const p = await phasesOf(page, '432');
  const rounds = p.filter(x => x.records);
  if (rounds.length !== 3) throw new Error(`録音が ${rounds.length} 本`);
  if (!rounds.every(x => x.tick)) throw new Error('カウント音が落ちている');
  if (p.filter(x => x.last).length !== 1) throw new Error('last が1つでない');
  if (!rounds.at(-1).last) throw new Error('last が最後の録音にない');
});

await step('「ひとりで話す」を選ぶと進行表が入れ替わる', async () => {
  await page.click('#mode-picker .chip[data-mode="solo"]');
  await page.waitForTimeout(150);
  const pressed = await page.locator('#mode-picker .chip[aria-pressed="true"]').textContent();
  if (pressed !== 'ひとりで話す') throw new Error(`押されているのは ${pressed}`);
  const plan = await page.locator('#plan-preview li').count();
  if (plan !== 7) throw new Error(`進行表が ${plan} 行`);
});

await step('ひとりで話すの約束：録音2本・最後だけ last・カウント音なし・5分6秒', async () => {
  const p = await phasesOf(page, 'solo');
  const rounds = p.filter(x => x.records);
  if (rounds.length !== 2) throw new Error(`録音が ${rounds.length} 本`);
  if (!rounds.at(-1).last) throw new Error('終了音が鳴らない（last が最後の録音にない）');
  if (p.some(x => x.tick)) throw new Error('カウント音が鳴る約束になっている');
  const total = p.reduce((n, x) => n + x.ms, 0);
  if (total !== 306_000) throw new Error(`合計が ${total / 1000} 秒`);
});

await step('録音の前に「構える」が入る', async () => {
  const p = await phasesOf(page, 'solo');
  p.forEach((x, i) => {
    if (x.records && (i === 0 || p[i - 1].label !== '構える')) {
      throw new Error(`${x.label} の前が「構える」でない`);
    }
  });
});

await step('文字起こしのトグルは、このモードでは出さない', async () => {
  if (await page.locator('#toggle-transcribe').isVisible()) throw new Error('トグルが見えている');
});

await step('設定は次に開いたときも残る', async () => {
  await page.reload();
  await page.waitForTimeout(300);
  const pressed = await page.locator('#mode-picker .chip[aria-pressed="true"]').textContent();
  if (pressed !== 'ひとりで話す') throw new Error(`押されているのは ${pressed}`);
});

await step('セッションが自分で回りきって結果画面に着く', async () => {
  await page.fill('#input-topic', 'solo run');
  await page.click('#btn-start');
  await page.waitForSelector('#screen-session.is-active');
  // 工程の途中から進めるので、秒数を決め打ちにすると越えてしまう。
  // 狙った工程に着くまで2秒ずつ進める（「構える」は3秒しかないため）。
  const until = async prefix => {
    for (let i = 0; i < 140; i += 2) {
      const badge = await page.locator('#phase-badge').textContent();
      if (badge.startsWith(prefix)) return;
      await advance(page, 2);
      await page.waitForTimeout(120);
    }
    const badge = await page.locator('#phase-badge').textContent();
    throw new Error(`${prefix} に進まない（いま ${badge}）`);
  };
  for (const next of ['構える', '1回目', '聞き返す', '言い直す', '構える', '2回目']) {
    await until(next);
  }
  await advance(page, 65);
  await page.waitForSelector('#screen-result.is-active', { timeout: 8000 });
});

await step('録音しない工程が、偽のラウンドとして記録に入らない', async () => {
  const cards = await page.locator('#result-rounds .round-card').count();
  if (cards !== 2) throw new Error(`結果に ${cards} 枚ある`);
});

await step('画面がはみ出さない', async () => {
  const over = await page.evaluate(() => {
    const s = document.querySelector('#screen-result .scroll') || document.querySelector('#screen-result');
    return s.scrollWidth > window.innerWidth + 1;
  });
  if (over) throw new Error('結果画面が横にはみ出している');
});

await step('no console errors', () => {
  if (errors.length) throw new Error(errors.join(' / '));
});

done('modes');
await browser.close();
await close();
