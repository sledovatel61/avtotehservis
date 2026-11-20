import fs from 'node:fs/promises';
import path from 'node:path';
const OUT = path.resolve(import.meta.dirname, '..');
const files = [];
async function walk(d) {
  for (const e of await fs.readdir(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) await walk(p);
    else if (e.name.endsWith('.json') && !e.name.startsWith('_')) files.push(p);
  }
}
await walk(path.join(OUT, 'concepts'));
let bad = 0, n = 0;
const rows = [];
for (const f of files.sort()) {
  const d = JSON.parse(await fs.readFile(f, 'utf8'));
  if (!d.texts) continue;
  n++;
  const { checkCard } = await import('./lib/check.mjs');
  const card = { id: d.id, side: d.side, texts: d.texts, qrList: d.qr, graphics: d.graphics };
  const r = checkCard(card);
  rows.push({ file: path.relative(OUT, f), ...r });
  if (r.violations.length) { bad++; console.log(`\n${d.id} ${d.side}:`); r.violations.forEach((v) => console.log('   ✗ ' + v)); }
  if (process.env.WARN && r.warnings.length) { console.log(`\n${d.id} ${d.side} (замечания):`); r.warnings.forEach((v) => console.log('   ! ' + v)); }
}
console.log(`\nпроверено файлов: ${n}, с нарушениями: ${bad}`);
await fs.writeFile(path.join(OUT, 'scripts', '_check.json'), JSON.stringify(rows, null, 1));
process.exitCode = bad ? 1 : 0;
