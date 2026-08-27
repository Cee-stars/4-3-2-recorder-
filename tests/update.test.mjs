/** 更新が 1 回の再読み込みで届くか。オフラインでも起動できるか。 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, launch, createRunner } from './helpers.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await fs.mkdtemp(path.join(os.tmpdir(), '432-sw-'));
for (const entry of ['index.html', 'sw.js', 'manifest.webmanifest', 'assets', 'src']) {
  await fs.cp(path.join(REPO, entry), path.join(dir, entry), { recursive: true });
}

const { base, close } = await startServer(dir);
const { browser, context } = await launch();
const { step, done } = createRunner();

const page = await context.newPage();
await page.goto(base);
// サービスワーカーが登録され、ページを受け持つまで待つ
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.waitForTimeout(500);

await step('サービスワーカーがページを受け持っている', async () => {
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  if (!controlled) throw new Error('controller なし');
});

await step('更新が 1 回の再読み込みで反映される', async () => {
  const html = await fs.readFile(path.join(dir, 'index.html'), 'utf8');
  await fs.writeFile(path.join(dir, 'index.html'), html.replace('>スタート<', '>スタート更新版<'));
  await page.reload();
  await page.waitForTimeout(600);
  const label = await page.locator('#btn-start').textContent();
  if (label !== 'スタート更新版') throw new Error(`まだ古い版：「${label}」`);
});

await step('中身（JS）の更新も 1 回で反映される', async () => {
  const js = await fs.readFile(path.join(dir, 'src/config.js'), 'utf8');
  await fs.writeFile(path.join(dir, 'src/config.js'), js.replace('内容を出し切る。', '内容を出し切る（更新）。'));
  await page.reload();
  await page.waitForTimeout(600);
  const cue = await page.locator('#plan-preview li .d').first().textContent();
  if (!cue.includes('（更新）')) throw new Error(`まだ古い版：「${cue}」`);
});

await step('オフラインでも起動できる', async () => {
  await context.setOffline(true);
  await page.reload();
  await page.waitForTimeout(800);
  if (!await page.locator('#btn-start').isVisible()) throw new Error('オフラインで開けない');
  const plan = await page.locator('#plan-preview li').count();
  if (plan !== 5) throw new Error(`進行表が出ない（${plan} 行）`);
  await context.setOffline(false);
});

await browser.close();
await close();
await fs.rm(dir, { recursive: true, force: true });
done('update');
