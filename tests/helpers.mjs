import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

/** テスト用にリポジトリをそのまま配信する。 */
export async function startServer() {
  const server = http.createServer(async (req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    try {
      const body = await fs.readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/`;
  return { base, close: () => new Promise(resolve => server.close(resolve)) };
}

/** マイクを許可した、iPhone サイズのブラウザを開く。 */
export async function launch() {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const context = await browser.newContext({
    permissions: ['microphone'],
    viewport: { width: 390, height: 844 },
  });
  return { browser, context };
}

/**
 * 時計を秒数ぶん進める。
 * 一度に長時間進めると requestAnimationFrame のループを大量に消化して詰まるので、
 * 短く刻んで進める。
 */
export async function advance(page, seconds, chunkSeconds = 30) {
  let left = seconds;
  while (left > 0) {
    const chunk = Math.min(left, chunkSeconds);
    await page.clock.runFor(chunk * 1000);
    left -= chunk;
  }
}

export function createRunner() {
  const failures = [];
  const step = async (label, fn) => {
    try {
      await fn();
      console.log(`  ok  ${label}`);
    } catch (err) {
      failures.push(label);
      console.log(`FAIL  ${label}: ${err.message}`);
      process.exitCode = 1;
    }
  };
  const done = name => {
    console.log(failures.length ? `\n${name}: ${failures.length} 件失敗` : `\n${name}: all checks passed`);
  };
  return { step, done };
}

export function collectErrors(page, errors) {
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
}
