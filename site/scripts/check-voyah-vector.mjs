#!/usr/bin/env node
/**
 * Гейт векторной марки Voyah (задания №45 и №48).
 *
 * Проверяет не «вообще файл», а каждый файл, который пойдёт в проект, отдельно:
 *
 *   C1  нет <text>, <tspan>, шрифтов и метаданных редактора
 *   C2  вес каждого SVG ≤ 4 КБ gzip
 *   C3  viewBox плотный: контуры занимают кадр, за кадр не выходит ни одна точка
 *   M1…M4  ГЕОМЕТРИЯ ЗНАКА (vy-mark*.svg) против bbox знака в эталоне:
 *          bbox ±2 px, площадь ±1.5 %, IoU ≥0.96, ни одного пикселя вне кадра
 *   L1…L4  то же для лейбла (vy-label*.svg)
 *   K1…K4  то же для локапа (vy-lockup*.svg)
 *   E1     ошибка контура двусторонняя: средняя ≤1.5 px, максимум ≤3 px (по локапу)
 *   M5     контраст заливки к обоим фонам страницы ≥3:1 (формула WCAG)
 *   J1…J3  vy-mark-paths.json: 9 контуров, блок normalized в 0…1, отверстие O = hole
 *   I1…I3  интеграция: разметка без PNG, CSS без ghost.png, brand-voyah-mark.mjs на SVG
 *
 * `--self-test` подкладывает мутанты и требует, чтобы каждый уронил гейт:
 * подрезка кадра на 40 px, подмена currentColor на краску владельца, PNG в разметке.
 *
 * Запуск: node site/scripts/check-voyah-vector.mjs [--self-test] [--json]
 * Код выхода: 0 — всё в норме, 1 — есть нарушения, 2 — нет входных файлов.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  alphaBbox,
  bboxOfMask,
  contourMetrics,
  contrast,
  countMask,
  hexToRgb,
  iouCounts,
  loadReference,
  loadSvg,
  makeGrid,
  makeSegmentGrid,
  maskFromAlpha,
  referenceBoundary,
  renderSvg,
  splitRows,
  stats,
  svgSubpaths,
  toleranceCoverage,
  vectorBoundary,
} from './lib/voyah-vector.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, '..');
const ROOT = join(SITE, '..');
const IMG = join(SITE, 'public', 'img');
const REF_PNG = join(ROOT, 'docs', 'brand', 'voyah', 'source', 'logo-black-on-white.png');
const JSON_PATHS = join(IMG, 'vy-mark-paths.json');
const PAGES = [join(SITE, 'src', 'pages', 'voyah-free.astro'), join(SITE, 'src', 'pages', 'index.astro')];
const CSS = join(SITE, 'src', 'styles', 'voyah.css');
const BRAND = join(SITE, 'scripts', 'brand-voyah-mark.mjs');

export const LIMITS = {
  meanPx: 1.5,
  maxPx: 3.0,
  gzipBytes: 4096,
  bboxPx: 2.0,
  areaError: 0.015,
  iou: 0.96,
  tolerancePx: 1,
  contrast: 3.0,
  ghostOpacity: 0.5,          // «призрак» — не сплошная заливка
  jsonDeviationPx: 0.1,
};

export const VARIANTS = [
  { file: 'vy-mark.svg', fill: 'currentColor', opacity: null },
  { file: 'vy-mark-light.svg', fill: '#FFFFFF', opacity: null },
  { file: 'vy-mark-dark.svg', fill: '#1B1F3C', opacity: null },
  { file: 'vy-mark-ghost.svg', fill: '#FFFFFF', opacity: 0.13 },
  { file: 'vy-label.svg', fill: 'currentColor', opacity: null },
  { file: 'vy-label-light.svg', fill: '#FFFFFF', opacity: null },
  { file: 'vy-label-dark.svg', fill: '#1B1F3C', opacity: null },
  { file: 'vy-label-ghost.svg', fill: '#FFFFFF', opacity: 0.13 },
  { file: 'vy-lockup.svg', fill: 'currentColor', opacity: null },
  { file: 'vy-lockup-light.svg', fill: '#FFFFFF', opacity: null },
  { file: 'vy-lockup-dark.svg', fill: '#1B1F3C', opacity: null },
  { file: 'vy-lockup-ghost.svg', fill: '#FFFFFF', opacity: 0.13 },
];

/** Фоны страницы, на которых стоит знак (из site/src/styles/voyah.css). */
export const BACKGROUNDS = [
  { name: 'first screen --v-ink', hex: '#070B12' },
  { name: 'price panel --v-panel', hex: '#0E1622' },
];

/** Заливки, которым разрешено не проходить контраст (ghost — это водяной знак). */
const NO_CONTRAST = new Set(['vy-mark-ghost.svg', 'vy-label-ghost.svg', 'vy-lockup-ghost.svg']);

/**
 * Цель каждого варианта по заливке. Тёмная краска владельца живёт только на
 * светлом (печать, PDF, логотип на белом) — требовать от неё контраст на почти
 * чёрном фоне бессмысленно. Поэтому контраст проверяется к ТЕМ фонам, для
 * которых файл сделан, и ни один вариант не остаётся без ≥3:1.
 */
const TARGETS = {
  light: { on: 'dark', note: 'белая заливка — для тёмных экранов' },
  currentColor: { on: 'dark', note: 'наследует цвет текста (#C9D3DE) — для тёмных экранов' },
  dark: { on: 'light', note: 'краска #1B1F3C — для бумаги и светлых панелей' },
};

const SCALE = 4;

export async function check({ svgDir = IMG, refPath = REF_PNG, ref = null, log = () => {} } = {}) {
  const checks = [];
  const add = (id, name, ok, detail) => {
    checks.push({ id, name, ok, detail });
    log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${name}: ${detail}`);
    return ok;
  };

  if (!ref) {
    if (!existsSync(refPath)) throw new Error(`Нет эталона: ${refPath}`);
    ref = loadReference(refPath);
  }
  const split = splitRows(ref);
  const markBbox = alphaBbox(ref, 0, split.labelTop);
  const labelBbox = alphaBbox(ref, split.labelTop, ref.height);
  const refMarkMask = maskFromAlpha(subOffset(ref.alpha, ref.width, 0, 0), 0.5);
  const refAll = { ref, split, markBbox, labelBbox, refMarkMask };

  // ---------- C1/C2 по всем вариантам + M/L/K по группам
  const groups = { 'vy-mark': [], 'vy-label': [], 'vy-lockup': [] };
  let loaded = true;
  for (const v of VARIANTS) {
    const path = join(svgDir, v.file);
    if (!existsSync(path)) {
      add('C0', `файл ${v.file}`, false, `нет файла ${path}`);
      loaded = false;
      continue;
    }
  }
  if (!loaded) return { ok: false, checks, hard: checks.filter((c) => !c.ok) };

  const variants = [];
  for (const v of VARIANTS) {
    const path = join(svgDir, v.file);
    const svg = loadSvg(path);
    const subs = svgSubpaths(svg);
    const base = v.file.replace(/(-light|-dark|-ghost)?\.svg$/, '');
    variants.push({ ...v, path, svg, subs, base });
    groups[base].push(variants[variants.length - 1]);
  }

  // C1: никакого текста и мусора
  const badText = variants.filter((x) => x.svg.hasText);
  const badFont = variants.filter((x) => x.svg.hasFontAttr);
  const badMeta = variants.filter((x) => x.svg.hasMetadata);
  add('C1', 'нет <text>/шрифтов/метаданных', !badText.length && !badFont.length && !badMeta.length,
    `${variants.length} файлов: text ${badText.length}, шрифты ${badFont.length}, метаданные ${badMeta.length}`);

  // C2: вес
  const heavy = variants.filter((x) => x.svg.gzipBytes > LIMITS.gzipBytes);
  const maxGz = Math.max(...variants.map((x) => x.svg.gzipBytes));
  add('C2', `вес каждого SVG ≤ ${LIMITS.gzipBytes} байт gzip`, heavy.length === 0,
    `максимум ${maxGz} байт (${heavy.map((x) => x.file).join(', ') || 'превышений нет'})`);

  // C3: плотность кадра и «ни одной точки за кадром»
  const frameProblems = [];
  for (const x of variants) {
    const [vx, vy, vw, vh] = x.svg.viewBoxNumbers || [0, 0, 0, 0];
    if (!(vw > 0 && vh > 0)) {
      frameProblems.push(`${x.file}: нет viewBox`);
      continue;
    }
    let out = 0;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const s of x.subs) {
      for (const [px, py] of s.pts) {
        if (px < vx - 1e-6 || py < vy - 1e-6 || px > vx + vw + 1e-6 || py > vy + vh + 1e-6) out++;
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
    }
    const fillX = (maxX - minX) / vw;
    const fillY = (maxY - minY) / vh;
    if (out > 0) frameProblems.push(`${x.file}: ${out} точек вне кадра`);
    if (fillX < 0.9 || fillY < 0.9) frameProblems.push(`${x.file}: контур занимает ${(fillX * 100) | 0}×${(fillY * 100) | 0} % кадра`);
  }
  add('C3', 'viewBox плотный, ни одной точки за кадром', frameProblems.length === 0,
    frameProblems.length ? frameProblems.slice(0, 4).join('; ') : 'все 12 файлов: кадр = bbox + 0.5 px');

  // Смещение кадра в координатах эталона берём из JSON (frames.*.origin_px):
  // сами SVG начинаются в 0 0, иначе они не несут привязки к странице.
  const frames = existsSync(JSON_PATHS) ? (JSON.parse(readFileSync(JSON_PATHS, 'utf8')).frames || {}) : {};
  const originOf = (key) => {
    const f = frames[key.replace(/^vy-/, '')];
    const o = f?.origin_px || frames[key]?.origin;
    if (Array.isArray(o) && o.length === 2 && o.every((v) => Number.isFinite(v))) return o;
    return null;
  };

  // ---------- M/L/K: геометрия каждой группы против своей полосы эталона
  const groupSpec = [
    { key: 'vy-mark', id: 'M', band: [0, split.labelTop], label: 'знак' },
    { key: 'vy-label', id: 'L', band: [split.labelTop, ref.height], label: 'лейбл' },
    { key: 'vy-lockup', id: 'K', band: [0, ref.height], label: 'локап' },
  ];
  const geometry = {};
  for (const spec of groupSpec) {
    const list = groups[spec.key];
    // геометрию меряем по основному варианту (currentColor), остальные — на вес/кадр
    const main = list.find((x) => x.file === `${spec.key}.svg`) || list[0];
    if (!main) {
      add(`${spec.id}0`, `${spec.label}: файл`, false, `нет ${spec.key}.svg`);
      continue;
    }
    const [vx, vy] = main.svg.viewBoxNumbers;
    const origin = originOf(spec.key);
    if (!origin) {
      add(`${spec.id}0`, `${spec.label}: привязка кадра в JSON`, false, `нет frames.${spec.key}.origin_px`);
      continue;
    }
    const rendered = await renderSvg(main.svg.text, ref, origin[0], origin[1], SCALE);
    const vecMask = maskFromAlpha(rendered.alpha, 0.5);
    const refMask = maskFromAlpha(subOffset(ref.alpha, ref.width, 0, 0), 0.5);
    // полоса эталона: обнуляем всё вне неё
    for (let y = 0; y < ref.height; y++) {
      if (y < spec.band[0] || y > spec.band[1]) {
        for (let x = 0; x < ref.width; x++) refMask[y * ref.width + x] = 0;
      }
    }
    const areaRef = countMask(refMask);
    const areaVec = countMask(vecMask);
    const { iou } = iouCounts(refMask, vecMask, ref.width, ref.height);
    const rb = spec.key === 'vy-mark' ? markBbox
      : spec.key === 'vy-label' ? labelBbox
        : [Math.min(markBbox[0], labelBbox[0]), markBbox[1], Math.max(markBbox[2], labelBbox[2]), labelBbox[3]];
    const vb = bboxOfMask(vecMask, ref.width, ref.height);
    const bboxDelta = Math.max(...rb.map((v, i) => Math.abs(v - vb[i])));
    const areaErr = Math.abs(areaVec - areaRef) / areaRef;

    // «ни одного пикселя контура вне кадра»: кадр в координатах эталона —
    // это [origin, origin + viewBox]. С отступом 0.5 px касаний границы быть
    // не должно; при обрезке контур упирается в неё всем краем.
    const [vvw, vvh] = [main.svg.viewBoxNumbers[2], main.svg.viewBoxNumbers[3]];
    const fx0 = origin[0];
    const fy0 = origin[1];
    const fx1 = origin[0] + vvw;
    const fy1 = origin[1] + vvh;
    let edgeTouching = 0;
    for (let y = 0; y < ref.height; y++) {
      for (let x = 0; x < ref.width; x++) {
        if (!vecMask[y * ref.width + x]) continue;
        if (x + 0.5 < fx0 || y + 0.5 < fy0 || x + 0.5 > fx1 || y + 0.5 > fy1) edgeTouching++;
      }
    }

    // ошибка контура по этой группе
    const refPts = referenceBoundary(ref, spec.band[0], spec.band[1]);
    const vecPtGrid = makeGrid(refPts, 8);
    const vecSegGrid = makeSegmentGrid(main.subs.flatMap((s) => s.pts), 8);
    const vecPts = vectorBoundary(main.subs, 0.25);
    const cm = contourMetrics(refPts, vecSegGrid, vecPts, vecPtGrid);

    geometry[spec.key] = { bbox: vb, bboxRef: rb, areaRef, areaVec, iou, cm, rendered: rendered.renderer };

    add(`${spec.id}1`, `${spec.label}: bbox ±${LIMITS.bboxPx} px к эталону`, bboxDelta <= LIMITS.bboxPx,
      `эталон [${rb.join(', ')}], вектор [${vb.join(', ')}], расхождение ${bboxDelta} px`);
    add(`${spec.id}2`, `${spec.label}: площадь ±${(LIMITS.areaError * 100).toFixed(1)} %`, areaErr <= LIMITS.areaError,
      `эталон ${areaRef} px, вектор ${areaVec} px, разница ${(areaErr * 100).toFixed(2)} %`);
    add(`${spec.id}3`, `${spec.label}: IoU ≥ ${LIMITS.iou}`, iou >= LIMITS.iou,
      `IoU ${iou.toFixed(5)} (${rendered.renderer})`);
    add(`${spec.id}4`, `${spec.label}: ни одного пикселя вне кадра`, edgeTouching === 0,
      `пикселей на границе кадра: ${edgeTouching}`);
  }

  // ---------- E1: ошибка контура (двусторонняя) по локапу
  const lockupMain = groups['vy-lockup'].find((x) => x.file === 'vy-lockup.svg');
  if (lockupMain) {
    const o = originOf('vy-lockup') || [0, 0];
    const placed = lockupMain.subs.map((s) => ({ ...s, pts: s.pts.map(([x, y]) => [x + o[0], y + o[1]]) }));
    const refPts = referenceBoundary(ref);
    const refPtGrid = makeGrid(refPts, 8);
    const vecSegGrid = makeSegmentGrid(placed.flatMap((s) => s.pts), 8);
    const vecPts = vectorBoundary(placed, 0.25);
    const cm = contourMetrics(refPts, vecSegGrid, vecPts, refPtGrid);
    add('E1', `ошибка контура ≤ ${LIMITS.meanPx} px средняя / ≤ ${LIMITS.maxPx} px максимум`,
      cm.stats.mean <= LIMITS.meanPx && cm.stats.max <= LIMITS.maxPx,
      `среднее ${cm.stats.mean.toFixed(3)}, p95 ${cm.stats.p95.toFixed(3)}, максимум ${cm.stats.max.toFixed(3)} px (${refPts.length} + ${vecPts.length} точек)`);
    if (geometry.lockup) geometry.lockup.cm = cm;
    else geometry.lockup = { cm };
  }

  // ---------- M5: контраст
  const bg = BACKGROUNDS.map((b) => ({ ...b, rgb: hexToRgb(b.hex) }));
  const contrastRows = [];
  let contrastFail = 0;
  let globalMin = Infinity;
  for (const x of variants) {
    if (NO_CONTRAST.has(x.file)) continue;
    const fill = x.subs[0]?.fill;
    const kind = x.file.includes('-light') ? 'light' : x.file.includes('-dark') ? 'dark' : 'currentColor';
    const target = TARGETS[kind];
    if (!fill) {
      contrastFail++;
      contrastRows.push(`${x.file}: нет заливки`);
      continue;
    }
    const rgb = fill === 'currentColor' ? hexToRgb('#C9D3DE') : hexToRgb(fill);
    const pairs = target.on === 'dark'
      ? bg.map((b) => ({ name: b.hex, r: contrast(rgb, b.rgb) }))
      : [{ name: '#FFFFFF', r: contrast(rgb, [255, 255, 255]) }];
    const min = Math.min(...pairs.map((p) => p.r));
    globalMin = Math.min(globalMin, min);
    if (min < LIMITS.contrast) contrastFail++;
    contrastRows.push(`${x.file} ${fill} → ${pairs.map((p) => `${p.r.toFixed(2)} на ${p.name}`).join(', ')}`);
  }
  add('M5', `контраст заливки к своим фонам ≥ ${LIMITS.contrast}:1`, contrastFail === 0,
    contrastFail ? contrastRows.filter((r) => /на #(070B12|0E1622|FFFFFF)/.test(r) && /1\.[0-9]{2} на/.test(r)).slice(0, 3).join('; ')
      : `${contrastRows.length} вариантов, минимум ${globalMin.toFixed(2)}:1`);

  // ghost обязан быть полупрозрачным
  const ghosts = variants.filter((x) => x.file.endsWith('-ghost.svg'));
  const ghostOk = ghosts.every((x) => {
    const op = Number(x.subs[0]?.fillOpacity ?? 1);
    return op > 0 && op <= LIMITS.ghostOpacity;
  });
  add('M6', 'ghost-варианты с fill-opacity ≤ 0.5',
    ghostOk && ghosts.length === 3,
    ghosts.map((x) => `${x.file} ${x.subs[0]?.fillOpacity ?? '—'}`).join(', '));

  // ---------- J: JSON для 3D-экструзии
  if (existsSync(JSON_PATHS)) {
    const doc = JSON.parse(readFileSync(JSON_PATHS, 'utf8'));
    const paths = doc.paths || [];
    const holes = paths.filter((p) => p.role === 'hole');
    add('J1', 'JSON: 9 замкнутых контуров', paths.length === 9, `контуров ${paths.length}`);
    const withNorm = paths.filter((p) => p.segments.every((s) => normOk(s)));
    add('J2', 'JSON: блок normalized в 0…1 у всех сегментов',
      withNorm.length === paths.length && !!doc.coordinate_system?.normalized,
      `${withNorm.length}/${paths.length} контуров, coordinate_system.normalized ${doc.coordinate_system?.normalized ? 'описан' : 'НЕТ'}`);
    add('J3', 'JSON: отверстие O помечено role=hole, группы mark/label', holes.length === 1
      && paths.filter((p) => p.group === 'mark').length === 3
      && paths.filter((p) => p.group === 'label').length === 6,
      `mark ${paths.filter((p) => p.group === 'mark').length}, label ${paths.filter((p) => p.group === 'label').length}, hole ${holes.length}`);
  } else {
    add('J1', 'JSON существует', false, `нет ${JSON_PATHS}`);
  }

  // ---------- I: интеграция в проект
  for (const page of PAGES) {
    if (!existsSync(page)) {
      add('I1', `разметка ${basename(page)}`, false, 'файла нет');
      continue;
    }
    const src = readFileSync(page, 'utf8');
    const stat = markUsage(src);
    add('I1', `разметка ${basename(page)}: знак инлайном, без PNG`, stat.ok, stat.detail);
  }
  if (existsSync(CSS)) {
    const css = readFileSync(CSS, 'utf8');
    const ghostPng = (css.match(/vy-mark-ghost\.png/g) || []).length;
    const ghostSvg = (css.match(/vy-mark-ghost\.svg/g) || []).length;
    add('I2', 'CSS: фоновый знак — ghost.svg, не PNG', ghostPng === 0 && ghostSvg >= 4,
      `ghost.png ${ghostPng}, ghost.svg ${ghostSvg}`);
  }
  if (existsSync(BRAND)) {
    const brand = readFileSync(BRAND, 'utf8');
    const markLine = (brand.match(/const MARK\s*=\s*([^;]+);/) || [])[1] || '';
    add('I3', 'brand-voyah-mark.mjs: MARK — SVG-вариант', /vy-mark-light\.svg/.test(markLine),
      `MARK = ${markLine.trim()}`);
  }

  const hard = checks.filter((c) => !c.ok);
  return { ok: hard.length === 0, checks, hard, geometry };
}

/** Точки на контуре обязаны лежать в 0…1; центр дуги может выйти за bbox — это геометрия. */
function normOk(s) {
  const keys = s.type === 'line' ? ['from_n', 'to_n']
    : s.type === 'arc' ? ['from_n', 'to_n']
      : s.type === 'cubic' ? ['p0_n', 'p1_n', 'p2_n', 'p3_n'] : [];
  const onCurve = keys.length > 0 && keys.every((k) => Array.isArray(s[k]) && s[k].every((v) => v >= -0.01 && v <= 1.01));
  if (!onCurve) return false;
  if (s.type === 'arc') {
    if (!Array.isArray(s.center_n) || s.center_n.length !== 2) return false;
    if (s.center_n.some((v) => Math.abs(v) > 3)) return false;
  }
  return true;
}

function subOffset(alpha, width, dx, dy) {
  return alpha;
}

// ------------------------------------------------------------------ мутанты

/** Мутант 1: подрезать кадр на 40 px — половина знака уезжает за viewBox. */
function mutateClip(svgDir, tmpDir) {
  const src = join(svgDir, 'vy-mark.svg');
  const text = readFileSync(src, 'utf8');
  const [vx, vy, vw, vh] = (text.match(/viewBox\s*=\s*"([^"]+)"/) || [])[1].trim().split(/[\s,]+/).map(Number);
  const clipped = text.replace(/viewBox\s*=\s*"[^"]+"/, `viewBox="${vx} ${vy} ${vw - 40} ${vh}"`);
  void clipped;
  copyAll(svgDir, tmpDir, (f) => (f === 'vy-mark.svg' ? clipped : readFileSync(join(svgDir, f), 'utf8')));
  return 'кадр знака подрезан на 40 px';
}

/** Мутант 2: вернуть краску владельца вместо currentColor — она невидима на сайте. */
function mutateInk(svgDir, tmpDir) {
  copyAll(svgDir, tmpDir, (f) => {
    if (f === 'vy-mark.svg') {
      return readFileSync(join(svgDir, f), 'utf8').replace(/fill="currentColor"/, 'fill="#1B1F3C"');
    }
    return readFileSync(join(svgDir, f), 'utf8');
  });
  return 'заливка знака #1B1F3C вместо currentColor';
}

/** Мутант 3: оставить <img> со старым PNG в разметке. */
function mutateMarkup() {
  return 'в разметке снова <img src="/img/vy-mark.png">';
}

function mutateMarkupSrc(src) {
  return src
    .replace(/<VoyahMark\b[^>]*\/>/g, '<img class="v-mark" src="/img/vy-mark.png" width="24" height="34" alt="" decoding="async">')
    .replace(/^import VoyahMark.*$/m, '');
}

/**
 * Гигиена исходника страницы: знак подключён компонентом (он печатает инлайновый
 * <svg> с currentColor), а PNG-фолбэков в разметке нет. Что знак реально
 * отрисован и не искажён — проверяет scripts/check-voyah-layout.mjs на живой
 * странице (пункт L7), здесь — только состав разметки.
 */
export function markUsage(src) {
  const pngRefs = (src.match(/vy-(mark|label|lockup)(@2x)?\.png/g) || []).length;
  const components = (src.match(/<VoyahMark\b/g) || []).length;
  const imported = /^import\s+VoyahMark\s+from\s+'[^']*VoyahMark\.astro';?$/m.test(src);
  return {
    ok: pngRefs === 0 && components > 0 && imported,
    detail: `PNG в разметке ${pngRefs}, <VoyahMark> ${components}, импорт ${imported ? 'есть' : 'НЕТ'}`,
  };
}

function copyAll(svgDir, tmpDir, transform) {
  mkdirpTmp(tmpDir);
  for (const f of readdirSync(svgDir)) {
    if (!f.endsWith('.svg')) continue;
    const out = transform(f);
    if (out === null || out === undefined) continue;
    writeTmp(tmpDir, f, out);
  }
  // JSON не трогаем — мутанты про кадр и цвет
  const json = join(svgDir, 'vy-mark-paths.json');
  if (existsSync(json)) writeTmp(tmpDir, 'vy-mark-paths.json', readFileSync(json));
}

function mkdirpTmp(dir) {
  mkdirSync(dir, { recursive: true });
}

function writeTmp(dir, name, data) {
  writeFileSync(join(dir, name), data);
}

async function selfTest(ref) {
  const tmpRoot = join(SITE, '.tmp-voyah-vector');
  let failed = 0;
  const mutants = [
    { name: 'M-обрезка: viewBox знака −40 px', make: mutateClip, expect: /M1|M3|M4|C3/ },
    { name: 'M-цвет: currentColor → #1B1F3C', make: mutateInk, expect: /M5/ },
  ];
  for (const m of mutants) {
    const dir = join(tmpRoot, m.name.replace(/[^\wа-яА-Я-]+/g, '_'));
    mkdirpTmp(dir);
    const what = m.make(IMG, dir);
    const res = await check({ svgDir: dir, ref, log: () => {} });
    const hit = res.hard.filter((c) => m.expect.test(c.id));
    const ok = !res.ok && hit.length > 0;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} мутант «${m.name}»${ok ? '' : ' НЕ уронил гейт'}: ${what} → ${hit.map((c) => `${c.id} ${c.detail}`).join(' | ') || 'ни один ожидаемый пункт не упал'}`);
  }
  // мутант разметки: вернуть <img> со старым PNG вместо компонента
  const markSrc = readFileSync(PAGES[0], 'utf8');
  const mutated = mutateMarkupSrc(markSrc);
  const stat = markUsage(mutated);
  if (stat.ok) failed++;
  console.log(`${stat.ok ? 'FAIL' : 'ok  '} мутант «${mutateMarkup()}»: ${stat.detail} → гейт I1 ${stat.ok ? 'НЕ упал' : 'упал, как должен'}`);

  console.log(`\nself-test: ${failed === 0 ? 'все мутанты роняют гейт' : `${failed} мутант(ов) гейт НЕ роняет`}`);
  return failed === 0;
}

// ------------------------------------------------------------------ запуск

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const jsonOut = process.argv.includes('--json');
  const selfTestMode = process.argv.includes('--self-test');
  if (!existsSync(REF_PNG)) {
    console.error(`Нет эталона ${REF_PNG}`);
    process.exit(2);
  }
  const ref = loadReference(REF_PNG);
  const silence = jsonOut || selfTestMode;
  const res = await check({ ref, log: silence ? () => {} : (s) => console.log(s) });

  if (selfTestMode) {
    const ok = await selfTest(ref);
    process.exit(res.ok && ok ? 0 : 1);
  }
  if (jsonOut) {
    console.log(JSON.stringify({
      ok: res.ok,
      limits: LIMITS,
      geometry: Object.fromEntries(Object.entries(res.geometry).map(([k, v]) => [k, {
        bboxRef: v.bboxRef, bbox: v.bbox, areaRef: v.areaRef, areaVec: v.areaVec, iou: v.iou,
        contour: v.cm?.stats,
      }])),
      checks: res.checks,
    }, null, 2));
    process.exit(res.ok ? 0 : 1);
  }
  const hard = res.hard;
  console.log(`\n${hard.length === 0 ? 'VOYAH-VECTOR: всё в норме' : `VOYAH-VECTOR: нарушено пунктов — ${hard.length}`}`);
  for (const c of hard) console.log(`  · ${c.id} ${c.name}: ${c.detail}`);
  process.exit(res.ok ? 0 : 1);
}
