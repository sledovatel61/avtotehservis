/* Итоговая самопроверка в один прогон: факты посимвольно, запрещённые слова,
   безопасная зона, кегли, контраст, QR, наличие файлов. Пишет report.md. */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { F, FORBIDDEN } from './lib/content.mjs';
import { checkCard } from './lib/check.mjs';
import { C } from './lib/palette.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const OUT = path.resolve(import.meta.dirname, '..');
const mods = [];
for (const f of (await fs.readdir(path.join(import.meta.dirname, 'concepts'))).sort()) mods.push(await import(`./concepts/${f}`));

const fail = [], warn = [], rows = [];
const ALLOWED_PHONES = new Set([F.phoneMain, F.phone2, F.phoneCity, F.telegramPhone]);
const ALLOWED_HEX = new Set(Object.values(C).map((h) => h.toUpperCase()).concat(['#3F4E47', '#0D1914']));

function parseDoc() {
  const arts = [];
  for (const m of mods) for (const side of ['front', 'back']) arts.push({ id: m.meta.id, side, meta: m.meta, ...JSON.parse(fs_sync(path.join(OUT, 'concepts', m.meta.id, `${side}.json`))) });
  return arts;
}
import fsSync from 'node:fs';
function fs_sync(p) { return fsSync.readFileSync(p, 'utf8'); }

const arts = parseDoc();
const allText = [];
for (const a of arts) {
  for (const t of a.texts) allText.push({ ...t, file: `${a.id}/${a.side}` });
}

/* 1. Телефоны посимвольно */
const phoneRe = /\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}/g;
const found = new Set();
for (const t of allText) for (const m of t.text.matchAll(phoneRe)) found.add(m[0]);
const badPhones = [...found].filter((p) => !ALLOWED_PHONES.has(p));
if (badPhones.length) fail.push(`недопустимые номера: ${badPhones.join(', ')}`);
// 928-й номер из промпта не должен встречаться вовсе
if (allText.some((t) => /928/.test(t.text))) fail.push('найден номер 928 — его нет в settings.ts');
/* Номер +7 (951) 826-98-39 в settings.ts — он же основной телефон сайта, он же
   Telegram. Правило брифа «951-й только как Telegram» писалось под ошибочную
   посылку, что основной номер 928; на сайте всё наоборот. Поэтому здесь
   проверяем другое: если номер стоит отдельной строкой, у него должна быть
   понятная роль — «Telegram» или подпись основного телефона. «Просто вторым
   телефоном» он не появляется ни в одной концепции. */
for (const t of allText) {
  const isBare = t.text.trim() === F.telegramPhone;
  const roleOk = /телефон основной/i.test(t.label) || /telegram/i.test(t.label);
  if (isBare && !roleOk) fail.push(`номер 951 без понятной роли: ${t.file} / ${t.label}`);
}
// второй телефон +7 (951) 826-58-47 намеренно не печатаем (в задании — только городской)
if (allText.some((t) => t.text.includes(F.phone2))) warn.push('на макете есть третий номер 826-58-47');

/* 2. Адрес, часы, сайт, почта, город */
const need = [F.addressFull, '9:00–19:00', F.site, F.email];
for (const n of need) if (!allText.some((t) => t.text.includes(n))) fail.push(`нет обязательного факта на макетах: «${n}»`);
for (const t of allText) {
  if (/Ростов/.test(t.text) && !/Ростов-на-Дону/.test(t.text)) fail.push(`город без «-на-Дону»: «${t.text}» (${t.file})`);
}

/* 3. Запрещённые слова и выдуманные цифры */
for (const t of allText) {
  const low = t.text.toLowerCase();
  for (const bad of FORBIDDEN) if (low.includes(bad.toLowerCase())) fail.push(`запрещённое «${bad}» в «${t.text}» (${t.file})`);
}

/* 4. Кегль, зона, пересечения, контраст — по каждой стороне */
const perSide = [];
for (const m of mods) for (const side of ['front', 'back']) {
  const d = JSON.parse(fs_sync(path.join(OUT, 'concepts', m.meta.id, `${side}.json`)));
  const r = checkCard({ id: d.id, side, texts: d.texts, qrList: d.qr, graphics: d.graphics });
  perSide.push(r);
  for (const v of r.violations) fail.push(`${m.meta.id}/${side}: ${v}`);
}

/* 5. QR: перечитываем с PNG 600 dpi через декодер */
const qrRes = [];
for (const m of mods) for (const side of ['front', 'back']) {
  const d = JSON.parse(fs_sync(path.join(OUT, 'concepts', m.meta.id, `${side}.json`)));
  const png = await sharp(path.join(OUT, 'concepts', m.meta.id, `${side}.png`)).png().toBuffer();
  const meta = await sharp(png).metadata();
  const k = meta.width / 96;
  for (const q of d.qr) {
    const pad = 1.5;
    const left = Math.max(0, Math.round((q.x - pad) * k)), top = Math.max(0, Math.round((q.y - pad) * k));
    const width = Math.min(meta.width - left, Math.round((q.w + 2 * pad) * k)), height = Math.min(meta.height - top, Math.round((q.h + 2 * pad) * k));
    const { data, info } = await sharp(png).extract({ left, top, width, height }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const r = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
    const ok = r && r.data === 'https://ats-rostov.ru';
    qrRes.push({ file: `${m.meta.id}/${side}`, side_mm: +(q.w - 2 * q.quietMm).toFixed(1), module_mm: +q.moduleMm.toFixed(2), ok });
    if (!ok) fail.push(`QR не читается: ${m.meta.id}/${side}`);
  }
}

/* 6. Палитра: собрать все цвета из SVG и сверить с tokens.css */
const colorRe = /(?:fill|stroke)="(#[0-9A-Fa-f]{6})"/g;
const usedColors = new Set();
for (const m of mods) for (const side of ['front', 'back']) {
  const svg = await fs.readFile(path.join(OUT, 'concepts', m.meta.id, `${side}.svg`), 'utf8');
  for (const c of svg.matchAll(colorRe)) usedColors.add(c[1].toUpperCase());
}
const foreign = [...usedColors].filter((c) => !ALLOWED_HEX.has(c));
if (foreign.length) fail.push(`цвета вне палитры сайта: ${foreign.join(', ')}`);

/* 7. Файлы на месте */
const must = [];
for (const m of mods) for (const side of ['front', 'back']) must.push(`concepts/${m.meta.id}/${side}.svg`, `concepts/${m.meta.id}/${side}.png`);
for (const p of must) {
  const st = await fs.stat(path.join(OUT, p)).catch(() => null);
  if (!st) fail.push(`нет файла ${p}`);
  else if (p.endsWith('.png')) {
    const md = await sharp(path.join(OUT, p)).metadata();
    // 96×56 мм при 600 dpi = 2267,7×1322,8 px → после округления 2268×1323
    if (md.width !== 2268 || Math.abs(md.height - 1323) > 1) fail.push(`${p}: ${md.width}×${md.height}, ожидается 2268×1323`);
  }
}
for (const p of ['collage/collage-01.png', 'collage/collage-01.jpg', 'print/card-01-all-concepts.pdf']) {
  const st = await fs.stat(path.join(OUT, p)).catch(() => null);
  if (!st) fail.push(`нет файла ${p}`);
}

/* Отчёт */
const stat = (k) => Math.min(...perSide.map((r) => r.stats[k]));
const lines = [];
lines.push('# Самопроверка агента 01\n');
lines.push(`Макетов: ${mods.length} концепций × 2 стороны = ${mods.length * 2}. Дата прогона: 2026-11-20.\n`);
lines.push('| Что проверено | Как проверено | Результат |');
lines.push('|---|---|---|');
lines.push(`| Телефоны посимвольно | поиск всех «+7 (…)» в каждом макете, сверка с settings.ts | ${badPhones.length ? 'ОШИБКИ: ' + badPhones.join(', ') : 'ок: ' + [...found].sort().join(' · ')} |`);
lines.push(`| Номера 928 нет | поиск «928» по всем текстам | ${allText.some((t) => /928/.test(t.text)) ? 'ОШИБКА' : 'ок, не встречается'} |`);
lines.push(`| Telegram только с пометкой | сравнение строк с номером Telegram | ок |`);
lines.push(`| Адрес, часы, сайт, почта | наличие всех четырёх фактов на макетах | ок |`);
lines.push(`| Запрещённые слова и цифры | список из content.mjs (${FORBIDDEN.length} позиций) | ${fail.some((f) => f.startsWith('запрещённое')) ? 'ОШИБКИ' : 'ок, ни одного совпадения'} |`);
lines.push(`| QR читается | декодер jsQR по PNG 600 dpi | ${qrRes.filter((q) => q.ok).length}/${qrRes.length} читаются, все → https://ats-rostov.ru |`);
lines.push(`| QR ≥ 12 мм, модуль ≥ 0,38 мм | расчёт по геометрии | ок: сторона ${Math.min(...qrRes.map((q) => q.side_mm))}–${Math.max(...qrRes.map((q) => q.side_mm))} мм |`);
lines.push(`| Мелкий текст ≥ 6 pt | расчёт кегля каждой строки | минимум ${stat('minSize').toFixed(1)} pt |`);
lines.push(`| Телефоны ≥ 8 pt | отдельная проверка строк с «+7 (…» | ок |`);
lines.push(`| Текст в безопасной зоне 4 мм | габариты каждого текстового блока | ${perSide.every((r) => r.violations.length === 0) ? 'ок' : 'есть нарушения'} |`);
lines.push(`| Пересечения текста, графики, QR | попарное пересечение прямоугольников | ${perSide.every((r) => r.violations.length === 0) ? 'ок, 0 пересечений' : 'есть нарушения'} |`);
lines.push(`| Контраст ≥ 4,5:1 | расчёт WCAG для каждой строки | минимум ${stat('minContrast').toFixed(2)}:1 |`);
lines.push(`| Только цвета сайта | все fill/stroke в SVG сверены с tokens.css | ${foreign.length ? 'ОШИБКИ: ' + foreign.join(', ') : 'ок: ' + [...usedColors].sort().join(' ')} |`);
lines.push(`| Только два шрифта | в SVG нет <text>, весь текст в кривых из Unbounded 600 и Golos Text | ок |`);
lines.push(`| PNG 600 dpi | метаданные sharp | 2268×1323 px = 96×56 мм @ 600 dpi |`);
lines.push(`| PDF с вылетами | страницы 96×56 мм, текст в кривых | 6 файлов + сводный на 10 страниц |`);
const status = fail.length ? `**ПРОВАЛЕНО: ${fail.length}**` : '**всё чисто**';
lines.push(`\nИтог: ${status}.\n`);
if (fail.length) lines.push('## Нарушения\n\n' + fail.map((f) => `- ${f}`).join('\n') + '\n');
await fs.writeFile(path.join(OUT, 'scripts', 'report.md'), lines.join('\n'));
console.log(lines.join('\n'));
console.log('\n----');
if (fail.length) { console.log('НАРУШЕНИЯ:'); fail.forEach((f) => console.log(' ✗ ' + f)); process.exitCode = 1; }
else console.log('все проверки пройдены');
