/* PDF на печать: отдельные файлы по концепциям + сводный. Каждая страница —
   96×56 мм (90×50 готовых + 3 мм вылета), метки реза по линии реза. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { writePdf, cropMarks } from './lib/pdfwrite.mjs';
import { C, SHEET } from './lib/palette.mjs';
import { Card } from './lib/card.mjs';
import { loadFonts } from './lib/fonts.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const OUT = path.resolve(import.meta.dirname, '..');
const fonts = await loadFonts(path.join(ROOT, 'site/public/fonts'));

const mods = [];
for (const f of (await fs.readdir(path.join(import.meta.dirname, 'concepts'))).sort()) mods.push(await import(`./concepts/${f}`));

const all = [];
await fs.mkdir(path.join(OUT, 'print'), { recursive: true });
for (const m of mods) {
  const pages = [];
  for (const side of ['front', 'back']) {
    const card = new Card({ id: m.meta.id, side, bg: C.night, fonts, title: `${m.meta.title} — ${side}` });
    m[side](card);
    const ops = [...card.list];
    // фон карточки уже первым слоем; метки реза сверху, они лежат в вылете
    pages.push({ ops, w: SHEET.w, h: SHEET.h, label: `${m.meta.id}-${side}` });
  }
  const file = path.join(OUT, 'print', `card-01-${m.meta.id.replace(/^\d+-/, '')}.pdf`);
  await writePdf(pages, file, { title: `АвтоТехСервис — визитка, ${m.meta.title}`, author: 'Агент 01', creator: 'SVG-генератор агента 01', subject: '90×50 мм + 3 мм вылета, текст в кривых' });
  all.push({ m, pages });
  console.log('PDF:', path.relative(OUT, file), `${(await fs.stat(file)).size} Б`);
}
// сводный PDF: 5 концепций × 2 стороны + метки реза на каждой странице
const summary = [];
for (const { m, pages } of all) {
  for (const p of pages) summary.push({ ...p, ops: [...p.ops, ...cropMarks()] });
}
const file = path.join(OUT, 'print', 'card-01-all-concepts.pdf');
await writePdf(summary, file, { title: 'АвтоТехСервис — 5 концепций визитки, агент 01', author: 'Агент 01', creator: 'SVG-генератор агента 01', subject: '10 страниц, 96×56 мм с вылетами и метками реза' });
console.log('PDF:', path.relative(OUT, file), `${(await fs.stat(file)).size} Б`);
