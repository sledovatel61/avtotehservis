#!/usr/bin/env node
/**
 * Картинка «эталон ↔ вектор» для отчёта по знаку Voyah (задание №48).
 *
 * Четыре панели, все — в пикселях эталона
 * docs/brand/voyah/source/logo-black-on-white.png:
 *
 *   1. исходник владельца (знак, лейбл и зазор — как есть);
 *   2. чистый вектор из vy-lockup.svg, отрисованный в тех же координатах;
 *   3. наложение: серый силуэт эталона + синий контур вектора;
 *   4. карта ошибки: |эталон − вектор| по контуру, зелёный → красный.
 *
 * Внизу — отдельные панели знака и локапа и числовые подписи.
 * Всё считается теми же функциями, что и гейт (scripts/lib/voyah-vector.mjs),
 * поэтому картинка не может «врать» отдельно от проверки.
 *
 * Запуск: node site/scripts/make-voyah-vector-report.mjs
 * Выход:  docs/reports/r30-logo-vector/compare.png, metrics.json, README.md
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Resvg } from '@resvg/resvg-js';

import {
  loadReference, loadSvg, svgSubpaths, referenceBoundary, vectorBoundary,
  makeGrid, makeSegmentGrid, contourMetrics, renderSvg, normalizeForRender,
  maskFromAlpha, countMask, iouCounts, bboxOfMask, splitRows, alphaBbox, contrast, hexToRgb,
} from './lib/voyah-vector.mjs';
import { LIMITS } from './check-voyah-vector.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, '..');
const ROOT = join(SITE, '..');
const IMG = join(SITE, 'public', 'img');
const OUT = join(ROOT, 'docs', 'reports', 'r30-logo-vector');
const REF = join(ROOT, 'docs', 'brand', 'voyah', 'source', 'logo-black-on-white.png');

mkdirSync(OUT, { recursive: true });

const ref = loadReference(REF);
const json = JSON.parse(readFileSync(join(IMG, 'vy-mark-paths.json'), 'utf8'));
const split = splitRows(ref);
const markBbox = alphaBbox(ref, 0, split.labelTop);
const labelBbox = alphaBbox(ref, split.labelTop, ref.height);

/* ---- рендер варианта в координатах эталона (1:1, без суперсэмплинга) ---- */
async function renderRegion(svgFile, origin, scale = 4) {
  const svg = loadSvg(join(IMG, svgFile));
  const rendered = await renderSvg(svg.text, ref, origin[0], origin[1], scale);
  return { svg, alpha: rendered.alpha };
}

const lockup = await renderRegion('vy-lockup.svg', json.frames.lockup.origin_px);
const mark = await renderRegion('vy-mark.svg', json.frames.mark.origin_px);

const refMask = maskFromAlpha(ref.alpha, 0.5);
const vecMask = maskFromAlpha(lockup.alpha, 0.5);
const markMask = maskFromAlpha(mark.alpha, 0.5);

/* окно отчёта в координатах эталона: знак + зазор + лейбл целиком */
const VB = { left: markBbox[0] - 8, top: 40, width: 830, height: 800 };

const { iou } = iouCounts(refMask, vecMask, ref.width, ref.height);
const cm = (() => {
  const o = json.frames.lockup.origin_px;
  const placed = svgSubpaths(lockup.svg).map((s) => ({ ...s, pts: s.pts.map(([x, y]) => [x + o[0], y + o[1]]) }));
  const refPts = referenceBoundary(ref);
  const vecSeg = makeSegmentGrid(placed.flatMap((s) => s.pts), 8);
  const vecGrid = makeGrid(refPts, 8);
  return contourMetrics(refPts, vecSeg, vectorBoundary(placed, 0.25), vecGrid);
})();

/* обрезка полного кадра до окна отчёта */
async function crop(rgba) {
  return sharp(Buffer.from(rgba), { raw: { width: ref.width, height: ref.height, channels: 4 } })
    .extract(VB).png().toBuffer();
}

/* ---- расстояние до контура, в цвет ---- */
/**
 * Карта ошибки. Показываем «две стороны» контура, как их меряет гейт:
 *   • зелёный…красный — расстояние от точки границы ЭТАЛОНА до вектора
 *     (0 px → 1.5 px, порог средней ошибки);
 *   • голубой — расстояние от точки контура ВЕКТОРА до эталона.
 * Середина штриха красится нейтрально: там ошибки контура быть не может,
 * иначе вся заливка становится красной и карта теряет смысл.
 */
function errorField() {
  const o = json.frames.lockup.origin_px;
  const placed = svgSubpaths(lockup.svg).map((s) => ({ ...s, pts: s.pts.map(([x, y]) => [x + o[0], y + o[1]]) }));
  const vecPts = placed.flatMap((s) => s.pts);
  const segVec = makeSegmentGrid(vecPts, 8);
  const refPts = referenceBoundary(ref);
  const gridRef = makeGrid(refPts, 8);

  const rgba = Buffer.alloc(ref.width * ref.height * 4);
  for (let i = 0; i < ref.width * ref.height; i++) {
    rgba[i * 4] = 12; rgba[i * 4 + 1] = 17; rgba[i * 4 + 2] = 25; rgba[i * 4 + 3] = 255;
  }
  // тело знака — приглушённая подложка, чтобы читалась форма
  for (let i = 0; i < ref.width * ref.height; i++) {
    if (ref.alpha[i] > 0.5) { rgba[i * 4] = 38; rgba[i * 4 + 1] = 46; rgba[i * 4 + 2] = 60; }
  }
  const paint = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= ref.width || y >= ref.height) return;
    const i = (y * ref.width + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b;
  };
  // точка вектора → расстояние до эталона (обратный ход), голубым — под низ
  for (const p of vectorBoundary(placed, 0.34)) {
    const d = gridRef.nearest(p[0], p[1]);
    const t = Math.min(1, d / 1.5);
    paint(Math.round(p[0]), Math.round(p[1]), Math.round(60 + t * 80), Math.round(150 - t * 60), 255);
  }
  // точка эталона → расстояние до вектора (основная метрика), зелёный → красный, сверху
  for (const p of refPts) {
    const d = segVec.nearest(p[0], p[1]);
    const t = Math.min(1, d / 1.5);
    paint(Math.round(p[0]), Math.round(p[1]), Math.round(40 + t * 215), Math.round(220 - t * 130), Math.round(90 - t * 40));
  }
  return rgba;
}

const field = errorField();

/* ---- панели ---- */
function panel(buf, w, h, label, bg = '#0A0F17') {
  return { buf, w, h, label, bg };
}

async function toPng(rgba, w, h) {
  return sharp(Buffer.from(rgba), { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/* 1. исходник: белое поле → тёмная подложка, знак чёрным */
function sourceRgba() {
  const [ir, ig, ib] = hexToRgb('#1B1F3C'); // краска владельца
  const rgba = Buffer.alloc(ref.width * ref.height * 4);
  for (let i = 0; i < ref.width * ref.height; i++) {
    const a = ref.alpha[i];
    rgba[i * 4] = Math.round(255 + (ir - 255) * a);
    rgba[i * 4 + 1] = Math.round(255 + (ig - 255) * a);
    rgba[i * 4 + 2] = Math.round(255 + (ib - 255) * a);
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/* 2. вектор: заливка #C9D3DE на тёмном */
async function vectorRgba(alpha) {
  const rgba = Buffer.alloc(ref.width * ref.height * 4);
  const [r, g, b] = hexToRgb('#C9D3DE');
  for (let i = 0; i < ref.width * ref.height; i++) {
    const a = alpha[i];
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = Math.round(255 * Math.max(a, 0));
  }
  const base = Buffer.alloc(ref.width * ref.height * 4);
  for (let i = 0; i < ref.width * ref.height; i++) {
    base[i * 4] = 7; base[i * 4 + 1] = 11; base[i * 4 + 2] = 18; base[i * 4 + 3] = 255;
  }
  return await sharp(base, { raw: { width: ref.width, height: ref.height, channels: 4 } })
    .composite([{ input: Buffer.from(rgba), raw: { width: ref.width, height: ref.height, channels: 4 } }])
    .raw().toBuffer();
}

/* 3. наложение: серый силуэт + синий контур */
function overlayRgba() {
  const rgba = Buffer.alloc(ref.width * ref.height * 4);
  const o = json.frames.lockup.origin_px;
  const placed = svgSubpaths(lockup.svg).map((s) => ({ ...s, pts: s.pts.map(([x, y]) => [x + o[0], y + o[1]]) }));
  const line = new Set();
  for (const s of placed) {
    const pts = s.pts;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
      for (let k = 0; k <= n; k++) {
        const x = Math.round(a[0] + ((b[0] - a[0]) * k) / n);
        const y = Math.round(a[1] + ((b[1] - a[1]) * k) / n);
        line.add(y * ref.width + x);
      }
    }
  }
  for (let i = 0; i < ref.width * ref.height; i++) {
    const v = ref.alpha[i];
    // силуэт эталона — светло-серый, чтобы синий и пурпурный контуры читались
    rgba[i * 4] = Math.round(7 + 90 * v);
    rgba[i * 4 + 1] = Math.round(11 + 100 * v);
    rgba[i * 4 + 2] = Math.round(18 + 116 * v);
    rgba[i * 4 + 3] = 255;
    const inVec = vecMask[i] > 0;
    const inRef = v > 0.5;
    // пурпурный — там, где заливки расходятся (гейт M2/L2/K2)
    if (inRef !== inVec) { rgba[i * 4] = 233; rgba[i * 4 + 1] = 74; rgba[i * 4 + 2] = 190; }
    if (line.has(i)) { rgba[i * 4] = 20; rgba[i * 4 + 1] = 90; rgba[i * 4 + 2] = 255; }
  }
  return rgba;
}

const panels = [
  panel(await toPng(sourceRgba(), ref.width, ref.height), ref.width, ref.height, '1. исходник владельца (logo-black-on-white.png, 1536×864)'),
  panel(await toPng(await vectorRgba(lockup.alpha), ref.width, ref.height), ref.width, ref.height, '2. вектор vy-lockup.svg → те же координаты'),
  panel(await toPng(overlayRgba(), ref.width, ref.height), ref.width, ref.height, '3. наложение: силуэт эталона, контур вектора, пурпурный — расхождение заливки'),
  panel(await toPng(field, ref.width, ref.height), ref.width, ref.height, '4. карта ошибки контура: зелёный 0 px → красный 1.5 px; жёлтый — расхождение заливки'),
];

/* ---- текстовые подписи: SVG-шапка и подвал поверх полотна ---- */
const GAP = 18;
const LABEL = 34;
const PAD = 24;
const cropH = VB.height;
const totalW = PAD * 2 + panels[0].w * 2 + GAP;
const gridH = LABEL + cropH;

function fmt(n, d = 3) { return Number(n).toFixed(d); }

const note = [
  `метрики: средняя ${fmt(cm.stats.mean)} px · медиана ${fmt(cm.stats.median)} · p95 ${fmt(cm.stats.p95)} · максимум ${fmt(cm.stats.max)} px`,
  `площадь: эталон ${countMask(refMask)} px · вектор ${countMask(vecMask)} px · IoU ${iou.toFixed(5)} (порог ${LIMITS.iou})`,
  `знак: bbox эталона [${markBbox.join(', ')}] · пропорция ${(json.frames.mark.aspect).toFixed(4)} · кадр ${json.frames.mark.viewBox}`,
  `лейбл: пропорция ${(json.frames.label.aspect).toFixed(4)} · локап ${(json.frames.lockup.aspect).toFixed(4)} · контраст #FFFFFF на #070B12 ${contrast([255, 255, 255], hexToRgb('#070B12')).toFixed(2)}:1`,
];

const W = totalW;
const H = PAD * 2 + LABEL * 2 + gridH * 2 + 130;
const parts = [];
for (let p = 0; p < panels.length; p++) {
  const col = p % 2;
  const row = Math.floor(p / 2);
  const x = PAD + col * (panels[p].w + GAP);
  const y = PAD + row * (gridH + LABEL) + LABEL;
  parts.push(`<text x="${x}" y="${y - 12}" fill="#C9D3DE" font-family="DejaVu Sans, sans-serif" font-size="17">${panels[p].label}</text>`);
  parts.push(`<rect x="${x - 1}" y="${y - 1}" width="${panels[p].w + 2}" height="${cropH + 2}" fill="none" stroke="#2A3646"/>`);
}

const svgText = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#070B12"/>
  ${note.map((t, i) => `<text x="${PAD}" y="${H - 96 + i * 22}" fill="#8FA3B8" font-family="DejaVu Sans, sans-serif" font-size="15">${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`).join('')}
  ${parts.join('')}
</svg>`;

const svgRenderer = new Resvg(svgText, { fitTo: { mode: 'width', value: W }, font: { loadSystemFonts: true } });
const svgPng = svgRenderer.render().asPng();

const composites = panels.map((p, i) => ({
  input: p.buf,
  left: PAD + (i % 2) * (p.w + GAP),
  top: PAD + Math.floor(i / 2) * (gridH + LABEL) + LABEL,
  raw: undefined,
}));

const comparePath = join(OUT, 'compare.png');
await sharp(svgPng).composite(composites).png({ compressionLevel: 9 }).toFile(comparePath);

/* ---- отчёт ---- */
const stats = {
  source: { file: 'docs/brand/voyah/source/logo-black-on-white.png', size: [ref.width, ref.height] },
  limits: LIMITS,
  frames: json.frames,
  geometry: {
    lockup: { iou, areaRef: countMask(refMask), areaVec: countMask(vecMask), contour: cm.stats, refToVec: cm.refToVec, vecToRef: cm.vecToRef },
    mark: {
      bboxRef: markBbox,
      bboxVec: bboxOfMask(markMask, ref.width, ref.height),
    },
  },
  variants: Object.fromEntries(['vy-mark', 'vy-label', 'vy-lockup'].flatMap((b) => (
    ['', '-light', '-dark', '-ghost'].map((s) => {
      const f = `${b}${s}.svg`;
      const svg = loadSvg(join(IMG, f));
      return [f, { bytes: svg.bytes, gzipBytes: svg.gzipBytes, viewBox: svg.viewBox, paths: svg.paths.length }];
    })
  ))),
  contrast: [
    { fg: '#FFFFFF', bg: '#070B12', ratio: contrast(hexToRgb('#FFFFFF'), hexToRgb('#070B12')) },
    { fg: '#C9D3DE', bg: '#070B12', ratio: contrast(hexToRgb('#C9D3DE'), hexToRgb('#070B12')) },
    { fg: '#FFFFFF', bg: '#0E1622', ratio: contrast(hexToRgb('#FFFFFF'), hexToRgb('#0E1622')) },
    { fg: '#1B1F3C', bg: '#070B12', ratio: contrast(hexToRgb('#1B1F3C'), hexToRgb('#070B12')) },
    { fg: '#1B1F3C', bg: '#FFFFFF', ratio: contrast(hexToRgb('#1B1F3C'), [255, 255, 255]) },
  ].map((c) => ({ ...c, ratio: Number(c.ratio.toFixed(2)) })),
};
writeFileSync(join(OUT, 'metrics.json'), JSON.stringify(stats, null, 2) + '\n');

console.log(`compare.png: ${W}×${H}`);
console.log(`контур: средняя ${fmt(cm.stats.mean)} / p95 ${fmt(cm.stats.p95)} / max ${fmt(cm.stats.max)} px, IoU ${iou.toFixed(5)}`);
console.log(`metrics.json записан`);
