/* Пробный рендер одной концепции в /tmp — для визуальной итерации. */
import fs from 'node:fs';
import path from 'node:path';

const [, , file, outDir = '/tmp/preview', only] = process.argv;
const mod = await import(path.resolve(file));
const dir = outDir;
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(path.join(dir, 'fonts'), { recursive: true });
const { ttfFiles } = await import('./lib/font.mjs');

for (const side of ['front', 'back']) {
  if (only && only !== side) continue;
  const card = await mod[side]();
  const svg = card.toSVG();
  fs.writeFileSync(path.join(dir, `${mod.slug}-${side}.svg`), svg);
  const png = card.toPNG({ scale: 2 });
  fs.writeFileSync(path.join(dir, `${mod.slug}-${side}.png`), png.buffer);
  console.log(side, png.width + '×' + png.height);
}
console.log('fonts:', ttfFiles().length);
