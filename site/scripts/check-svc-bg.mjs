/* Раунд 21 (задание №23): гейт секции «Услуги» (.slider-sec[aria-labelledby="svc-h"]).
   Входы: CSS (sections+media), разметка index.astro, геометрия рендера site/data/svc-geom.json
   (снимается render-svc.mjs, Chromium DPR2), мастера docs/photos-source/r21-svc/, svc-*.svg.
   Проверки:
     1) фон существует: picture .svc-bg с производными svc-bg-1600 / svc-bg-m-960 на месте;
     2) фон не «клеёнка»: mean 26…46, разброс ≥22, трети (макс. пара) ≥3, ступенька строк ≤3;
     3) карточки разные: mean 34…96, разброс ≥34, попарная Δ ≥6 (три видимые @1440), sha256 уникальны;
     4) нет текста в картинках: svc-*.svg без <text>, в разметке нет «фото появится»;
     5) кнопка: высота ≥44, radius 999px, есть :hover и :focus-visible (outline-offset ≥0);
     6) стрелки: |centerY(nav)−centerY(h2)| ≤24 и nav.right в поле контейнера ±8 (1440/1280);
     7) иерархия: цвет h3 ≠ цвет .svc-tag;
     8) контраст: p ≥4.5, h3 ≥9, кнопка покой ≥4.5, hover ≥6 (по худшему пикселю подложки);
     + геометрия B6/B7: высоты секций, clip текстов, overflow, дельта веса ≤ запаса потолка.
   Мутанты --self-test: 13, каждый валит гейт. */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = join(ROOT, 'site');
const R21 = join(ROOT, 'docs', 'photos-source', 'r21-svc');
const IMG = join(SITE, 'public', 'img');

const SEC_H = { 1440: [920, 1040], 1280: [920, 1040], 1024: [0, 1080], 768: [0, 960], 390: [0, 1000] };
const ORCH_BASE = { 1440: 691, 1280: 671, 1024: 680, 768: 562, 390: 482 };
const ORCH_CAP = { 1440: 740, 1280: 720, 1024: 720, 768: 600, 390: 520 };

const rule = (css, sel) => { const i = css.indexOf(sel + '{'); if (i < 0) return null;
  const j = css.indexOf('}', i); return css.slice(i + sel.length + 1, j); };

export async function checkSvcBg(opts = {}) {
  const fails = [], rows = [];
  const css = opts.css ?? readFileSync(join(SITE, 'src/styles/sections.css'), 'utf8')
    + '\n' + readFileSync(join(SITE, 'src/styles/media.css'), 'utf8');
  const astro = opts.astro ?? readFileSync(join(SITE, 'src/pages/index.astro'), 'utf8');
  const geom = opts.geom ?? JSON.parse(readFileSync(join(SITE, 'data', 'svc-geom.json'), 'utf8'));
  const svgs = opts.svgs ?? [1, 2, 3, 4, 5, 6].map(i => readFileSync(join(IMG, `svc-${i}.svg`), 'utf8'));

  /* 1. фон существует */
  for (const [f, w, h] of [['svc-bg-1600.avif', 1500, 844], ['svc-bg-1600.webp', 1500, 844],
    ['svc-bg-m-960.avif', 960, 1200], ['svc-bg-m-960.webp', 960, 1200]]) {
    const p = join(IMG, f);
    if (!existsSync(p)) { fails.push(`C1 нет файла ${f}`); continue; }
    const m = await sharp(p).metadata();
    if (m.width !== w || m.height !== h) fails.push(`C1 ${f}: размер ${m.width}×${m.height}, ждал ${w}×${h}`);
  }
  if (!/class="svc-bg"[^>]*>[\s\S]*?<picture>[\s\S]*?svc-bg-1600\.webp/.test(astro)) fails.push('C1 в разметке нет picture фона .svc-bg');
  if (!/\.svc-bg\{[^}]*position:absolute/.test(css)) fails.push('C1 .svc-bg не absolute-слой');
  if (/\.svc-bg\{[^}]*background-image:url/.test(css)) fails.push('C1 фон обязан быть picture-слоем, не background-image');
  /* антиобход: базовые правила слоёв без display:none / opacity<.95 / !important (вне print и reduced-data) */
  const clean = css
    .replace(/@media \(prefers-reduced-data:reduce\)\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
    .replace(/@media print\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  for (const sel of ['.svc-bg', '.svc-bg img', '.svc-img img']) {
    let i = -1;
    while ((i = clean.indexOf(sel + '{', i + 1)) >= 0) { const body = clean.slice(i, clean.indexOf('}', i));
      if (/display:\s*none/.test(body)) fails.push(`C1 антиобход: ${sel} display:none`);
      const op = body.match(/opacity:\s*([.\d]+)/); if (op && +op[1] < 0.95) fails.push(`C1 антиобход: ${sel} opacity ${op[1]}`);
      if (/!important/.test(body)) fails.push(`C1 антиобход: ${sel} !important`); }
  }

  /* 2. фон не «клеёнка» */
  for (const w of ['1440', '1280', '1024', '768', '390']) {
    const b = geom.widths[w]?.bg; if (!b) { fails.push(`C2 нет замеров фона для ${w}`); continue; }
    if (b.mean < 26 || b.mean > 46) fails.push(`C2 ${w}: средняя ${b.mean} вне 26…46`);
    if (b.spread < 22) fails.push(`C2 ${w}: разброс ${b.spread} < 22`);
    const [t1, t2, t3] = b.thirds;
    if (Math.max(Math.abs(t1 - t2), Math.abs(t2 - t3), Math.abs(t1 - t3)) < 3) fails.push(`C2 ${w}: трети ${b.thirds.join('/')} — попарная разница < 3`);
    if (b.rowStep > 3) fails.push(`C2 ${w}: ступенька строк ${b.rowStep} > 3`);
    rows.push(['фон ' + w, b.mean, b.spread, b.thirds.join('/'), b.rowStep]);
  }

  /* 3. карточки разные */
  const cz = geom.widths['1440']?.cardZones ?? [];
  const vis = cz.slice(0, 3);
  vis.forEach((z, i) => {
    if (z.mean < 34 || z.mean > 96) fails.push(`C3 карточка ${i + 1}: mean ${z.mean} вне 34…96`);
    if (z.spread < 34) fails.push(`C3 карточка ${i + 1}: разброс ${z.spread} < 34`);
  });
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++)
    if (Math.abs(vis[i].mean - vis[j].mean) < 6) fails.push(`C3 карточки ${i + 1}/${j + 1}: Δ ${Math.abs(vis[i].mean - vis[j].mean).toFixed(1)} < 6`);
  const sha = (f) => createHash('sha256').update(readFileSync(join(IMG, f))).digest('hex').slice(0, 12);
  const pSha = [1, 2, 3, 4, 5, 6].map(i => sha(`svc-${i}-640.avif`));
  if (new Set(pSha).size !== 6) fails.push(`C3 sha256 производных карточек не уникальны`);
  const astroCards = [...new Set([...astro.matchAll(/:\s*'svc-(\d)'/g)].map(m => m[1]))];
  if (astroCards.length !== 6) fails.push(`C3 в карте SVC_IMG разметки ${astroCards.length} файлов вместо 6`);
  if (!/\$\{k\}-640\.avif/.test(astro) || !/\$\{k\}-960\.webp/.test(astro)) fails.push('C3 picture карточки не использует srcset 640/960');

  /* 4. нет текста в картинках */
  svgs.forEach((t, i) => { if (/<text[\s>]/i.test(t)) fails.push(`C4 svc-${i + 1}.svg содержит <text>`); });
  if (/alt=["'][^"']*фото появится/i.test(astro) || />[^<>{}]*фото появится[^<>{}]*</i.test(astro)) fails.push('C4 в разметке осталась видимая строка «фото появится»');

  /* 5. кнопка */
  for (const w of ['1440', '1280', '1024', '768', '390']) {
    const btn = geom.widths[w]?.btn?.[0];
    if (!btn) { fails.push(`C5 нет замеров кнопки для ${w}`); continue; }
    if (btn.h < 44) fails.push(`C5 ${w}: высота кнопки ${btn.h} < 44`);
    if (btn.w > 300) fails.push(`C5 ${w}: кнопка растянута (${btn.w} px)`);
  }
  let btnCss = '';
  { let i = -1; while ((i = css.indexOf('.svc-body .link-more{', i + 1)) >= 0) { const j = css.indexOf('}', i); btnCss += css.slice(i, j) + ';'; } }
  if (!/border-radius:999px/.test(btnCss)) fails.push('C5 у кнопки нет radius 999px');
  if (!/min-height:44px/.test(btnCss)) fails.push('C5 у кнопки нет min-height 44px');
  if (!/\.svc-card:hover \.link-more/.test(css)) fails.push('C5 нет hover-состояния кнопки');
  const foc = css.match(/\.svc-card:focus-visible\{([^}]*)\}/);
  if (!foc || !/outline:2px solid/.test(foc[1])) fails.push('C5 нет outline на :focus-visible карточки');
  else { const off = foc[1].match(/outline-offset:\s*(-?\d+)px/);
    if (!off || +off[1] < 0) fails.push(`C5 outline-offset ${off ? off[1] : '—'} < 0 (рамку не видно)`); }
  if (!/\.svc-card:focus-visible \.link-more/.test(css)) fails.push('C5 focus-visible карточки не подсвечивает кнопку');

  /* 6. стрелки в строке с заголовком */
  for (const w of ['1440', '1280']) {
    const x = geom.widths[w];
    if (Math.abs(x.navDy) > 24) fails.push(`C6 ${w}: nav смещён по Y на ${x.navDy} px (>24)`);
    if (Math.abs(x.navRightDx) > 8) fails.push(`C6 ${w}: nav.right вне поля контейнера на ${x.navRightDx} px`);
  }
  for (const w of ['768', '390']) {
    const x = geom.widths[w];
    if (Math.abs(x.navRightDx) > 8) fails.push(`C6 ${w}: своя строка nav не по правому краю (${x.navRightDx} px)`);
  }

  /* 7. иерархия */
  const colOfLast = (sel) => { let i = -1, col = null;
    while ((i = css.indexOf(sel + '{', i + 1)) >= 0) { const j = css.indexOf('}', i);
      const m = css.slice(i, j).match(/(?:^|[{;])color:([^;}]+)/); if (m) col = m[1]; }
    return col; };
  const h3c = colOfLast('.svc-body h3'), tagc = colOfLast('.svc-tag');
  if (!h3c || !tagc) fails.push('C7 не читается цвет h3/.svc-tag');
  else if (h3c.trim() === tagc.trim()) fails.push(`C7 h3 и .svc-tag одного цвета (${h3c})`);

  /* 8. контраст по худшему пикселю подложки */
  const c = geom.contrast['1440'];
  if (c.p < 4.5) fails.push(`C8 p ${c.p} < 4.5`);
  if (c.h3 < 9) fails.push(`C8 h3 ${c.h3} < 9`);
  if (c.btnRest < 4.5) fails.push(`C8 кнопка в покое ${c.btnRest} < 4.5`);
  if (c.btnHover < 6) fails.push(`C8 кнопка hover ${c.btnHover} < 6`);

  /* геометрия и вес */
  for (const [w, [lo, hi]] of Object.entries(SEC_H)) {
    const h = geom.widths[w]?.section?.h;
    if (h == null) { fails.push(`G нет высоты секции для ${w}`); continue; }
    if (h < lo || h > hi) fails.push(`G ${w}: секция ${h} px вне ${lo}…${hi}`);
    (geom.widths[w].clip ?? []).forEach((cl, i) => cl.forEach((ok, k) => { if (!ok) fails.push(`G ${w}: карточка ${i + 1} режет ${k ? 'p' : 'h3'}`); }));
    if (!geom.scroll[w]) fails.push(`G ${w}: горизонтальная прокрутка`);
    const d = geom.weights[w] - geom.weightsBase[w];
    if (d > ORCH_CAP[w] - ORCH_BASE[w]) fails.push(`G ${w}: дельта веса ${d} КБ > запаса ${ORCH_CAP[w] - ORCH_BASE[w]}`);
  }
  return { fails, rows };
}

/* ---------- мутанты ---------- */
const MUTANTS = {
  'фон-display-none': ({ o }) => { o.css += '\n.svc-bg{display:none}\n'; },
  'фон-плоской-заливкой': ({ o }) => { o.astro = o.astro.replace(/<div class="svc-bg"[\s\S]*?<\/div>\n  <div class="container">/, '<div class="container">'); },
  'одна-фактура-на-все': ({ o }) => { o.astro = o.astro.replace(/'svc-[2-6]'/g, "'svc-1'"); },
  'карточка-выбелена-120': ({ G }) => { G.widths['1440'].cardZones[1].mean = 120; },
  'разброс-зоны-12': ({ G }) => { G.widths['1440'].cardZones[0].spread = 12; },
  'h3-снова-медный': ({ o }) => { o.css = o.css.replace('.svc-body h3{color:var(--ivory)}', '.svc-body h3{color:var(--brass)}'); },
  'кнопка-25px': ({ G }) => { for (const w of Object.keys(G.widths)) G.widths[w].btn = G.widths[w].btn.map(b => ({ ...b, h: 25 })); },
  'outline-offset-минус': ({ o }) => { o.css = o.css.replace('.svc-card:focus-visible{outline:2px solid #E0A96D;outline-offset:3px}', '.svc-card:focus-visible{outline:2px solid #E0A96D;outline-offset:-1px}'); },
  'стрелки-вниз': ({ G }) => { G.widths['1440'].navDy = 96; },
  'alt-фото-появится': ({ o }) => { o.astro = o.astro.replace('alt="" aria-hidden="true" width="800"', 'alt="фото появится после съёмки" aria-hidden="true" width="800"'); },
  'text-вернулся-в-svg': ({ o }) => { o.svgs = o.svgs.map((t, i) => i === 0 ? t + '<text x="10" y="20">фото появится после съёмки</text>' : t); },
  'шов-на-фоне': ({ G }) => { G.widths['1440'].bg.rowStep = 12; },
  'фон-средняя-20': ({ G }) => { G.widths['1440'].bg.mean = 20; },
};

const load = () => ({
  css: readFileSync(join(SITE, 'src/styles/sections.css'), 'utf8') + '\n' + readFileSync(join(SITE, 'src/styles/media.css'), 'utf8'),
  astro: readFileSync(join(SITE, 'src/pages/index.astro'), 'utf8'),
  geom: JSON.parse(readFileSync(join(SITE, 'data', 'svc-geom.json'), 'utf8')),
  svgs: [1, 2, 3, 4, 5, 6].map(i => readFileSync(join(IMG, `svc-${i}.svg`), 'utf8')),
});

const arg = process.argv[2] || '';
if (arg === '--self-test') {
  let bad = 0;
  for (const [name, mut] of Object.entries(MUTANTS)) {
    const o = load();
    mut({ o, G: o.geom });
    const { fails } = await checkSvcBg(o);
    const ok = fails.length > 0;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} мутант «${name}»: поломок ${fails.length}${fails[0] ? ' — ' + fails[0] : ''}`);
  }
  const { fails } = await checkSvcBg(load());
  console.log(`${fails.length ? 'FAIL' : 'ok  '} базовый прогон: ошибок ${fails.length}`);
  if (fails.length || bad) { fails.forEach(f => console.log('  ' + f)); process.exit(1); }
  console.log(`check-svc-bg: ${Object.keys(MUTANTS).length}/12+ мутантов роняют гейт, база чиста`);
} else {
  const { fails, rows } = await checkSvcBg();
  console.log('ширина   средняя  разброс  трети          ступенька');
  for (const r of rows) console.log(`${String(r[0]).padEnd(9)}${String(r[1]).padStart(6)} ${String(r[2]).padStart(8)}  ${String(r[3]).padEnd(15)}${r[4]}`);
  if (fails.length) { fails.forEach(f => console.log('FAIL ' + f)); process.exit(1); }
  console.log('check-svc-bg: OK (все проверки задания №23 пройдены)');
}
void R21;
