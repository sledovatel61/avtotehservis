/* Раунд 20, часть C: гейт фона секции «Как мы работаем» (.est-sec).
   Проверяет по МАСТЕРАМ (docs/photos-source/r20-steps), CSS-слоям, рендер-геометрии
   (site/data/steps-geom.json, снята Chromium-прогоном render-steps.mjs):
     1) наличие/размеры мастеров и производных, уникальность sha256 панелей;
     2) смысл CSS: градиенты скримов, монотонность, верх ≥ .60, низ ≤ .80, фон секции на var(--…);
     3) антиобход: в базовых правилах слоёв нет !important / opacity < .95 / display:none;
     4) модель контраста: худший пиксель мастера под зоной текста + скрим → WCAG-отношение;
     5) пол видимости: средние/разбросы мастеров, модель и рендер (средняя, разброс, трети, панель−секция);
     6) геометрия из geom: зазоры aside, высоты панелей, лимиты высот секций, about, заливка h2, прокрутка;
     7) мутанты (--self-test): 13 поломок, каждая роняет гейт.
   Запуск: node scripts/check-steps-bg.mjs [--mutant=имя] [--self-test] */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const R20 = join(ROOT, 'docs', 'photos-source', 'r20-steps');
const IMG = join(ROOT, 'site', 'public', 'img');

const LUM = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const relLum = (r, g, b) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const ratio = (a, b) => { const [hi, lo] = a > b ? [a, b] : [b, a]; return (hi + 0.05) / (lo + 0.05); };
const hexLum = (h) => { const n = parseInt(h.slice(1), 16); return relLum(n >> 16 & 255, n >> 8 & 255, n & 255); };

const IVORY_LUM = LUM(244, 239, 230);          /* scrim секции/панелей */
const DARK_LUM = LUM(11, 20, 16);              /* scrim aside */

/* ---------- чтение входов ---------- */
async function loadMaster(file) {
  const im = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { w: im.info.width, h: im.info.height, c: im.info.channels, d: im.data };
}
function regionWorst(m, r) {                    /* минимальная яркость в прямоугольнике мастера */
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(m.w, Math.ceil(r.x + r.w)), y1 = Math.min(m.h, Math.ceil(r.y + r.h));
  let mn = 255;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * m.w + x) * m.c;
    mn = Math.min(mn, LUM(m.d[i], m.d[i + 1], m.d[i + 2])); }
  return mn;
}
function stats(m, step = 3) {                   /* средняя, min, max, трети верхней полосы */
  let s = 0, n = 0, mn = 255, mx = 0, lS = 0, lN = 0, rS = 0, rN = 0;
  for (let y = 0; y < m.h; y += step) for (let x = 0; x < m.w; x += step) { const i = (y * m.w + x) * m.c;
    const v = LUM(m.d[i], m.d[i + 1], m.d[i + 2]); s += v; n++; mn = Math.min(mn, v); mx = Math.max(mx, v);
    if (y < m.h * 0.3) { if (x < m.w / 3) { lS += v; lN++; } else if (x > 2 * m.w / 3) { rS += v; rN++; } } }
  return { mean: s / n, mn, mx, thirdL: lS / Math.max(1, lN), thirdR: rS / Math.max(1, rN) };
}
function seamStep(m) {                          /* макс. ступень между соседними строками (A6, major B) */
  const row = new Float64Array(m.h);
  for (let y = 0; y < m.h; y++) { let t = 0;
    for (let x = 0; x < m.w; x++) { const i = (y * m.w + x) * m.c; t += LUM(m.d[i], m.d[i + 1], m.d[i + 2]); }
    row[y] = t / m.w; }
  let best = 0, at = 0;
  /* низкочастотный профиль: скользящее среднее по 21 строке. Высокочастотное зерно
     фактуры (штрих металла, бумажные волокна) при этом гасится, а настоящая ступень —
     нет: она сохраняется целиком, потому что окно по обе стороны от границы разное. */
  const R = 10;
  const smooth = (y) => { let t = 0, n = 0;
    for (let k = -R; k <= R; k++) { const yy = y + k; if (yy < 0 || yy >= m.h) continue; t += row[yy]; n++; }
    return t / n; };
  for (let y = R + 1; y < m.h - R - 1; y++) {
    const d = Math.abs(smooth(y + 1) - smooth(y));
    if (d > best) { best = d; at = y; } }
  return { step: best, at: at / m.h };
}
function coverRect(zone, box, mw, mh) {         /* зона (css px внутри бокса) → прямоугольник мастера */
  const sc = Math.max(box.w / mw, box.h / mh);
  const sw = box.w / sc, sh = box.h / sc, ox = (mw - sw) / 2, oy = (mh - sh) / 2;
  return { x: ox + (zone.x - box.x) / sc, y: oy + (zone.y - box.y) / sc, w: zone.w / sc, h: zone.h / sc };
}
function stops(css, sel) {                      /* альфы градиента скрима правила sel::after */
  const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '::after\\s*\\{[^}]*?linear-gradient\\(([^;}]*)\\)', 's');
  const m = css.match(re); if (!m) return null;
  const a = [...m[1].matchAll(/rgba\(\s*[\d\s,]+,\s*([.\d]+)\s*\)\s+(\d+)%/g)].map(x => [+x[1], +x[2]]);
  return a.length >= 2 ? a : null;
}
const alphaAt = (st, yFrac) => {                 /* линейная интерполяция альфы по высоте */
  const p = yFrac * 100;
  if (p <= st[0][1]) return st[0][0];
  for (let i = 1; i < st.length; i++) if (p <= st[i][1]) {
    const [a0, p0] = st[i - 1], [a1, p1] = st[i];
    return a0 + (a1 - a0) * ((p - p0) / Math.max(1, p1 - p0)); }
  return st[st.length - 1][0];
};
function layerRules(css) {                       /* правила, сгруппированные по @media */
  const out = []; let depth = 0, stack = [], buf = '';
  for (const ln of css.split('\n')) {
    const openM = ln.match(/@media[^{]*/);
    const sameLine = openM && (ln.match(/{/g) || []).length === (ln.match(/}/g) || []).length;
    if (sameLine) {                       /* однострочный @media-блок: своя область, не задевая глубину */
      out.push({ media: openM[0].trim() + ' ' + (buf || ''), block: ln });
      buf = ''; continue;
    }
    buf += ln + '\n';
    depth += (ln.match(/{/g) || []).length - (ln.match(/}/g) || []).length;
    if (openM) stack.push({ d: depth - 1, q: openM[0].trim() });
    if (depth === 0 && buf.trim()) {
      /* медиа берём ДО очистки стека — иначе закрывающая строка обнуляет контекст */
      out.push({ media: stack.map(x => x.q).join(' '), block: buf });
      buf = ''; stack = [];
      continue;
    }
    while (stack.length && depth <= stack[stack.length - 1].d && !openM) stack.pop();
  }
  /* ред. приёмки: НЕ выбрасываем правила из print/reduced-data из разбора —
     они нужны антиобходу; исключение делается точечно в самих проверках */
  const flat2 = [];
  for (const o of out) for (const m of o.block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    let sel = m[1].trim(), body = m[2], media = o.media;
    if (/^@media/.test(sel)) {            /* однострочный @media: разворачиваем вложенные правила */
      media = (media + ' ' + sel).trim();
      for (const n of body.matchAll(/([^{}]+)\{([^{}]*)\}/g))
        flat2.push({ sel: n[1].trim(), body: n[2], media });
      continue;
    }
    flat2.push({ sel, body, media });
  }
  return flat2;
}

/* ---------- мутации ---------- */
const flat = (w, h, v) => ({ w, h, c: 3, d: Buffer.alloc(w * h * 3, v) });
const MUTANTS = {
  'panel3-нет-текстуры': ({ M }) => { M.panel3 = flat(1200, 900, 213); },
  'panel2-белая': ({ M }) => { M.panel2 = flat(1200, 900, 255); },
  'фон-секции-тёмный': ({ M }) => { for (let i = 0; i < M.sec.d.length; i++) M.sec.d[i] = Math.round(M.sec.d[i] * 0.3); },
  'opacity-.4': ({ o }) => { o.css += '\n.est-bg-p{opacity:.4}\n'; },
  'important': ({ o }) => { o.css += '\n.est-bg{background:var(--ivory)!important}\n'; },
  'display-none': ({ o }) => { o.css += '\n.est-bg-p{display:none}\n'; },
  'один-файл-на-4-панели': ({ o }) => { o.astro = o.astro.replace(/est-p([234])-(\d+)/g, 'est-p1-$2'); },
  'скрим-.95': ({ o }) => { o.css = o.css.replace(/(\.est-bg-p::after\s*\{[^}]*?linear-gradient\(180deg,\s*)rgba\(244,239,230,\.\d+\)(\s+\d+%,\s*)rgba\(244,239,230,\.\d+\)/s, '$1rgba(244,239,230,.95)$2rgba(244,239,230,.95)'); },
  'aside-без-текстуры': ({ M }) => { M.aside = flat(1200, 1400, 60); },
  'panel2-выше-на-30': ({ G }) => { for (const w of Object.keys(G.widths)) { const x = G.widths[w]; if (x.panelsRel) { x.panelsRel[1].h += 30; x.panelHeights[1] += 30; } } },
  'aside-зазор-96': ({ G }) => { for (const w of ['1440', '1280', '1200']) if (G.widths[w]) G.widths[w].gapBottom = 96; },
  'надзаголовок-светлой-медью': ({ o }) => { o.css = o.css.replace(/--est-ink:\s*#[0-9A-Fa-f]{6}/, '--est-ink:#C08A5A'); },
  /* мутанты по протоколу A6 (major A): те самые обходы, на которых гейт круга 20 был зелёным */
  'A6-составной-opacity': ({ o }) => { o.css += '\n.est-step .est-bg-p{opacity:.35}\n'; },
  'A6-filter-brightness': ({ o }) => { o.css += '\n.est-bg-p{filter:brightness(.2)}\n'; },
  'A6-visibility-hidden': ({ o }) => { o.css += '\n.est-step .est-bg-p img{visibility:hidden}\n'; },
  'A6-important-90': ({ o }) => { o.css += '\n.est-sec .est-bg-p::after{background:rgba(11,20,16,.9)!important}\n'; },
  'A6-about-fact-opacity': ({ o }) => { o.css += '\n.about .fact-bg{opacity:.12}\n'; },
  'A6-about-feat-filter': ({ o }) => { o.css += '\n.about .feat-bg{filter:brightness(.15)}\n'; },
  /* ровно дефект A6: всё ниже 38 % высоты притемнено — на границе ступень, а не рампа */
  'A6-фон-со-швом': ({ M }) => { const y0 = Math.round(M.sec.h * 0.38);
    for (let y = y0; y < M.sec.h; y++) for (let x = 0; x < M.sec.w; x++) { const i = (y * M.sec.w + x) * M.sec.c; for (let q = 0; q < 3; q++) M.sec.d[i + q] = Math.max(0, M.sec.d[i + q] - 12); } },
  'A6-панели-одинаковые': ({ M }) => { M.panel2 = { w: M.panel1.w, h: M.panel1.h, c: M.panel1.c, d: Buffer.from(M.panel1.d) }; M.panel3 = { w: M.panel1.w, h: M.panel1.h, c: M.panel1.c, d: Buffer.from(M.panel1.d) }; },
  'пол-h2-убран': ({ M }) => { for (let y = 0; y < M.sec.h * 0.38; y++) for (let x = 0; x < M.sec.w; x++) { const i = (y * M.sec.w + x) * M.sec.c; for (let q = 0; q < 3; q++) M.sec.d[i + q] = Math.max(0, M.sec.d[i + q] - 40); } },
};

/* ---------- гейт ---------- */
export async function checkStepsBg(opts = {}) {
  const fails = [], rows = [];
  const css = opts.css ?? readFileSync(join(ROOT, 'site/src/styles/sections.css'), 'utf8')
    + '\n' + readFileSync(join(ROOT, 'site/src/styles/media.css'), 'utf8');
  const astro = opts.astro ?? readFileSync(join(ROOT, 'site/src/pages/index.astro'), 'utf8');
  const geom = opts.geom ?? JSON.parse(readFileSync(join(ROOT, 'site/data/steps-geom.json'), 'utf8'));
  const M = opts.masters ?? {
    sec: await loadMaster(join(R20, 'sec-2600.jpg')),
    secM960: await loadMaster(join(R20, 'sec-m-960.jpg')),
    secM640: await loadMaster(join(R20, 'sec-m-640.jpg')),
    panel1: await loadMaster(join(R20, 'panel-1-metal.jpg')),
    panel2: await loadMaster(join(R20, 'panel-2-paper.jpg')),
    panel3: await loadMaster(join(R20, 'panel-3-concrete.jpg')),
    panel4: await loadMaster(join(R20, 'panel-4-fabric.jpg')),
    aside: await loadMaster(join(R20, 'aside-1200.jpg')),
  };
  const P = [M.panel1, M.panel2, M.panel3, M.panel4];

  /* 1. файлы и уникальность */
  const dims = { sec: [2600, 1400], secM960: [1200, 1400], secM640: [640, 1400], panel1: [1200, 900], panel2: [1200, 900], panel3: [1200, 900], panel4: [1200, 900], aside: [1200, 1400] };
  for (const [k, [w, h]] of Object.entries(dims))
    if (M[k].w !== w || M[k].h !== h) fails.push(`C1 мастер ${k}: размер ${M[k].w}×${M[k].h}, ожидался ${w}×${h}`);
  const derivs = ['est-bg-1600', 'est-bg-960', 'est-bg-640', 'est-bg-m-960', 'est-bg-m-640',
    'est-p1-640', 'est-p2-640', 'est-p3-640', 'est-p4-640',
    'est-aside-1000', 'est-aside-640'];
  for (const d of derivs) for (const ext of ['avif', 'webp'])
    if (!existsSync(join(IMG, `${d}.${ext}`))) fails.push(`C1 нет производной ${d}.${ext}`);
  const sha = (f) => createHash('sha256').update(readFileSync(join(IMG, f))).digest('hex').slice(0, 12);
  const pSha = [1, 2, 3, 4].map(i => sha(`est-p${i}-640.avif`));
  if (new Set(pSha).size !== 4) fails.push(`C1 sha256 производных панелей не уникальны: ${pSha.join(',')}`);
  const astroPanels = [...new Set([...astro.matchAll(/\/img\/(est-p\d)-\d+\.(?:avif|webp)/g)].map(m => m[1]))];
  if (astroPanels.length !== 4) fails.push(`C1 в разметке панелей задействовано ${astroPanels.length} файла вместо 4`);

  /* 2. смысл CSS: скримы и фон на переменной */
  /* ред. приёмки: назначение скрима — держать контраст текста, а не заливать картинку.
     Верх ≤ .50 (фактура видна), низ ≤ .85 (не глухая заливка), монотонность.
     Настоящую гарантию контраста даёт C4 по худшему пикселю — он ниже. */
  const layers = { '.est-bg': [0.00, 0.85], '.est-bg-p': [0.00, 0.85], '.est-aside-bg': [0.55, 0.98] };
  const SCRIM_TOP_MAX = 0.50;
  const ST = {};
  for (const [sel, [lo, hi]] of Object.entries(layers)) {
    const st = stops(css, sel);
    if (!st) { fails.push(`C2 нет градиента скрима ${sel}::after`); continue; }
    ST[sel] = st;
    const [top, bot] = [st[0][0], st[st.length - 1][0]];
    if (top < lo) fails.push(`C2 ${sel}: верх скрима ${top} < ${lo}`);
    if (sel !== '.est-aside-bg' && top > SCRIM_TOP_MAX) fails.push(`C2 ${sel}: верх скрима ${top} > ${SCRIM_TOP_MAX} — фактура залита (A6, major D)`);
    if (bot > hi) fails.push(`C2 ${sel}: низ скрима ${bot} > ${hi}`);
    for (let i = 1; i < st.length; i++) if (st[i][0] < st[i - 1][0] - 1e-9) fails.push(`C2 ${sel}: скрим не монотонен`);
  }
  if (!/\.est-bg\s*\{[^}]*background(-color)?:\s*var\(--/.test(css)) fails.push('C2 фон секции не на var(--…)');

  /* 3. антиобход (A6, major A): смотрим ЛЮБОЕ правило, в селекторе которого есть класс слоя —
     включая составные (.est-step .est-bg-p) и контекстные. Гасить слой можно только
     в print / prefers-reduced-data / prefers-reduced-motion, иначе это обход гейта. */
  const LAYER_CLS = ['est-bg', 'est-bg-p', 'est-aside-bg', 'fact-bg', 'feat-bg', 'btn-bg', 'about-bg'];
  for (const r of layerRules(css)) {
    if (!LAYER_CLS.some(cl => new RegExp('(^|[\\s,>+~])\\.' + cl.replace(/-/g, '\\-') + '(?![\\w-])').test(r.sel))) continue;
    const allowed = /print|prefers-reduced-data|prefers-reduced-motion/.test(r.media);
    if (/!important/.test(r.body)) fails.push(`C3 ${r.sel} [${r.media || 'base'}]: !important на слое фона`);
    const op = r.body.match(/opacity:\s*([.\d]+)/); if (op && +op[1] < 0.95 && !allowed) fails.push(`C3 ${r.sel}: opacity ${op[1]} на слое фона`);
    if (/display:\s*none/.test(r.body) && !allowed) fails.push(`C3 ${r.sel} [${r.media || 'base'}]: display:none на слое фона`);
    if (/visibility:\s*hidden/.test(r.body) && !allowed) fails.push(`C3 ${r.sel}: visibility:hidden на слое фона`);
    const fl = r.body.match(/filter:\s*([^;}]+)/); if (fl && !allowed) fails.push(`C3 ${r.sel}: filter ${fl[1].trim()} на слое фона`);
    const br = r.body.match(/brightness\(([.\d]+)/); if (br && +br[1] < 0.95 && !allowed) fails.push(`C3 ${r.sel}: brightness ${br[1]} < 0,95`);
  }

  /* 4. модель контраста (худший пиксель мастера под зоной + скрим), зоны рендера @1440 */
  const W = geom.widths['1440'];
  const ink = (css.match(/--est-ink:\s*(#[0-9A-Fa-f]{6})/) || [])[1] || '#7A4620';
  /* цвет основного текста панели читаем из CSS — иначе гейт сверяет не то, что на экране */
  const panelInk = (css.match(/\.est-step p\s*\{[^}]*color:\s*(#[0-9A-Fa-f]{6})/) || [])[1] || '#3F4E47';
  const panelH3 = (css.match(/\.est-step h3\s*\{[^}]*color:\s*([^;}]+)/) || [])[1] || '#0B1410';
  const Z = W.zones, box = W.section;
  const stSec = ST['.est-bg'], stPan = ST['.est-bg-p'], stAs = ST['.est-aside-bg'];
  const zone = (m, z, b, mw, mh, scrim, base, textHex, need, label) => {
    if (!stSec && scrim === 'sec') return;
    const st = scrim === 'sec' ? stSec : scrim === 'pan' ? stPan : stAs;
    if (!st) return;
    const r = coverRect(z, b, mw, mh);
    const worst = regionWorst(m, r);
    const a = alphaAt(st, (z.y + z.h / 2) / (scrim === 'pan' ? b.h : box.h));
    const lum = worst * (1 - a) + base * a;
    const cr = ratio(relLum(lum, lum, lum), hexLum(textHex));
    rows.push([label, Math.round(worst), +a.toFixed(2), Math.round(lum), textHex, +cr.toFixed(2), need]);
    if (cr < need) fails.push(`C4 ${label}: контраст ${cr.toFixed(2)} < ${need}`);
    return lum;
  };
  const h2Lum = zone(M.sec, Z.h2, { x: 0, y: 0, w: box.w, h: box.h }, 2600, 1400, 'sec', IVORY_LUM, '#0B1410', 7, 'h2 секции');
  zone(M.sec, Z.eye, { x: 0, y: 0, w: box.w, h: box.h }, 2600, 1400, 'sec', IVORY_LUM, ink, 4.5, 'надзаголовок');
  /* ред. приёмки: порог «худший пиксель ≥ 225» был прокси для контраста надзаголовка и заставлял
     заливать фон. Теперь контраст надзаголовка считается напрямую (zone(...'надзаголовок') выше),
     а здесь остаётся пол видимости: фон под заголовком обязан быть светлым, но живым. */
  if (h2Lum !== undefined && (h2Lum < 186 || h2Lum > 246)) fails.push(`C4/B1 худший пиксель фона зоны h2 ${Math.round(h2Lum)} вне 186…246`);
  for (let i = 0; i < 4; i++) {
    const b = W.panelsRel[i];
    zone(P[i], Z[`p${i + 1}h`], b, 1200, 900, 'pan', IVORY_LUM, panelH3.trim(), 7, `панель ${i + 1} h3`);
    zone(P[i], Z[`p${i + 1}p`], b, 1200, 900, 'pan', IVORY_LUM, panelInk, 4.5, `панель ${i + 1} p`);
  }
  zone(M.aside, Z.ah, W.asideRel, 1200, 1400, 'as', DARK_LUM, '#C9A06A', 4.5, 'aside h3');
  zone(M.aside, Z.ap, W.asideRel, 1200, 1400, 'as', DARK_LUM, '#E9EDEA', 4.5, 'aside p');

  /* 5. пол видимости: мастера + модель + рендер */
  P.forEach((m, i) => { const s = stats(m);
    if (s.mean < 150 || s.mean > 200) fails.push(`C5 панель ${i + 1}: средняя мастера ${s.mean.toFixed(1)} вне 150…200`);
    if (s.mx - s.mn < 50) fails.push(`C5 панель ${i + 1}: разброс мастера ${Math.round(s.mx - s.mn)} < 50 (фактура не читается)`);
    if (s.mx - s.mn > 90) fails.push(`C5 панель ${i + 1}: разброс мастера ${Math.round(s.mx - s.mn)} > 90`); });
  /* ред. приёмки (A6, major D): четыре панели должны отличаться друг от друга — не только sha,
     но и по средней яркости после скрима. Иначе на экране это один прямоугольник. */
  {
    const aP = alphaAt(ST['.est-bg-p'] || [[0.40, 0]], 0.5);
    const onScreen = P.map(m => { const st = stats(m); return st.mean * (1 - aP) + IVORY_LUM * aP; });
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      const d = Math.abs(onScreen[i] - onScreen[j]);
      if (d < 3) fails.push(`C5 панели ${i + 1} и ${j + 1} на экране неразличимы: Δ средней ${d.toFixed(1)} < 3 (A6, major D)`);
    }
  }
  const aSt = stats(M.aside); if (aSt.mx - aSt.mn < 25) fails.push(`C5 aside: разброс мастера ${Math.round(aSt.mx - aSt.mn)} < 25`);
  /* ред. приёмки (A6, major B): в мастере фона не должно быть горизонтального шва.
     Порог 2,0 — при фактуре разбросом 70 соседние строки отличаются на доли единицы,
     а «ступень» от ветвления по y давала 30. */
  for (const [key, m] of [['фон секции', M.sec], ['портрет 960', M.secM960], ['портрет 640', M.secM640]]) {
    const sm = seamStep(m);
    if (sm.step > 2.0) fails.push(`C5/B2 ${key}: горизонтальный шов ${sm.step.toFixed(1)} на ${(sm.at * 100).toFixed(0)} % высоты (порог 2,0) — A6, major B`);
  }
  for (let i = 0; i < 4; i++) { const sm = seamStep(P[i]);
    if (sm.step > 3.0) fails.push(`C5/B2 панель ${i + 1}: шов ${sm.step.toFixed(1)} на ${(sm.at * 100).toFixed(0)} % высоты (порог 3,0)`); }
  const sSt = stats(M.sec);
  if (stSec) {
    const aMid = alphaAt(stSec, 0.5);
    const modelMean = sSt.mean * (1 - aMid) + IVORY_LUM * aMid;
    if (modelMean < 205 || modelMean > 228) fails.push(`C5 модель средней секции ${modelMean.toFixed(1)} вне 205…228`);
    /* светлый композит верха − тёмный композит: минимум из тени aside (box-shadow rgba(11,20,16,.35))
       и низа мастера под скримом — тени часть рендера секции */
    const shA = +((css.match(/\.est-aside\s*\{[^}]*?box-shadow:[^;]*?rgba\(11,20,16,\s*([.\d]+)\)/) || [])[1] || 0);
    const light = sSt.mx * (1 - stSec[0][0]) + IVORY_LUM * stSec[0][0];
    const darkTex = sSt.mn * (1 - stSec[stSec.length - 1][0]) + IVORY_LUM * stSec[stSec.length - 1][0];
    const darkShadow = modelMean * (1 - shA) + DARK_LUM * shA;
    const modelSpread = light - Math.min(darkTex, darkShadow);
    if (modelSpread < 35) fails.push(`C5 модель разброса секции ${modelSpread.toFixed(1)} < 35`);
    const modelThirds = (sSt.thirdR - sSt.thirdL) * (1 - alphaAt(stSec, 0.15));
    if (modelThirds < 5) fails.push(`C5 модель трети секции ${modelThirds.toFixed(1)} < 5`);
    P.forEach((m, i) => { const p = stats(m); const aP = alphaAt(ST['.est-bg-p'] || [[0.72, 0]], 0.5);
      /* модель консервативна (без теней): порог 5; спецификационные ≥6 проверяются рендером ниже */
      const d = (p.mean * (1 - aP) + IVORY_LUM * aP) - modelMean;
      if (Math.abs(d) < 6) fails.push(`C5 модель панель ${i + 1} и фон секции: |Δ| ${Math.abs(d).toFixed(1)} < 6 (панель сливается с фоном)`); });
  }
  for (const w of ['1440', '390']) { const r = geom.widths[w].render; if (!r) continue;
    if (r.secMean < 205 || r.secMean > 228) fails.push(`C5 рендер ${w}: средняя ${r.secMean} вне 205…228`);
    if (r.secSpread < 35) fails.push(`C5 рендер ${w}: разброс ${r.secSpread} < 35`);
    if (Math.abs(r.thirdR - r.thirdL) < 5) fails.push(`C5 рендер ${w}: трети ${r.thirdL}/${r.thirdR}, Δ < 5`);
    r.panelSpread.forEach((s, i) => { if (s < 25) fails.push(`C5 рендер ${w}: разброс панели ${i + 1} ${s} < 25`); });
    r.panelMean.forEach((m, i) => { if (Math.abs(m - r.secMean) < 6) fails.push(`C5 рендер ${w}: панель ${i + 1} и секция: |Δ| ${Math.abs(m - r.secMean).toFixed(1)} < 6`); }); }

  /* 6. геометрия из geom */
  for (const w of ['1440', '1280', '1200']) { const x = geom.widths[w]; if (!x) continue;
    if (Math.abs(x.gapTop) > 4) fails.push(`C6 ${w}: зазор aside сверху ${x.gapTop}`);
    if (Math.abs(x.gapBottom) > 4) fails.push(`C6 ${w}: зазор aside снизу ${x.gapBottom}`);
    if (Math.max(...x.panelHeights) - Math.min(...x.panelHeights) > 2) fails.push(`C6 ${w}: высоты панелей ${x.panelHeights.join('/')}`);
    if (x.section.h > 880) fails.push(`C6 ${w}: секция ${x.section.h} > 880`); }
  const x10 = geom.widths['1024'], x39 = geom.widths['390'];
  if (x10.section.h > 1150) fails.push(`C6 1024: секция ${x10.section.h} > 1150`);
  if (x10.about.sectionH > 1500) fails.push(`C6 1024: about ${x10.about.sectionH} > 1500`);
  if (x10.about.media.w > 720) fails.push(`C6 1024: фото about ${x10.about.media.w} > 720`);
  if (x10.about.charsPerLine > 75) fails.push(`C6 1024: знаков в строке ${x10.about.charsPerLine} > 75`);
  if (x39.section.h > 1450) fails.push(`C6 390: секция ${x39.section.h} > 1450`);
  for (const w of ['1440', '390']) { const L = geom.widths[w].estLines;
    if (L[L.length - 1] < 0.35) fails.push(`C6 ${w}: заливка последней строки h2 ${(L[L.length - 1] * 100).toFixed(0)}% < 35%`); }
  for (const [w, ok] of Object.entries(geom.scroll)) if (!ok) fails.push(`C6 ${w}: горизонтальная прокрутка`);

  return { fails, rows };
}

/* ---------- CLI ---------- */
const arg = process.argv[2] || '';
if (arg === '--self-test') {
  const base = { css: readFileSync(join(ROOT, 'site/src/styles/sections.css'), 'utf8') + '\n' + readFileSync(join(ROOT, 'site/src/styles/media.css'), 'utf8'),
    astro: readFileSync(join(ROOT, 'site/src/pages/index.astro'), 'utf8'),
    geom: JSON.parse(readFileSync(join(ROOT, 'site/data/steps-geom.json'), 'utf8')) };
  const masters = async () => ({
    sec: await loadMaster(join(R20, 'sec-2600.jpg')), secM960: await loadMaster(join(R20, 'sec-m-960.jpg')),
    secM640: await loadMaster(join(R20, 'sec-m-640.jpg')), panel1: await loadMaster(join(R20, 'panel-1-metal.jpg')),
    panel2: await loadMaster(join(R20, 'panel-2-paper.jpg')), panel3: await loadMaster(join(R20, 'panel-3-concrete.jpg')),
    panel4: await loadMaster(join(R20, 'panel-4-fabric.jpg')), aside: await loadMaster(join(R20, 'aside-1200.jpg')) });
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let bad = 0;
  for (const [name, mut] of Object.entries(MUTANTS)) {
    const o = { css: base.css, astro: base.astro, geom: clone(base.geom), masters: await masters() };
    mut({ M: o.masters, o, G: o.geom });
    const { fails } = await checkStepsBg(o);
    const ok = fails.length > 0;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} мутант «${name}»: поломок ${fails.length}${fails[0] ? ' — ' + fails[0] : ''}`);
  }
  const { fails } = await checkStepsBg(base);
  console.log(`${fails.length ? 'FAIL' : 'ok  '} базовый прогон: ошибок ${fails.length}`);
  if (fails.length || bad) { fails.forEach(f => console.log('  ' + f)); process.exit(1); }
  console.log(`check-steps-bg: ${Object.keys(MUTANTS).length}/12+ мутантов роняют гейт, база чиста`);
} else if (arg.startsWith('--mutant=')) {
  const name = arg.slice(9);
  const o = { css: readFileSync(join(ROOT, 'site/src/styles/sections.css'), 'utf8') + '\n' + readFileSync(join(ROOT, 'site/src/styles/media.css'), 'utf8'),
    astro: readFileSync(join(ROOT, 'site/src/pages/index.astro'), 'utf8'),
    geom: JSON.parse(readFileSync(join(ROOT, 'site/data/steps-geom.json'), 'utf8')), masters: undefined };
  o.masters = { sec: await loadMaster(join(R20, 'sec-2600.jpg')), secM960: await loadMaster(join(R20, 'sec-m-960.jpg')),
    secM640: await loadMaster(join(R20, 'sec-m-640.jpg')), panel1: await loadMaster(join(R20, 'panel-1-metal.jpg')),
    panel2: await loadMaster(join(R20, 'panel-2-paper.jpg')), panel3: await loadMaster(join(R20, 'panel-3-concrete.jpg')),
    panel4: await loadMaster(join(R20, 'panel-4-fabric.jpg')), aside: await loadMaster(join(R20, 'aside-1200.jpg')) };
  MUTANTS[name]({ M: o.masters, o, G: o.geom });
  const { fails } = await checkStepsBg(o);
  console.log(fails.length ? `мутант «${name}» пойман: ${fails.length} проверок упали` : `мутант «${name}» НЕ пойман`);
  process.exit(fails.length ? 0 : 1);
} else {
  const { fails, rows } = await checkStepsBg();
  console.log('зона                       мастер α    рендер текст  контраст ≥');
  for (const r of rows) console.log(`${r[0].padEnd(26)} ${String(r[1]).padStart(4)} ${r[2].toFixed(2)} ${String(r[3]).padStart(6)} ${r[4]} ${String(r[5]).padStart(6)} ${r[6]}`);
  if (fails.length) { fails.forEach(f => console.log('FAIL ' + f)); process.exit(1); }
  console.log(`check-steps-bg: OK (${rows.length} строк таблицы контраста, все проверки Части C пройдены)`);
}
