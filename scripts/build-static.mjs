import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const filename = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(filename) : [filename];
});

for (const filename of walk(path.join(root, 'javascript')).filter(filename => filename.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `Invalid JavaScript: ${filename}`);
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output);
for (const entry of ['index.html', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'assets', 'javascript', 'vendor']) {
  cpSync(path.join(root, entry), path.join(output, entry), {
    recursive: true,
    filter: filename => !path.relative(root, filename).split(path.sep).includes('showcase'),
  });
}

const indexFile = path.join(output, 'index.html');
const html = readFileSync(indexFile, 'utf8').replace(/(src|href)="([^"?#]+\.(?:js|css))"/g, (_, attribute, filename) => {
  const hash = createHash('sha256').update(readFileSync(path.join(output, filename))).digest('hex').slice(0, 12);
  return `${attribute}="${filename}?v=${hash}"`;
});
writeFileSync(indexFile, html);
for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  if (/^https?:/.test(match[1])) throw new Error(`External page dependency: ${match[1]}`);
  if (!existsSync(path.join(output, match[1].split('?')[0]))) throw new Error(`Missing page asset: ${match[1]}`);
}
for (const cssFile of walk(path.join(output, 'assets/css')).filter(file => file.endsWith('.css'))) {
  for (const match of readFileSync(cssFile, 'utf8').matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g)) {
    if (/^https?:/.test(match[1])) throw new Error(`External stylesheet dependency: ${match[1]}`);
    if (!existsSync(path.resolve(path.dirname(cssFile), match[1]))) throw new Error(`Missing stylesheet asset: ${match[1]}`);
  }
}
const files = walk(output);
const bytes = files.reduce((total, filename) => total + statSync(filename).size, 0);
console.log(`Static build verified: ${files.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MiB. Runtime libraries and assets are local.`);
