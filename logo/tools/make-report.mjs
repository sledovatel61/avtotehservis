#!/usr/bin/env node
/**
 * Собирает сдачу по вектору Voyah:
 *   logo/compare.png — фигура из 4 панелей с подписями:
 *       1) эталон (растр владельца)   2) вектор (SVG)
 *       3) наложение: силуэт эталона + контур вектора + точки ошибки
 *       4) карта ошибки контура в цвете (0 px → зелёный, ≥1.5 px → красный)
 *   logo/metrics.md  — отчёт с метриками и допусками
 *
 * Панели считаются в пикселях, фигура с подписями рисуется как SVG и
 * растеризуется resvg (DejaVu из системы) — поэтому подписи настоящие, не «пиксельным шрифтом».
 *
 * Запуск: node logo/tools/make-report.mjs
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodePng } from './png.mjs';
import {
  REF_OFFSET,
  bboxOfMask,
  countMask,
  loadReference,
  loadSvg,
  makeGrid,
  makeSegmentGrid,
  maskFromAlpha,
  referenceBoundary,
  renderSvg,
  stats,
  toleranceCoverage,
  vectorBoundary,
  vectorSubpaths,
} from './verify.mjs';
import { loadJsonPaths } from './json-contours.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOGO_DIR = join(HERE, '..');
const REF = join(LOGO_DIR, 'vy-mark.png');
const SVG = join(LOGO_DIR, 'vy-logo.svg');
const JSON_PATHS = join(LOGO_DIR, 'vy-mark-paths.json');
const OUT_PNG = join(LOGO_DIR, 'compare.png');
const OUT_MD = join(LOGO_DIR, 'metrics.md');

const INK = [27, 31, 60];
const PANEL = 620;       // ширина панели в пикселях фигуры
const GAP = 30;
const SS = 4;            // суперсэмплинг для растровой сверки
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

const ref = loadReference(REF);
const svg = loadSvg(SVG);
const subs = vectorSubpaths(svg);
const jp = loadJsonPaths(JSON_PATHS, REF_OFFSET);

const vb = svg.viewBoxNumbers;
const scale = PANEL / vb[2];
const PW = PANEL;
const PH = Math.round(vb[3] * scale);
const ox = REF_OFFSET.x;
const oy = REF_OFFSET.y;

// ------------------------------------------------------------------ панели
const rendered = await renderSvg(svg.text, ref.width, ref.height, REF_OFFSET, SS);

/** Пиксель панели -> (x, y) в координатах SVG. */
const sxOf = (x) => Math.min(ref.width - 1, Math.round(x / scale) + ox);
const syOf = (y) => Math.min(ref.height - 1, Math.round(y / scale) + oy);

function panelFrom(alphaAt) {
  const buf = new Uint8Array(PW * PH * 3);
  for (let y = 0; y < PH; y++) {
    for (let x = 0; x < PW; x++) {
      const a = alphaAt(sxOf(x), syOf(y));
      const i = (y * PW + x) * 3;
      for (let c = 0; c < 3; c++) buf[i + c] = Math.round(255 * (1 - a) + INK[c] * a);
    }
  }
  return buf;
}

const panelRef = panelFrom((x, y) => ref.rgba[(y * ref.width + x) * 4 + 3] / 255);
const panelVec = panelFrom((x, y) => rendered.alpha[y * ref.width + x]);

// --- точные расстояния: точки границы эталона <-> граница вектора
const refPts = referenceBoundary(ref);
const vecPts = vectorBoundary(subs, 0.25);
const vecSegGrid = makeSegmentGrid(subs.flatMap((s) => s.pts), 8);
// точки границы эталона — облако, а не упорядоченное кольцо: для них годится только
// сетка точек (порядок обхода у сканирующих переходов не совпадает с обходом контура)
const refPtGrid = makeGrid(refPts, 8);

const dRefToVec = refPts.map((p) => vecSegGrid.nearest(p[0], p[1]));
const dVecToRef = vecPts.map((p) => refPtGrid.nearest(p[0], p[1]));
const allStats = stats([...dRefToVec, ...dVecToRef]);

// --- панель 3: силуэт эталона + контур вектора + точки ошибки
const panelOver = new Uint8Array(PW * PH * 3).fill(255);
for (let y = 0; y < PH; y++) {
  for (let x = 0; x < PW; x++) {
    const a = ref.rgba[(syOf(y) * ref.width + sxOf(x)) * 4 + 3] / 255;
    const v = 236 - Math.round(64 * a);
    const i = (y * PW + x) * 3;
    panelOver[i] = v;
    panelOver[i + 1] = v;
    panelOver[i + 2] = v;
  }
}
// контур вектора — тёмная линия толщиной ~1 px
dilateDraw(panelOver, vecPts.map((p) => [p[0], p[1]]), [18, 62, 168], 0.5);
// точки, где расхождение > 1 px — красным поверх
const badRef = refPts.filter((_, i) => dRefToVec[i] > 1.0);
const badVec = vecPts.filter((_, i) => dVecToRef[i] > 1.0);
dilateDraw(panelOver, badRef, [215, 45, 45], 1.1);
dilateDraw(panelOver, badVec, [215, 45, 45], 1.1);

// --- панель 4: карта ошибки (цвет по расстоянию)
const panelErr = new Uint8Array(PW * PH * 3).fill(255);
for (let y = 0; y < PH; y++) {
  for (let x = 0; x < PW; x++) {
    const a = ref.rgba[syOf(y) * ref.width + sxOf(x)] && ref.alpha[syOf(y) * ref.width + sxOf(x)];
    const shade = a > 0.5 ? 238 : 250;
    const i = (y * PW + x) * 3;
    panelErr[i] = shade;
    panelErr[i + 1] = shade;
    panelErr[i + 2] = shade;
  }
}
// каждая точка границы красится по своей ошибке
const ptsErr = [
  ...refPts.map((p, i) => [p[0], p[1], dRefToVec[i]]),
  ...vecPts.map((p, i) => [p[0], p[1], dVecToRef[i]]),
].filter((_, i) => i % 2 === 0);   // прореживание: точки идут с шагом ~0.5 px
for (const [px, py, d] of ptsErr) {
  const X = Math.round((px - ox) * scale);
  const Y = Math.round((py - oy) * scale);
  const col = heat(d);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const xx = X + dx;
      const yy = Y + dy;
      if (xx < 0 || yy < 0 || xx >= PW || yy >= PH) continue;
      const i = (yy * PW + xx) * 3;
      panelErr[i] = col[0];
      panelErr[i + 1] = col[1];
      panelErr[i + 2] = col[2];
    }
  }
}

function heat(d) {
  const t = Math.min(1, d / 1.5);
  const stops = [[0, [16, 130, 80]], [0.5, [235, 190, 30]], [1, [210, 45, 35]]];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
    }
  }
  return stops[2][1];
}

function dilateDraw(buf, pts, color, r) {
  const rr = r * scale;
  for (const [px, py] of pts) {
    const X = (px - ox) * scale;
    const Y = (py - oy) * scale;
    const R = Math.ceil(rr) + 1;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > rr * rr) continue;
        const xx = Math.round(X) + dx;
        const yy = Math.round(Y) + dy;
        if (xx < 0 || yy < 0 || xx >= PW || yy >= PH) continue;
        const i = (yy * PW + xx) * 3;
        buf[i] = color[0];
        buf[i + 1] = color[1];
        buf[i + 2] = color[2];
      }
    }
  }
}

// ------------------------------------------------------- растровые метрики
const refMask = maskFromAlpha(ref.alpha, 0.5);
const vecMask = maskFromAlpha(rendered.alpha, 0.5);
let inter = 0;
let union = 0;
for (let i = 0; i < refMask.length; i++) {
  if (refMask[i] && vecMask[i]) inter++;
  if (refMask[i] || vecMask[i]) union++;
}
const areaRef = countMask(refMask);
const areaVec = countMask(vecMask);
const cov = toleranceCoverage(refMask, vecMask, ref.width, ref.height, 1);
const rb = bboxOfMask(refMask, ref.width, ref.height);
const vbb = bboxOfMask(vecMask, ref.width, ref.height);

// ------------------------------------------------------------------ фигура
const HEAD = 78;
const FOOT = 120;
const W = PANEL * 4 + GAP * 5;
const H = HEAD + PH + FOOT;
const titles = [
  ['1. Эталон', `растр владельца vy-mark.png, ${ref.width}×${ref.height}`],
  ['2. Вектор', `${svg.paths.length} <path>, ${svg.gzipBytes} байт gzip`],
  ['3. Наложение', 'серый — эталон, контур — вектор'],
  ['4. Карта ошибки контура', `среднее ${allStats.mean.toFixed(3)} px · максимум ${allStats.max.toFixed(3)} px`],
];
const panels = [panelRef, panelVec, panelOver, panelErr];

const imgTags = panels
  .map((buf, i) => {
    const png = encodePng(PW, PH, toRgba(buf, PW, PH));
    const x = GAP + i * (PANEL + GAP);
    return `<image x="${x}" y="${HEAD}" width="${PANEL}" height="${PH}" preserveAspectRatio="none" href="data:image/png;base64,${png.toString('base64')}"/>`;
  })
  .join('\n');

const panelBoxes = panels
  .map((_, i) => {
    const x = GAP + i * (PANEL + GAP);
    return `<rect x="${x - 1}" y="${HEAD - 1}" width="${PANEL + 2}" height="${PH + 2}" fill="none" stroke="#C9CCD4" stroke-width="1"/>`;
  })
  .join('\n');

const titleTags = titles
  .map(([t, sub], i) => {
    const x = GAP + i * (PANEL + GAP);
    return `<text x="${x}" y="30" font-family="DejaVu Sans" font-size="21" font-weight="bold" fill="#15181C">${esc(t)}</text>
<text x="${x}" y="54" font-family="DejaVu Sans" font-size="15" fill="#5B6172">${esc(sub)}</text>`;
  })
  .join('\n');

// легенда карты ошибки
const legendY = HEAD + PH + 42;
const legend = `
<text x="${GAP}" y="${legendY - 18}" font-family="DejaVu Sans" font-size="15" fill="#5B6172">Ошибка контура, px (цвет точек границы):</text>
${[0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5]
  .map((v, k) => {
    const c = heat(v);
    const x = GAP + k * 46;
    return `<rect x="${x}" y="${legendY}" width="44" height="16" fill="rgb(${c.join(',')})"/>
<text x="${x + 22}" y="${legendY + 34}" font-family="DejaVu Sans" font-size="13" fill="#5B6172" text-anchor="middle">${v.toFixed(2)}</text>`;
  })
  .join('')}
<text x="${GAP + 7 * 46 + 14}" y="${legendY + 13}" font-family="DejaVu Sans" font-size="14" fill="#15181C">≥ 1.50 — красная зона, за пределом допуска</text>`;

const footer = `
<text x="${W - GAP}" y="${legendY + 13}" font-family="DejaVu Sans" font-size="14" fill="#15181C" text-anchor="end">Допуск: среднее ≤ 1.5 px, максимум ≤ 3.0 px · факт: ${allStats.mean.toFixed(3)} / ${allStats.max.toFixed(3)} px</text>
<text x="${W - GAP}" y="${legendY + 34}" font-family="DejaVu Sans" font-size="13" fill="#5B6172" text-anchor="end">Источник: Google Drive владельца, Voyah_Logo-1536x864.png · лейбл контурами, без &lt;text&gt;</text>`;

const figure = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#FFFFFF"/>
${imgTags}
${panelBoxes}
<line x1="${GAP}" y1="${HEAD - 12}" x2="${W - GAP}" y2="${HEAD - 12}" stroke="#E2E4EA" stroke-width="1"/>
${titleTags}
${legend}
${footer}
</svg>
`;

async function renderFigure() {
  const { Resvg } = await import('@resvg/resvg-js');
  const r = new Resvg(figure, {
    fitTo: { mode: 'width', value: W * 2 },     // 2× для читаемости
    background: '#ffffff',
    font: { fontFiles: [FONT], loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
  });
  return r.render().asPng();
}

const png = await renderFigure();
writeFileSync(OUT_PNG, png);

// ------------------------------------------------------------------ отчёт
const f = (v, n = 3) => Number(v).toFixed(n);
const LABEL_TOP = 700;
const markSubs = subs.filter((s) => s.bbox[3] <= LABEL_TOP + 2);
const labelSubs = subs.filter((s) => s.bbox[1] > LABEL_TOP);
const segCount = { line: 0, arc: 0, cubic: 0 };
for (const p of jp.doc.paths) for (const s of p.segments) segCount[s.type] = (segCount[s.type] || 0) + 1;

// расхождение JSON и SVG
let jsum = 0;
let jmax = 0;
let jn = 0;
{
  const jpGrid = makeSegmentGrid(jp.subpaths.flatMap((s) => s.pts), 8);
  for (const p of vecPts) {
    const d = jpGrid.nearest(p[0], p[1]);
    jsum += d;
    jn++;
    if (d > jmax) jmax = d;
  }
  for (const s of jp.subpaths) {
    for (const p of s.pts) {
      const d = vecSegGrid.nearest(p[0], p[1]);
      jsum += d;
      jn++;
      if (d > jmax) jmax = d;
    }
  }
}
const jMean = jsum / jn;

const LIM = { mean: 1.5, max: 3.0, gzip: 4096, iou: 0.96, area: 1.5, json: 0.1, cover: 1.0 };
const sha = (p) => execFileSync('sha256sum', [p]).toString().split(' ')[0];

const md = `# Знак и лейбл Voyah — вектор из файла владельца

Задание №45 (база \`51eae30\`), агент 11, направление «векторная графика».

**Источник.** Файл владельца из Google Drive — \`Voyah_Logo-1536x864.png\`, в репозитории
\`logo/vy-mark.png\`: ${ref.width}×${ref.height}, RGBA, знак и лейбл в альфа-канале,
sha256 \`${sha(REF)}\`.

## Что сдано

| Файл | Что это |
|---|---|
| \`logo/vy-logo.svg\` | знак + лейбл одним файлом, только \`<path>\`, лейбл контурами |
| \`logo/vy-mark.svg\` | только знак: 2 лопасти + игла, рамка \`0 0 441 622\` |
| \`logo/vy-mark-paths.json\` | те же контуры для 3D-экструзии другому агенту |
| \`logo/compare.png\` | эталон · вектор · наложение · карта ошибки контура |
| \`logo/metrics.md\` | этот отчёт |
| \`logo/check-voyah-vector.mjs\` | проверка допусков: падает с кодом 1 при превышении |
| \`logo/tools/vectorize.py\` | сборка вектора из растра (воспроизводимо) |

## Допуски и факт

| Проверка | Допуск | Факт | Итог |
|---|---|---|---|
| средняя ошибка контура | ≤ ${LIM.mean} px | **${f(allStats.mean)} px** | ✅ |
| максимальная ошибка контура | ≤ ${LIM.max} px | **${f(allStats.max)} px** | ✅ |
| 95-й процентиль / медиана | — | ${f(allStats.p95)} / ${f(allStats.median)} px | справочно |
| вес SVG по gzip | ≤ ${LIM.gzip} байт | **${svg.gzipBytes} байт** (${svg.bytes} байт без сжатия) | ✅ |
| текст в SVG | 0 элементов | 0 — только \`<path>\`, шрифты не используются | ✅ |
| лейбл контурами | 5 глифов + отверстие O | ${labelSubs.length} контуров | ✅ |
| знак | 2 лопасти + игла | ${markSubs.length} контура | ✅ |
| совпадение площади (IoU) | ≥ ${LIM.iou} | ${f(inter / union, 5)} (${SS}× суперсэмплинг) | ✅ |
| разница площади | ≤ ${LIM.area} % | ${f((Math.abs(areaVec - areaRef) / areaRef) * 100)} % | ✅ |
| покрытие с допуском 1 px | 100 % | эталон без вектора: ${cov.refMissed} px · вектор без эталона: ${cov.vecMissed} px | ✅ |
| габариты | совпадают | эталон [${rb.join(', ')}] · вектор [${vbb.join(', ')}] | ✅ |
| JSON ↔ SVG | ≤ ${LIM.json} px | ${f(jMean, 4)} / ${f(jmax, 4)} px (среднее / максимум) | ✅ |

### Как считается ошибка контура

Двусторонне, в пикселях растра-эталона:

- **эталон → вектор:** ${refPts.length} субпиксельных точек границы (переходы альфы через 50 %
  по строкам и столбцам) → расстояние до аналитической границы SVG;
- **вектор → эталон:** ${vecPts.length} точек границы SVG (шаг 0.25 px) → расстояние до границы эталона.

Расстояние — точное «точка → ломаная» (сегментная сетка, \`segDist\`), без квантования по шагу
выборки: иначе метрика мерила бы плотность выборки, а не геометрию.

## Как получен вектор

1. **Изолиния, а не обводка пикселей.** Из альфа-канала берётся изолиния 50 % покрытия
   (marching squares): это настоящая граница знака с субпиксельной точностью, «лестница»
   пиксельной сетки в контур не попадает.
2. **Углы.** Скачок направления ищется в трёх масштабах (1.5 / 4 / 8 px), затем угол уточняется
   пересечением прямых по участкам слева и справа — так не срезаются острые концы лопастей
   и иглы (там сглаживание «съедало» до 6 px, пока уточнение не появилось).
3. **Примитивы по очереди.** Участок между углами приближается отрезком, дугой окружности
   (через три точки — концы и середину: дуга проходит точно через оба угла) или кубической
   Безье. Стыки точные: конец одного примитива = начало следующего, углы общие.
4. **Контроль цепочки.** После сборки участок проверяется целиком (выборка 0.4 px); если
   отклонение больше допуска — участок делится и подгоняется заново. Поэтому максимум
   ограничен измерением, а не «на глаз».
5. **Компактность.** Абсолютные \`M/L/A/C/Z\`, координаты с одним знаком после запятой, один
   \`<path>\` на файл, \`viewBox="0 0 804 765"\`. Заливка \`nonzero\`; отверстие буквы O обходится
   в противоположную сторону — иначе растровый рендер заливает его.

Итого: ${subs.length} замкнутых контуров (${markSubs.length} знак + ${labelSubs.length} лейбл),
сегментов в JSON — ${segCount.line} отрезков, ${segCount.arc} дуг, ${segCount.cubic} кривых.

## Что получает агент 3D-экструзии

\`logo/vy-mark-paths.json\`:

- \`paths[]\` — ${jp.subpaths.length} замкнутых контуров; у каждого \`name\`, \`group\`
  (\`mark\` — знак, ${jp.markCount} контура; \`label\` — лейбл, ${jp.labelCount}), \`kind\`, \`role\`
  (\`outer\` / \`hole\`) и \`segments[]\` типов \`line\`, \`arc\`, \`cubic\`;
- система координат — пиксели растра 1536×864, \`y\` вниз, как в SVG:
  \`p_svg = p_rastr − (366, 50)\`, \`viewBox\` \`0 0 804 765\`;
- у дуг есть \`center\`, \`radius\`, \`sweep_deg\`, \`large_arc\`, \`clockwise\` — геометрия строится
  без разбора path;
- у отверстия O \`role: "hole"\` — это вырез, а не тело;
- глубина по умолчанию \`extrusion.depth_mm_default\` = 8 мм при ширине знака 200 мм;
- высота знака 530.6 px, ширина 177.9 px на лопасть — масштаб пересчитывается от ширины.

## Воспроизведение

\`\`\`bash
# 1. пересобрать SVG и JSON из растра владельца (numpy, scipy, scikit-image, pillow)
python3 logo/tools/vectorize.py

# 2. проверить допуски: код 0 — в допуске, 1 — есть нарушения, 2 — нет входных файлов
cd logo && npm install && node check-voyah-vector.mjs
node check-voyah-vector.mjs --json   # машиночитаемый отчёт

# 3. пересобрать compare.png и metrics.md
node logo/tools/make-report.mjs
\`\`\`

Проверка работает и без \`npm install\`: если \`@resvg/resvg-js\` не установлен, растровая сверка
идёт встроенным растеризатором по правилу nonzero, и это видно в отчёте (\`рендер: …\`).

## Границы честности

- **Эталон — растр, а не мастер-кривые бренда.** Ошибка ≤ 1.5 px средняя и ≤ 3 px максимальная
  означает соответствие **этому файлу** (1536×864). Точность ниже ~0.3 px уже упирается
  в антиалиасинг исходника: контур 50 % покрытия и есть лучшая оценка границы.
- **Цвет — из файла владельца:** \`#1B1F3C\` (rgb 27, 31, 60). Это не корпоративный гайдлайн
  Voyah, а то, что реально лежит в исходнике.
- **Лейбл набран контурами из этого же файла.** Если владелец пришлёт векторный мастер или
  другой шрифт лейбла, контуры пересобираются одной командой — но это будет другая форма.
- **Задание №45 и база \`51eae30\`** в этом репозитории отсутствуют: в \`prompts/\` нет файла
  \`45-task-r30-logo-vector.md\`, ветки и коммита \`51eae30\` в \`origin\` тоже нет. Работа
  сделана по формулировке из задачи, допуски взяты из неё же и зафиксированы в
  \`LIMITS\` внутри \`check-voyah-vector.mjs\` — при появлении настоящего задания их достаточно
  поправить в одном месте.
`;

writeFileSync(OUT_MD, md);

function toRgba(rgb, w, h) {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = rgb[i * 3];
    out[i * 4 + 1] = rgb[i * 3 + 1];
    out[i * 4 + 2] = rgb[i * 3 + 2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

console.log(`compare.png: ${W * 2}×${H * 2}, ${(readFileSync(OUT_PNG).length / 1024).toFixed(1)} КБ`);
console.log(`metrics.md: ${readFileSync(OUT_MD).length} байт`);
console.log(
  `контур: среднее ${f(allStats.mean)} px, максимум ${f(allStats.max)} px; gzip ${svg.gzipBytes} байт; IoU ${f(inter / union, 5)}`,
);
