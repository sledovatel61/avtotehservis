#!/usr/bin/env node
/**
 * Проверка векторного знака и лейбла Voyah.
 *
 * Падает (exit 1) при нарушении любого допуска:
 *
 *   геометрия  средняя ошибка контура ≤ 1.5 px, максимум ≤ 3 px (эталон logo/vy-mark.png)
 *   состав     2 лопасти + игла + 5 глифов лейбла + отверстие O, лейбл контурами
 *   запрет     никаких <text>/<tspan>/шрифтов в SVG
 *   вес        SVG ≤ 4096 байт в gzip
 *   эталон     SVG растеризуется в ту же область, что и raстр (IoU ≥ 0.99)
 *   JSON       logo/vy-mark-paths.json описывает те же контуры (расхождение ≤ 0.05 px)
 *
 * Запуск:  node logo/check-voyah-vector.mjs
 *          node logo/check-voyah-vector.mjs --json     # машиночитаемый отчёт
 * Код выхода: 0 — всё в допуске, 1 — есть нарушения, 2 — не найдены входные файлы.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REF_OFFSET,
  countMask,
  toleranceCoverage,
  bboxOfMask,
  contourMetrics,
  iou,
  loadReference,
  loadSvg,
  makeGrid,
  makeSegmentGrid,
  maskFromAlpha,
  referenceBoundary,
  renderSvg,
  stats,
  vectorBoundary,
  vectorSubpaths,
} from './tools/verify.mjs';
import { loadJsonPaths } from './tools/json-contours.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** --svg / --ref позволяют проверить другой файл (нужно для негативных тестов). */
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]) : fallback;
}

const REF = arg('ref', join(HERE, 'vy-mark.png'));
const LOGO = arg('svg', join(HERE, 'vy-logo.svg'));
const MARK = arg('mark', join(HERE, 'vy-mark.svg'));
const JSON_PATHS = arg('json', join(HERE, 'vy-mark-paths.json'));

export const LIMITS = {
  meanPx: 1.5,
  maxPx: 3.0,
  gzipBytes: 4096,
  iou: 0.96,           // IoU по маске 50 %: шов антиалиасинга ~1 px даёт ~2 % площади
  areaError: 0.015,    // относительная разница площади
  tolerancePx: 1.0,    // покрытие с допуском: каждая маска внутри раздутой другой
  jsonDeviationPx: 0.1,
};

const checks = [];
function check(name, ok, detail, hard = true) {
  checks.push({ name, ok, detail, hard });
  return ok;
}

if (!existsSync(REF) || !existsSync(LOGO)) {
  console.error(`Не найдены входные файлы: ${REF} / ${LOGO}`);
  process.exit(2);
}

const ref = loadReference(REF);
const W = ref.width;
const H = ref.height;
const svg = loadSvg(LOGO);

// ------------------------------------------------------------------ 1. вес
check(
  'вес SVG ≤ 4 КБ gzip',
  svg.gzipBytes <= LIMITS.gzipBytes,
  `${svg.gzipBytes} байт gzip (${svg.bytes} байт без сжатия), предел ${LIMITS.gzipBytes}`,
);

// ------------------------------------------------- 2. никакого текста/шрифтов
check('в SVG нет <text>/<tspan>', !svg.hasText, svg.hasText ? 'найден текстовый элемент' : 'только <path>');
check(
  'в SVG нет шрифтовых атрибутов',
  !svg.hasFontAttr,
  svg.hasFontAttr ? 'найден font-family/font-size/@font-face' : 'шрифты не используются',
);

// -------------------------------------------------------- 3. состав контуров
const subs = vectorSubpaths(svg);
const viewBoxOk =
  svg.viewBoxNumbers &&
  svg.viewBoxNumbers.length === 4 &&
  svg.viewBoxNumbers[2] === 804 &&
  svg.viewBoxNumbers[3] === 765;
check('viewBox 0 0 804 765', !!viewBoxOk, svg.viewBox || 'viewBox отсутствует');

const LABEL_TOP = 700;
const markSubs = subs.filter((s) => s.bbox[3] <= LABEL_TOP + 2);
const labelSubs = subs.filter((s) => s.bbox[1] > LABEL_TOP);
check(
  'знак: 3 контура (2 лопасти + игла)',
  markSubs.length === 3,
  `найдено ${markSubs.length}`,
);
const blades = markSubs.filter((s) => s.bbox[2] - s.bbox[0] >= 70);
const needles = markSubs.filter((s) => s.bbox[2] - s.bbox[0] < 70);
check('лопасти: 2, ширина ≥ 70 px', blades.length === 2, `найдено ${blades.length}`);
check('игла: 1, ширина < 70 px', needles.length === 1, `найдено ${needles.length}`);
check(
  'лейбл: 5 глифов + отверстие O',
  labelSubs.length === 6,
  `найдено ${labelSubs.length} контуров (ожидается 6: V O Y A H и отверстие O)`,
);
check(
  'лейбл задан контурами, а не текстом',
  labelSubs.length >= 5 && !svg.hasText,
  `контуров лейбла ${labelSubs.length}, текстовых элементов 0`,
);
check(
  'все контуры замкнуты',
  subs.every((s) => s.closed),
  `${subs.length} контуров`,
);

// -------------------------------------------------------- 4. ошибка контура
const refPts = referenceBoundary(ref);
const refGrid = makeGrid(refPts, 8);
const vecPts = vectorBoundary(subs, 0.25);
const vecGrid = makeSegmentGrid(subs.flatMap((s) => s.pts), 8);
const cm = contourMetrics(refPts, refGrid, vecPts, vecGrid);
check(
  `средняя ошибка контура ≤ ${LIMITS.meanPx} px`,
  cm.stats.mean <= LIMITS.meanPx,
  `среднее ${cm.stats.mean.toFixed(3)} px (медиана ${cm.stats.median.toFixed(3)}, p95 ${cm.stats.p95.toFixed(3)})`,
);
check(
  `максимальная ошибка контура ≤ ${LIMITS.maxPx} px`,
  cm.stats.max <= LIMITS.maxPx,
  `максимум ${cm.stats.max.toFixed(3)} px`,
);

// ------------------------------------------------- 5. растровая сверка (IoU)
// растровую сверку делаем с 4-кратным суперсэмплингом: антиалиасинг SVG-рендерера
// при 1:1 садится на полпикселя и даёт «шов», не связанный с геометрией контура
const SS = 4;
const rendered = await renderSvg(svg.text, W, H, REF_OFFSET, SS);
const refMask = maskFromAlpha(ref.alpha, 0.5);
const vecMask = maskFromAlpha(rendered.alpha, 0.5);
const ov = iou(refMask, vecMask, W, H);
const areaRef = countMask(refMask);
const areaVec = countMask(vecMask);
const areaErr = Math.abs(areaVec - areaRef) / areaRef;
check(
  `совпадение площади (IoU) ≥ ${LIMITS.iou}`,
  ov.iou >= LIMITS.iou,
  `IoU ${ov.iou.toFixed(5)}; общая площадь ${ov.inter} / ${ov.union} px; рендер: ${rendered.renderer}, ${SS}× суперсэмплинг`,
);
check(
  `разница площади ≤ ${(LIMITS.areaError * 100).toFixed(1)} %`,
  areaErr <= LIMITS.areaError,
  `эталон ${areaRef} px, вектор ${areaVec} px, расхождение ${(areaErr * 100).toFixed(3)} %`,
);
const cover = toleranceCoverage(refMask, vecMask, W, H, LIMITS.tolerancePx);
check(
  `покрытие с допуском ${LIMITS.tolerancePx} px = 100 %`,
  cover.refMissed === 0 && cover.vecMissed === 0,
  `пикселей эталона без вектора рядом: ${cover.refMissed}; пикселей вектора без эталона рядом: ${cover.vecMissed}`,
);
const rb = bboxOfMask(refMask, W, H);
const vb = bboxOfMask(vecMask, W, H);
const bboxDelta = Math.max(...rb.map((v, i) => Math.abs(v - vb[i])));
check(
  'габариты вектора и эталона совпадают',
  bboxDelta <= 2,
  `эталон [${rb.join(', ')}], вектор [${vb.join(', ')}], расхождение ${bboxDelta} px`,
);

// --------------------------------------------------------- 6. отдельный знак
if (existsSync(MARK)) {
  const markSvg = loadSvg(MARK);
  const markSubs2 = vectorSubpaths(markSvg);
  check(
    'vy-mark.svg: только знак, 3 контура',
    markSubs2.length === 3,
    `контуров ${markSubs2.length}, gzip ${markSvg.gzipBytes} байт`,
  );
  check(
    'vy-mark.svg: тот же контур, что в логотипе',
    markSubs2.every((s) => s.bbox[3] <= LABEL_TOP + 2),
    'лейбл не входит в отдельный знак',
  );
}

// ---------------------------------------------------------- 7. JSON контуров
if (existsSync(JSON_PATHS)) {
  const jp = loadJsonPaths(JSON_PATHS, REF_OFFSET);
  check('JSON: 9 замкнутых контуров', jp.subpaths.length === 9, `найдено ${jp.subpaths.length}`);
  const jPts = vectorBoundary(jp.subpaths, 0.25);
  const jGrid = makeSegmentGrid(jp.subpaths.flatMap((s) => s.pts), 8);
  let sum = 0;
  let max = 0;
  for (const p of vecPts) {
    const d = jGrid.nearest(p[0], p[1]);
    sum += d;
    max = Math.max(max, d);
  }
  for (const p of jPts) {
    const d = vecGrid.nearest(p[0], p[1]);
    sum += d;
    max = Math.max(max, d);
  }
  const deviation = { mean: sum / (vecPts.length + jPts.length), max };
  check(
    'JSON описывает те же контуры, что SVG',
    deviation.max <= LIMITS.jsonDeviationPx,
    `расхождение среднее ${deviation.mean.toFixed(4)} px, максимум ${deviation.max.toFixed(4)} px`,
  );
  check(
    'JSON: группы mark и label, отверстие O помечено role=hole',
    jp.markCount === 3 && jp.labelCount === 6 && jp.holeCount === 1,
    `mark ${jp.markCount}, label ${jp.labelCount}, hole ${jp.holeCount}`,
  );
} else {
  check('logo/vy-mark-paths.json существует', false, `файл ${JSON_PATHS} не найден`);
}

// ------------------------------------------------------------------ отчёт
const jsonOut = process.argv.includes('--json');
const failed = checks.filter((c) => c.hard && !c.ok);
if (jsonOut) {
  console.log(
    JSON.stringify(
      {
        ok: failed.length === 0,
        limits: LIMITS,
        metrics: {
          contour: cm.stats,
          refToVector: cm.refToVec,
          vectorToRef: cm.vecToRef,
          iou: ov.iou,
          gzipBytes: svg.gzipBytes,
          bytes: svg.bytes,
          refBoundaryPoints: refPts.length,
          vectorBoundaryPoints: vecPts.length,
        },
        checks,
      },
      null,
      2,
    ),
  );
} else {
  console.log('Проверка знака и лейбла Voyah\n');
  for (const c of checks) {
    console.log(`${c.ok ? '  ok  ' : ' ПАДЕНИЕ'}  ${c.name}\n         ${c.detail}`);
  }
  console.log(
    `\nконтур: среднее ${cm.stats.mean.toFixed(3)} px, p95 ${cm.stats.p95.toFixed(3)} px, максимум ${cm.stats.max.toFixed(3)} px`,
  );
  console.log(`точек границы: эталон ${refPts.length}, вектор ${vecPts.length}`);
  console.log(`SVG: ${svg.bytes} байт, gzip ${svg.gzipBytes} байт (предел ${LIMITS.gzipBytes})`);
  console.log(`\n${failed.length === 0 ? 'ИТОГ: в допуске' : `ИТОГ: нарушено проверок — ${failed.length}`}`);
  for (const c of failed) console.log(`  · ${c.name}: ${c.detail}`);
}
process.exit(failed.length === 0 ? 0 : 1);
