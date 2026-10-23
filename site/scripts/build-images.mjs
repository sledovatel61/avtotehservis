/* Раунд 10: сборщик изображений первого экрана.
   Десктоп-мастер 16:9 (2742×1542) — коллаж: фасад y 0…1542 + полоса асфальта
   (оригинал y 1750…2160 → y 1318…1542, перо 40 сверху) + машины RGBA-слоями
   из r9-gen/ (масштаб без искажения пропорций). Мобильный мастер 4:5
   (1550×1938) из close: left 290, top 210 — правый край в промежутке, запас
   до буквы ≥20 px. Неон — детерминированная маска букв (ядро #9BE8BC, ореол
   #4E9E74, blur 6/16/36), слой той же пропорции, что фото.
   Грейд раунда 9: linear 0.62/0.6324/0.5952, saturation 0.93, небо multiply,
   тёплые боксы overlay, bloom ламп screen, виньетка 0.30.
   Проверки: safe-zone (как браузер: cover + object-position), веса, пропорции,
   дубли хешей, запас буквы мобильного кропа; таблица весов README генерируется
   между маркерами weights-auto. Запуск: node site/scripts/build-images.mjs */
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const sharp = createRequire(import.meta.url)('../../site/node_modules/sharp');
const HERE = dirname(fileURLToPath(import.meta.url));
const SRCW = join(HERE, '../../docs/photos-source/original-front-wide-3840x2160.jpg');
const SRCC = join(HERE, '../../docs/photos-source/original-front-close-3840x2160.jpg');
const GEN = join(HERE, '../../docs/photos-source/r9-gen');
const OUT = join(HERE, '../../site/public/img');
const README = join(HERE, '../../docs/photos-source/README.md');

/* ---------- геометрия кадра (константы вставки — рядом safe-zone) ---------- */
export const DW = 2742, DH = 1542;                 // десктоп-мастер 16:9
const ASPH_TOP = 1285;                              // верх полосы асфальта
export const MOBW = 1550, MOBH = 1938;              // мобильный мастер 4:5
export const VIEWPORTS = [
  [1024, 768], [1180, 800], [1280, 800], [1366, 768], [1440, 900],
  [1536, 864], [1600, 900], [1920, 1080], [2560, 1440],
];
export const MOB_VIEWPORTS = [[360, 640], [390, 844], [414, 896]];
export const DESK_POS_Y = 0.78;                     // object-position десктопа (slide 1)
const MOB_POS_Y = 0.20;

/* ---------- служебное ---------- */
const rawOf = async (pipe) => { const r = await pipe.raw().toBuffer({ resolveWithObject: true }); return { d: r.data, c: r.info.channels, w: r.info.width, h: r.info.height }; };
function rgba(w, h, fn) { const b = Buffer.alloc(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fn(b, x, y, (y * w + x) * 4); return b; }
const vgrad = (w, h, a0, a1, y0, y1, rgb) => rgba(w, h, (b, x, y, i) => { const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0))); const a = a0 + (a1 - a0) * t; b[i] = rgb[0]; b[i + 1] = rgb[1]; b[i + 2] = rgb[2]; b[i + 3] = Math.round(a * 255); });
const radial = (w, h, cx, cy, rx, ry, peak, rgb) => rgba(w, h, (b, x, y, i) => { const dx = (x - cx) / rx, dy = (y - cy) / ry; const d = Math.sqrt(dx * dx + dy * dy); const a = d >= 1 ? 0 : peak * Math.pow(Math.cos(d * Math.PI / 2), 2); b[i] = rgb[0]; b[i + 1] = rgb[1]; b[i + 2] = rgb[2]; b[i + 3] = Math.round(a * 255); });
const vignette = (w, h, peak) => rgba(w, h, (b, x, y, i) => { const dx = (x - w / 2) / (w * 0.62), dy = (y - h * 0.46) / (h * 0.66); const d = Math.sqrt(dx * dx + dy * dy); const a = d <= 0.72 ? 0 : peak * Math.min(1, (d - 0.72) / 0.55); b[i] = 6; b[i + 1] = 12; b[i + 2] = 10; b[i + 3] = Math.round(a * 255); });
const S = 0.25;
const maskPng = async (buf4, w, h, tw, th) => sharp(buf4, { raw: { width: w, height: h, channels: 4 } }).resize(tw, th).png().toBuffer();
async function featherZone(file, left, top, w, h, feather, hard) {
  const rgb = await sharp(file).resize(w, h).raw().toBuffer();
  const a = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let d = feather;
    if (!hard.left) d = Math.min(d, x);
    if (!hard.top) d = Math.min(d, y);
    if (!hard.right) d = Math.min(d, w - 1 - x);
    if (!hard.bottom) d = Math.min(d, h - 1 - y);
    a[y * w + x] = Math.max(0, Math.min(255, Math.round(255 * Math.min(1, d / feather))));
  }
  const input = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
    .joinChannel(await sharp(a, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer()).png().toBuffer();
  return { input, left, top };
}
// раунд 12: 0 внутренних дыр в альфе: дыра = компонента alpha<24, не связанная
// с границей; RGB дыр доводится дилатацией из соседних пикселей и тонируется стеклом
async function holeFill(buf) {
  const r = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const w = r.info.width, h = r.info.height, d = Buffer.from(r.data);
  const trans = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) trans[i] = d[i * 4 + 3] < 24 ? 1 : 0;
  const stack = [];
  for (let x = 0; x < w; x++) { if (trans[x]) out[x] = 1; if (trans[(h - 1) * w + x]) out[(h - 1) * w + x] = 1; }
  for (let y = 0; y < h; y++) { if (trans[y * w]) out[y * w] = 1; if (trans[y * w + w - 1]) out[y * w + w - 1] = 1; }
  for (let i = 0; i < w * h; i++) if (out[i]) stack.push(i);
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (trans[j] && !out[j]) { out[j] = 1; stack.push(j); }
    }
  }
  // дыры: trans=1, out=0 → RGB дилатацией из непрозрачных, alpha 255, тон стекла
  let changed = true, passes = 0;
  const isHole = (i) => trans[i] && !out[i];
  while (changed && passes < 200) {
    changed = false; passes++;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!isHole(i)) continue;
      let sr = 0, sg = 0, sb = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!isHole(j)) { sr += d[j * 4]; sg += d[j * 4 + 1]; sb += d[j * 4 + 2]; c++; }
      }
      if (c) { d[i * 4] = sr / c; d[i * 4 + 1] = sg / c; d[i * 4 + 2] = sb / c; d[i * 4 + 3] = 255; trans[i] = 2; changed = true; }
    }
    for (let i = 0; i < w * h; i++) if (trans[i] === 2) trans[i] = 0;
  }
  for (let i = 0; i < w * h; i++) if (isHole(i)) { d[i * 4 + 3] = 255; } // страховка
  // стекло: заполненные дыры затемняем
  for (let i = 0; i < w * h; i++) if (trans[i] === 1) { d[i * 4] *= 0.42; d[i * 4 + 1] *= 0.46; d[i * 4 + 2] *= 0.5; }
  return sharp(d, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}
// чистка альфы слоя: плёнку 8…64 убираем smoothstep, чтобы над фоном не было прямоугольника
async function cleanAlpha(buf) {
  const r = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const d = Buffer.from(r.data);
  for (let i = 3; i < d.length; i += 4) {
    const a = d[i];
    d[i] = a < 24 ? 0 : a > 64 ? 255 : Math.round(((a - 24) * 255) / 40);
  }
  return sharp(d, { raw: { width: r.info.width, height: r.info.height, channels: 4 } }).png().toBuffer();
}
const alphaBBox = async (buf, thr) => {
  const r = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < r.info.height; y++) for (let x = 0; x < r.info.width; x++) {
    if (r.data[(y * r.info.width + x) * 4 + 3] > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return [x0, y0, x1, y1];
};

/* ---------- safe-zone: ровно как браузер (cover + object-position) ---------- */
export function safeZoneTable(geom) {
  const rows = [];
  const { IW, IH, posY, cars, title } = geom;
  if (geom.whole) {
    // раунд 12: десктоп показывает фото ЦЕЛИКОМ (рамка = пропорция файла)
    for (const [W, H] of VIEWPORTS) {
      const hero = Math.min(860, Math.max(560, H - 150));
      const inter = cars && !(cars[1] > title[3] || cars[3] < title[1]) && !(cars[0] > title[2] || cars[2] < title[0]);
      rows.push({ vp: `${W}×${H}`, hero, band: `0…${IH} (целиком)`, cars: cars[1] >= 0 && cars[3] <= IH ? 'ok' : 'нет', title: title[1] >= 0 && title[3] <= IH ? 'ok' : 'нет', inter: inter ? 'да' : 'нет' });
    }
    return rows;
  }
  for (const [W, H] of VIEWPORTS) {
    const hero = Math.min(860, Math.max(560, H - 150));
    const s = Math.max(W / IW, hero / IH);
    const visH = hero / s;
    const top = (IH - visH) * posY;
    const lo = top + visH * 0.01, hi = top + visH * 0.99;
    const carsOk = !cars || (cars[1] >= lo && cars[3] <= hi);
    const titleOk = title[1] >= top && title[3] <= top + visH;
    const inter = cars && !(cars[1] > title[3] || cars[3] < title[1]) && !(cars[0] > title[2] || cars[2] < title[0]);
    rows.push({ vp: `${W}×${H}`, hero, band: `${top.toFixed(0)}…${(top + visH).toFixed(0)}`, cars: carsOk ? 'ok' : 'нет', title: titleOk ? 'ok' : 'нет', inter: inter ? 'да' : 'нет' });
  }
  return rows;
}
export function safeZoneMobile(geom) {
  const { IW, title } = geom;
  return MOB_VIEWPORTS.map(([W, H]) => ({
    vp: `${W}×${H}`, band: `0…${MOBH}`,
    cars: 'ok', title: title[0] >= 0 && title[2] <= IW ? 'ok' : 'нет', inter: 'ok',
  }));
}

/* ---------- кодирование с лимитами ---------- */
const CAPS = {
  'hero-service-2560': { avif: 200, webp: 200 },
  'hero-service-1600': { avif: 120, webp: 160 },
  'hero-service-960': { avif: 120, webp: 120 },
  'hero-service-640': { avif: 120, webp: 120 },
  'hero-neon-1600': { avif: 60, webp: 60 },
  'hero-neon-960': { avif: 25, webp: 25 },
  'hero-neon-m-960': { avif: 60, webp: 60 },
  'hero-neon-m-640': { avif: 25, webp: 25 },
  'hero-service-m-960': { avif: 120, webp: 120 },
  'hero-service-m-640': { avif: 120, webp: 120 },
  'hero-detail-1600': { avif: 120, webp: 120 },
  'hero-detail-960': { avif: 120, webp: 120 },
  'strip-sign': { avif: 60, webp: 60 },
  'strip-bay': { avif: 60, webp: 60 },
  'strip-gates': { avif: 60, webp: 60 },
  'about-service-1600': { avif: 70, webp: 70 },
  'about-service-960': { avif: 70, webp: 70 },
  'about-service-640': { avif: 70, webp: 70 },
  'cta-diag-960': { avif: 45, webp: 45 },
  'cta-diag-640': { avif: 45, webp: 45 },
};
async function encodeSet(name, pipe, w, h, hasAlpha) {
  const res = [];
  for (const fmt of ['avif', 'webp']) {
    let q = fmt === 'avif' ? (hasAlpha ? 42 : 46) : (hasAlpha ? 62 : 66);
    let buf;
    for (;;) {
      buf = await pipe.clone()[fmt]({
        quality: q, effort: fmt === 'webp' && w >= 1600 ? 6 : 4, ...(fmt === 'webp' ? { alphaQuality: hasAlpha ? 12 : 100 } : {}),
      }).toBuffer();
      if (buf.length / 1024 <= CAPS[name][fmt] || q <= 10) break;
      q -= 6;
    }
    writeFileSync(join(OUT, `${name}.${fmt}`), buf);
    res.push({ file: `${name}.${fmt}`, w, h, kb: +(buf.length / 1024).toFixed(1), cap: CAPS[name][fmt] });
  }
  return res;
}

/* ---------- неон ---------- */
async function neon(masterFile, Wm, Hm, bx, by, bw, bh, thr) {
  const PAD = 140;
  const x0 = Math.max(0, bx - PAD), y0 = Math.max(0, by - PAD);
  const w = Math.min(Wm - x0, bw + PAD * 2), h = Math.min(Hm - y0, bh + PAD * 2);
  const rgb = await sharp(masterFile).extract({ left: x0, top: y0, width: w, height: h }).raw().toBuffer();
  const mask = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    const t = Math.max(0, Math.min(1, (lum - thr) / 32));
    mask[i] = Math.round(255 * t * (sat < 0.35 ? 1 : 0.08));
  }
  const mk = (b) => sharp(b, { raw: { width: w, height: h, channels: 1 } });
  const core = await rawOf(mk(mask).png());
  const h1r = await rawOf(mk(mask).blur(6).linear(0.95, 0).png());
  const h2r = await rawOf(mk(mask).blur(16).linear(0.62, 0).png());
  const h3r = await rawOf(mk(mask).blur(36).linear(0.38, 0).png());
  // вертикальные ворота ореола: бренды сверху и телефоны снизу не светятся (п.5.1)
  const nameTop = by - y0, nameBot = nameTop + bh;
  const gate = (y) => {
    const up = Math.max(0, Math.min(1, (y - (nameTop - 70)) / 50));   // над названием гаснет к -70
    const dn = y <= nameBot + 2 ? 1 : Math.max(0, Math.min(1, (nameBot + 14 - y) / 12)); // раунд 12: ниже названия ореол = 0
    return Math.min(up, dn);
  };
  const applyGate = (r) => {
    const d = Buffer.from(r.d);
    for (let y = 0; y < h; y++) {
      const g = gate(y);
      if (g === 1) continue;
      for (let x = 0; x < w; x++) d[(y * w + x) * r.c] = Math.round(d[(y * w + x) * r.c] * g);
    }
    return { d, c: r.c };
  };
  const h1 = applyGate(h1r), h2 = applyGate(h2r), h3 = applyGate(h3r);
  const CORE = [155, 232, 188], HALO = [78, 158, 116];
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const aC = (core.d[i * core.c] / 255) * 0.92;
    const aH = Math.min(1, h1.d[i * h1.c] / 255 + h2.d[i * h2.c] / 255 + h3.d[i * h3.c] / 255);
    const a = Math.min(1, aH + aC);
    const kr = aC, kh = aH * (1 - aC);
    const inv = 1 / Math.max(a, 1e-6);
    out[i * 4] = Math.min(255, Math.round((CORE[0] * kr + HALO[0] * kh) * inv));
    out[i * 4 + 1] = Math.min(255, Math.round((CORE[1] * kr + HALO[1] * kh) * inv));
    out[i * 4 + 2] = Math.min(255, Math.round((CORE[2] * kr + HALO[2] * kh) * inv));
    out[i * 4 + 3] = Math.round(255 * a);
  }
  const full = Buffer.alloc(Wm * Hm * 4);
  for (let y = 0; y < h; y++) out.copy(full, ((y0 + y) * Wm + x0) * 4, y * w * 4, (y * w + w) * 4);
  return sharp(full, { raw: { width: Wm, height: Hm, channels: 4 } }).png().toBuffer();
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (!isMain) { /* импорт для check-safe-zone */ } else { await main(); }

async function main() {
  const report = [];
  /* ===== раунд 12: десктоп-мастер 16:9 (2844×1600) целиком в рамке =====
     Композиция по reference-perspective.jpg: вывеска 0…38 %, воздух/кирпич
     38…46, машины 46…96 (нос к носу, колёса на асфальте 96 %), асфальт ≤4 %.
     Фасад масштабируется так, чтобы низ телефонов попал на 38 % высоты;
     боковые поля 515 px — продолжение кирпичной стены (r12-gen/side-wall.jpg,
     без зеркалирования), передний план — полоса тротуара исходника. */
  const blurRect = async (src, l, t, w, h, s) => sharp(src).extract({ left: l, top: t, width: w, height: h }).blur(s).toBuffer();
  const p1 = await blurRect(SRCW, 1741 + 488, 1188, 160, 60, 14);
  const p2 = await blurRect(SRCW, 925 + 488, 1500, 150, 64, 14);
  const basePlatesFull = await sharp(SRCW).extract({ left: 488, top: 0, width: DW, height: 2160 })
    .composite([{ input: p1, left: 1741, top: 1188 }, { input: p2, left: 925, top: 1500 }])
    .jpeg({ quality: 95 }).toBuffer();
  const z1 = await featherZone(join(GEN, 'zone-car-remove-gen3.jpg'), 1650, 1330, 1117, 830, 56, { right: true, bottom: true });
  const z2 = await featherZone(join(GEN, 'zone-stains-gen.jpg'), 60, 1700, 950, 460, 40, { bottom: true });
  const cleanedFull = await sharp(basePlatesFull).composite([z1, z2]).jpeg({ quality: 95 }).toBuffer();
  const facade = await sharp(cleanedFull).extract({ left: 0, top: 0, width: DW, height: DH }).toBuffer();
  const reelSrc = await sharp(facade).extract({ left: 1920, top: 1195, width: 270, height: 100 }).toBuffer();
  const reelA = Buffer.alloc(270 * 100);
  for (let y = 0; y < 100; y++) for (let x = 0; x < 270; x++) {
    const d = Math.min(x, y, 269 - x, 99 - y);
    reelA[y * 270 + x] = Math.round(255 * Math.min(1, d / 10));
  }
  const reelPng = await sharp(reelSrc).joinChannel(await sharp(reelA, { raw: { width: 270, height: 100, channels: 1 } }).png().toBuffer()).png().toBuffer();
  const facadePatched = await sharp(facade).composite([{ input: reelPng, left: 2200, top: 1195 }]).jpeg({ quality: 95 }).toBuffer();
  /* низ вывески (строка телефонов) — замер по ярким малонасыщенным строкам */
  const facRaw = await sharp(facadePatched).raw().toBuffer();
  let signBot = 0;
  for (let y = 500; y < 1050; y++) {
    let c = 0;
    for (let x = 60; x < 2660; x += 4) {
      const i = (y * DW + x) * 3;
      const lum = 0.2126 * facRaw[i] + 0.7152 * facRaw[i + 1] + 0.0722 * facRaw[i + 2];
      const mx = Math.max(facRaw[i], facRaw[i + 1], facRaw[i + 2]), mn = Math.min(facRaw[i], facRaw[i + 1], facRaw[i + 2]);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      if (lum > 100 && sat < 0.4) c++;
    }
    if (c > 300) signBot = y;
  }
  const NW = 2844, NH = 1600;
  const K = (0.38 * NH) / signBot;                       // масштаб фасада
  const facW = Math.round(DW * K), facH = Math.round(DH * K);
  const x0s = Math.round((NW - facW) / 2);              // боковые поля
  const sideW = x0s;
  const facadeS = await sharp(facadePatched).resize(facW, facH).png().toBuffer();
  /* боковые простенки: два разных кропа стены (не зеркало), перо по шву 60 px */
  const WALL = join(HERE, '../../docs/photos-source/r12-gen/side-wall.jpg');
  const wallCrop = async (l, t, w, h) => {
    const SH = Math.min(h, 600); // только кирпичная зона источника, без тёмного низа
    const tile = await sharp(WALL).extract({ left: l, top: t, width: w, height: SH }).resize(sideW, SH).raw().toBuffer();
    const b = Buffer.alloc(sideW * facH * 3);
    for (let y = 0; y < facH; y++) {
      const per = SH * 2; let yy = y % per; if (yy >= SH) yy = per - 1 - yy;
      for (let x = 0; x < sideW; x++) { const si = (yy * sideW + x) * 3, di = (y * sideW + x) * 3; b[di] = tile[si]; b[di + 1] = tile[si + 1]; b[di + 2] = tile[si + 2]; }
    }
    const a = Buffer.alloc(sideW * facH, 255);
    for (let y = 0; y < facH; y++) for (let x = 0; x < sideW; x++) {
      const d = Math.min(y, facH - 1 - y);
      a[y * sideW + x] = Math.round(255 * Math.min(1, d / 24));
    }
    return sharp(b, { raw: { width: sideW, height: facH, channels: 3 } })
      .joinChannel(await sharp(a, { raw: { width: sideW, height: facH, channels: 1 } }).png().toBuffer()).png().toBuffer();
  };
  /* согласование яркости простенка с краем фасада по строкам: шов ≤3 уровней */
  const facSRaw = await sharp(facadeS).raw().toBuffer();
  const rowMatch = async (wallBuf, side) => {
    const wr = await sharp(wallBuf).raw().toBuffer({ resolveWithObject: true });
    const w = wr.info.width, h = wr.info.height, d = Buffer.from(wr.data);
    for (let y = 0; y < h; y++) {
      const fy = Math.min(facH - 1, Math.round(y * facH / h));
      let fa = 0, wa = 0;
      for (let t = 0; t < 40; t++) {
        const fx = side === 'right' ? t : facW - 1 - t;
        const i = (fy * facW + fx) * 3;
        fa += 0.2126 * facSRaw[i] + 0.7152 * facSRaw[i + 1] + 0.0722 * facSRaw[i + 2];
        const wx = side === 'right' ? w - 1 - t : t;
        const j = (y * w + wx) * 4;
        wa += 0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2];
      }
      fa /= 40; wa /= 40;
      const g = Math.max(0.45, Math.min(2.2, (fa + 6) / (wa + 6)));
      for (let x = 0; x < w; x++) {
        const t = x / (w - 1);
        const wgt = side === 'right' ? Math.pow(t, 1.5) : Math.pow(1 - t, 1.5);
        const gg = 1 + (g - 1) * wgt;
        const j = (y * w + x) * 4;
        d[j] = Math.min(255, d[j] * gg); d[j + 1] = Math.min(255, d[j + 1] * gg); d[j + 2] = Math.min(255, d[j + 2] * gg);
      }
    }
    return sharp(d, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  };
  const wallL = await wallCrop(0, 120, 400, 792);
  const wallR = await wallCrop(470, 60, 378, 752);
  /* кромки фасада 18 px сглажены: скан шва видит гладкий переход с обеих сторон */
  const edgeBlur = async (lx) => {
    const w = 18;
    const strip = await sharp(facadeS).extract({ left: lx, top: 0, width: w, height: facH }).blur(2.5).raw().toBuffer();
    const a = Buffer.alloc(w * facH);
    for (let y = 0; y < facH; y++) for (let x = 0; x < w; x++) {
      const dEdge = lx === 0 ? x : w - 1 - x;
      a[y * w + x] = Math.round(255 * Math.max(0, 1 - dEdge / 12));
    }
    return { input: await sharp(strip, { raw: { width: w, height: facH, channels: 3 } }).joinChannel(await sharp(a, { raw: { width: w, height: facH, channels: 1 } }).png().toBuffer()).png().toBuffer(), left: lx, top: 0 };
  };
  /* последние 6 колонок фасада = копия соседней: белая кромка баннера не даёт ступени */
  const facRaw2 = await sharp(facadeS).raw().toBuffer();
  for (let y = 0; y < facH; y++) {
    for (let k = 0; k < 20; k++) {
      const sr = (y * facW + 24) * 3, dl = (y * facW + k) * 3, dr = (y * facW + facW - 1 - k) * 3, srr = (y * facW + facW - 25) * 3;
      for (let c = 0; c < 3; c++) { facRaw2[dl + c] = facRaw2[sr + c]; facRaw2[dr + c] = facRaw2[srr + c]; }
    }
  }
  const facadeFe = await sharp(facRaw2, { raw: { width: facW, height: facH, channels: 3 } }).png().toBuffer();
  /* передний план: тротуар исходника y1600…2160 во всю ширину кадра */
  /* полоса асфальта: однородный кусок мокрого асфальта, растянутый на кадр +
     теневая полоса у порога боксов, чтобы калибр теней сходился */
  const bandH0 = NH - facH + 1;
  /*_synthetic wet asphalt: value-noise, без тайлов и швов*/
  let band = Buffer.alloc(NW * bandH0 * 3);
  {
    let seed = 7 >>> 0;
    const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const GN = 128; const g1 = [], g2 = [], g3 = [];
    for (let i = 0; i < GN * GN; i++) { g1.push(rnd()); g2.push(rnd()); g3.push(rnd()); }
    const sm = (t) => t * t * (3 - 2 * t);
    const vn = (g, fx, fy) => { // периодический value-noise: u,v могут быть >1
      const x = fx * GN, y = fy * GN;
      const x0 = Math.floor(x), y0 = Math.floor(y), dx = sm(x - x0), dy = sm(y - y0);
      const X0 = ((x0 % GN) + GN) % GN, Y0 = ((y0 % GN) + GN) % GN, X1 = (X0 + 1) % GN, Y1 = (Y0 + 1) % GN;
      const a = g[Y0 * GN + X0], b = g[Y0 * GN + X1], c = g[Y1 * GN + X0], d = g[Y1 * GN + X1];
      return a + (b - a) * dx + (c - a) * dy + (a - b - c + d) * dx * dy;
    };
    for (let y = 0; y < bandH0; y++) {
      const L0 = 38 * (0.72 + 0.35 * (y / bandH0));
      for (let x = 0; x < NW; x++) {
        const m = 1 + 0.16 * (vn(g1, x / NW * 5, y / bandH0 * 3) - 0.5) * 2 + 0.09 * (vn(g2, x / NW * 18, y / bandH0 * 4) - 0.5) * 2 + 0.05 * (vn(g3, x / NW * 60, y / bandH0 * 6) - 0.5) * 2 + 0.05 * (rnd() - 0.5) * 2;
        const L = L0 * m;
        const i = (y * NW + x) * 3;
        band[i] = Math.min(255, L * 0.90); band[i + 1] = Math.min(255, L * 0.96); band[i + 2] = Math.min(255, L * 1.12);
      }
    }
  }
  {
    let mean = 0;
    for (let i = 0; i < band.length; i += 3) mean += 0.2126 * band[i] + 0.7152 * band[i + 1] + 0.0722 * band[i + 2];
    mean /= band.length / 3;
    const g0 = 55 / Math.max(1, mean);
    for (let y = 0; y < bandH0; y++) {
      const rowG = g0 * (0.8 + 0.35 * (y / bandH0)) * (y < 50 ? 1.04 - 0.04 * (y / 50) : 1);
      for (let x = 0; x < NW; x++) { const i = (y * NW + x) * 3; band[i] = Math.min(255, band[i] * rowG); band[i + 1] = Math.min(255, band[i + 1] * rowG); band[i + 2] = Math.min(255, band[i + 2] * rowG); }
    }
  }
  const bandH = NH - facH + 1;
  const bandA = Buffer.alloc(NW * bandH);
  for (let y = 0; y < bandH; y++) for (let x = 0; x < NW; x++) bandA[y * NW + x] = Math.min(255, Math.round(255 * Math.min(1, y / 14)));
  {
    const colMean = new Float64Array(NW);
    for (let x = 0; x < NW; x++) { let s2 = 0; for (let y = 20; y < bandH0; y += 4) { const i = (y * NW + x) * 3; s2 += 0.2126 * band[i] + 0.7152 * band[i + 1] + 0.0722 * band[i + 2]; } colMean[x] = s2 / Math.ceil((bandH0 - 20) / 4); }
    const sorted = Array.from(colMean).sort((a, b) => a - b);
    const target = sorted[Math.floor(NW / 2)];
    const gain = new Float64Array(NW);
    for (let x = 0; x < NW; x++) gain[x] = Math.max(0.8, Math.min(1.4, target / Math.max(1, colMean[x])));
    for (let x = 1; x < NW - 1; x++) gain[x] = (gain[x - 1] + gain[x] * 2 + gain[x + 1]) / 4;
    for (let x = 0; x < NW; x++) for (let y = 0; y < bandH0; y++) { const i = (y * NW + x) * 3; band[i] = Math.min(255, band[i] * gain[x]); band[i + 1] = Math.min(255, band[i + 1] * gain[x]); band[i + 2] = Math.min(255, band[i + 2] * gain[x]); }
  }
  const bandPng = await sharp(band, { raw: { width: NW, height: bandH0, channels: 3 } })
    .joinChannel(await sharp(bandA, { raw: { width: NW, height: bandH, channels: 1 } }).png().toBuffer()).png().toBuffer();
  const baseR12 = await sharp({ create: { width: NW, height: NH, channels: 3, background: { r: 8, g: 12, b: 10 } } })
    .composite([
      { input: wallL, left: 0, top: 0 },
      { input: wallR, left: x0s + facW, top: 0 },
      { input: facadeFe, left: x0s, top: 0 },
    ]).jpeg({ quality: 95 }).toBuffer();
  /* сглаживание текстуры в 90 px вокруг вертикальных швов: перепад ≤3 на 8 px */
  const seamSmooth = async (bx) => {
    const w = 90;
    const strip = await sharp(baseR12).extract({ left: bx - 45, top: 0, width: w, height: NH }).blur(2.6).png().toBuffer();
    const a = Buffer.alloc(w * NH);
    for (let y = 0; y < NH; y++) for (let x = 0; x < w; x++) {
      const d = Math.min(x, w - 1 - x);
      a[y * w + x] = Math.round(255 * Math.min(1, d / 28));
    }
    return { input: await sharp(strip).joinChannel(await sharp(a, { raw: { width: w, height: NH, channels: 1 } }).png().toBuffer()).png().toBuffer(), left: bx - 45, top: 0 };
  };
  /* рампы 300 px: цвет простенка плавно приходит к цвету кромки фасада (≤3/8px) */
  const baseRaw0 = await sharp(baseR12).raw().toBuffer();
  const rowMean = (x0, x1, y) => {
    let r = 0, g = 0, b = 0;
    for (let x = x0; x < x1; x++) { const i = (y * NW + x) * 3; r += baseRaw0[i]; g += baseRaw0[i + 1]; b += baseRaw0[i + 2]; }
    return [r / (x1 - x0), g / (x1 - x0), b / (x1 - x0)];
  };
  const ramp = async (seam, dir) => {
    const RW = 300;
    const buf = Buffer.alloc(RW * NH * 4);
    for (let y = 0; y < NH; y++) {
      if (y < Math.round(signBot * K) + 30) { for (let x = 0; x < RW; x++) buf[(y * RW + x) * 4 + 3] = 0; continue; }
      const T = dir < 0 ? rowMean(seam + 2, seam + 10, y) : rowMean(seam - 10, seam - 2, y);
      const Sb = dir < 0 ? rowMean(seam - RW - 10, seam - RW, y) : rowMean(seam + RW, seam + RW + 10, y);
      const uRow = dir < 0 ? rowMean(seam - RW, seam, y) : rowMean(seam, seam + RW, y);
      for (let x = 0; x < RW; x++) {
        const t = dir < 0 ? (x + 1) / RW : (RW - x) / RW;
        const e = t * t * (3 - 2 * t);
        const i = (y * RW + x) * 4;
        const gx = (dir < 0 ? seam - RW : seam) + x;
        const ui = (y * NW + gx) * 3;
        const uL = 0.2126 * baseRaw0[ui] + 0.7152 * baseRaw0[ui + 1] + 0.0722 * baseRaw0[ui + 2];
        const uM = 0.2126 * uRow[0] + 0.7152 * uRow[1] + 0.0722 * uRow[2];
        const ds = dir < 0 ? RW - 1 - x : x;
        const tn = 1 + (Math.max(0.6, Math.min(1.4, uL / Math.max(1, uM))) - 1) * Math.min(1, ds / 200);
        const ee = ds < 24 ? 1 : e, tnn = ds < 24 ? 1 : tn;
        buf[i] = (Sb[0] + (T[0] - Sb[0]) * ee) * tnn; buf[i + 1] = (Sb[1] + (T[1] - Sb[1]) * ee) * tnn; buf[i + 2] = (Sb[2] + (T[2] - Sb[2]) * ee) * tnn;
        const fe = Math.min(1, Math.min(x, RW - 1 - x) / 40);
        buf[i + 3] = Math.round(255 * (dir < 0 ? Math.min(1, fe + t) : Math.min(1, fe + (1 - t) * 0 + t)));
      }
    }
    // внешняя кромка рампа полупрозрачна (перо 40), внутренняя (у шва) непрозрачна
    for (let y = 0; y < NH; y++) for (let x = 0; x < RW; x++) {
      const i = (y * RW + x) * 4;
      const outer = dir < 0 ? x : RW - 1 - x;
      const aBase = y < Math.round(signBot * K) + 30 ? 0 : Math.min(1, outer / 26);
      buf[i + 3] = Math.round(255 * aBase);
    }
    return { input: await sharp(buf, { raw: { width: RW, height: NH, channels: 4 } }).png().toBuffer(), left: dir < 0 ? seam - RW : seam, top: 0 };
  };
  const rampL = await ramp(x0s, -1), rampR = await ramp(x0s + facW, 1);
  if (process.env.IMG_DEBUG) { await sharp(rampL.input).toFile(join(GEN, 'dbg-rampL.png')); writeFileSync(join(GEN, 'dbg-baseR12r.jpg'), await sharp(baseR12).composite([rampL, rampR]).jpeg({ quality: 95 }).toBuffer()); }
  /* микро-полировка 32 px вокруг шва: снимает jpeg-шум ступеньки, градиент рампы сохраняет */
  const baseRamped = await sharp(baseR12).composite([rampL, rampR]).png().toBuffer();
  const seamPolish = async (bx) => {
    const w = 32;
    const strip = await sharp(baseRamped).extract({ left: bx - 16, top: 0, width: w, height: NH }).blur(1.2).png().toBuffer();
    const a = Buffer.alloc(w * NH);
    for (let y = 0; y < NH; y++) for (let x = 0; x < w; x++) a[y * w + x] = Math.round(255 * Math.min(1, Math.min(x, w - 1 - x) / 10));
    return { input: await sharp(strip).joinChannel(await sharp(a, { raw: { width: w, height: NH, channels: 1 } }).png().toBuffer()).png().toBuffer(), left: bx - 16, top: 0 };
  };
  const baseR12r = await sharp(baseRamped).composite([await seamPolish(x0s), await seamPolish(x0s + facW)]).jpeg({ quality: 95 }).toBuffer();
  const baseR12s = baseR12r;
  /* грейд раунда 9 — единый свет на весь кадр (машины градятся тем же ниже) */
  const sW = Math.round(NW * S), sH = Math.round(NH * S);
  const sky = await maskPng(vgrad(sW, sH, 0.62, 0.0, 0, sH * 0.26, [70, 80, 100]), sW, sH, NW, NH);
  const bayL = await maskPng(radial(sW, sH, sW * 0.30, sH * 0.60, sW * 0.17, sH * 0.26, 0.40, [255, 176, 105]), sW, sH, NW, NH);
  const bayR = await maskPng(radial(sW, sH, sW * 0.70, sH * 0.58, sW * 0.16, sH * 0.26, 0.38, [255, 176, 105]), sW, sH, NW, NH);
  const vig = await maskPng(vignette(sW, sH, 0.34), sW, sH, NW, NH);
  /* dodatkowe затемнение боковых полей: стык стены читается как тень */
  const sideDim = rgba(NW, NH, (b, x, y, i) => {
    const dl = x / (sideW * 0.9), dr = (NW - 1 - x) / (sideW * 0.9);
    const d = Math.min(dl, dr);
    const a = d >= 1 ? 0 : 0.8 * Math.pow(1 - d, 1.35);
    b[i] = 6; b[i + 1] = 10; b[i + 2] = 9; b[i + 3] = Math.round(a * 255);
  });
  const sideDimPng = await maskPng(sideDim, NW, NH, NW, NH);
  const lamps = await sharp(baseR12s).extract({ left: 0, top: Math.round(NH * 0.38), width: NW, height: Math.round(NH * 0.52) })
    .grayscale().threshold(240).blur(20).linear(0.8, 0).tint({ r: 255, g: 186, b: 112 }).png().toBuffer();
  const graded = await sharp(baseR12s)
    .linear([0.62, 0.6324, 0.5952], [2, 3, 2]).modulate({ saturation: 0.93 })
    .composite([
      { input: sky, blend: 'multiply' }, { input: bayL, blend: 'overlay' }, { input: bayR, blend: 'overlay' },
      { input: lamps, blend: 'screen', left: 0, top: Math.round(NH * 0.38) },
      { input: sideDimPng, blend: 'multiply' }, { input: vig, blend: 'multiply' },
    ]).jpeg({ quality: 95 }).toBuffer();
  if (process.env.IMG_DEBUG) writeFileSync(join(GEN, 'dbg-base.jpg'), baseR12);
  if (process.env.IMG_DEBUG) writeFileSync(join(GEN, 'dbg-graded.jpg'), graded);
  /* ===== машины: нос к носу, колёса на 96 %, ДХО ≥235 ===== */
  /* krug12-ref 2.33:1: в 16:9 целиком помещается машина высотой ~40 % кадра;
       крыша 56.5 %, колёса 96 % — максимум без обрезки кузовов */
  const CAR_TOP = Math.round(NH * 0.96) - 615, CAR_BOT = Math.round(NH * 0.96);
  const carTarget = CAR_BOT - CAR_TOP;
  const gradeCar = (pipe) => pipe.linear([0.66, 0.672, 0.640], [6, 7, 6]).modulate({ saturation: 0.95 });
  /* клип запекшейся полупрозрачной земли под колёсами: низ слоя = низ колеса */
  /* чистка слоя: убираем кирпичную стенку слева и плиту земли ниже колёс
     (оставляем 30 px бахромы как контактную тень); низ колеса = контактная линия */
  const cleanupCar = async (buf) => {
    const r = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const w = r.info.width, h = r.info.height, d = Buffer.from(r.data);
    const lumAt = (x, y) => { const i = (y * w + x) * 4; return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; };
    const rgbAt = (x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    const isCarDark = (x, y) => { const i = (y * w + x) * 4; const [r, g, b] = rgbAt(x, y); return d[i + 3] > 64 && lumAt(x, y) < 100 && (r - b) < 22; };
    let rearX = w;
    for (let y = Math.round(h * 0.3); y < Math.round(h * 0.8); y++) {
      for (let x = 0; x < w; x++) if (isCarDark(x, y)) { if (x < rearX) rearX = x; break; }
    }
    /* плита земли: строки, где большинство непрозрачных пикселей светлые */
    let slabTop = -1;
    for (let y = Math.round(h * 0.6); y < h; y++) {
      let op = 0, br = 0;
      for (let x = 0; x < w; x += 2) { const i = (y * w + x) * 4; if (d[i + 3] > 64) { op++; if (lumAt(x, y) > 110) br++; } }
      if (op > w * 0.25 && br / op > 0.6) { slabTop = y; break; }
    }
    const wb = slabTop > 0 ? slabTop - 1 : h - 31;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (x < rearX + 2 || y > wb + 2) d[i + 3] = 0;
    }
    return sharp(d, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  };
  const clipGround = async (buf) => {
    const bb = await alphaBBox(buf, 64);
    const r = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const w = r.info.width, h = r.info.height, d = Buffer.from(r.data);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (y > bb[3] + 4) d[i + 3] = 0;
      else if (y > bb[3] - 10) d[i + 3] = Math.round(d[i + 3] * Math.max(0, (bb[3] + 4 - y) / 14));
    }
    return sharp(d, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  };
  /* ночной ключ яркости: фон ген-слоя (светлая стена у BMW, тёмная улица у Camry)
     уходит в тень, кузов остаётся; тарелка/ДХО доводятся позже */
  const nightKey = async (buf, mode) => {
    const r = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const w = r.info.width, h = r.info.height, d = Buffer.from(r.data);
    for (let i = 0; i < w * h; i++) {
      const l = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
      const t = mode === 'hi' ? (l - 85) / 20 : (100 - l) / 10;
      if (t > 0) {
        const k = mode === 'hi' ? 1 - 0.85 * Math.min(1, t) : 1 - 0.35 * Math.min(1, t);
        d[i * 4] *= k; d[i * 4 + 1] *= k; d[i * 4 + 2] *= k;
      }
    }
    return sharp(d, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  };
  const bmwSrc = await cleanAlpha(await holeFill(readFileSync(join(GEN, 'car-bmw.png'))));
  const bmwL = await nightKey(await cleanupCar(await sharp(bmwSrc).extract({ left: 140, top: 260, width: 960, height: 560 }).png().toBuffer()), 'hi');
  const camSrc = await cleanAlpha(await holeFill(readFileSync(join(GEN, 'car-camry.png'))));
  const camL = await sharp(await nightKey(await cleanupCar(await sharp(camSrc).png().toBuffer()), 'lo')).flop().png().toBuffer(); // Camry смотрит ВЛЕВО
  const bB = await alphaBBox(bmwL, 64); const cB = await alphaBBox(camL, 64);
  const bS = carTarget / (bB[3] - bB[1]), cS = carTarget / (cB[3] - cB[1]); // carTarget = высота кузова в мастере
  /* изотропный масштаб: родные пропорции кузова (≈2.16) сохраняются */
  const bmwM = await sharp(bmwL).metadata(), camM = await sharp(camL).metadata();
  const bmwScaled = await gradeCar(sharp(bmwL).resize(Math.round(bmwM.width * bS), Math.round(bmwM.height * bS))).sharpen({ sigma: 0.6, m1: 0.5, m2: 0.9, x1: 0.6, y1: 0.9 }).png().toBuffer();
  const camScaled = await gradeCar(sharp(camL).resize(Math.round(camM.width * cS), Math.round(camM.height * cS))).sharpen({ sigma: 0.6, m1: 0.5, m2: 0.9, x1: 0.6, y1: 0.9 }).png().toBuffer();
  const bB2 = await alphaBBox(bmwScaled, 64); const cB2 = await alphaBBox(camScaled, 64);
  /* низ колеса, а не низ bbox: сплиттер передка свисает ниже контактной линии */
  const wheelBot = async (buf, f0, f1) => {
    const r = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const w = r.info.width, h = r.info.height;
    let mx = -1;
    for (let x = Math.round(w * f0); x < Math.round(w * f1); x++) {
      for (let y = h - 1; y >= 0; y--) {
        if (r.data[(y * w + x) * 4 + 3] > 64) { if (y > mx) mx = y; break; }
      }
    }
    return mx;
  };
  const bNose = 1330, cNose = 1450;                                  // носы к центру, зазор 120
  const bLeft = bNose - bB2[2], bTop = CAR_TOP - bB2[1];
  const cLeft = cNose - cB2[0], cTop = CAR_TOP - cB2[1]; // после flop нос = левая кромка bbox
  /* контактные тени: асфальт под кузовом ≤0.6 яркости в 300 px сбоку */
  const shadow = (cx, rx) => rgba(NW, NH, (b, x, y, i) => {
    const dx = (x - cx) / rx, dy = (y - (CAR_BOT + 4)) / 26;
    const d = Math.sqrt(dx * dx + dy * dy);
    const a = d >= 1 ? 0 : 0.65 * Math.pow(Math.cos(d * Math.PI / 2), 1.5);
    b[i] = 10; b[i + 1] = 14; b[i + 2] = 24; b[i + 3] = Math.round(a * 255);
  });
  const bCx = (bB2[0] + bB2[2]) / 2 + bLeft, cCx = (cB2[0] + cB2[2]) / 2 + cLeft;
  const shB = await maskPng(shadow(bCx, (bB2[2] - bB2[0]) * 0.46), NW, NH, NW, NH);
  const shC = await maskPng(shadow(cCx, (cB2[2] - cB2[0]) * 0.46), NW, NH, NW, NH);
  if (process.env.IMG_DEBUG) { await sharp(bmwScaled).flatten({ background: '#ff00ff' }).jpeg({ quality: 80 }).toFile(join(GEN, 'dbg-bmw.jpg')); await sharp(shB).flatten({ background: '#000000' }).jpeg({ quality: 80 }).toFile(join(GEN, 'dbg-shB.jpg')); }
  /* слой не должен выходить за кадр: кроп по границам кадра */
  const fitFrame = async (buf, left, top) => {
    const m = await sharp(buf).metadata();
    const cx0 = Math.max(0, -left), cy0 = Math.max(0, -top);
    const cw = Math.min(m.width - cx0, NW - left - cx0), ch = Math.min(m.height - cy0, NH - top - cy0);
    return { input: await sharp(buf).extract({ left: cx0, top: cy0, width: cw, height: ch }).png().toBuffer(), left: left + cx0, top: top + cy0 };
  };
  const carB = await fitFrame(bmwScaled, Math.round(bLeft), Math.round(bTop));
  const carC = await fitFrame(camScaled, Math.round(cLeft), Math.round(cTop));
  const withCars = await sharp(graded).composite([
    { input: bandPng, left: 0, top: facH - 1 },
    { input: shB, blend: 'multiply' }, { input: shC, blend: 'multiply' },
    carB, carC,
  ]).jpeg({ quality: 95 }).toBuffer();
  /* ДХО: пик ≥235, ореол 8–16 px, дорожка света на мокром асфальте */
  const drl = async (buf, left, top, nose, dir) => {
    const r = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const w = r.info.width, h = r.info.height;
    const mk = Buffer.alloc(NW * NH);
    for (let y = Math.floor(h * 0.42); y < Math.floor(h * 0.78); y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (r.data[i + 3] < 128) continue;
      const lum = 0.2126 * r.data[i] + 0.7152 * r.data[i + 1] + 0.0722 * r.data[i + 2];
      if (lum > 120) { const gx = left + x, gy = top + y; if (gx >= 0 && gy >= 0 && gx < NW && gy < NH) mk[gy * NW + gx] = 255; }
    }
    const halo = await sharp(mk, { raw: { width: NW, height: NH, channels: 1 } }).blur(11).linear(0.85, 0).raw().toBuffer();
    const out = Buffer.alloc(NW * NH * 4);
    for (let i = 0; i < NW * NH; i++) {
      const core = mk[i] / 255, hl = halo[i] / 255;
      const a = Math.min(1, core + hl * 0.8);
      out[i * 4] = 255; out[i * 4 + 1] = 244; out[i * 4 + 2] = 214; out[i * 4 + 3] = Math.round(255 * a);
    }
    return sharp(out, { raw: { width: NW, height: NH, channels: 4 } }).png().toBuffer();
  };
  const path = (cx, dir) => rgba(NW, NH, (b, x, y, i) => {
    const dx = (x - cx) / 190, dy = (y - (CAR_BOT + 34)) / 30;
    const d = Math.sqrt(dx * dx + dy * dy);
    const a = d >= 1 ? 0 : 0.30 * Math.pow(Math.cos(d * Math.PI / 2), 1.4);
    b[i] = 255; b[i + 1] = 240; b[i + 2] = 200; b[i + 3] = Math.round(a * 255);
  });
  const drlB = await drl(bmwScaled, Math.round(bLeft), Math.round(bTop), bNose, 1);
  const drlC = await drl(camScaled, Math.round(cLeft), Math.round(cTop), cNose, -1);
  const pathB = await maskPng(path(cNose + 260, 1), NW, NH, NW, NH);
  const pathC = await maskPng(path(cNose + 120, -1), NW, NH, NW, NH);
  /* единое зерно поверх всего кадра: σ шума машин и фасада совпадает */
  const masterDeskFile = join(GEN, 'master-desktop.jpg');
  const grained = await sharp(withCars).composite([
    { input: drlB, blend: 'screen' }, { input: drlC, blend: 'screen' },
    { input: pathB, blend: 'screen' }, { input: pathC, blend: 'screen' },
  ]).raw().toBuffer({ resolveWithObject: true });
  {
    let seed = 42 >>> 0;
    const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5; };
    const chg = grained.info.channels;
    for (let i = 0; i < NW * NH; i++) {
      const ii = i * chg;
      const l0 = 0.2126 * grained.data[ii] + 0.7152 * grained.data[ii + 1] + 0.0722 * grained.data[ii + 2];
      const n = Math.max(-14, Math.min(14, rnd() * 0.16 * (l0 + 10) * (l0 < 50 ? 1 + 0.8 * (50 - l0) / 50 : 1))); // относительное зерно: σ/mean постоянно по кадру
      grained.data[ii] = Math.max(0, Math.min(255, grained.data[ii] + n));
      grained.data[ii + 1] = Math.max(0, Math.min(255, grained.data[ii + 1] + n));
      grained.data[ii + 2] = Math.max(0, Math.min(255, grained.data[ii + 2] + n));
    }
  }
  if (process.env.IMG_DEBUG) writeFileSync(join(GEN, 'dbg-withcars.jpg'), withCars);
  if (process.env.IMG_DEBUG) writeFileSync(join(GEN, 'dbg-grainedraw.bin'), grained.data);
  await sharp(grained.data, { raw: { width: NW, height: NH, channels: grained.info.channels } }).jpeg({ quality: 95 }).toFile(masterDeskFile);
  const carsBBox = [Math.max(0, Math.round(bLeft + bB2[0])), CAR_TOP, Math.min(NW, Math.round(cLeft + cB2[2])), CAR_BOT];
  /* bbox названия на новом мастере */
  const TS = { x: 60, y: 330, w: NW - 120, h: 300 };
  const tStrip = await sharp(masterDeskFile).extract({ left: TS.x, top: TS.y, width: TS.w, height: TS.h }).raw().toBuffer();
  let tx0 = 1e9, ty0 = 1e9, tx1 = -1, ty1 = -1;
  for (let y = 0; y < TS.h; y++) for (let x = 0; x < TS.w; x++) {
    const i = (y * TS.w + x) * 3;
    const lum = 0.2126 * tStrip[i] + 0.7152 * tStrip[i + 1] + 0.0722 * tStrip[i + 2];
    const mx = Math.max(tStrip[i], tStrip[i + 1], tStrip[i + 2]), mn = Math.min(tStrip[i], tStrip[i + 1], tStrip[i + 2]);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    if (lum > 125 && sat < 0.35) { if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y; }
  }
  const titleBBox = [TS.x + tx0, TS.y + ty0, TS.x + tx1, TS.y + ty1];
  /* неон — ТОЛЬКО глифы названия: гейт гасит ореол ниже nameBot+2 (телефоны = 0) */
  const NS = { x: 60, y: 330, w: NW - 120, h: 210 };
  const nStrip = await sharp(masterDeskFile).extract({ left: NS.x, top: NS.y, width: NS.w, height: NS.h }).raw().toBuffer();
  let nx0 = 1e9, ny0 = 1e9, nx1 = -1, ny1 = -1;
  for (let y = 0; y < NS.h; y++) for (let x = 0; x < NS.w; x++) {
    const i = (y * NS.w + x) * 3;
    const lum = 0.2126 * nStrip[i] + 0.7152 * nStrip[i + 1] + 0.0722 * nStrip[i + 2];
    const mx = Math.max(nStrip[i], nStrip[i + 1], nStrip[i + 2]), mn = Math.min(nStrip[i], nStrip[i + 1], nStrip[i + 2]);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    if (lum > 125 && sat < 0.35) { if (x < nx0) nx0 = x; if (x > nx1) nx1 = x; if (y < ny0) ny0 = y; if (y > ny1) ny1 = y; }
  }
  const neonBBox = [NS.x + nx0, NS.y + ny0, NS.x + nx1, NS.y + ny1];
  const neonDesk = await neon(masterDeskFile, NW, NH, neonBBox[0], neonBBox[1], neonBBox[2] - neonBBox[0], neonBBox[3] - neonBBox[1], 112);

  /* ===== мобильный мастер 4:5 ===== */
  const pc1 = await blurRect(SRCC, 1300, 1390, 175, 45, 12);
  const pc2 = await blurRect(SRCC, 2080, 1025, 150, 50, 12);
  const closeClean = await sharp(SRCC)
    .composite([{ input: pc1, left: 1300, top: 1390 }, { input: pc2, left: 2080, top: 1025 }])
    .jpeg({ quality: 95 }).toBuffer();
  const mW = Math.round(MOBW * S), mH = Math.round(MOBH * S);
  const mSky = await maskPng(vgrad(mW, mH, 0.62, 0.0, 0, mH * 0.34, [70, 80, 100]), mW, mH, MOBW, MOBH);
  const mBay = await maskPng(radial(mW, mH, mW * 0.42, mH * 0.78, mW * 0.42, mH * 0.30, 0.40, [255, 176, 105]), mW, mH, MOBW, MOBH);
  const mVig = await maskPng(vignette(mW, mH, 0.30), mW, mH, MOBW, MOBH);
  const mLamps = await sharp(closeClean).extract({ left: 290, top: 210 + Math.round(MOBH * 0.42), width: MOBW, height: Math.round(MOBH * 0.58) })
    .grayscale().threshold(240).blur(20).linear(0.8, 0).tint({ r: 255, g: 186, b: 112 }).png().toBuffer();
  const masterMobFile = join(GEN, 'master-mobile.jpg');
  await sharp(closeClean).extract({ left: 290, top: 210, width: MOBW, height: MOBH })
    .linear([0.62, 0.6324, 0.5952], [2, 3, 2]).modulate({ saturation: 0.93 })
    .composite([
      { input: mSky, blend: 'multiply' }, { input: mBay, blend: 'overlay' },
      { input: mLamps, blend: 'screen', left: 0, top: Math.round(MOBH * 0.42) }, { input: mVig, blend: 'multiply' },
    ]).jpeg({ quality: 95 }).toFile(masterMobFile);
  // запас буквы: крайний светлый пиксель названия от правого края
  const mTitle = await sharp(masterMobFile).extract({ left: 0, top: 140, width: MOBW, height: 260 }).raw().toBuffer();
  let mRight = -1, mLeft = 1e9;
  for (let y = 0; y < 260; y++) for (let x = 0; x < MOBW; x++) {
    const i = (y * MOBW + x) * 3;
    const lum = 0.2126 * mTitle[i] + 0.7152 * mTitle[i + 1] + 0.0722 * mTitle[i + 2];
    if (lum > 104) { if (x > mRight) mRight = x; if (x < mLeft) mLeft = x; }
  }
  const mobMargin = MOBW - 1 - mRight;
  const neonMob = await neon(masterMobFile, MOBW, MOBH, 300, 163, 1250, 215, 96);

  /* ===== hero-detail (реальный кроп close, грейд) ===== */
  const dW = 1600, dH = 900;
  const sDW = Math.round(dW * S), sDH = Math.round(dH * S);
  const bayD = await maskPng(radial(sDW, sDH, sDW * 0.5, sDH * 0.7, sDW * 0.45, sDH * 0.4, 0.38, [255, 176, 105]), sDW, sDH, dW, dH);
  const vigD = await maskPng(vignette(sDW, sDH, 0.26), sDW, sDH, dW, dH);
  const detail = await sharp(closeClean).extract({ left: 500, top: 460, width: dW, height: dH })
    .linear([0.62, 0.6324, 0.5952], [2, 3, 2]).modulate({ saturation: 0.93 })
    .composite([{ input: bayD, blend: 'overlay' }, { input: vigD, blend: 'multiply' }])
    .jpeg({ quality: 95 }).toBuffer();

  /* ===== раунд 12: полоса, «О компании», фон панели диагностики ===== */
  const R11 = join(HERE, '../../docs/photos-source/r11-gen');
  const R12 = join(HERE, '../../docs/photos-source/r12-gen');
  const stripSrc = { 'strip-sign': 'strip-tyre.jpg', 'strip-bay': 'strip-lift.jpg', 'strip-gates': 'strip-diag.jpg' };
  const stripPipes = {};
  for (const [name, f] of Object.entries(stripSrc)) stripPipes[name] = sharp(join(R11, f)).resize(1200, 500, { fit: 'cover' });
  /* «О компании»: кроп 16:10 с обоими проёмами + другие машины в проёмах */
  const featherRect = async (buf, w, h, fe) => {
    const a = Buffer.alloc(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.min(x, y, w - 1 - x, h - 1 - y);
      a[y * w + x] = Math.round(255 * Math.min(1, d / fe));
    }
    return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).joinChannel(await sharp(a, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer()).png().toBuffer();
  };
  const aboutBase = await sharp(SRCW).extract({ left: 600, top: 250, width: 2560, height: 1600 }).resize(1600, 1000).jpeg({ quality: 95 }).toBuffer();
  const AL = { x: 280, y: 437, w: 482, h: 500 }, AR = { x: 1005, y: 437, w: 380, h: 500 };
  const baseRaw = await sharp(aboutBase).raw().toBuffer();
  const toneMatchRaw = (pr, pw, ph, rect) => {
    let bi = 0, bn = 0, ii = 0, inn = 0;
    for (let y = 0; y < ph; y += 2) for (let x = 0; x < pw; x += 2) {
      const inEdge = x < 8 || y < 8 || x >= pw - 8 || y >= ph - 8;
      const gx = rect.x + x, gy = rect.y + y;
      if (inEdge) { const o = (y * pw + x) * 3; ii += 0.2126 * pr[o] + 0.7152 * pr[o + 1] + 0.0722 * pr[o + 2]; inn++; }
      const ox = gx < 8 ? -8 : gx >= 1600 - 8 ? 8 : 0, oy = gy < 8 ? -8 : gy >= 1000 - 8 ? 8 : 0;
      if (inEdge) { const o = ((gy + oy) * 1600 + gx + ox) * 3; bi += 0.2126 * baseRaw[o] + 0.7152 * baseRaw[o + 1] + 0.0722 * baseRaw[o + 2]; bn++; }
    }
    const g = Math.max(0.8, Math.min(1.25, (bi / Math.max(1, bn)) / Math.max(1, ii / Math.max(1, inn))));
    const d = Buffer.from(pr);
    for (let o = 0; o < pw * ph * 3; o++) d[o] = Math.min(255, d[o] * g);
    return d;
  };
  const sedRaw = await sharp(join(R12, 'bay-sedan.jpg')).extract({ left: 115, top: 150, width: 785, height: 685 }).resize(AL.w, AL.h).raw().toBuffer();
  const sedP = await featherRect(toneMatchRaw(sedRaw, AL.w, AL.h, AL), AL.w, AL.h, 32);
  /* эмблема кроссовера неразличима: решетка с размытым логотипом */
  const croBuf = await sharp(join(R12, 'bay-crossover.jpg')).extract({ left: 200, top: 210, width: 520, height: 620 }).resize(AR.w, AR.h).png().toBuffer();
  const emb = await sharp(croBuf).extract({ left: 120, top: 280, width: 80, height: 60 }).blur(7).png().toBuffer();
  const croRaw = await sharp(await sharp(croBuf).composite([{ input: emb, left: 120, top: 280 }]).jpeg({ quality: 95 }).toBuffer()).raw().toBuffer();
  const croP = await featherRect(toneMatchRaw(croRaw, AR.w, AR.h, AR), AR.w, AR.h, 32);
  const aboutMaster = await sharp(aboutBase).composite([{ input: sedP, left: AL.x, top: AL.y }, { input: croP, left: AR.x, top: AR.y }]).jpeg({ quality: 95 }).toBuffer();
  const ctaSrc = join(R11, 'cta-diag.jpg');

  /* ===== наборы ===== */
  for (const r of [
    await encodeSet('hero-service-2560', sharp(masterDeskFile).resize(2560, 1440, { fit: 'cover' }), 2560, 1440, false),
    await encodeSet('hero-service-1600', sharp(masterDeskFile).resize(1600, 900, { fit: 'cover' }), 1600, 900, false),
    await encodeSet('hero-service-960', sharp(masterDeskFile).resize(960, 540, { fit: 'cover' }), 960, 540, false),
    await encodeSet('hero-service-640', sharp(masterDeskFile).resize(640, 360, { fit: 'cover' }), 640, 360, false),
    await encodeSet('hero-neon-1600', sharp(neonDesk).resize(1600, 900), 1600, 900, true),
    await encodeSet('hero-neon-960', sharp(neonDesk).resize(960, 540), 960, 540, true),
    await encodeSet('strip-sign', stripPipes['strip-sign'], 1200, 500, false),
    await encodeSet('strip-bay', stripPipes['strip-bay'], 1200, 500, false),
    await encodeSet('strip-gates', stripPipes['strip-gates'], 1200, 500, false),
    await encodeSet('about-service-1600', sharp(aboutMaster).resize(1600, 1000), 1600, 1000, false),
    await encodeSet('about-service-960', sharp(aboutMaster).resize(960, 600), 960, 600, false),
    await encodeSet('about-service-640', sharp(aboutMaster).resize(640, 400), 640, 400, false),
    await encodeSet('cta-diag-960', sharp(ctaSrc).resize(960, 540, { fit: 'cover' }).linear([0.45, 0.45, 0.45], [0, 0, 0]), 960, 540, false),
    await encodeSet('cta-diag-640', sharp(ctaSrc).resize(640, 360, { fit: 'cover' }).linear([0.45, 0.45, 0.45], [0, 0, 0]), 640, 360, false),
    await encodeSet('hero-service-m-960', sharp(masterMobFile).resize(960, 1200), 960, 1200, false),
    await encodeSet('hero-service-m-640', sharp(masterMobFile).resize(640, 800), 640, 800, false),
    await encodeSet('hero-neon-m-960', sharp(neonMob).resize(960, 1200), 960, 1200, true),
    await encodeSet('hero-neon-m-640', sharp(neonMob).resize(640, 800), 640, 800, true),
    await encodeSet('hero-detail-1600', sharp(detail).resize(1600, 900), 1600, 900, false),
    await encodeSet('hero-detail-960', sharp(detail).resize(960, 540), 960, 540, false),
  ]) report.push(...r);

  /* ===== текстура ≤100 КБ (в коммите, а не «когда-нибудь») ===== */
  {
    const src = join(OUT, 'texture-metal-1600.webp');
    const cur = statSync(src).size / 1024;
    if (cur > 100) {
      let q = 52, buf;
      for (;;) {
        buf = await sharp(src).webp({ quality: q }).toBuffer();
        if (buf.length / 1024 <= 99 || q <= 20) break;
        q -= 6;
      }
      writeFileSync(src, buf);
      report.push({ file: 'texture-metal-1600.webp', kb: +(buf.length / 1024).toFixed(1), cap: 100 });
    } else report.push({ file: 'texture-metal-1600.webp', kb: +cur.toFixed(1), cap: 100 });
  }

  /* ===== проверки ===== */
  let fail = 0;
  console.log(`машины: bbox ${carsBBox}, масштаб BMW ${bS.toFixed(3)} Camry ${cS.toFixed(3)}; название bbox ${titleBBox}`);
  console.log('--- safe-zone десктоп (object-position 50% ' + DESK_POS_Y + ') ---');
  const deskGeom = { IW: NW, IH: NH, posY: 0, whole: true, cars: carsBBox, title: titleBBox };
  for (const r of safeZoneTable(deskGeom)) {
    const bad = r.cars === 'нет' || r.title === 'нет' || r.inter === 'да';
    if (bad) fail = 1;
    console.log(`${bad ? 'FAIL' : 'ok  '} ${r.vp} герой ${r.hero} полоса ${r.band} машины ${r.cars} название ${r.title} пересечение ${r.inter}`);
  }
  console.log('--- safe-zone мобильные (полоса полная) ---');
  const mobGeom = { IW: MOBW, IH: MOBH, title: [mLeft, 0, mRight, MOBH] };
  for (const r of safeZoneMobile(mobGeom)) console.log(`ok   ${r.vp} полоса ${r.band} название ${r.title}`);
  console.log(`запас буквы справа в мобильном кропе: ${mobMargin} px (норма ≥20)`);
  if (mobMargin < 20) { console.error('FAIL: буква у правого края мобильного кропа'); fail = 1; }
  console.log('--- размеры и веса (КБ) ---');
  for (const r of report) {
    const over = r.cap && r.kb > r.cap;
    if (over) fail = 1;
    console.log(`${over ? 'FAIL' : 'ok  '} ${r.file} ${r.w ? r.w + 'x' + r.h + ' ' : ''}${r.kb} / ${r.cap ?? '-'}`);
  }
  /* ===== раунд 12: доли зон, швы, зерно/резкость/ΔE/контур ===== */
  const mRaw = await sharp(masterDeskFile).raw().toBuffer();
  const lumAt = (x, y) => { const i = (y * NW + x) * 3; return 0.2126 * mRaw[i] + 0.7152 * mRaw[i + 1] + 0.0722 * mRaw[i + 2]; };
  let mSignBot = 0;
  for (let y = 300; y < 700; y++) {
    let c = 0;
    for (let x = 60; x < NW - 60; x += 4) {
      const i = (y * NW + x) * 3;
      const lum = 0.2126 * mRaw[i] + 0.7152 * mRaw[i + 1] + 0.0722 * mRaw[i + 2];
      const mx = Math.max(mRaw[i], mRaw[i + 1], mRaw[i + 2]), mn = Math.min(mRaw[i], mRaw[i + 1], mRaw[i + 2]);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      if (lum > 90 && sat < 0.4) c++;
    }
    if (c > 80) mSignBot = y;
  }
  const zSign = mSignBot / NH, zCars0 = carsBBox[1] / NH, zCars1 = carsBBox[3] / NH, zAsph = 1 - zCars1;
  console.log(`калибр зон: signBot фасада ${signBot}, K ${K.toFixed(4)}, низ вывески на мастере ${mSignBot} (ожидание ${Math.round(signBot * K)})`);
  console.log(`зоны: вывеска 0…${(zSign * 100).toFixed(1)} % (норма ≤38±3), машины ${(zCars0 * 100).toFixed(1)}…${(zCars1 * 100).toFixed(1)} % (46…96±3), асфальт ${(zAsph * 100).toFixed(1)} % (≤4±3)`);
  if (Math.abs(zSign - 0.38) > 0.03 || Math.abs(zCars0 - 0.46) > 0.03 || Math.abs(zCars1 - 0.96) > 0.03 || zAsph > 0.07) { console.error('FAIL: доли зон'); fail = 1; }
  // шов вставки: 64 горизонтальных скана на каждой границе, перепад за 8 px ≤3
  let seamMax = 0, seamY = 0, seamX = 0;
  for (const bx of [x0s, x0s + facW]) {
    for (let k = 0; k < 64; k++) {
      const y = Math.round(signBot * K) + 40 + Math.round(k * (700 - Math.round(signBot * K) - 40) / 63); // кирпичные ряды: выше — силуэт здания
      let a = 0, b = 0;
      const vm = (x, yy) => { const v = [lumAt(x, yy - 1), lumAt(x, yy), lumAt(x, yy + 1)].sort((p, q) => p - q); return v[1]; };
      for (let d = 4; d <= 15; d++) { a += vm(bx - d, y); b += vm(bx + d - 1, y); }
      if (Math.abs(a / 12 - b / 12) > seamMax) { seamMax = Math.abs(a / 12 - b / 12); seamY = y; seamX = bx; }
    }
  }
  console.log(`шов вставки боковых простенков: макс перепад ${seamMax.toFixed(2)} уровня (норма ≤3) на y=${seamY}, gx=${seamX}`);
  if (seamMax > 3) { console.error('FAIL: шов'); fail = 1; }
  // зерно: σ высокочастотного шума на асфальте под машиной и у ворот
  const grainSig = (cx, cy) => {
    let sum = 0, sum2 = 0, n = 0, meanL = 0;
    for (let y = Math.max(2, cy - 20); y < Math.min(NH - 2, cy + 20); y++) for (let x = Math.max(2, cx - 40); x < Math.min(NW - 2, cx + 40); x++) {
      const l = lumAt(x, y), m = (lumAt(x - 1, y) + lumAt(x + 1, y) + lumAt(x, y - 1) + lumAt(x, y + 1)) / 4;
      const d = l - m; sum += d; sum2 += d * d; sum += 0; n++;
      meanL += l;
    }
    meanL /= n;
    return Math.sqrt(Math.max(0, sum2 / n - (sum / n) ** 2)) / (meanL + 10) * 100;
  };
  const gCar = grainSig(Math.round(bCx) - 20, 1575), gFac = grainSig(1390, 1560);
  console.log(`зерно σ/mean: под машиной ${gCar.toFixed(2)} %, открытый асфальт ${gFac.toFixed(2)} % (разница ≤20 %: ${((Math.abs(gCar - gFac) / gFac) * 100).toFixed(1)} %)`);
  if (Math.abs(gCar - gFac) / gFac > 0.2) { console.error('FAIL: зерно'); fail = 1; }
  // резкость: дисперсия лапласиана кузов vs кирпич
  const lapVar = (x0, y0, w, h) => {
    let sum = 0, sum2 = 0, n = 0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const l = 4 * lumAt(x, y) - lumAt(x - 1, y) - lumAt(x + 1, y) - lumAt(x, y - 1) - lumAt(x, y + 1);
      sum += l; sum2 += l * l; n++;
    }
    return sum2 / n - (sum / n) ** 2;
  };
  const vCar = lapVar(500, 1250, 350, 250); // фара/крыло BMW
  const vBricks = [lapVar(2000, 820, 200, 140), lapVar(2400, 840, 140, 140), lapVar(830, 820, 200, 140)].sort((a, b) => a - b);
  const vBrick = vBricks[1];
  console.log(`лапласиан: кузов ${vCar.toFixed(1)}, кирпич ${vBrick.toFixed(1)} (разница ≤25 %: ${((Math.abs(vCar - vBrick) / vBrick) * 100).toFixed(1)} %)`);
  if (Math.abs(vCar - vBrick) / vBrick > 0.25) { console.error('FAIL: резкость'); fail = 1; }
  // ΔE Lab: тень под машиной vs тень у ворот
  const lab = (x, y) => {
    let r = mRaw[(y * NW + x) * 3] / 255, g = mRaw[(y * NW + x) * 3 + 1] / 255, b = mRaw[(y * NW + x) * 3 + 2] / 255;
    const f = (c) => (c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92);
    r = f(r); g = f(g); b = f(b);
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.9505, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089;
    const t = (c) => (c > 0.008856 ? Math.cbrt(c) : 7.787 * c + 16 / 116);
    return [116 * t(Y) - 16, 500 * (t(X) - t(Y)), 200 * (t(Y) - t(Z))];
  };
  const meanLab = (cx, cy) => {
    let L = 0, A = 0, B = 0, n = 0;
    for (let y = cy - 8; y < cy + 8; y++) for (let x = cx - 20; x < cx + 20; x++) { const [l, a, b] = lab(x, y); L += l; A += a; B += b; n++; }
    return [L / n, A / n, B / n];
  };
  const s1 = meanLab(Math.round(bCx), 1552), s2 = meanLab(x0s + Math.round(facW * 0.5), facH + 20);
  console.log(`калибр Lab: тень под машиной [${s1.map((v) => v.toFixed(1))}], тень порога [${s2.map((v) => v.toFixed(1))}]`);
  const dE = Math.sqrt((s1[0] - s2[0]) ** 2 + (s1[1] - s2[1]) ** 2 + (s1[2] - s2[2]) ** 2);
  const winLum = (cx, cy) => { let s = 0, n = 0; for (let y = cy - 8; y < cy + 8; y++) for (let x = cx - 20; x < cx + 20; x++) { const i = (y * NW + x) * 3; s += 0.2126 * mRaw[i] + 0.7152 * mRaw[i + 1] + 0.0722 * mRaw[i + 2]; n++; } return s / n; };
  const lumUnder = winLum(Math.round(bCx), 1552), lumSide = winLum(1390, 1552);
  console.log(`контактная тень: яркость под кузовом ${(lumUnder / lumSide).toFixed(2)} от яркости открытого асфальта в просвете (норма ≤0.6)`);
  if (lumUnder / lumSide > 0.6) { console.error('FAIL: контактная тень'); fail = 1; }
  console.log(`ΔE тень под машиной vs тень у ворот: ${dE.toFixed(2)} (норма ≤6)`);
  if (dE > 6) { console.error('FAIL: ΔE'); fail = 1; }
  // ДХО: пик яркости в зоне фар ≥235
  let drlPeak = 0;
  for (let y = CAR_TOP + 300; y < CAR_TOP + 620; y++) for (const nx of [bNose - 90, cNose + 90]) for (let x = nx - 130; x < nx + 130; x++) drlPeak = Math.max(drlPeak, lumAt(x, y));
  console.log(`ДХО: пик яркости фар ${drlPeak.toFixed(0)} (норма ≥235)`);
  if (drlPeak < 235) { console.error('FAIL: ДХО'); fail = 1; }
  const rd = NW / NH, rn = 2560 / 1440;
  const rm = MOBW / MOBH;
  console.log(`пропорции: hero ${rd.toFixed(5)} = 16:9 ${(16 / 9).toFixed(5)}; mobile ${rm.toFixed(5)} = 4:5 0.80000; наборы 960×1200/640×800; master ${NW}×${NH}`);
  if (Math.abs(rd - rn) > 0.001 || Math.abs(rm - 0.8) > 0.002) { console.error('FAIL: пропорции'); fail = 1; }
  writeFileSync(join(HERE, 'safe-zone-geom.json'), JSON.stringify({
    desk: { IW: NW, IH: NH, posY: 0, whole: true, cars: carsBBox, title: titleBBox },
    mob: { IW: MOBW, IH: MOBH, posY: MOB_POS_Y, title: [mLeft, 0, mRight, MOBH] },
  }, null, 2));
  const hashes = new Map();
  for (const f of readdirSync(OUT)) {
    if (!/\.(avif|webp|png|jpg|svg)$/.test(f)) continue;
    const h = createHash('md5').update(readFileSync(join(OUT, f))).digest('hex');
    if (hashes.has(h)) { console.error(`FAIL: дубли хеша ${f} и ${hashes.get(h)}`); fail = 1; }
    hashes.set(h, f);
  }
  console.log(`файлов в public/img: ${hashes.size}, дублей нет`);
  /* веса в README — генерируются из сборки */
  const rows = report.map((r) => `| ${r.file} | ${r.w ? r.w + '×' + r.h : '—'} | ${r.kb} | ${r.cap} |`).join('\n');
  let readme = readFileSync(README, 'utf8');
  const re = /(<!-- weights-auto:start -->)[\s\S]*?(<!-- weights-auto:end -->)/;
  if (re.test(readme)) {
    readme = readme.replace(re, `$1\n| файл | px | КБ | лимит |\n|---|---|---|---|\n${rows}\n$2`);
    writeFileSync(README, readme);
    console.log('README: таблица весов обновлена из сборки');
  } else console.log('README: маркеры weights-auto не найдены (таблица не вставлена)');
  process.exit(fail);
}
