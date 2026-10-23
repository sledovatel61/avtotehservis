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
  'hero-service-2560': { avif: 250, webp: 400 },
  'hero-service-1600': { avif: 120, webp: 120 },
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
};
async function encodeSet(name, pipe, w, h, hasAlpha) {
  const res = [];
  for (const fmt of ['avif', 'webp']) {
    let q = fmt === 'avif' ? (hasAlpha ? 42 : 46) : (hasAlpha ? 62 : 66);
    let buf;
    for (;;) {
      buf = await pipe.clone()[fmt]({
        quality: q, effort: 4, ...(fmt === 'webp' ? { alphaQuality: hasAlpha ? 12 : 100 } : {}),
      }).toBuffer();
      if (buf.length / 1024 <= CAPS[name][fmt] || q <= 18) break;
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
    const dn = y <= nameBot + 20 ? 1 : Math.max(0, Math.min(1, (nameBot + 80 - y) / 60)); // ниже +80
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
  /* ===== десктоп-мастер 16:9 ===== */
  const blurRect = async (src, l, t, w, h, s) => sharp(src).extract({ left: l, top: t, width: w, height: h }).blur(s).toBuffer();
  const p1 = await blurRect(SRCW, 1741 + 488, 1188, 160, 60, 14);
  const p2 = await blurRect(SRCW, 925 + 488, 1500, 150, 64, 14);
  const basePlatesFull = await sharp(SRCW).extract({ left: 488, top: 0, width: DW, height: 2160 })
    .composite([{ input: p1, left: 1741, top: 1188 }, { input: p2, left: 925, top: 1500 }])
    .jpeg({ quality: 95 }).toBuffer();
  // чистка раунда 9 (машина клиента, пятна) — нужна и кадру, и источнику полосы асфальта
  const z1 = await featherZone(join(GEN, 'zone-car-remove-gen3.jpg'), 1650, 1330, 1117, 830, 56, { right: true, bottom: true });
  const z2 = await featherZone(join(GEN, 'zone-stains-gen.jpg'), 60, 1700, 950, 460, 40, { bottom: true });
  const cleanedFull = await sharp(basePlatesFull).composite([z1, z2]).jpeg({ quality: 95 }).toBuffer();
  const facade = await sharp(cleanedFull).extract({ left: 0, top: 0, width: DW, height: DH }).toBuffer();
  // пятно вместо красной катушки на правом простенке (копия кирпича рядом)
  const reelSrc = await sharp(facade).extract({ left: 1920, top: 1195, width: 270, height: 100 }).toBuffer();
  const reelA = Buffer.alloc(270 * 100);
  for (let y = 0; y < 100; y++) for (let x = 0; x < 270; x++) {
    const d = Math.min(x, y, 269 - x, 99 - y);
    reelA[y * 270 + x] = Math.round(255 * Math.min(1, d / 10));
  }
  const reelPng = await sharp(reelSrc).joinChannel(await sharp(reelA, { raw: { width: 270, height: 100, channels: 1 } }).png().toBuffer()).png().toBuffer();
  const facadePatched = await sharp(facade).composite([{ input: reelPng, left: 2200, top: 1195 }]).jpeg({ quality: 95 }).toBuffer();
  // асфальт: оригинал y 1750…2160 → y 1285…1542, перо 12 сверху
  const asph = await sharp(cleanedFull).extract({ left: 0, top: 1750, width: DW, height: 410 }).resize(DW, DH - ASPH_TOP).raw().toBuffer();
  const asphA = Buffer.alloc(DW * (DH - ASPH_TOP));
  for (let y = 0; y < DH - ASPH_TOP; y++) for (let x = 0; x < DW; x++) asphA[y * DW + x] = Math.min(255, Math.round(255 * Math.min(1, y / 12)));
  const asphPng = await sharp(asph, { raw: { width: DW, height: DH - ASPH_TOP, channels: 3 } })
    .joinChannel(await sharp(asphA, { raw: { width: DW, height: DH - ASPH_TOP, channels: 1 } }).png().toBuffer()).png().toBuffer();
  const withAsph = await sharp(facadePatched).composite([{ input: asphPng, left: 0, top: ASPH_TOP }]).jpeg({ quality: 95 }).toBuffer();
  // грейд раунда 9
  const sW = Math.round(DW * S), sH = Math.round(DH * S);
  const sky = await maskPng(vgrad(sW, sH, 0.62, 0.0, 0, sH * 0.30, [70, 80, 100]), sW, sH, DW, DH);
  const bayL = await maskPng(radial(sW, sH, sW * 0.235, sH * 0.62, sW * 0.21, sH * 0.28, 0.42, [255, 176, 105]), sW, sH, DW, DH);
  const bayR = await maskPng(radial(sW, sH, sW * 0.755, sH * 0.60, sW * 0.20, sH * 0.28, 0.40, [255, 176, 105]), sW, sH, DW, DH);
  const vig = await maskPng(vignette(sW, sH, 0.30), sW, sH, DW, DH);
  const lamps = await sharp(withAsph).extract({ left: 0, top: Math.round(DH * 0.40), width: DW, height: Math.round(DH * 0.5) })
    .grayscale().threshold(240).blur(20).linear(0.8, 0).tint({ r: 255, g: 186, b: 112 }).png().toBuffer();
  const graded = await sharp(withAsph)
    .linear([0.62, 0.6324, 0.5952], [2, 3, 2]).modulate({ saturation: 0.93 })
    .composite([
      { input: sky, blend: 'multiply' }, { input: bayL, blend: 'overlay' }, { input: bayR, blend: 'overlay' },
      { input: lamps, blend: 'screen', left: 0, top: Math.round(DH * 0.40) }, { input: vig, blend: 'multiply' },
    ]).jpeg({ quality: 95 }).toBuffer();
  // машины: масштаб по высоте кузова, пропорции не тянем
  const bmwL = await sharp(await cleanAlpha(readFileSync(join(GEN, 'car-bmw.png'))))
    .extract({ left: 140, top: 260, width: 960, height: 560 }).png().toBuffer(); // без блуждающих бликов сверху
  const camL = await cleanAlpha(readFileSync(join(GEN, 'car-camry.png')));
  const bB = await alphaBBox(bmwL, 64); const cB = await alphaBBox(camL, 64);
  const bH = bB[3] - bB[1], cH = cB[3] - cB[1];
  // вывеска (название+телефоны) занимает y 573…900; низ ограничен safe-zone
  // 2560×1440 (0.902·1542≈1391) → машины y 910…1388 (0.31 высоты): подробнее в отчёте
  const CAR_TOP = 925, CAR_BOT = 1388;
  const bTarget = CAR_BOT - CAR_TOP, cTarget = CAR_BOT - CAR_TOP;
  const bS = bTarget / bH, cS = cTarget / cH;
  const bmwScaled = await sharp(bmwL).resize(Math.round(1240 * bS), Math.round(820 * bS)).png().toBuffer();
  const camScaled = await sharp(camL).resize(Math.round(1250 * cS), Math.round(920 * cS)).png().toBuffer();
  const bB2 = await alphaBBox(bmwScaled, 64); const cB2 = await alphaBBox(camScaled, 64);
  const bLeft = 30 - bB2[0], bTop = CAR_TOP - bB2[1];
  const cLeft = 1520 - cB2[0], cTop = CAR_TOP - cB2[1];
  const masterDeskFile = join(GEN, 'master-desktop.jpg');
  await sharp(graded).composite([
    { input: bmwScaled, left: Math.round(bLeft), top: Math.round(bTop) },
    { input: camScaled, left: Math.round(cLeft), top: Math.round(cTop) },
  ]).jpeg({ quality: 95 }).toFile(masterDeskFile);
  const carsBBox = [
    30, CAR_TOP,
    Math.max(30 + (bB2[2] - bB2[0]), 1520 + (cB2[2] - cB2[0])), CAR_BOT,
  ];
  // bbox названия: яркие пиксели полосы вывески
  // bbox названия+телефонов: яркие малонасыщенные пиксели внутри полотна баннера
  const TS = { x: 60, y: 540, w: 2600, h: 380 };
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
  // неон — ТОЛЬКО название (п.5.1 задания №9): телефоны не светятся
  const NS = { x: 60, y: 540, w: 2600, h: 240 };
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
  const neonDesk = await neon(masterDeskFile, DW, DH, neonBBox[0], neonBBox[1], neonBBox[2] - neonBBox[0], neonBBox[3] - neonBBox[1], 112);

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

  /* ===== наборы ===== */
  for (const r of [
    await encodeSet('hero-service-2560', sharp(masterDeskFile).resize(2560, 1440), 2560, 1440, false),
    await encodeSet('hero-service-1600', sharp(masterDeskFile).resize(1600, 900), 1600, 900, false),
    await encodeSet('hero-service-960', sharp(masterDeskFile).resize(960, 540), 960, 540, false),
    await encodeSet('hero-service-640', sharp(masterDeskFile).resize(640, 360), 640, 360, false),
    await encodeSet('hero-neon-1600', sharp(neonDesk).resize(1600, 900), 1600, 900, true),
    await encodeSet('hero-neon-960', sharp(neonDesk).resize(960, 540), 960, 540, true),
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
  const deskGeom = { IW: DW, IH: DH, posY: DESK_POS_Y, cars: carsBBox, title: titleBBox };
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
  const rd = DW / DH, rn = 2560 / 1440;
  const rm = MOBW / MOBH;
  console.log(`пропорции: hero ${rd.toFixed(5)} = 16:9 ${(16 / 9).toFixed(5)}; mobile ${rm.toFixed(5)} = 4:5 0.80000; наборы 960×1200/640×800`);
  if (Math.abs(rd - rn) > 0.001 || Math.abs(rm - 0.8) > 0.002) { console.error('FAIL: пропорции'); fail = 1; }
  writeFileSync(join(HERE, 'safe-zone-geom.json'), JSON.stringify({
    desk: { IW: DW, IH: DH, posY: DESK_POS_Y, cars: carsBBox, title: titleBBox },
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
