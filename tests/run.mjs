/** tests/*.test.mjs をひとつずつ実行する簡易ランナー。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.mjs')).sort();

let failed = 0;
for (const file of files) {
  console.log(`\n── ${file}`);
  const code = await new Promise(resolve => {
    spawn(process.execPath, [path.join(dir, file)], { stdio: 'inherit' }).on('close', resolve);
  });
  if (code !== 0) failed += 1;
}

console.log(failed ? `\n${failed} / ${files.length} ファイルが失敗しました` : `\n${files.length} ファイルすべて成功`);
process.exit(failed ? 1 : 0);
