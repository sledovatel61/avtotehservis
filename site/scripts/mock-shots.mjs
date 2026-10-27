/**
 * Раунд 15: макет-скрины первого экрана и «О компании» для отчёта.
 * В sandbox НЕТ браузера (puppeteer/chromium недоступны), поэтому кадр собирается
 * детерминированно: фото + scrim-градиенты ИЗ hero.css + текстовые блоки по формулам
 * CSS (clamp/max-width/padding/wrap) — те же числа, что проверяют чекеры.
 * Слой неона в круге 15 удалён, поэтому в макете его тоже нет.
 * Прецедент: evaluation/assets/r10-hero-1440-scrim.jpg, круг 14: r14-shots/.
 * Запуск: node site/scripts/mock-shots.mjs  → evaluation/assets/r15-shots/
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('../../site/node_modules/sharp');
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMG = join(HERE, '../public/img');
const OUT = join(HERE, '../../evaluation/assets/r15-shots');
let astro = readFileSync(join(HERE, '../src/pages/index.astro'), 'utf8');
try { const r = await fetch('http://127.0.0.1:4399/'); if (r.ok) astro = await r.text(); } catch { /* офлайн */ }

const NIGHT = '#0B1410', IVORY = '#F4EFE6', MIST = '#B7C4BB', BRASS = '#E0A96D', COPPER = '#C87F45';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const slides = [...astro.matchAll(/<div class="slide(?: is-active)?"[\s\S]*?<\/div>\s*<\/div>/g)].map((m) => {
  const b = m[0];
  return {
    eyebrow: (b.match(/slide-eyebrow">([^<]*)</) || [])[1] || '',
    h1: (b.match(/<h1[^>]*>([^<]*)</) || b.match(/class="h1">([^<]*)</) || [])[1] || '',
    sub: (b.match(/slide-sub">([^<]*)</) || [])[1] || '',
    btns: [...b.matchAll(/class="btn btn--(copper|ghost)[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map((x) => ({
      kind: x[1], text: x[2].replace(/<[^>]*>/g, '').trim(),
    })),
  };
}).slice(0, 3);
const btnText = (b, mode) => (b.text.startsWith('Позвонить') && mode !== 'desk' ? 'Позвонить' : b.text);

const wrap = (text, px, fontPx, k, maxLines = 99) => {
  const per = Math.max(6, Math.floor(px / (fontPx * k)));
  const words = text.split(/\s+/); const lines = []; let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > per && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
};

/* scrim-градиенты ровно из hero.css раунда 15 */
const H_STOPS = [[0, .94], [26, .90], [44, .74], [52, .34], [60, 0]];
const hGrad = (id) => `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">` +
  H_STOPS.map(([t, a]) => `<stop offset="${t}%" stop-color="#060B09" stop-opacity="${a}"/>`).join('') + '</linearGradient>';
const vGrad = (id, a, span) => `<linearGradient id="${id}" x1="0" y1="1" x2="0" y2="0">` +
  `<stop offset="0%" stop-color="#060B09" stop-opacity="${a}"/><stop offset="${span}%" stop-color="#060B09" stop-opacity="0"/></linearGradient>`;

const btnSvg = (x, y, label, kind, fontPx = 15, padX = 26) => {
  const w = Math.round(label.toUpperCase().length * fontPx * 0.62 + padX * 2);
  const h = fontPx === 15 ? 48 : 41;
  const fill = kind === 'copper' ? COPPER : 'none';
  const stroke = kind === 'copper' ? 'none' : 'rgba(224,169,109,0.45)';
  const col = kind === 'copper' ? NIGHT : IVORY;
  return { w, svg: `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
<text x="${x + w / 2}" y="${y + h / 2 + fontPx * 0.36}" font-family="DejaVu Sans" font-size="${fontPx}" font-weight="600" letter-spacing="${fontPx * 0.04}" fill="${col}" text-anchor="middle">${esc(label.toUpperCase())}</text></g>` };
};

async function renderHero({ name, vw, vh, slideIdx = 0 }) {
  const short = vh <= 560;
  const mode = vw >= 1024 ? 'desk' : vw >= 641 ? (vh > vw ? 'tab-port' : 'tab-land') : 'mob';
  /* высота героя/полосы — формулы hero.css раунда 15 */
  let heroH, stripH, flow = false;
  if (mode === 'desk') { heroH = Math.min(vh - 96, vw * 9 / 16); stripH = heroH; }
  else if (mode === 'tab-land') { heroH = clamp(vh - 54, 320, 780); stripH = heroH; }
  else if (mode === 'tab-port') { flow = true; stripH = vw * 9 / 16; heroH = stripH; }
  else { flow = true; stripH = short ? Math.min(460, vh - 120) : clamp(vh * 0.48, 300, 460); heroH = stripH; }
  stripH = Math.round(stripH); heroH = Math.round(heroH);

  const bgFile = mode === 'mob' ? 'hero-service-m-960.webp' : 'hero-service-2560.webp';
  const meta = await sharp(join(IMG, bgFile)).metadata();
  const scale = Math.max(vw / meta.width, stripH / meta.height);
  const sw = Math.round(meta.width * scale), sh = Math.round(meta.height * scale);
  const posX = mode === 'tab-land' ? 0.68 : 0.5, posY = mode === 'mob' ? 0.20 : 0.5;
  const bg = await sharp(join(IMG, bgFile)).resize(sw, sh)
    .extract({ left: Math.round((sw - vw) * posX), top: Math.round((sh - stripH) * posY), width: vw, height: Math.min(stripH, sh) }).toBuffer();

  /* текстовая колонка */
  let tx, contentW, h1Px, subPx, subMaxCh;
  if (mode === 'desk') {
    const cx = (vw - Math.min(1200, vw - 40)) / 2 + 20, hp = clamp(vw * 0.05, 24, 96);
    tx = cx; contentW = vw * 0.44 - cx - hp;
    h1Px = short ? clamp(vw * 0.046, 21.6, 30.4) : clamp(vw * 0.032, 30.4, 46.4);
    subPx = clamp(vw * 0.0115, 15, 18); subMaxCh = 44;
  } else if (mode === 'tab-land') {
    tx = vw * 0.04 + 24; contentW = Math.min(vw * 0.62 - 48, clamp(vw * 0.04, 28.8, 38.4) * 9.5);
    h1Px = short ? clamp(vw * 0.046, 21.6, 30.4) : clamp(vw * 0.04, 28.8, 38.4);
    subPx = clamp(vw * 0.016, 15, 17); subMaxCh = 30;
  } else if (mode === 'tab-port') {
    tx = 24; contentW = vw - 48; h1Px = clamp(vw * 0.036, 27.2, 35.2); subPx = clamp(vw * 0.017, 15, 17); subMaxCh = 46;
  } else {
    tx = 14; contentW = vw - 28; h1Px = short ? clamp(vw * 0.046, 21.6, 30.4) : clamp(vw * 0.072, 24.8, 30.4);
    subPx = vw <= 480 ? 15 : 16; subMaxCh = 999;
  }

  const s = slides[slideIdx];
  const h1Lines = wrap(s.h1, contentW, h1Px, 0.62);
  const subLines = wrap(s.sub, Math.min(contentW, subPx * subMaxCh * 0.55), subPx, 0.60, short ? 3 : 99);
  const eyebrowH = (mode === 'mob' || short) ? 0 : 44;
  const h1H = h1Lines.length * h1Px * 1.14 + h1Px * 0.42;
  const subH = subLines.length * subPx * 1.45 + (mode === 'mob' ? 10 : 16);
  const ctaH = mode === 'mob' ? 41 : 48;
  const total = eyebrowH + h1H + subH + ctaH;
  const headerH = vw >= 1024 ? 96 : 54;

  const g = [];
  let y = headerH + (flow ? stripH + 18 : (stripH - total) / 2);
  if (eyebrowH) {
    g.push(`<rect x="${tx}" y="${y}" width="${Math.min(contentW, 330)}" height="30" rx="15" fill="rgba(11,20,16,.55)" stroke="rgba(224,169,109,.4)"/>
<text x="${tx + 16}" y="${y + 19}" font-family="DejaVu Sans" font-size="12.5" letter-spacing="1.75" fill="${BRASS}">${esc(s.eyebrow.toUpperCase())}</text>`);
    y += eyebrowH;
  }
  h1Lines.forEach((ln) => { g.push(`<text x="${tx}" y="${y + h1Px * 0.82}" font-family="DejaVu Sans" font-size="${h1Px}" font-weight="600" fill="${IVORY}">${esc(ln)}</text>`); y += h1Px * 1.14; });
  y += h1Px * 0.42;
  subLines.forEach((ln) => { g.push(`<text x="${tx}" y="${y + subPx * 0.8}" font-family="DejaVu Sans" font-size="${subPx}" fill="${MIST}">${esc(ln)}</text>`); y += subPx * 1.45; });
  y += (mode === 'mob' ? 10 : 16) - subPx * 0.45;
  let bx = tx;
  for (const b of s.btns) {
    const f = mode === 'mob' ? 13.5 : 15, pd = mode === 'mob' ? 18 : 26;
    const r = btnSvg(bx, y, btnText(b, mode), b.kind, f, pd);
    g.push(r.svg); bx += r.w + (mode === 'mob' ? 10 : 14);
  }
  const ctaBottom = y + ctaH;

  const H = (flow ? Math.round(ctaBottom + 66) : Math.round(heroH)) + headerH;
  const navItems = ['Услуги', 'О компании', 'Новости и акции', 'Контакты'];
  let nx = vw - 20 - 190;
  const navSvg = [];
  for (let i = navItems.length - 1; i >= 0; i--) {
    const wN = Math.round(navItems[i].length * (vw >= 1024 && vw < 1280 ? 7.4 : 8.0) + (vw >= 1024 && vw < 1280 ? 20 : 26));
    nx -= wN;
    navSvg.push(`<text x="${nx + wN / 2}" y="${headerH / 2 + 5}" font-family="DejaVu Sans" font-size="14.5" fill="${MIST}" text-anchor="middle">${esc(navItems[i])}</text>`);
    nx -= (vw >= 1024 && vw < 1280 ? 2 : 4);
  }
  const headSvg = `<g><rect x="0" y="0" width="${vw}" height="${headerH}" fill="${NIGHT}"/>
<text x="20" y="${headerH / 2 + 2}" font-family="DejaVu Sans" font-size="17" font-weight="600" fill="${IVORY}">АвтоТехСервис</text>
<text x="20" y="${headerH / 2 + 18}" font-family="DejaVu Sans" font-size="11" fill="${MIST}">РОСТОВ-НА-ДОНУ · ПОРТОВАЯ 439</text>
${navSvg.join('')}
<rect x="${vw - 20 - 180}" y="${headerH / 2 - 19}" width="180" height="38" rx="19" fill="none" stroke="rgba(224,169,109,.45)"/>
<text x="${vw - 20 - 90}" y="${headerH / 2 + 5}" font-family="DejaVu Sans" font-size="13.5" fill="${IVORY}" text-anchor="middle">+7 (951) 826-98-39</text>
<rect x="0" y="${headerH}" width="${vw}" height="${H}" fill="none"/></g>`;
  const scrims = flow ? '' : `<rect x="0" y="0" width="${vw}" height="${stripH}" fill="url(#hg)"/><rect x="0" y="0" width="${vw}" height="${stripH}" fill="url(#vg)"/>`;
  const uiY = flow ? H - 44 : headerH + stripH - 34;
  const uiSvg = flow
    ? `<g><circle cx="${vw / 2 - 74}" cy="${uiY}" r="17" fill="none" stroke="rgba(224,169,109,.4)"/><circle cx="${vw / 2 - 30}" cy="${uiY}" r="17" fill="none" stroke="rgba(224,169,109,.4)"/><rect x="${vw / 2 + 6}" y="${uiY - 3}" width="34" height="3" rx="1.5" fill="${BRASS}"/><rect x="${vw / 2 + 48}" y="${uiY - 3}" width="34" height="3" rx="1.5" fill="rgba(183,196,187,.35)"/><rect x="${vw / 2 + 90}" y="${uiY - 3}" width="34" height="3" rx="1.5" fill="rgba(183,196,187,.35)"/></g>`
    : `<g><circle cx="${vw - 96}" cy="${uiY}" r="24" fill="rgba(11,20,16,.6)" stroke="rgba(224,169,109,.4)"/><circle cx="${vw - 40}" cy="${uiY}" r="24" fill="rgba(11,20,16,.6)" stroke="rgba(224,169,109,.4)"/><text x="${vw - 96}" y="${uiY + 6}" font-family="DejaVu Sans" font-size="19" fill="${BRASS}" text-anchor="middle">←</text><text x="${vw - 40}" y="${uiY + 6}" font-family="DejaVu Sans" font-size="19" fill="${BRASS}" text-anchor="middle">→</text></g>`;

  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${H}">
<defs>${hGrad('hg')}${vGrad('vg', mode === 'desk' ? .55 : .62, mode === 'desk' ? 26 : 32)}</defs>
${scrims}<g transform="translate(0,${flow ? headerH : headerH})">${g.join('')}</g>${uiSvg}${headSvg}</svg>`;

  await sharp({ create: { width: vw, height: H, channels: 3, background: NIGHT } })
    .composite([{ input: bg, left: 0, top: headerH }, { input: Buffer.from(overlay), left: 0, top: 0 }])
    .jpeg({ quality: 82 }).toFile(join(OUT, name + '.jpg'));
  console.log(`${name}: ${vw}×${H}, полоса ${Math.round(stripH)}, текст x${Math.round(tx)} w${Math.round(contentW)}, кнопки до y${Math.round(ctaBottom)}`);
}

const SHOTS = [[1217, 598], [1366, 768], [1920, 950], [1024, 600], [844, 390], [926, 428], [768, 1024], [390, 844], [360, 800]];
for (const [vw, vh] of SHOTS) await renderHero({ name: `hero-${vw}x${vh}-slide1`, vw, vh });
for (const [vw, vh] of [[1217, 598], [390, 844]]) {
  await renderHero({ name: `hero-${vw}x${vh}-slide3`, vw, vh, slideIdx: 2 });
  /* «О компании» */
  const cw = Math.min(1200, vw - 40);
  const ih = Math.round(cw * 1000 / 1600);
  const about = await sharp(join(IMG, 'about-service-1600.webp')).resize(cw, ih).toBuffer();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${ih + 130}">
<text x="${(vw - cw) / 2}" y="52" font-family="DejaVu Sans" font-size="30" font-weight="600" fill="${IVORY}">О компании</text>
<text x="${(vw - cw) / 2}" y="80" font-family="DejaVu Sans" font-size="16" fill="${MIST}">Семь лет на Портовой, 439 — два поста, подъёмники, свой инструмент</text></svg>`;
  await sharp({ create: { width: vw, height: ih + 130, channels: 3, background: NIGHT } })
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }, { input: about, left: Math.round((vw - cw) / 2), top: 90 }])
    .jpeg({ quality: 82 }).toFile(join(OUT, `about-${vw}x${vh}.jpg`));
}
/* кроп ×5 места ретуши: до (master-clean-prefence) и после (master-clean) */
for (const [tag, file] of [['before', 'master-clean-prefence.jpg'], ['after', 'master-clean.jpg']]) {
  const mid = await sharp(join(HERE, `../../docs/photos-source/r13-clean/${file}`))
    .extract({ left: 380, top: 80, width: 3000, height: 1875 }).resize(1600, 1000).toBuffer();
  const base = await sharp(mid)
    .extract({ left: 1420, top: 130, width: 180, height: 120 }).resize({ width: 900, kernel: 'nearest' }).jpeg({ quality: 90 }).toBuffer();
  await sharp(base).toFile(join(OUT, `fence-retouch-${tag}-x5.jpg`));
}
console.log('макет-скрины раунда 15 готовы:', OUT);
