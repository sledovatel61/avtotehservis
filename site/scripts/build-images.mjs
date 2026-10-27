/* Сборщик фото раунда 14 (первый экран фоном, кадр «пусто слева / сцена справа»).
   Кадр героя: принятый заказчиком gen-hero-c.jpg (1376×768, вечер, BMW G30 + Camry XV70
   нос к носу) ДОРАБАТЫВАЕТСЯ детерминированно, без переклейки машин:
     1) левое продолжение 176 px — зеркало собственных левых колонок кадра
        (пустой мокрый асфальт в тени + зелёные отблески): зеркальный шов непрерывен;
     2) верх +55 px — тёмное небо, продолжение верхних строк кадра (градиент ×0.82→1);
     3) низ +50 px — зеркало нижних строк (мокрый асфальт с отражениями);
        итог 1552×873 = 16:9, затем ×1.662 → 2560×1440 (lanczos + лёгкий sharpen);
     4) текстовый блок NGN-стойки («АВТОСЕРВИС ЗАМЕНА МАСЛА ШИНОМОНТАЖ») генератор
        исказил — поверх кладётся блок из ОРИГИНАЛА заказчика master-clean.jpg
        (окно 340×175+1700+1265), приведённый по тону к ночной стойке, перо 4 px.
   Зоны после сборки: пусто 0…~52 % (асфальт), машины с 50.4 %, вывеска 53.7…94.1 %.
   «О компании» раунд 14: цельный кроп оригинала master-clean.jpg окно
   {380, 80, 3000×1875} → 1600×1000 БЕЗ цветокоррекции (Δ к исходнику < 12).
   Мобильный кроп 4:5: окно 1290…2442 по X мастера (обе машины + вывеска целиком/видны).
   Полоса, панель диагностики, слайды 2–3 — не трогаются (§3.6 задания №14).
   Запуск: node site/scripts/build-images.mjs */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../public/img');
const PHOTOS = join(HERE, '../../docs/photos-source');
const SRC_CLEAN = join(PHOTOS, 'r13-clean/master-clean.jpg');   // оригинал заказчика, без C4
const GEN_C = join(PHOTOS, 'r13-clean/gen-hero-c.jpg');        // принятый кадр раунда 13
const W2 = join(PHOTOS, 'r14-gen/master-wide2.jpg');           // сцена, перегенерированная вправо
const R11 = join(PHOTOS, 'r11-gen');
const GEN = join(PHOTOS, 'r9-gen');
const README = join(PHOTOS, 'README.md');

export const MOBW = 1152, MOBH = 1440;             // мобильный мастер 4:5 (кроп десктоп-мастера)
export const MOB_VIEWPORTS = [[320, 568], [360, 640], [360, 740], [390, 844], [414, 896], [430, 932]];
const MOB_POS_Y = 0.20;
const NW = 2560, NH = 1440;                        // десктоп-мастер раунда 14
/* зона текста на десктопе (рамка оверлея из задания): x 10–47 %, y 26–74 % */
export const TEXT_ZONE = [0.10, 0.26, 0.47, 0.74];

export function safeZoneTable(geom) {
  const { IW, IH, posY, whole, cars, title } = geom;
  const ROWS = [[1024, 768], [1180, 800], [1280, 800], [1366, 768], [1440, 900], [1536, 864], [1600, 900], [1920, 1080], [2560, 1440]];
  return ROWS.map(([W, H]) => {
    const heroH = Math.min(860, Math.max(560, H - 150));
    const bandH = whole ? IH : Math.round(IH * (heroH / H));
    const y0 = posY, y1 = posY + bandH;
    const carsIn = cars[1] >= y0 && cars[3] <= y1;
    const titleIn = title[1] >= y0 && title[3] <= y1;
    const inter = !(cars[0] > title[2] || title[0] > cars[2] || cars[1] > title[3] || title[1] > cars[3]);
    return { vp: `${W}×${H}`, hero: heroH, band: `${y0}…${y1}${whole ? ' (целиком)' : ''}`, cars: carsIn ? 'ok' : 'нет', title: titleIn ? 'ok' : 'нет', inter: inter ? 'да' : 'нет' };
  });
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
  'hero-service-m-960': { avif: 120, webp: 120 },
  'hero-service-m-640': { avif: 120, webp: 120 },
  'strip-sign': { avif: 60, webp: 60 },
  'strip-bay': { avif: 60, webp: 60 },
  'strip-gates': { avif: 60, webp: 60 },
  'about-service-1600': { avif: 80, webp: 160 },
  'about-service-960': { avif: 70, webp: 70 },
  'about-service-640': { avif: 70, webp: 70 },
  'cta-diag-960': { avif: 45, webp: 45 },
  'cta-diag-640': { avif: 45, webp: 45 },
  /* раунд 12, патч #62: слайды 2–3 в ровно 16:9 (кроп 0 px в рамке героя) */
  'hero-tyre-2032': { avif: 120, webp: 120 },
  'hero-tyre-1600': { avif: 70, webp: 70 },
  'hero-tyre-960': { avif: 40, webp: 40 },
  'hero-tyre-640': { avif: 25, webp: 25 },
  'hero-tools-2032': { avif: 120, webp: 120 },
  'hero-tools-1600': { avif: 70, webp: 70 },
  'hero-tools-960': { avif: 40, webp: 40 },
  'hero-tools-640': { avif: 25, webp: 25 },
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

const rawOf = async (pipe) => { const r = await pipe.raw().toBuffer({ resolveWithObject: true }); return { d: r.data, c: r.info.channels, w: r.info.width, h: r.info.height }; };
const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
/* раунд 15: детерминированный ГПСЧ (mulberry32) вместо Math.random —
   две сборки подряд обязаны давать байт-в-байт одинаковые файлы */
const mulberry32 = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/* ---------- перо + согласование тона для оверлея стойки ---------- */
async function featherRect(buf, w, h, fe) {
  const a = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.min(x, y, w - 1 - x, h - 1 - y);
    a[y * w + x] = Math.round(255 * Math.min(1, d / fe));
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } })
    .joinChannel(await sharp(a, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer()).png().toBuffer();
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (!isMain) { /* импорт для check-safe-zone */ } else { await main(); }

async function main() {
  let fail = 0;
  const report = [];
  console.log('== раунд 14: кадр героя «пусто слева / сцена справа» ==');

  /* ----- 1. вертикальные продолжения (небо сверху, асфальт снизу) ----- */
  const TOP = 55, BOT = 50, LEFT = 176;
  const w2 = await sharp(W2).raw().toBuffer({ resolveWithObject: true });
  const SW = w2.info.width, SH = w2.info.height;                 // 1376×768
  const topStrip = await sharp(W2).extract({ left: 0, top: 0, width: SW, height: 6 })
    .resize(SW, TOP, { fit: 'fill' }).blur(3).linear([0.86, 0.88, 0.90], [0, 0, 0]).raw().toBuffer();
  const botRaw = await sharp(W2).extract({ left: 0, top: SH - BOT, width: SW, height: BOT }).flip().raw().toBuffer();
  const H1 = TOP + SH + BOT;                                     // 873
  const vert = Buffer.alloc(SW * H1 * 3);
  topStrip.copy(vert, 0);
  w2.data.copy(vert, TOP * SW * 3);
  Buffer.from(botRaw).copy(vert, (TOP + SH) * SW * 3);
  const vertFile = join(PHOTOS, 'r14-gen/_vert.png');
  await sharp(vert, { raw: { width: SW, height: H1, channels: 3 } }).png().toFile(vertFile);

  /* ----- 2. левое продолжение: зеркало собственных левых колонок ----- */
  const leftBand = await sharp(vertFile).extract({ left: 0, top: 0, width: LEFT, height: H1 }).flop().raw().toBuffer();
  const W1 = LEFT + SW;                                          // 1552
  const canvas = Buffer.alloc(W1 * H1 * 3);
  Buffer.from(leftBand).copy(canvas, 0);
  for (let y = 0; y < H1; y++) Buffer.from(vert).copy(canvas, (y * W1 + LEFT) * 3, y * SW * 3, (y + 1) * SW * 3);
  /* левая пустая зона выше горизонта — глубокая тень: плавающие блики генератора
     (зелёные штрихи в «небе») гасятся градиентом ×0.30→0.80 по Y и до 1 к x 740 */
  const VOID_X = 740, VOID_Y = Math.round(H1 * 0.52);
  for (let y = 0; y < VOID_Y; y++) {
    const fy = 0.30 + 0.50 * (y / VOID_Y);
    for (let x = 0; x < VOID_X; x++) {
      const fx = x < VOID_X - 80 ? 1 : (VOID_X - x) / 80;
      const f = 1 - (1 - fy) * fx;
      const i = (y * W1 + x) * 3;
      canvas[i] = Math.round(canvas[i] * f);
      canvas[i + 1] = Math.round(canvas[i + 1] * f);
      canvas[i + 2] = Math.round(canvas[i + 2] * f);
    }
  }
  const canvasFile = join(PHOTOS, 'r14-gen/_canvas.png');
  await sharp(canvas, { raw: { width: W1, height: H1, channels: 3 } }).png().toFile(canvasFile);
  const ratio = W1 / H1;
  console.log(`холст ${W1}×${H1}, пропорция ${ratio.toFixed(5)} (16:9 = 1.77778, допуск ≤1 px: ${(Math.abs(W1 - H1 * 16 / 9)).toFixed(2)} px)`);
  if (Math.abs(W1 - H1 * 16 / 9) > 1) { console.error('FAIL: пропорция холста'); fail = 1; }

  /* ----- 3. текстовый блок NGN-стойки: перерисовка с оригинала заказчика -----
     Генератор исказил текст стойки («АВТОСВРРМС…»). Заменяем целиком: фон блока =
      медиана фона стойки по строкам рядом, буквы = маска белого текста оригинала
      master-clean.jpg (окно 330×155+1680+1295), окрашенная в цвет букв ночной стойки.
     Никакой видимой заплатки: фон берётся из самого кадра, перо 2 px по кромке. */
  const PT = { x: 1104, y: 338, w: 78, h: 54 };   // гарула bbox 1106…1179 × 340…390 (canvas), колонки стойки 1104…1187
  const cv = await sharp(canvasFile).raw().toBuffer();
  const bgRow = Buffer.alloc(PT.w * 3);
  let tR = 0, tG = 0, tB = 0, tn = 0;
  for (let y = 340; y < 391; y++) for (let x = 1106; x < 1180; x++) {
    const i = (y * W1 + x) * 3; const L = lum(cv, i);
    if (L > 140) { tR += cv[i]; tG += cv[i + 1]; tB += cv[i + 2]; tn++; }
  }
  const txtCol = [Math.round(tR / tn), Math.round(tG / tn), Math.round(tB / tn)];
  const block = Buffer.alloc(PT.w * PT.h * 4);
  const day = await sharp(SRC_CLEAN).extract({ left: 1680, top: 1295, width: 330, height: 155 })
    .resize(PT.w, PT.h, { fit: 'fill' }).raw().toBuffer();
  for (let x = 0; x < PT.w; x++) {
    const u = ((PT.y - 1) * W1 + PT.x + x) * 3, v2 = ((PT.y + PT.h + 2) * W1 + PT.x + x) * 3;
    bgRow[x * 3] = (cv[u] + cv[v2]) / 2; bgRow[x * 3 + 1] = (cv[u + 1] + cv[v2 + 1]) / 2; bgRow[x * 3 + 2] = (cv[u + 2] + cv[v2 + 2]) / 2;
  }
  const rng = mulberry32(0x9e3779b9);
  for (let y = 0; y < PT.h; y++) {
    for (let x = 0; x < PT.w; x++) {
      const bg = [bgRow[x * 3], bgRow[x * 3 + 1], bgRow[x * 3 + 2]];
      const di = (y * PT.w + x) * 3, bi = (y * PT.w + x) * 4;
      const Ld = 0.2126 * day[di] + 0.7152 * day[di + 1] + 0.0722 * day[di + 2];
      const a = Math.max(0, Math.min(1, (Ld - 120) / 40));          // маска белых букв
      const n = (rng() - 0.5) * 3;                                // лёгкий шум фона (seed)
      block[bi] = Math.round(bg[0] * (1 - a) + txtCol[0] * a + n * (1 - a));
      block[bi + 1] = Math.round(bg[1] * (1 - a) + txtCol[1] * a + n * (1 - a));
      block[bi + 2] = Math.round(bg[2] * (1 - a) + txtCol[2] * a + n * (1 - a));
      const ex = Math.min(x, PT.w - 1 - x), ey = Math.min(y, PT.h - 1 - y);
      block[bi + 3] = Math.round(255 * Math.min(1, Math.min(ex, ey) / 2));
    }
  }
  const postPng = await sharp(block, { raw: { width: PT.w, height: PT.h, channels: 4 } }).png().toBuffer();
  const withPost = join(PHOTOS, 'r14-gen/_withpost.png');
  await sharp(canvasFile).composite([{ input: postPng, left: PT.x, top: PT.y }]).png().toFile(withPost);
  console.log(`стойка: блок ${PT.w}×${PT.h} в (${PT.x},${PT.y}), цвет букв ${txtCol.join(',')}`);

  /* ----- 4. мастер 2560×1440 + резкость ----- */
  const masterDeskFile = join(PHOTOS, 'r14-gen/master-desk-2560.jpg');
  await sharp(withPost).resize(NW, NH, { fit: 'fill', kernel: 'lanczos3' })
    .sharpen({ sigma: 0.8, m1: 0.4, m2: 1.6 }).jpeg({ quality: 95 }).toFile(masterDeskFile);

  /* ----- 5. замеры зон на мастере ----- */
  const M = await sharp(masterDeskFile).raw().toBuffer({ resolveWithObject: true });
  let cx0 = 1e9, cx1 = -1, cy0 = 1e9, cy1 = -1;
  for (let y = Math.round(NH * 0.30); y < Math.round(NH * 0.62); y += 2)
    for (let x = 0; x < NW; x += 2) {
      const i = (y * NW + x) * 3; const L = lum(M.data, i);
      const mx = Math.max(M.data[i], M.data[i + 1], M.data[i + 2]), mn = Math.min(M.data[i], M.data[i + 1], M.data[i + 2]);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      if (L > 95 && sat < 0.30) { if (x < cx0) cx0 = x; if (x > cx1) cx1 = x; if (y < cy0) cy0 = y; if (y > cy1) cy1 = y; }
    }
  const carsBBox = [cx0, cy0, cx1, cy1];
  console.log(`машины: x ${cx0}…${cx1} (${(cx0 / NW * 100).toFixed(1)}–${(cx1 / NW * 100).toFixed(1)} %), y ${cy0}…${cy1} (${(cy0 / NH * 100).toFixed(1)}–${(cy1 / NH * 100).toFixed(1)} %) — норма: старт не раньше 50 %`);
  if (cx0 / NW < 0.50) { console.error('FAIL: машины начинаются раньше 50 %'); fail = 1; }
  /* чистота зоны текста: ярких пикселей (вывеска/фары) и тёплых насыщенных (кузова) нет */
  const Z = { x0: Math.round(NW * TEXT_ZONE[0]), y0: Math.round(NH * TEXT_ZONE[1]), x1: Math.round(NW * TEXT_ZONE[2]), y1: Math.round(NH * TEXT_ZONE[3]) };
  let bright = 0, warm = 0, zn = 0, zmax = 0;
  for (let y = Z.y0; y < Z.y1; y += 2) for (let x = Z.x0; x < Z.x1; x += 2) {
    const i = (y * NW + x) * 3; const L = lum(M.data, i);
    const r = M.data[i], g = M.data[i + 1], b = M.data[i + 2];
    if (L > zmax) zmax = L;
    if (L > 120) bright++;
    if (r > g + 18 && r > b + 18 && L > 60) warm++;
    zn++;
  }
  console.log(`зона текста x ${Z.x0}…${Z.x1}, y ${Z.y0}…${Z.y1}: ярких ${(bright / zn * 100).toFixed(3)} % (норма <0.1 %), тёплых ${(warm / zn * 100).toFixed(3)} % (норма <0.1 %), макс. яркость ${zmax}`);
  if (bright / zn >= 0.001 || warm / zn >= 0.001) { console.error('FAIL: зона текста не пустая'); fail = 1; }
  /* вывеска: bbox ярких бирюзовых пикселей верхней трети */
  let sx0 = 1e9, sx1 = -1, sy0 = 1e9, sy1 = -1;
  for (let y = 0; y < Math.round(NH * 0.40); y += 2) for (let x = Math.round(NW * 0.45); x < NW; x += 2) {
    const i = (y * NW + x) * 3; const L = lum(M.data, i);
    const r = M.data[i], g = M.data[i + 1], b = M.data[i + 2];
    if (L > 140 && g > r - 10 && b > r) { if (x < sx0) sx0 = x; if (x > sx1) sx1 = x; if (y < sy0) sy0 = y; if (y > sy1) sy1 = y; }
  }
  console.log(`вывеска: x ${sx0}…${sx1} (${(sx0 / NW * 100).toFixed(1)}–${(sx1 / NW * 100).toFixed(1)} %), y ${sy0}…${sy1}`);
  const titleBBox = [Z.x0, Z.y0, Z.x1, Z.y1];

  /* ----- 7. мобильный кроп 4:5 (раунд 15): холст наращён вниз на 160 px мокрого
     асфальта (зеркало нижних строк), окно 1280×1600 с x 1268 — обе машины целиком
     с запасом ≥24 px с каждой стороны и вывеска целиком ----- */
  const MX = 1268, MCW = 1280, MCH = 1600;
  const EXT_H = MCH - 1440;
  const bottom = await sharp(masterDeskFile).extract({ left: 0, top: 1440 - EXT_H, width: 2560, height: EXT_H })
    .flip().blur(2).linear([0.92, 0.92, 0.92], [0, 0, 0]).png().toBuffer();
  const extFile = join(PHOTOS, 'r14-gen/master-ext-2560x1600.png');
  await sharp({ create: { width: 2560, height: MCH, channels: 3, background: '#000' } })
    .composite([{ input: await sharp(masterDeskFile).png().toBuffer(), top: 0, left: 0 }, { input: bottom, top: 1440, left: 0 }])
    .png().toFile(extFile);
  const masterMobFile = join(PHOTOS, 'r14-gen/master-mobile-4x5.jpg');
  await sharp(extFile).extract({ left: MX, top: 0, width: MCW, height: MCH }).resize(MOBW, MOBH).jpeg({ quality: 95 }).toFile(masterMobFile);
  const kMob = MOBW / MCW;
  const mobTitle = [Math.round((sx0 - MX) * kMob), 0, Math.round((sx1 - MX) * kMob), MOBH];
  const mL = Math.round((cx0 - MX) * kMob), mR = Math.round((MX + MCW - cx1) * kMob);
  console.log(`мобайл 4:5: окно x ${MX}…${MX + MCW}; вывеска в кропе x ${mobTitle[0]}…${mobTitle[2]} из ${MOBW}; машины: запас слева ${mL} / справа ${mR} (норма ≥24)`);
  if (mobTitle[0] < 0 || mobTitle[2] > MOBW) { console.error('FAIL: вывеска не целиком в мобильном кропе'); fail = 1; }
  if (mL < 24 || mR < 24) { console.error('FAIL: запас машин в мобильном кропе < 24 px'); fail = 1; }

  /* ----- 8. «О компании»: цельный кроп оригинала БЕЗ цветокоррекции ----- */
  /* окно 3000×1875+380+80: низ = 1955 = низ проёмов; +520 из задания срезал бы
     верх вывески (замер: верх баннера y≈115) — отклонение задокументировано. */
  const aboutMaster = await sharp(SRC_CLEAN).extract({ left: 380, top: 80, width: 3000, height: 1875 })
    .resize(1600, 1000, { fit: 'fill', kernel: 'lanczos3' }).jpeg({ quality: 95 }).toBuffer();

  /* ----- 9. полоса / панель / слайды 2–3 — как в раундах 11–12 (§3.6: не трогать) ----- */
  const stripSrc = { 'strip-sign': 'strip-tyre.jpg', 'strip-bay': 'strip-lift.jpg', 'strip-gates': 'strip-diag.jpg' };
  const stripPipes = {};
  for (const [name, f] of Object.entries(stripSrc)) stripPipes[name] = sharp(join(R11, f)).resize(1200, 500, { fit: 'cover' });
  const ctaSrc = join(R11, 'cta-diag.jpg');
  const PH = join(PHOTOS);
  const slide16 = {};
  for (const [name, f] of [['hero-tyre', 'gen-tyre-2048.jpg'], ['hero-tools', 'gen-tools-2048.jpg']]) {
    slide16[name] = sharp(join(PH, f)).extract({ left: 8, top: 0, width: 2032, height: 1143 });
  }

  /* ----- 10. наборы ----- */
  for (const r of [
    await encodeSet('hero-service-2560', sharp(masterDeskFile).resize(2560, 1440, { fit: 'cover' }), 2560, 1440, false),
    await encodeSet('hero-service-1600', sharp(masterDeskFile).resize(1600, 900, { fit: 'cover' }), 1600, 900, false),
    await encodeSet('hero-service-960', sharp(masterDeskFile).resize(960, 540, { fit: 'cover' }), 960, 540, false),
    await encodeSet('hero-service-640', sharp(masterDeskFile).resize(640, 360, { fit: 'cover' }), 640, 360, false),
    await encodeSet('hero-service-m-960', sharp(masterMobFile).resize(960, 1200), 960, 1200, false),
    await encodeSet('hero-service-m-640', sharp(masterMobFile).resize(640, 800), 640, 800, false),
    await encodeSet('strip-sign', stripPipes['strip-sign'], 1200, 500, false),
    await encodeSet('strip-bay', stripPipes['strip-bay'], 1200, 500, false),
    await encodeSet('strip-gates', stripPipes['strip-gates'], 1200, 500, false),
    await encodeSet('about-service-1600', sharp(aboutMaster).resize(1600, 1000), 1600, 1000, false),
    await encodeSet('about-service-960', sharp(aboutMaster).resize(960, 600), 960, 600, false),
    await encodeSet('about-service-640', sharp(aboutMaster).resize(640, 400), 640, 400, false),
    await encodeSet('cta-diag-960', sharp(ctaSrc).resize(960, 540, { fit: 'cover' }).linear([0.45, 0.45, 0.45], [0, 0, 0]), 960, 540, false),
    await encodeSet('cta-diag-640', sharp(ctaSrc).resize(640, 360, { fit: 'cover' }).linear([0.45, 0.45, 0.45], [0, 0, 0]), 640, 360, false),
  ]) report.push(...r);
  for (const name of ['hero-tyre', 'hero-tools']) {
    for (const [w, h] of [[640, 360], [960, 540], [1600, 900], [2032, 1143]]) {
      report.push(...await encodeSet(`${name}-${w}`, slide16[name].clone().resize(w, h), w, h, false));
    }
  }

  /* ----- 11. текстура ≤100 КБ ----- */
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

  /* ----- 12. геометрия для check-safe-zone ----- */
  writeFileSync(join(HERE, 'safe-zone-geom.json'), JSON.stringify({
    desk: { IW: NW, IH: NH, posY: 0, whole: true, cars: carsBBox, title: titleBBox },
    mob: { IW: MOBW, IH: MOBH, posY: MOB_POS_Y, title: mobTitle },
  }, null, 2));

  /* ----- 13. дубли хешей + таблица весов в README ----- */
  const hashes = new Map();
  for (const f of readdirSync(OUT)) {
    if (!/\.(avif|webp|png|jpg|svg)$/.test(f)) continue;
    const h = createHash('md5').update(readFileSync(join(OUT, f))).digest('hex');
    if (hashes.has(h)) { console.error(`FAIL: дубли хеша ${f} и ${hashes.get(h)}`); fail = 1; }
    hashes.set(h, f);
  }
  console.log(`файлов в public/img: ${hashes.size}, дублей нет`);
  const rows = report.map((r) => `| ${r.file} | ${r.w ? r.w + '×' + r.h : '—'} | ${r.kb} | ${r.cap} |`).join('\n');
  let readme = readFileSync(README, 'utf8');
  const re = /(<!-- weights-auto:start -->)[\s\S]*?(<!-- weights-auto:end -->)/;
  if (re.test(readme)) {
    readme = readme.replace(re, `$1\n| файл | px | КБ | лимит |\n|---|---|---|---|\n${rows}\n$2`);
    writeFileSync(README, readme);
    console.log('README: таблица весов обновлена из сборки');
  } else console.log('README: маркеры weights-auto не найдены (таблица не вставлена)');
  for (const r of report) console.log(`ok   ${r.file} ${r.w ? r.w + 'x' + r.h : ''} ${r.kb} / ${r.cap}`);
  process.exit(fail);
}
