import fs from 'node:fs/promises';
import path from 'node:path';
import { loadFonts } from './lib/fonts.mjs';
import { Card } from './lib/card.mjs';
import { toSvg, toPng, decodeQr } from './lib/render.mjs';
import { C, SHEET } from './lib/palette.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../../..');           // корень репозитория
const FONTS = path.join(ROOT, 'site/public/fonts');
const OUT = path.resolve(import.meta.dirname, '..');
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));

const fonts = await loadFonts(FONTS);
const mods = [];
for (const dir of await fs.readdir(path.join(import.meta.dirname, 'concepts'))) {
  const m = await import(`./concepts/${dir}`);
  mods.push(m);
}
mods.sort((a, b) => a.meta.num.localeCompare(b.meta.num));

for (const m of mods) {
  if (only.length && !only.includes(m.meta.id)) continue;
  const dir = path.join(OUT, 'concepts', m.meta.id);
  await fs.mkdir(dir, { recursive: true });
  for (const side of ['front', 'back']) {
    const card = new Card({ id: m.meta.id, side, bg: C.night, fonts, title: `${m.meta.title} — ${side === 'front' ? 'лицевая' : 'оборотная'}` });
    m[side](card);
    const svg = await toSvg(card);
    await fs.writeFile(path.join(dir, `${side}.svg`), svg);
    const png = await toPng(svg, { dpi: 600 });
    await fs.writeFile(path.join(dir, `${side}.png`), png);
    // превью 300 dpi для коллажа и просмотра в репозитории
    await toPng(svg, { dpi: 300, file: path.join(dir, `${side}-300.png`) });
    for (const box of card.qrList) {
      const r = await decodeQr(png, box);
      console.log(`${m.meta.id} ${side}: QR → ${r.ok ? r.url : 'НЕ ПРОЧИТАН'}`);
      if (!r.ok || r.url !== box.url) process.exitCode = 1;
    }
    await fs.writeFile(path.join(dir, `${side}.json`), JSON.stringify({ id: m.meta.id, side, meta: m.meta, bg: card.bg, texts: card.texts, qr: card.qrList, graphics: card.graphics, sheet: SHEET }, null, 1));
  }
  console.log(`  готово: ${m.meta.id}`);
}
