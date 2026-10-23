/**
 * Раунд 14: макет-скрины первого экрана и «О компании» для отчёта.
 * В sandbox НЕТ браузера (puppeteer/chromium недоступны), поэтому кадр собирается
 * детерминированно: фото + неон (blend screen) + scrim-градиенты ИЗ hero.css +
 * текстовые блоки по формулам CSS (clamp/max-width/padding) — те же числа, что
 * проверяют check-hero-layout.mjs и measure-contrast.mjs. Это макет, не снимок
 * браузера (прецедент: evaluation/assets/r10-hero-1440-scrim.jpg).
 * Запуск: node site/scripts/mock-shots.mjs  → evaluation/assets/r14-shots/
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('../../site/node_modules/sharp');
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMG = join(HERE, '../public/img');
const OUT = join(HERE, '../../evaluation/assets/r14-shots');
let astro = readFileSync(join(HERE, '../src/pages/index.astro'), 'utf8');
/* если локальный сервер поднят — берём ОТРЕНДЕРЕННЫЕ тексты (подстановки {S.*}) */
try {
  const r = await fetch('http://127.0.0.1:4399/');
  if (r.ok) astro = await r.text();
} catch { /* офлайн-режим: исходник */ }

const NIGHT = '#0B1410', IVORY = '#F4EFE6', MIST = '#B7C4BB', BRASS = '#E0A96D', COPPER = '#C87F45';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ---------- тексты слайдов из разметки ---------- */
const slides = [...astro.matchAll(/<div class="slide(?: is-active)?"[\s\S]*?<\/div>\s*<\/div>/g)].map((m) => {
  const b = m[0];
  const eyebrow = (b.match(/slide-eyebrow">([^<]*)</) || [])[1] || '';
  const h1 = (b.match(/<h1[^>]*>([^<]*)</) || b.match(/class="h1">([^<]*)</) || [])[1] || '';
  const sub = (b.match(/slide-sub">([^<]*)</) || [])[1] || '';
  const btns = [...b.matchAll(/class="btn btn--(copper|ghost)[^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map((x) => ({
    kind: x[1],
    text: x[2].replace(/<[^>]*>/g, '').trim(),
  }));
  return { eyebrow, h1, sub, btns };
}).slice(0, 3);
/* на планшете телефонная кнопка сжимается до «Позвонить» (span.btn-phone-num скрыт) */
const btnText = (b, mode) => (mode === 'tab' && b.text.startsWith('Позвонить') ? 'Позвонить' : b.text);

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrap = (text, px, fontPx, k) => {
  const per = Math.floor(px / (fontPx * k));
  const words = text.split(/\s+/); const lines = []; let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > per && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
};

/* ---------- scrim-градиенты ровно из hero.css (раунд 14) ---------- */
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

async function renderHero({ name, vw, vh, mode }) {
  const heroH = mode === 'desk' ? Math.min(vw * 9 / 16, vh - 96)
    : mode === 'tab' ? clamp(0.72 * vh, 480, 780)
      : Math.max(460, 0.76 * vh);           // мобайл: трек + панель внутри
  const uiH = mode === 'mob' ? 58 : 0;      // мобайл: hero-ui в потоке под треком
  const H = Math.round(heroH) + (mode === 'desk' ? 0 : uiH);
  const trackH = Math.round(heroH);

  /* фон: cover из мастера */
  const bgFile = mode === 'mob' ? 'hero-service-m-960.webp' : 'hero-service-2560.webp';
  const neonFile = mode === 'mob' ? 'hero-neon-m-960.webp' : 'hero-neon-1600.webp';
  const meta = await sharp(join(IMG, bgFile)).metadata();
  const scale = Math.max(vw / meta.width, trackH / meta.height);
  const sw = Math.round(meta.width * scale), sh = Math.round(meta.height * scale);
  const posX = mode === 'tab' ? 0.68 : 0.5, posY = mode === 'mob' ? 0.20 : 0.5;
  const dx = -Math.round((sw - vw) * posX), dy = -Math.round((sh - trackH) * posY);
  const bg = await sharp(join(IMG, bgFile)).resize(sw, sh)
    .extract({ left: Math.round((sw - vw) * posX), top: Math.round((sh - trackH) * posY), width: vw, height: trackH }).toBuffer();
  const neonMeta = await sharp(join(IMG, neonFile)).metadata();
  const nScale = Math.max(vw / neonMeta.width, trackH / neonMeta.height);
  const nsw = Math.round(neonMeta.width * nScale), nsh = Math.round(neonMeta.height * nScale);
  const neon = await sharp(join(IMG, neonFile)).resize(nsw, nsh)
    .extract({ left: Math.round((nsw - vw) * posX), top: Math.round((nsh - trackH) * posY), width: vw, height: trackH }).toBuffer();

  /* текстовый блок */
  let tx, contentW, h1Px, subPx, panel = null;
  if (mode === 'desk') {
    const cx = (vw - Math.min(1200, vw - 40)) / 2 + 20, hp = clamp(vw * 0.05, 24, 96);
    tx = cx; contentW = vw * 0.44 - cx - hp; h1Px = clamp(vw * 0.032, 30.4, 46.4); subPx = clamp(vw * 0.0115, 15, 18);
  } else if (mode === 'tab') {
    tx = vw * 0.04 + 24; contentW = Math.min(vw * 0.62 - 48, h1em(vw) ); h1Px = clamp(vw * 0.04, 28.8, 38.4); subPx = clamp(vw * 0.016, 15, 17);
  } else {
    tx = 10 + 14; contentW = vw - 20 - 28; h1Px = clamp(vw * 0.072, 24.8, 30.4); subPx = 15;   // ≤480: .slide-sub{font-size:15px}
  }
  function h1em(v) { return clamp(v * 0.04, 28.8, 38.4) * 9.5; }   // планшет: h1 max-width 9.5em
  if (mode === 'tab') contentW = Math.min(vw * 0.62 - 48, h1em(vw));

  const parts = [];
  const blocks = slides.map((s, i) => {
    const h1Lines = wrap(s.h1, contentW, h1Px, 0.62);
    const subLines = wrap(s.sub, mode === 'desk' ? Math.min(contentW, subPx * 44 * 0.5) : contentW, subPx, 0.60);
    const eyebrowH = mode === 'mob' ? 0 : 30 + 14;
    const h1H = h1Lines.length * h1Px * 1.14 + h1Px * 0.42;
    const subH = subLines.length * subPx * 1.45 + (mode === 'mob' ? 10 : 16);
    const ctaH = mode === 'mob' ? 41 : 48;
    const total = eyebrowH + h1H + subH + ctaH;
    return { s, h1Lines, subLines, eyebrowH, h1H, subH, ctaH, total };
  });

  /* вертикальная раскладка */
  let panelTop = 0;
  if (mode === 'mob') {
    const t = blocks[0].total + 28;              // панель по худшему слайду + padding
    panelTop = trackH - 10 - t;
  }
  const svgTexts = [];
  blocks.forEach((bl, i) => {
    const y0 = mode === 'mob' ? panelTop + 14 : (trackH - bl.total) / 2;
    let y = y0;
    const g = [];
    if (mode !== 'mob') {
      g.push(`<rect x="${tx}" y="${y}" width="${Math.min(contentW, 320)}" height="30" rx="15" fill="rgba(11,20,16,.55)" stroke="rgba(224,169,109,.4)"/>
<text x="${tx + 16}" y="${y + 19}" font-family="DejaVu Sans" font-size="12.5" letter-spacing="1.75" fill="${BRASS}">${esc(bl.s.eyebrow.toUpperCase())}</text>`);
      y += bl.eyebrowH;
    }
    bl.h1Lines.forEach((ln) => {
      g.push(`<text x="${tx}" y="${y + h1Px * 0.82}" font-family="DejaVu Sans" font-size="${h1Px}" font-weight="600" fill="${IVORY}">${esc(ln)}</text>`);
      y += h1Px * 1.14;
    });
    y += h1Px * 0.42;
    bl.subLines.forEach((ln) => {
      g.push(`<text x="${tx}" y="${y + subPx * 0.8}" font-family="DejaVu Sans" font-size="${subPx}" fill="${MIST}">${esc(ln)}</text>`);
      y += subPx * 1.45;
    });
    y += (mode === 'mob' ? 10 : 16) - subPx * 0.45;
    let bx = tx;
    for (const b of bl.s.btns) {
      const label = btnText(b, mode);
      const f = mode === 'mob' ? 13.5 : 15, pd = mode === 'mob' ? 18 : 26;
      const r = btnSvg(bx, y, label, b.kind, f, pd);
      g.push(r.svg); bx += r.w + (mode === 'mob' ? 10 : 14);
    }
    svgTexts.push(`<g class="slide${i}" opacity="${i === 0 ? 1 : 0}">${g.join('')}</g>`);
  });

  /* панель мобайла */
  const panelSvg = mode === 'mob'
    ? `<rect x="10" y="${panelTop}" width="${vw - 20}" height="${trackH - 10 - panelTop}" rx="18" fill="rgba(6,11,9,.82)"/>` : '';
  /* hero-ui */
  const uiSvg = mode === 'mob'
    ? `<g><circle cx="${vw / 2 - 74}" cy="${trackH + 29}" r="17" fill="none" stroke="rgba(224,169,109,.4)"/><circle cx="${vw / 2 - 30}" cy="${trackH + 29}" r="17" fill="none" stroke="rgba(224,169,109,.4)"/><rect x="${vw / 2 + 6}" y="${trackH + 26}" width="34" height="3" rx="1.5" fill="${BRASS}"/><rect x="${vw / 2 + 48}" y="${trackH + 26}" width="34" height="3" rx="1.5" fill="rgba(183,196,187,.35)"/><rect x="${vw / 2 + 90}" y="${trackH + 26}" width="34" height="3" rx="1.5" fill="rgba(183,196,187,.35)"/></g>`
    : `<g><circle cx="${vw - 96}" cy="${trackH - 34}" r="24" fill="rgba(11,20,16,.6)" stroke="rgba(224,169,109,.4)"/><circle cx="${vw - 40}" cy="${trackH - 34}" r="24" fill="rgba(11,20,16,.6)" stroke="rgba(224,169,109,.4)"/><text x="${vw - 96}" y="${trackH - 28}" font-family="DejaVu Sans" font-size="19" fill="${BRASS}" text-anchor="middle">←</text><text x="${vw - 40}" y="${trackH - 28}" font-family="DejaVu Sans" font-size="19" fill="${BRASS}" text-anchor="middle">→</text></g>`;

  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${H}">
<defs>${hGrad('hg')}${vGrad('vg', mode === 'desk' ? .55 : .62, mode === 'desk' ? 26 : 32)}</defs>
<rect x="0" y="0" width="${vw}" height="${trackH}" fill="url(#hg)"/>
<rect x="0" y="0" width="${vw}" height="${trackH}" fill="url(#vg)"/>
${panelSvg}${svgTexts[0]}${uiSvg}
</svg>`;

  const img = sharp({ create: { width: vw, height: H, channels: 3, background: NIGHT } })
    .composite([
      { input: bg, left: 0, top: 0 },
      { input: neon, left: 0, top: 0, blend: 'screen' },
      { input: Buffer.from(overlay), left: 0, top: 0 },
    ]).jpeg({ quality: 82 });
  await img.toFile(join(OUT, name + '.jpg'));
  console.log(`${name}: hero ${vw}×${H}, трек ${trackH}, колонка x${Math.round(tx)} w${Math.round(contentW)}` +
    (mode === 'mob' ? `, панель y${Math.round(panelTop)}…${trackH - 10} (h=${Math.round(trackH - 10 - panelTop)})` : ''));
  return { trackH, panelTop };
}

/* ---------- запуск ---------- */
const desk = await renderHero({ name: 'desk-1440x900-slide1', vw: 1440, vh: 900, mode: 'desk' });
const tab = await renderHero({ name: 'tab-1024x768-slide1', vw: 1024, vh: 768, mode: 'tab' });
const mob = await renderHero({ name: 'mob-390x844-slide1', vw: 390, vh: 844, mode: 'mob' });

/* остальные слайды — текстовые блоки те же места */
for (const [mode, vw, vh, pref] of [['desk', 1440, 900, 'desk-1440x900'], ['tab', 1024, 768, 'tab-1024x768'], ['mob', 390, 844, 'mob-390x844']]) {
  for (let i = 1; i < 3; i++) {
    // переключаем «слайд»: рендерим тот же кадр, но с текстом i-го слайда
    const save = slides[0]; slides[0] = slides[i];
    await renderHero({ name: `${pref}-slide${i + 1}`, vw, vh, mode });
    slides[0] = save;
  }
}

/* зона текста поверх десктоп-кадра (x 10–47 %, y 26–74 % героя) */
{
  const base = await sharp(join(OUT, 'desk-1440x900-slide1.jpg')).toBuffer();
  const h = desk.trackH;
  const zx = vw0(1440, 0.10), zy = h * 0.26, zw = 1440 * 0.37, zh = h * 0.48;
  function vw0(w, p) { return w * p; }
  const ov = `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="${h}">
<rect x="${zx}" y="${zy}" width="${zw}" height="${zh}" fill="rgba(255,0,0,.12)" stroke="#FF3B30" stroke-width="3"/>
<text x="${zx + 8}" y="${zy - 10}" font-family="DejaVu Sans" font-size="20" fill="#FF3B30">зона текста x 10–47 %, y 26–74 %</text></svg>`;
  await sharp(base).composite([{ input: Buffer.from(ov), left: 0, top: 0 }]).jpeg({ quality: 82 }).toFile(join(OUT, 'desk-zone-overlay.jpg'));
  console.log('zone overlay: ok');
}

/* «О компании»: секция с.about — картинка 1200×750 в контейнере */
for (const [pref, vw] of [['desk-1440x900', 1440], ['tab-1024x768', 1024], ['mob-390x844', 390]]) {
  const cw = Math.min(1200, vw - 40);
  const ih = Math.round(cw * 1000 / 1600);
  const about = await sharp(join(IMG, 'about-service-1600.webp')).resize(cw, ih).toBuffer();
  const headH = 90;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${vw}" height="${ih + headH + 40}">
<text x="${(vw - cw) / 2}" y="52" font-family="DejaVu Sans" font-size="30" font-weight="600" fill="${IVORY}">О компании</text>
<text x="${(vw - cw) / 2}" y="80" font-family="DejaVu Sans" font-size="16" fill="${MIST}">Семь лет на Портовой, 439 — два поста, подъёмники, свой инструмент</text></svg>`;
  await sharp({ create: { width: vw, height: ih + headH + 40, channels: 3, background: NIGHT } })
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }, { input: about, left: Math.round((vw - cw) / 2), top: headH }])
    .jpeg({ quality: 82 }).toFile(join(OUT, pref + '-about.jpg'));
}

/* мобильный кадр 4:5 отдельным файлом */
await sharp(join(IMG, 'hero-service-m-960.webp')).jpeg({ quality: 85 }).toFile(join(OUT, 'mob-4x5-frame.jpg'));

/* перекрытие машины панелью на мобайле (мастер 1152×1440 → трек 390×625) */
{
  const trackH = Math.max(460, 0.76 * 844);
  const scale = Math.max(390 / 960, trackH / 1200);
  /* машины в мобайл-мастере 1152×1440: y 432…892 → в m-960 (960×1200): 360…743.3 */
  const cTop = 360 * scale, cBot = 743.33 * scale;
  const panelTop = mob.panelTop;
  const overlap = Math.max(0, Math.min(cBot, trackH) - Math.max(cTop, panelTop));
  const frac = overlap / (cBot - cTop);
  console.log(`мобайл: машины y ${cTop.toFixed(0)}…${cBot.toFixed(0)} из трека ${trackH}, панель с y ${panelTop.toFixed(0)} → перекрытие ${(frac * 100).toFixed(1)} % (норма ≤33.3 %)`);
  if (frac > 1 / 3) { console.error('FAIL перекрытие панели'); process.exit(1); }
}
console.log('макет-скрины готовы:', OUT);
