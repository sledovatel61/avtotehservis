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
import { tmpdir } from 'node:os';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, renameSync } from 'node:fs';
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
  /* раунд 15 / правка приёмки: раньше здесь стояли готовые 'ok' — проверка не могла упасть
     (ревью A6 по тому же классу дефекта в гейте ширины героя). Теперь считаем по числам:
     полоса фото на ≤640 = clamp(300px,48svh,460px) от ширины экрана, cover кропит только
     по вертикали (мастер 4:5 уже экрана), машины и вывеска в координатах мастера. */
  const { IW, IH, title, cars } = geom;
  return MOB_VIEWPORTS.map(([W, H]) => {
    const band = Math.round(Math.min(460, Math.max(300, H * 0.48)));
    const scale = Math.max(W / IW, band / IH);      // cover
    const visW = Math.min(IW, W / scale), visH = Math.min(IH, band / scale);
    const left = (IW - visW) / 2, top = (IH - visH) * (geom.posY ?? 0.2);
    const inside = (r) => r[0] >= left - 1 && r[2] <= left + visW + 1 && r[1] >= top - 1 && r[3] <= top + visH + 1;
    const carsIn = cars ? inside(cars) : false;
    const titleIn = inside(title);
    /* Пересечение вывески и машин на мобиле НЕ проверяем: это содержание фотографии
       (машины стоят перед стеной с баннером), а текст на ≤640 идёт отдельным блоком
       ПОД кадром — наложению неоткуда взяться. Критерий — «машины и вывеска в кадре». */
    return {
      vp: `${W}×${H}`, band: `0…${band}`,
      cars: carsIn ? 'ok' : 'нет', title: titleIn ? 'ok' : 'нет', inter: 'n/a',
    };
  });
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
  /* раунд 20 (задание №22): светлая секция «Как мы работаем» — ориентиры B6 */
  'est-bg-1600': { avif: 22, webp: 30 },
  'est-bg-960': { avif: 12, webp: 16 },
  'est-bg-640': { avif: 6, webp: 9 },
  'est-bg-m-960': { avif: 12, webp: 16 },
  'est-bg-m-640': { avif: 6, webp: 9 },
  'est-p1-640': { avif: 6, webp: 9 },
  'est-p2-640': { avif: 6, webp: 9 },
  'est-p3-640': { avif: 6, webp: 9 },
  'est-p4-640': { avif: 6, webp: 9 },
  'est-aside-1000': { avif: 18, webp: 24 },
  /* раунд 21: «Услуги» — фон секции и шесть карточек */
  'svc-bg-1600': { avif: 17, webp: 34 }, 'svc-bg-m-960': { avif: 13, webp: 23 },
  'svc-1-640': { avif: 5, webp: 7 }, 'svc-2-640': { avif: 5, webp: 7 }, 'svc-3-640': { avif: 5, webp: 7 },
  'svc-4-640': { avif: 5, webp: 7 }, 'svc-5-640': { avif: 5, webp: 7 }, 'svc-6-640': { avif: 5, webp: 7 },
  'svc-1-960': { avif: 7, webp: 9 }, 'svc-2-960': { avif: 7, webp: 9 }, 'svc-3-960': { avif: 7, webp: 9 },
  'svc-4-960': { avif: 7, webp: 9 }, 'svc-5-960': { avif: 7, webp: 9 }, 'svc-6-960': { avif: 7, webp: 9 },
  'est-aside-640': { avif: 8, webp: 12 },
  /* раунд 12, патч #62: слайды 2–3 в ровно 16:9 (кроп 0 px в рамке героя) */
  'hero-tyre-2032': { avif: 120, webp: 120 },
  'hero-tyre-1600': { avif: 70, webp: 70 },
  'hero-tyre-960': { avif: 40, webp: 40 },
  'hero-tyre-640': { avif: 25, webp: 25 },
  'hero-tools-2032': { avif: 120, webp: 120 },
  'hero-tools-1600': { avif: 70, webp: 70 },
  'hero-tools-960': { avif: 40, webp: 40 },
  'hero-tools-640': { avif: 25, webp: 25 },
  /* раунд 17 (задание №19): фоны «Трёх направлений» */
  'tri-bg-2560':    { avif: 130, webp: 150 },
  'tri-bg-m-900':   { avif: 80,  webp: 95  },
  'tri-wheel-1600': { avif: 70,  webp: 80  },
  'tri-wheel-960':  { avif: 45,  webp: 50  },
  'tri-wheel-640':  { avif: 28,  webp: 32  },
  'tri-serv-1600':  { avif: 70,  webp: 80  },
  'tri-serv-960':   { avif: 45,  webp: 50  },
  'tri-serv-640':   { avif: 28,  webp: 32  },
  'tri-diag-1600':  { avif: 70,  webp: 80  },
  'tri-diag-960':   { avif: 45,  webp: 50  },
  'tri-diag-640':   { avif: 28,  webp: 32  },
  /* раунд 18 (задание №20): фоны «О компании» — A секция, B карточки, C плашки, D кнопка */
  'about-bg-2560':   { avif: 130, webp: 150 },
  'about-bg-1600':   { avif: 80,  webp: 95  },
  'about-bg-m-1200': { avif: 110, webp: 130 },
  'about-bg-m-640':  { avif: 55,  webp: 65  },
  'about-c1-1080': { avif: 50, webp: 58 }, 'about-c1-720': { avif: 30, webp: 35 }, 'about-c1-480': { avif: 18, webp: 22 },
  'about-c2-1080': { avif: 50, webp: 58 }, 'about-c2-720': { avif: 30, webp: 35 }, 'about-c2-480': { avif: 18, webp: 22 },
  'about-c3-1080': { avif: 50, webp: 58 }, 'about-c3-720': { avif: 30, webp: 35 }, 'about-c3-480': { avif: 18, webp: 22 },
  'about-c4-1080': { avif: 50, webp: 58 }, 'about-c4-720': { avif: 30, webp: 35 }, 'about-c4-480': { avif: 18, webp: 22 },
  'about-f1-1280': { avif: 34, webp: 40 }, 'about-f1-640': { avif: 14, webp: 17 },
  'about-f2-1280': { avif: 34, webp: 40 }, 'about-f2-640': { avif: 14, webp: 17 },
  'about-f3-1280': { avif: 34, webp: 40 }, 'about-f3-640': { avif: 14, webp: 17 },
  'about-f4-1280': { avif: 34, webp: 40 }, 'about-f4-640': { avif: 14, webp: 17 },
  'about-btn-640': { avif: 14, webp: 17 }, 'about-btn-320': { avif: 7, webp: 9 },
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
  /* РАУНД 15 / правка приёмки: полосу 176×873 нельзя копировать в холст одним куском —
     сплошное копирование «кирпичом» кладёт её в первые ~99 строк холста, а ниже оставляет
     чёрный столбец (в рендере 768×1024 видна кромка x≈86 из 768). Копируем построчно. */
  for (let y = 0; y < H1; y++) {
    Buffer.from(leftBand).copy(canvas, y * W1 * 3, y * LEFT * 3, (y + 1) * LEFT * 3);
  }
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
  /* промежуточный холст 4,7 МБ — во временную папку, в репозиторий не тащим */
  const extFile = join(tmpdir(), 'ats-master-ext-2560x1600.png');
  await sharp({ create: { width: 2560, height: MCH, channels: 3, background: '#000' } })
    .composite([{ input: await sharp(masterDeskFile).png().toBuffer(), top: 0, left: 0 }, { input: bottom, top: 1440, left: 0 }])
    .png().toFile(extFile);
  const masterMobFile = join(PHOTOS, 'r14-gen/master-mobile-4x5.jpg');
  await sharp(extFile).extract({ left: MX, top: 0, width: MCW, height: MCH }).resize(MOBW, MOBH).jpeg({ quality: 95 }).toFile(masterMobFile);
  const kMob = MOBW / MCW;
  /* раунд 15 / правка приёмки: bbox вывески в координатах мобильного мастера —
     по X и по Y (раньше Y был «0…MOBH», из-за чего проверка пересечения не могла быть верной) */
  const mobTitle = [Math.round((sx0 - MX) * kMob), Math.round(sy0 * kMob), Math.round((sx1 - MX) * kMob), Math.round(sy1 * kMob)];
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
  ]) report.push(...r);
  for (const name of ['hero-tyre', 'hero-tools']) {
    for (const [w, h] of [[640, 360], [960, 540], [1600, 900], [2032, 1143]]) {
      report.push(...await encodeSet(`${name}-${w}`, slide16[name].clone().resize(w, h), w, h, false));
    }
  }

  /* ----- 10b. раунд 17: мастера и фоны «Трёх направлений» (задание №19) -----
     Сырые кадры генератора (*-raw.jpg) нормализуются до заявленных размеров
     мастеров (cover-кроп по центру + resize), затем кодируются avif/webp. */
  const R18 = join(PHOTOS, 'r18-dirs');
  const r18Masters = {
    'sec-bg-2560':        { raw: 'sec-bg-2560-raw.jpg',    w: 2560, h: 1440 },
    'sec-bg-m-900':       { raw: 'sec-bg-m-900-raw.jpg',   w: 900,  h: 1600 },
    'card-1-wheels-2400': { raw: 'card-1-wheels-raw.jpg',  w: 2400, h: 1600 },
    'card-2-service-2400': { raw: 'card-2-service-raw.jpg', w: 2400, h: 1600 },
    'card-3-diag-2400':   { raw: 'card-3-diag-raw.jpg',    w: 2400, h: 1600 },
  };
  for (const [name, m] of Object.entries(r18Masters)) {
    const rawPath = join(R18, m.raw), outPath = join(R18, name + '.jpg');
    if (!existsSync(rawPath)) { console.error(`[r18] Input file is missing: ${rawPath}`); process.exit(1); }
    const md = await sharp(rawPath).metadata();
    const sc = Math.max(m.w / md.width, m.h / md.height);
    const sw = Math.round(md.width * sc), sh = Math.round(md.height * sc);
    await sharp(rawPath).resize(sw, sh)
      .extract({ left: Math.round((sw - m.w) / 2), top: Math.round((sh - m.h) / 2), width: m.w, height: m.h })
      .jpeg({ quality: 95 }).toFile(outPath + '.tmp');
    renameSync(outPath + '.tmp', outPath);
  }
  /* РАУНД 17 / приёмка (замечание A6 §9.4): zones.json больше НЕ перезаписывается сборкой.
     Это входные данные проверки (что именно считается сюжетом на кадре), а не её результат:
     иначе гейт сравнивал число с самим собой, а ручная правка зоны не выживала пересборки.
     Файл лежит в docs/photos-source/r18-dirs/zones.json и меняется только руками. */
  const mSecD = join(R18, 'sec-bg-2560.jpg'), mSecM = join(R18, 'sec-bg-m-900.jpg');
  const mWheel = join(R18, 'card-1-wheels-2400.jpg');
  const mServ = join(R18, 'card-2-service-2400.jpg');
  const mDiag = join(R18, 'card-3-diag-2400.jpg');
  for (const r of await Promise.all([
    encodeSet('tri-bg-2560', sharp(mSecD).resize(2560, 1440), 2560, 1440, false),
    encodeSet('tri-bg-m-900', sharp(mSecM).resize(900, 1600), 900, 1600, false),
    encodeSet('tri-wheel-1600', sharp(mWheel).resize(1600, 1067), 1600, 1067, false),
    encodeSet('tri-wheel-960', sharp(mWheel).resize(960, 640), 960, 640, false),
    encodeSet('tri-wheel-640', sharp(mWheel).resize(640, 427), 640, 427, false),
    encodeSet('tri-serv-1600', sharp(mServ).resize(1600, 1067), 1600, 1067, false),
    encodeSet('tri-serv-960', sharp(mServ).resize(960, 640), 960, 640, false),
    encodeSet('tri-serv-640', sharp(mServ).resize(640, 427), 640, 427, false),
    encodeSet('tri-diag-1600', sharp(mDiag).resize(1600, 1067), 1600, 1067, false),
    encodeSet('tri-diag-960', sharp(mDiag).resize(960, 640), 960, 640, false),
    encodeSet('tri-diag-640', sharp(mDiag).resize(640, 427), 640, 427, false),
  ])) report.push(...r);

  /* ----- 10c. раунд 18: мастера и фоны «О компании» (задание №20) -----
     11 мастеров: A секция (2560×1440 + портрет 1200×2700), B 4 карточки 2400×1600,
     C 4 плашки 1600×533, D кнопка 1200×400. Нормализация — cover-кроп по центру. */
  const R19 = join(PHOTOS, 'r19-about');
  const r19Masters = {
    'sec-bg-2560':        { raw: 'sec-bg-2560-raw.jpg',        w: 2560, h: 1440 },
    'sec-bg-m-1200':      { raw: 'sec-bg-m-1200-raw.jpg',      w: 1200, h: 2700 },
    'card-1-estimate-2400': { raw: 'card-1-estimate-2400-raw.jpg', w: 2400, h: 1600 },
    'card-2-warranty-2400': { raw: 'card-2-warranty-2400-raw.jpg', w: 2400, h: 1600 },
    'card-3-schedule-2400': { raw: 'card-3-schedule-2400-raw.jpg', w: 2400, h: 1600 },
    'card-4-fleet-2400':    { raw: 'card-4-fleet-2400-raw.jpg',    w: 2400, h: 1600 },
    'fact-1-address-1600':  { raw: 'fact-1-address-1600-raw.jpg',  w: 1600, h: 533 },
    'fact-2-hours-1600':    { raw: 'fact-2-hours-1600-raw.jpg',    w: 1600, h: 533 },
    'fact-3-warranty-1600': { raw: 'fact-3-warranty-1600-raw.jpg', w: 1600, h: 533 },
    'fact-4-fleet-1600':    { raw: 'fact-4-fleet-1600-raw.jpg',    w: 1600, h: 533 },
    'btn-cta-1200':         { raw: 'btn-cta-1200-raw.jpg',         w: 1200, h: 400 },
  };
  for (const [name, m] of Object.entries(r19Masters)) {
    const rawPath = join(R19, m.raw), outPath = join(R19, name + '.jpg');
    if (!existsSync(rawPath)) { console.error(`[r19] Input file is missing: ${rawPath}`); process.exit(1); }
    const md = await sharp(rawPath).metadata();
    const sc = Math.max(m.w / md.width, m.h / md.height);
    const sw = Math.round(md.width * sc), sh = Math.round(md.height * sc);
    await sharp(rawPath).resize(sw, sh)
      .extract({ left: Math.round((sw - m.w) / 2), top: Math.round((sh - m.h) / 2), width: m.w, height: m.h })
      .jpeg({ quality: 95 }).toFile(outPath + '.tmp');
    renameSync(outPath + '.tmp', outPath);
  }
  /* раунд 19 (§3 пол видимости): мастера растягиваются аффинно до целевых
     средней/разброса, чтобы слой ПОД скримом читался: mean−17,8 ≥ 3 и разброс ≥ 40.
     Цели из рабочей точки оркестратора (плашки 29,7/54 при скриме 0,78). */
  const STRETCH = {
    'sec-bg-2560.jpg': [37, 170], 'sec-bg-m-1200.jpg': [37, 170],
    'card-1-estimate-2400.jpg': [82, 260], 'card-2-warranty-2400.jpg': [58, 260],
    'card-3-schedule-2400.jpg': [58, 260], 'card-4-fleet-2400.jpg': [58, 260],
    'fact-1-address-1600.jpg': [72, 245], 'fact-2-hours-1600.jpg': [72, 245],
    'fact-3-warranty-1600.jpg': [72, 245], 'fact-4-fleet-1600.jpg': [72, 245],
    'btn-cta-1200.jpg': [63, 150],
  };
  for (const [f, [tMean, tSpread]] of Object.entries(STRETCH)) {
    const fp = join(R19, f);
    for (let pass = 0; pass < 2; pass++) {
      const im = await sharp(fp).raw().toBuffer({ resolveWithObject: true });
      const { width: w, height: h, channels: c } = im.info; const d = Buffer.from(im.data);
      let sum = 0, n = 0, mn = 255, mx = 0;
      for (let i = 0; i < d.length; i += c * 7) { const v = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        sum += v; n++; if (v < mn) mn = v; if (v > mx) mx = v; }
      const mean = sum / n, spread = Math.max(1, mx - mn);
      const a = tSpread / spread, b = tMean - a * mean;
      if (Math.abs(a - 1) < 0.02 && Math.abs(b) < 2) break;
      for (let i = 0; i < d.length; i += c) for (let k = 0; k < 3; k++)
        d[i + k] = Math.max(0, Math.min(255, Math.round(d[i + k] * a + b)));
      await sharp(d, { raw: { width: w, height: h, channels: c } }).jpeg({ quality: 95 }).toFile(fp + '.tmp');
      renameSync(fp + '.tmp', fp);
    }
  }
  /* §3.2 (ред. приёмки круга 19): вертикальная виньетка мастеров. У сгенерированных
     кадров низ темнее верха на 30–45 единиц; под скримом это давало «фото сверху,
     чёрный низ» — фон карточек фактически не читался (низ 21 при верхе 43).
     Выравниваем профиль строк мягкой базой (бокс-блюр 12 % высоты) и частичным
     коэффициентом 0.85: кромок нет (коэффициент гладкий по y), фактура сохраняется,
     общий mean/spread дальше нормирует STRETCH. */
  for (const [name, m] of Object.entries(r19Masters)) {
    if (!/^card-|^fact-/.test(name)) continue;   /* фон секции и кнопка — без выравнивания:
                                                    у фона надзаголовок должен остаться ≤30 */
    const fp = join(R19, name + '.jpg');
    const im = await sharp(fp).raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: c } = im.info; const d = Buffer.from(im.data);
    const rowMean = new Float64Array(h);
    for (let y = 0; y < h; y++) { let t = 0;
      for (let x = 0; x < w; x++) { const i = (y * w + x) * c;
        t += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; }
      rowMean[y] = t / w; }
    const R = Math.max(2, Math.round(h * 0.12));
    const base = new Float64Array(h);
    for (let y = 0; y < h; y++) { let t = 0, n = 0;
      for (let k = -R; k <= R; k++) { const yy = y + k; if (yy < 0 || yy >= h) continue; t += rowMean[yy]; n++; }
      base[y] = t / n; }
    let bs = 0; for (let y = 0; y < h; y++) bs += base[y]; const T = bs / h;
    const gain = new Float64Array(h);
    for (let y = 0; y < h; y++) { const g = Math.pow(T / Math.max(4, base[y]), 0.85);
      gain[y] = Math.max(0.55, Math.min(2.2, g)); }
    for (let y = 0; y < h; y++) { const g = gain[y]; if (Math.abs(g - 1) < 0.02) continue;
      for (let x = 0; x < w; x++) { const i = (y * w + x) * c;
        for (let q = 0; q < 3; q++) d[i + q] = Math.max(0, Math.min(255, Math.round(d[i + q] * g))); } }
    await sharp(d, { raw: { width: w, height: h, channels: c } }).jpeg({ quality: 95 }).toFile(fp + '.tmp');
    renameSync(fp + '.tmp', fp);
    let mn = 255, mx = 0, sm = 0;
    for (let i = 0; i < d.length; i += c * 11) { const v = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sm += v; if (v < mn) mn = v; if (v > mx) mx = v; }
    console.log(`ok   r19 ${name}: выравнивание, gain ${gain[0].toFixed(2)}→${gain[h - 1].toFixed(2)}, mean ${(sm / (d.length / (c * 11))).toFixed(1)}`);
  }
  /* §2.5 (ред. приёмки круга 19): приёмка A5 притемняла ПЛАТО y 791…1147 с феерингом
     140 px. На рендере это дало видимую кромку поперёк карточки: между 48 % и 53 %
     высоты яркость падала на 16 единиц (замер оркестратора, 1440/DPR2). Плато удалено.
     Затемнение полосы под текстом делает скрим .feat-bg::after — он плавный по всей
     высоте и кромок не даёт; мастер остаётся натуральным. */
  const BTN0 = join(R19, 'btn-cta-1200.jpg');
  /* §2.1/§3 кнопка: стекло — блик в полосе текста (y81…319) ограничен плечом
     (рамка ghost .55 обязана держать ≥3:1 на худшем пикселе фона), а отражённый
     свет у верхнего/нижнего края пилюли сохраняет разброс деталей ≥40 на рендере */
  {
    const f = BTN0;
    const im = await sharp(f).raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: c } = im.info; const d = Buffer.from(im.data);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * c;
      const fe = y < 81 ? Math.min(1, (81 - y) / 80) : y > 319 ? Math.min(1, (y - 319) / 80) : 0;
      for (let q = 0; q < 3; q++) { let v = d[i + q];
        if (y >= 81 && y <= 319) { if (v > 112) v = 112 + (v - 112) * 0.14; }
        else { v = v + fe * (140 + v * 0.9); }   /* отражённый свет к краям пилюли, feather — без стыка */
        d[i + q] = Math.max(0, Math.min(255, Math.round(v))); } }
    await sharp(d, { raw: { width: w, height: h, channels: c } }).jpeg({ quality: 95 }).toFile(f + '.tmp');
    renameSync(f + '.tmp', f);
  }
  const A2560 = join(R19, 'sec-bg-2560.jpg'), AM = join(R19, 'sec-bg-m-1200.jpg');
  const C = [1, 2, 3, 4].map(i => join(R19, `card-${i}-${['estimate', 'warranty', 'schedule', 'fleet'][i - 1]}-2400.jpg`));
  const F = [1, 2, 3, 4].map(i => join(R19, `fact-${i}-${['address', 'hours', 'warranty', 'fleet'][i - 1]}-1600.jpg`));
  const BTN = join(R19, 'btn-cta-1200.jpg');
  /* раунд 20: предел хайлайтов в текстовой полосе карточек (y 791…1147 мастера).
     Под принятыми приёмкой скримами .52/.66/.81 p mist #B7C4BB требует фон rel ≤ .079,
     что при a≈.69 даёт мастер ≤ ~230; берём 215 с запасом. Идемпотентно (повторный
     прогон не меняет файл), среднюю/разброс пола почти не трогает. */
  for (const f of C) {
    const im = await sharp(f).raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: c } = im.info; const d = Buffer.from(im.data);
    let n = 0;
    for (let y = 791; y < 1147; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * c;
      const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (L > 215) { const k = 215 / L; for (let q = 0; q < 3; q++) d[i + q] = Math.round(d[i + q] * k); n++; } }
    if (n) { await sharp(d, { raw: { width: w, height: h, channels: c } }).jpeg({ quality: 95 }).toFile(f + '.tmp'); renameSync(f + '.tmp', f); }
    console.log(`ok   band-clamp ${f.split('/').pop()}: пикселей прижато ${n}`);
  }
  for (const r of await Promise.all([
    encodeSet('about-bg-2560', sharp(A2560).resize(2560, 1440), 2560, 1440, false),
    encodeSet('about-bg-1600', sharp(A2560).resize(1600, 900), 1600, 900, false),
    encodeSet('about-bg-m-1200', sharp(AM).resize(1200, 2700), 1200, 2700, false),
    encodeSet('about-bg-m-640', sharp(AM).resize(640, 1440), 640, 1440, false),
    ...[1, 2, 3, 4].flatMap(i => [
      encodeSet(`about-c${i}-1080`, sharp(C[i - 1]).resize(1080, 720), 1080, 720, false),
      encodeSet(`about-c${i}-720`, sharp(C[i - 1]).resize(720, 480), 720, 480, false),
      encodeSet(`about-c${i}-480`, sharp(C[i - 1]).resize(480, 320), 480, 320, false),
    ]),
    ...[1, 2, 3, 4].flatMap(i => [
      encodeSet(`about-f${i}-1280`, sharp(F[i - 1]).resize(1280, 427), 1280, 427, false),
      encodeSet(`about-f${i}-640`, sharp(F[i - 1]).resize(640, 213), 640, 213, false),
    ]),
    encodeSet('about-btn-640', sharp(BTN).resize(640, 213), 640, 213, false),
    encodeSet('about-btn-320', sharp(BTN).resize(320, 107), 320, 107, false),
  ])) report.push(...r);

  /* ----- 10b. раунд 20 (задание №22): светлая секция «Как мы работаем» -----
     Мастера: sec и aside — AI-генерации (2 из лимита 3), 4 панели — детерминированный
     синтез synth-steps-textures.mjs. Нормализация — ОДИН аффинный проход плюс фикс.
     локальные правки; циклов подгонки под числа гейта нет (запрет части F). */
  const R20 = join(HERE, '../../docs/photos-source/r20-steps');
  const secMaster = join(R20, 'sec-2600.jpg');
  /* раунд 20, ред. приёмки: убрано ветвление по y («пол 212 в зоне h2» + рампа только сверху).
     Оно давало ступень 228 → 216 на 37 % высоты — видимую линию через всю секцию (A6, major B).
     Новая формула непрерывна по y: одна аффинная нормализация + рампа по X. */
  {
    const im = await sharp(join(R20, 'sec-2600-raw.jpg')).resize(2600, 1400, { fit: 'cover' })
      .raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: c } = im.info; const d = Buffer.from(im.data);
    let sum = 0, n = 0, mn = 255, mx = 0;
    for (let i = 0; i < d.length; i += c) { const v = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += v; n++; if (v < mn) mn = v; if (v > mx) mx = v; }
    const T_MEAN = 214, T_SPREAD = 70;
    const a = T_SPREAD / Math.max(1, mx - mn), b = T_MEAN - a * (sum / n);
    const AMP = 14;                                                   /* живость по X: ±14 */
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * c;
      let v = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * a + b;
      v += AMP * ((x / (w - 1)) * 2 - 1);
      const g = Math.max(0, Math.min(255, Math.round(v)));
      const tint = d[i + 1] - d[i];                                  /* сохраняем холодный подтон */
      d[i] = Math.max(0, Math.min(255, g - 2)); d[i + 1] = g; d[i + 2] = Math.max(0, Math.min(255, g - 4 - Math.max(0, tint)));
    }
    await sharp(d, { raw: { width: w, height: h, channels: c } }).jpeg({ quality: 95 }).toFile(secMaster + '.tmp');
    renameSync(secMaster + '.tmp', secMaster);
  }
  const asideMaster = join(R20, 'aside-1200.jpg');
  {
    const im = await sharp(join(R20, 'aside-1200-raw.jpg')).resize(1200, 1400, { fit: 'cover' })
      .raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: c } = im.info; const d = Buffer.from(im.data);
    for (let i = 0; i < d.length; i += c) for (let q = 0; q < 3; q++) {
      let v = d[i + q]; if (v > 150) v = 150 + (v - 150) * 0.25;      /* блики под скримом .78…86 ≤ 79 */
      d[i + q] = Math.max(0, Math.min(255, Math.round(v))); }
    await sharp(d, { raw: { width: w, height: h, channels: c } }).jpeg({ quality: 95 }).toFile(asideMaster + '.tmp');
    renameSync(asideMaster + '.tmp', asideMaster);
  }
  /* портретные кропы фона для ≤1024/≤640: в узкий cover-кроп попадает вся рампа */
  /* портретные кропы: узкий кроп берёт только середину мастера, где рампа по X почти плоская.
     Поэтому в кроп добавляется СВОЯ непрерывная рампа по X (без ветвления по y — ступеней нет). */
  const rampCrop = async (left, width, amp, out) => {
    const im = await sharp(secMaster).extract({ left, top: 0, width, height: 1400 }).raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: c } = im.info; const d = Buffer.from(im.data);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * c;
      const add = amp * ((x / (w - 1)) * 2 - 1);
      for (let q = 0; q < 3; q++) d[i + q] = Math.max(0, Math.min(255, Math.round(d[i + q] + add))); }
    await sharp(d, { raw: { width: w, height: h, channels: c } }).jpeg({ quality: 95 }).toFile(out);
    return out;
  };
  const secM960 = await rampCrop(700, 1200, 22, join(R20, 'sec-m-960.jpg'));
  const secM640 = await rampCrop(980, 640, 30, join(R20, 'sec-m-640.jpg'));
  const panelMasters = [1, 2, 3, 4].map(i => join(R20, `panel-${i}-${['metal', 'paper', 'concrete', 'fabric'][i - 1]}.jpg`));
  for (const r of await Promise.all([
    encodeSet('est-bg-1600', sharp(secMaster).resize(1600, 862), 1600, 862, false),
    encodeSet('est-bg-960', sharp(secMaster).resize(960, 517), 960, 517, false),
    encodeSet('est-bg-640', sharp(secMaster).resize(640, 345), 640, 345, false),
    encodeSet('est-bg-m-960', sharp(secM960).resize(960, 1120), 960, 1120, false),
    encodeSet('est-bg-m-640', sharp(secM640).resize(640, 1400), 640, 1400, false),
    ...[0, 1, 2, 3].map(i => encodeSet(`est-p${i + 1}-640`, sharp(panelMasters[i]).resize(640, 480), 640, 480, false)),
    encodeSet('est-aside-1000', sharp(asideMaster).resize(1000, 1167), 1000, 1167, false),
    encodeSet('est-aside-640', sharp(asideMaster).resize(640, 747), 640, 747, false),
  ])) report.push(...r);

  /* ----- 10c. раунд 21 (задание №23): фон секции «Услуги» и фактуры карточек ----- */
  const R21 = join(HERE, '../../docs/photos-source/r21-svc');
  const lift = async (file, add) => {   /* AI-мастер: аддитивный подъём средней, разброс сохранён */
    const im = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: c } = im.info; const d = Buffer.from(im.data);
    for (let i = 0; i < d.length; i += c) for (let q = 0; q < 3; q++) d[i + q] = Math.max(0, Math.min(255, Math.round(d[i + q] + add)));
    const out = file.replace(/-raw\.jpg$/, '-lift.jpg');
    await sharp(d, { raw: { width: w, height: h, channels: c } }).jpeg({ quality: 95 }).toFile(out + '.tmp');
    renameSync(out + '.tmp', out);
    return out;
  };
  const tyreM = await lift(join(R21, 'tyre-raw.jpg'), 11);   /* 29.3 → ~40 */
  const oilM = await lift(join(R21, 'oil-raw.jpg'), 37);     /* 26.9 → ~64 */
  const CARD_M = [tyreM, join(R21, 'bal-raw-synth.jpg'), join(R21, 'tread-raw-synth.jpg'), oilM,
    join(R21, 'susp-raw-synth.jpg'), join(R21, 'elec-raw-synth.jpg')];
  /* вертикальное сглаживание левого поля мастера: профиль по строкам без ступеней >3 (шов/ступка) */
  const bgSmooth = await (async () => {
    const im = await sharp(join(R21, 'bg-raw.jpg')).resize(1500, 844, { fit: 'cover' }).raw().toBuffer({ resolveWithObject: true });
    const { width: w, height: h, channels: c } = im.info; const d = Buffer.from(im.data);
    /* раунд 21: фон-мастер = постобработка AI-кадра: вертикальная монотонная рампа
       (профиль строк без ступенек на любом кропе) + горизонтальный световой профиль
       кадра (свет из ворот справа) + 8 % вертикальной фактуры исходника + зерно. */
    const colMean = new Float64Array(w);
    for (let x = 0; x < w; x++) { let ss = 0, nn = 0;
      for (let y = 0; y < h; y += 2) { const ii = (y * w + x) * c; ss += .2126 * d[ii] + .7152 * d[ii + 1] + .0722 * d[ii + 2]; nn++; }
      colMean[x] = ss / nn; }
    let gMean = 0; for (let x = 0; x < w; x++) gMean += colMean[x]; gMean /= w;
    const rowMean = (y0, y1) => { let ss = 0, nn = 0;
      for (let y = y0; y < y1; y += 2) for (let x = 0; x < w; x += 8) { const ii = (y * w + x) * c; ss += .2126 * d[ii] + .7152 * d[ii + 1] + .0722 * d[ii + 2]; nn++; }
      return ss / nn; };
    const T = rowMean(0, Math.round(h * .12)), B = rowMean(Math.round(h * .88), h);
    const rnd = ((a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; })(21021);
    for (let y = 0; y < h; y++) {
      const t = y / (h - 1), ramp = T + (B - T) * t;
      for (let x = 0; x < w; x++) {
        const ii = (y * w + x) * c;
        const lum = .2126 * d[ii] + .7152 * d[ii + 1] + .0722 * d[ii + 2];
        const target = ramp + (colMean[x] - gMean) + (rnd() - 0.5) * 4;
        const delta = target - lum;
        for (let q = 0; q < 3; q++) d[ii + q] = Math.max(0, Math.min(255, Math.round(d[ii + q] + delta)));
      }
    }
    const out = join(R21, 'bg-smooth.jpg');
    await sharp(d, { raw: { width: w, height: h, channels: c } }).jpeg({ quality: 95 }).toFile(out + '.tmp');
    renameSync(out + '.tmp', out);
    return out;
  })();
  for (const r of await Promise.all([
    encodeSet('svc-bg-1600', sharp(bgSmooth).resize(1500, 844), 1500, 844, false),
    encodeSet('svc-bg-m-960', sharp(bgSmooth).resize(960, 1200, { fit: 'cover' }), 960, 1200, false),
    ...CARD_M.flatMap((m, i) => [
      encodeSet(`svc-${i + 1}-640`, sharp(m).resize(640, 480, { fit: 'cover' }), 640, 480, false),
      encodeSet(`svc-${i + 1}-960`, sharp(m).resize(960, 720, { fit: 'cover' }), 960, 720, false),
    ]),
  ])) report.push(...r);

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
    /* разрез мобильного мастера 1152×1440 (он же отдаётся как 960×1200 / 640×800 — геометрия
       в координатах мастера, проверка пересчитывает через cover) */
    mob: { IW: MOBW, IH: MOBH, posY: MOB_POS_Y, title: mobTitle,
           cars: [Math.round(Math.max(0, cx0 - MX) * kMob), Math.round(cy0 * kMob),
                  Math.round(Math.min(MX + MCW, cx1) * kMob - MX * kMob), Math.round(cy1 * kMob)] },
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
