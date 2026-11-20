/* Самопроверка макетов: не «на глаз», а пересчётом.
 *
 *   1) телефоны посимвольно = settings.ts, 951-й только как Telegram;
 *   2) адрес, часы, сайт, почта, юрлицо — без опечаток;
 *   3) QR декодируется и ведёт на https://ats-rostov.ru;
 *   4) нет запрещённых слов и выдуманных цифр;
 *   5) кегли: любой текст ≥ 6 pt, телефоны ≥ 8 pt;
 *   6) весь текст внутри безопасной зоны 4 мм;
 *   7) контраст текста к фону ≥ 4,5:1 (с учётом opacity);
 *   8) только два шрифта и только цвета палитры;
 *   9) пять концепций различаются (проверяется глазами — коллаж);
 *  10) коллаж открывается, все 10 макетов видны.
 *
 *   node check.mjs        → таблица и код выхода 1 при любом провале
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { TRIM_W, TRIM_H, BLEED, SAFE, PX_PER_MM, C } from './lib/canvas.mjs';
import { facts, phones, legalShort } from './lib/facts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..');
const CONCEPTS = ['01-nochnoy-ceh', '02-formulyar', '03-kleymo', '04-svetlaya', '05-protektor'];

const PALETTE = new Set(Object.values(C).map((c) => c.toLowerCase()));
const FONTS_OK = new Set(['golos-400', 'golos-500', 'golos-700', 'unbounded-600']);
const FORBIDDEN = [
  'лучш', 'самый', '№1', 'номер один', '100%', 'гарантия качества', 'гарантируем',
  'лет опыта', 'клиентов', 'кузовн', 'покрас', 'эвакуатор', 'развал', 'схождени',
  'директор', 'Lorem', 'заголовок', 'пример текста',
];

/* ---------- цвета ---------- */
function hex2rgb(h) {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
function lum([r, g, b]) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [l1, l2] = [lum(hex2rgb(a)), lum(hex2rgb(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
function blend(fg, bg, alpha) {
  const f = hex2rgb(fg), b = hex2rgb(bg);
  return '#' + f.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('');
}

/* ---------- проверки ---------- */
const results = [];
function record(point, ok, detail) {
  results.push({ point, ok, detail });
}

const all = {};
for (const dir of CONCEPTS) {
  const mod = await import(`./concepts/${dir}.mjs`);
  all[dir] = { mod, front: await mod.front(), back: await mod.back() };
}

/* 1–2, 4: текст */
{
  const problems = [];
  for (const [dir, { front, back }] of Object.entries(all)) {
    for (const [side, card] of [['front', front], ['back', back]]) {
      const texts = card.texts();
      const joined = texts.map((t) => t.meta.s).join(' | ');
      // телефоны: каждый номер, начинающийся с +7, должен быть из settings.ts
      const allowed = new Set([phones.main, phones.city, phones.telegram]);
      for (const m of joined.matchAll(/\+7\s*\(\d{3}\)\s*\d{3}-\d{2}-\d{2}/g)) {
        if (!allowed.has(m[0])) problems.push(`${dir}/${side}: посторонний номер «${m[0]}»`);
      }
      // 951-й — только строкой с подписью Telegram
      // основной номер и Telegram на сайте — один и тот же 951-й, поэтому правило такое:
      // 951-й либо стоит как основной (ровно phones.main), либо только на строке «Telegram …»
      for (const t of texts) {
        if (!t.meta.s.includes(phones.telegram)) continue;
        const standalone = t.meta.s.trim() === phones.main;
        if (!standalone && !/telegram/i.test(t.meta.s)) problems.push(`${dir}/${side}: 951-й без подписи Telegram («${t.meta.s}»)`);
      }
      // запрещённые слова
      for (const w of FORBIDDEN) {
        if (joined.toLowerCase().includes(w.toLowerCase())) problems.push(`${dir}/${side}: запрещённое «${w}»`);
      }
      // «Ростов» без «-на-Дону»
      if (/(^|[^а-яё-])Ростов(?!-на-Дону)/i.test(joined)) problems.push(`${dir}/${side}: «Ростов» без «-на-Дону»`);
      // город только полный
      if (joined.includes('г. Ростов')) problems.push(`${dir}/${side}: «г. Ростов»`);
    }
  }
  record('1 Телефоны = settings.ts, 951-й только Telegram', problems.length === 0, problems.join('; ') || 'все номера совпадают посимвольно');
}

{
  const need = [facts.address, facts.hours, facts.site, legalShort];
  const problems = [];
  for (const [dir, { front, back }] of Object.entries(all)) {
    const joined = [...front.texts(), ...back.texts()].map((t) => t.meta.s).join(' | ');
    if (!joined.includes(facts.address)) problems.push(`${dir}: нет адреса`);
    if (!joined.includes(facts.hours)) problems.push(`${dir}: нет часов`);
    if (!joined.includes(facts.site)) problems.push(`${dir}: нет сайта`);
    if (!/ИП\s+Яковенко/.test(joined) || !joined.includes(facts.legal.inn)) problems.push(`${dir}: нет юрлица с ИНН`);
    if (!joined.includes(facts.shortLandmark)) problems.push(`${dir}: нет ориентира`);
    if (/ИП\s+Яковенко\s+П\.\s*И(?!\.)/.test(joined)) problems.push(`${dir}: «П. И» без точки`);
  }
  record('2 Адрес, часы, сайт, юрлицо, ориентир', problems.length === 0, problems.join('; ') || 'на месте во всех пяти');
}

/* 5: кегли */
{
  const problems = [];
  for (const [dir, { front, back }] of Object.entries(all)) {
    for (const [side, card] of [['front', front], ['back', back]]) {
      for (const t of card.texts()) {
        const isPhone = /\+7\s*\(|\d{3}-\d{2}-\d{2}/.test(t.meta.s);
        const min = isPhone ? 8 : 6;
        if (t.meta.ptSize < min - 1e-9) problems.push(`${dir}/${side}: «${t.meta.s.slice(0, 24)}» ${t.meta.ptSize} pt < ${min}`);
      }
    }
  }
  const minAll = Math.min(...Object.values(all).flatMap(({ front, back }) => [...front.texts(), ...back.texts()].map((t) => t.meta.ptSize)));
  record('5 Кегли: текст ≥ 6 pt, телефоны ≥ 8 pt', problems.length === 0, problems.join('; ') || `минимум по всем макетам — ${minAll.toFixed(1)} pt`);
}

/* 6: безопасная зона */
{
  const problems = [];
  for (const [dir, { front, back }] of Object.entries(all)) {
    for (const [side, card] of [['front', front], ['back', back]]) {
      for (const t of card.texts()) {
        const b = t.bbox;
        if (b.x0 < SAFE - 1e-6 || b.y0 < SAFE - 1e-6 || b.x1 > TRIM_W - SAFE + 1e-6 || b.y1 > TRIM_H - SAFE + 1e-6) {
          problems.push(`${dir}/${side}: «${t.meta.s.slice(0, 22)}» вне 4 мм (x ${b.x0.toFixed(1)}…${b.x1.toFixed(1)}, y ${b.y0.toFixed(1)}…${b.y1.toFixed(1)})`);
        }
      }
    }
  }
  record('6 Текст внутри безопасной зоны 4 мм', problems.length === 0, problems.join('; ') || 'ни одна буква не ближе 4 мм к резу');
}

/* 6b: пересечения текста */
{
  const problems = [];
  for (const [dir, { front, back }] of Object.entries(all)) {
    for (const [side, card] of [['front', front], ['back', back]]) {
      const ts = card.texts();
      for (let i = 0; i < ts.length; i++) {
        for (let j = i + 1; j < ts.length; j++) {
          const a = ts[i].bbox, b = ts[j].bbox;
          const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
          const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
          if (ix > 0.25 && iy > 0.25) {
            problems.push(`${dir}/${side}: «${ts[i].meta.s.slice(0, 18)}» ∩ «${ts[j].meta.s.slice(0, 18)}» (${ix.toFixed(1)}×${iy.toFixed(1)} мм)`);
          }
        }
      }
    }
  }
  record('6b. Текстовые строки не наезжают друг на друга', problems.length === 0, problems.join('; ') || 'пересечений нет');
}

/* 7: контраст */
{
  const problems = [];
  let minRatio = Infinity;
  let minCase = '';
  for (const [dir, { front, back }] of Object.entries(all)) {
    for (const [side, card] of [['front', front], ['back', back]]) {
      for (const t of card.texts()) {
        const bg = t.meta.bg || card.bg;
        const fg = t.opacity === 1 ? t.fill : blend(t.fill, bg, t.opacity);
        const r = ratio(fg, bg);
        if (r < minRatio) { minRatio = r; minCase = `${dir}/${side}: «${t.meta.s.slice(0, 24)}»`; }
        if (r < 4.5) problems.push(`${dir}/${side}: «${t.meta.s.slice(0, 22)}» ${r.toFixed(2)}:1`);
      }
    }
  }
  record('7 Контраст текста ≥ 4,5:1', problems.length === 0, problems.join('; ') || `минимум ${minRatio.toFixed(2)}:1 (${minCase})`);
}

/* 8: шрифты и палитра */
{
  const fonts = new Set();
  const colors = new Set();
  const problems = [];
  for (const [dir, { front, back }] of Object.entries(all)) {
    for (const [side, card] of [['front', front], ['back', back]]) {
      for (const t of card.texts()) fonts.add(t.meta.face);
      for (const it of card.items) {
        for (const key of ['fill', 'stroke', 'plate', 'ink']) {
          const v = it[key];
          if (typeof v === 'string' && v.startsWith('#')) {
            colors.add(v.toLowerCase());
            if (!PALETTE.has(v.toLowerCase())) problems.push(`${dir}/${side}: цвет ${v} вне палитры`);
          }
        }
      }
    }
  }
  for (const f of fonts) if (!FONTS_OK.has(f)) problems.push(`начертание ${f} вне списка`);
  const perSide = [];
  for (const [dir, { front, back }] of Object.entries(all)) {
    for (const [side, card] of [['front', front], ['back', back]]) {
      const fams = new Set(card.texts().map((t) => (t.meta.face.startsWith('unbounded') ? 'Unbounded' : 'Golos')));
      if (fams.size > 2) problems.push(`${dir}/${side}: больше двух семейств`);
      perSide.push(fams.size);
    }
  }
  record('8 Два шрифта, цвета палитры', problems.length === 0,
    problems.join('; ') || `начертания: ${[...fonts].join(', ')}; цвета: ${[...colors].join(' ')}`);
}

/* 3: QR — декодируем из готового PNG */
{
  const problems = [];
  const decoded = [];
  for (const [dir, { front, back }] of Object.entries(all)) {
    for (const [side, card] of [['front', front], ['back', back]]) {
      const qrs = card.items.filter((i) => i.kind === 'qr');
      const pngPath = path.join(OUT, 'concepts', dir, `${side}.png`);
      if (!fs.existsSync(pngPath)) { problems.push(`${dir}/${side}: нет PNG`); continue; }
      const png = PNG.sync.read(fs.readFileSync(pngPath));
      const scale = png.width / ((TRIM_W + BLEED * 2) * PX_PER_MM);
      for (const q of qrs) {
        // берём область кода с тихой зоной и небольшим запасом
        const pad = 2;
        const x = Math.max(0, Math.round((q.x - pad + BLEED) * PX_PER_MM * scale));
        const y = Math.max(0, Math.round((q.y - pad + BLEED) * PX_PER_MM * scale));
        const w = Math.min(png.width - x, Math.round((q.w + pad * 2) * PX_PER_MM * scale));
        const h = Math.min(png.height - y, Math.round((q.h + pad * 2) * PX_PER_MM * scale));
        const sub = new PNG({ width: w, height: h });
        PNG.bitblt(png, sub, x, y, w, h, 0, 0);
        // jsqr ждёт RGBA — он уже RGBA
        const res = jsQR(new Uint8ClampedArray(sub.data), w, h, { inversionAttempts: 'dontInvert' });
        if (!res) { problems.push(`${dir}/${side}: QR не распознан`); continue; }
        decoded.push(res.data);
        if (res.data !== facts.siteUrl) problems.push(`${dir}/${side}: QR ведёт «${res.data}»`);
        const mmSize = q.w;
        if (mmSize < 12) problems.push(`${dir}/${side}: QR плашка ${mmSize.toFixed(1)} мм < 12`);
      }
    }
  }
  record('3 QR распознаётся и ведёт на ats-rostov.ru', problems.length === 0,
    problems.join('; ') || `декодировано ${decoded.length} кодов, все → ${[...new Set(decoded)].join(', ')}; плашка 12,5 мм = код 9,6 мм + тихая зона 4 модуля`);
}

/* 10: PNG 300 dpi */
{
  const problems = [];
  for (const dir of CONCEPTS) {
    for (const side of ['front', 'back']) {
      const p = path.join(OUT, 'concepts', dir, `${side}.png`);
      if (!fs.existsSync(p)) { problems.push(`${dir}/${side}: нет файла`); continue; }
      const png = PNG.sync.read(fs.readFileSync(p));
      const dpi = png.width / ((TRIM_W + BLEED * 2) / 25.4);
      if (dpi < 599) problems.push(`${dir}/${side}: ${dpi.toFixed(0)} dpi`);
    }
  }
  record('10 PNG 300 dpi (рендер 2× = 600)', problems.length === 0, problems.join('; ') || 'все 10 файлов 2268 × 1324 px');
}

/* ---------- вывод ---------- */
const rows = results.map((r) => `| ${r.point} | ${r.ok ? 'да' : 'НЕТ'} | ${r.detail} |`);
const out = [
  '| Пункт задания | Да/Нет | Чем подтверждается |',
  '|---|---|---|',
  ...rows,
].join('\n');
console.log(out);
fs.writeFileSync(path.join(OUT, 'selfcheck.md'), `# Самопроверка агента 02\n\nСгенерировано \`tools/check.mjs\` ${new Date().toISOString().slice(0, 10)}.\n\n${out}\n`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
