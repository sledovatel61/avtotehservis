#!/usr/bin/env node
/**
 * Ортогональный рендер силуэта машины сбоку + числа (задание №52, круг 31).
 *
 * Зачем: «похоже / не похоже» — не аргумент. Скрипт рисует машину в чистом орто
 * (без перспективы) ровно в метровом масштабе, накладывает направляющую сетку
 * (земля, оси колёс, крыша, порог) и печатает отношения из задания:
 * длина/высота, база/длина, диаметр колеса/высота, крыша, клиренс, зазор арки.
 *
 * Геометрия берётся из `src/client/car-profile.ts` — того же модуля, что
 * использует заставка. Поэтому гейт `check-car-profile.mjs` может подсунуть
 * «мутанта» (растянуть длину, опустить крышу…) и убедиться, что числа поехали.
 *
 * Запуск:
 *   LD_LIBRARY_PATH=/tmp/al2023/lib node scripts/car-profile.mjs            # PNG + числа
 *   LD_LIBRARY_PATH=/tmp/al2023/lib node scripts/car-profile.mjs --json     # только числа
 *   OUT=... node scripts/car-profile.mjs                                    # куда положить PNG
 *
 * В песочнице у Chromium нет libnss3: библиотеки лежат в @sparticuz/chromium
 * (архив al2023.tar.br), распаковка — см. scripts/intro-stills.mjs.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import sharp from 'sharp';
import { CAR, carGlsl, carMetrics, carSilhouetteGlsl } from '../src/client/car-profile.ts';

/* карта орто-проекции: метры → пиксели. Ширина кадра 1200 px = 5,3 м */
export const VIEW = { w: 1200, h: 500, x0: -2.65, x1: 2.65, pxPerM: 1200 / 5.3 };

export const mapping = () => {
  const pxPerM = VIEW.w / (VIEW.x1 - VIEW.x0);
  const yBottom = -0.18; /* низ кадра в метрах: чуть ниже земли */
  return {
    pxPerM,
    toPx: (x) => (x - VIEW.x0) * pxPerM,
    /* экранный y растёт вниз, поэтому земля y=0 — на строке row0 */
    row0: VIEW.h + yBottom * pxPerM,
    toRow: (y) => VIEW.h + yBottom * pxPerM - y * pxPerM,
    viewX: (px) => VIEW.x0 + px / pxPerM,
  };
};

const ORTHO_FS = (glsl) => `#version 300 es
precision highp float;
out vec4 O;
uniform vec2 uRes;
${glsl}
void main(){
  /* чистое орто сбоку: ни перспективы, ни наклона — только (x, y) в метрах.
     gl_FragCoord.y растёт вверх от низа кадра, строки PNG — вниз */
  vec2 p = vec2(${VIEW.x0} + gl_FragCoord.x / uRes.x * ${(VIEW.x1 - VIEW.x0).toFixed(4)},
                ${(-0.18).toFixed(4)} + gl_FragCoord.y / uRes.y * ${(VIEW.h / VIEW.pxPerM).toFixed(4)});
  float d = sdSide2D(p);
  if (d > 0.0) { O = vec4(0.0, 0.0, 0.0, 1.0); return; }
  const vec2 e = vec2(0.004, 0.0);
  vec2 g = normalize(vec2(sdSide2D(p + e.xy) - sdSide2D(p - e.xy),
                          sdSide2D(p + e.yx) - sdSide2D(p - e.yx)));
  float sh = 0.42 + 0.58 * clamp(dot(g, normalize(vec2(0.55, 0.75))), 0.0, 1.0);
  O = vec4(clamp(vec3(sh) * vec3(0.62, 0.86, 1.0) + 0.18, 0.0, 1.0), 1.0);
}`;

const PAGE = (fs) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#000}canvas{display:block}</style>
<canvas id="c" width="${VIEW.w}" height="${VIEW.h}"></canvas>
<script>
const fs = ${JSON.stringify(fs)};
const vs = ${JSON.stringify(`#version 300 es
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`)};
const gl = document.getElementById('c').getContext('webgl2', {
  antialias: false, alpha: false, depth: false, preserveDrawingBuffer: true,
  desynchronized: false, premultipliedAlpha: false,
});
window.__err = null;
const make = (type, src) => {
  const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
};
try {
  const p = gl.createProgram();
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  gl.useProgram(p);
  gl.uniform2f(gl.getUniformLocation(p, 'uRes'), ${VIEW.w}, ${VIEW.h});
  gl.viewport(0, 0, ${VIEW.w}, ${VIEW.h});
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.finish();
  window.__ok = true;
} catch (e) { window.__err = String(e); }
</script>`;

/** Рисует силуэт и возвращает сырой PNG (без сетки) — его и меряет гейт. */
export async function renderSilhouette(browser, car = CAR) {
  const page = await browser.newPage();
  await page.setViewport({ width: VIEW.w, height: VIEW.h, deviceScaleFactor: 1 });
  await page.setContent(PAGE(ORTHO_FS(carGlsl(car) + carSilhouetteGlsl(car))), { waitUntil: 'load' });
  /* один кадр рисуется сразу, но композитор забирает его не мгновенно */
  await new Promise((r) => setTimeout(r, 400));
  const err = await page.evaluate(() => window.__err);
  if (err) { await page.close(); throw new Error('шейдер: ' + err); }
  const png = await page.screenshot({ type: 'png' });
  await page.close();
  return png;
}

/** Меряет силуэт по картинке: длина, высота, колесо, зазор арки, клиренс, база. */
export async function measure(png) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const m = mapping();
  const on = (x, y) => {
    const i = (y * w + x) * info.channels;
    return data[i] > 40 || data[i + 1] > 40 || data[i + 2] > 40;
  };
  /* bbox силуэта */
  let minX = w, maxX = -1, minY = h, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error('силуэт пустой');
  const px = m.pxPerM;
  const length = (maxX - minX + 1) / px;
  const height = (m.row0 - minY) / px;

  /* пик крыши: самый верхний ряд силуэта. Доля от носа — так «кабина сзади»
     проверяется числом, а не на глаз */
  const peak = [];
  for (let x = minX; x <= maxX; x++) if (on(x, minY)) peak.push(x);
  const peakPx = peak[Math.floor(peak.length / 2)];

  /* арки ищём структурно: колонка, где снизу шина (от земли), выше — зазор,
     ещё выше — кузов. Такой профиль есть только над колёсами. */
  const arch = [];
  for (let x = 0; x < w; x++) {
    const runs = [];
    let start = -1;
    for (let y = 0; y < h; y++) {
      const v = on(x, y);
      if (v && start < 0) start = y;
      if (!v && start >= 0) { runs.push([start, y - 1]); start = -1; }
    }
    if (start >= 0) runs.push([start, h - 1]);
    if (runs.length !== 2) continue;
    const [body, tyre] = runs; /* сверху вниз: сначала кузов, ниже — шина */
    const tyreH = (m.row0 - tyre[0]) / px;
    if (tyreH < 0.35 || tyreH > 1.05) continue;
    if (tyre[1] < m.row0 - 1.5) continue;                   /* низ шины у земли */
    const gap = (tyre[0] - body[1] - 1) / px;
    if (gap < 0 || gap > 0.2) continue;
    arch.push({ x, tyreH, gap });
  }
  if (arch.length < 8) throw new Error(`не нашёл арок (колонок с шиной и зазором: ${arch.length})`);
  const median = (a) => a.slice().sort((p1, p2) => p1 - p2)[Math.floor(a.length / 2)];
  /* диаметр — верхняя точка шины (у центра колеса), зазор — самый узкий (там же) */
  const wheelD = Math.max(...arch.map((a) => a.tyreH));
  const archGap = Math.min(...arch.map((a) => a.gap));
  const roofTop = (m.row0 - minY) / px;

  /* база: центроиды левой и правой групп арочных колонок */
  const xs = arch.map((a) => a.x).sort((a, b) => a - b);
  const clusters = [[xs[0]]];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] <= 3) clusters[clusters.length - 1].push(xs[i]);
    else clusters.push([xs[i]]);
  }
  const centres = clusters.filter((c) => c.length > 4).map((c) => (c[0] + c[c.length - 1]) / 2);
  const wheelbase = centres.length >= 2 ? (Math.max(...centres) - Math.min(...centres)) / px : NaN;

  /* клиренс: самая низкая точка кузова между арками (по оси машины) */
  const cx = Math.round(m.toPx(0));
  let sill = NaN;
  for (let y = h - 1; y >= 0; y--) {
    if (on(cx, y)) { sill = (m.row0 - y) / px; break; }
  }

  return {
    length: +length.toFixed(3),
    height: +height.toFixed(3),
    roofTop: +roofTop.toFixed(3),
    wheelD: +wheelD.toFixed(3),
    archGap: +archGap.toFixed(3),
    clearance: +sill.toFixed(3),
    wheelbase: +wheelbase.toFixed(3),
    /* x пика крыши в метрах и его доля от носа (0 — нос, 1 — корма) */
    roofPeakX: +(m.viewX(peakPx)).toFixed(3),
    roofPeakFrac: +((maxX - peakPx) / (maxX - minX + 1)).toFixed(3),
    pxPerM: +px.toFixed(1),
  };
}

/** Сетка-наложение: земля, оси колёс, крыша, порог, база. */
export async function withGrid(png) {
  const m = mapping();
  const car = carMetrics();
  const line = (y1, x2, y2, color, dash = '') =>
    `<line x1="${m.toPx(VIEW.x0)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="1" ${dash}/>`;
  const rows = [];
  const xR = VIEW.w;
  const items = [
    { y: 0, color: '#39e08a', label: 'земля 0,000' },
    { y: car.clearance, color: '#7ad0ff', label: `порог ${car.clearance.toFixed(3)}` },
    { y: car.roofTop, color: '#ffd166', label: `крыша ${car.roofTop.toFixed(3)}` },
    { y: CAR.wheelD / 2, color: '#9aa7b8', label: `ось колеса ${(CAR.wheelD / 2).toFixed(3)}` },
  ];
  for (const it of items) rows.push(line(m.toRow(it.y), xR, m.toRow(it.y), it.color));
  const axleX = [CAR.wheelbase / 2, -CAR.wheelbase / 2];
  for (const ax of axleX) rows.push(
    `<line x1="${m.toPx(ax).toFixed(1)}" y1="${m.toRow(car.roofTop).toFixed(1)}" x2="${m.toPx(ax).toFixed(1)}" y2="${m.toRow(0).toFixed(1)}" stroke="#ff8fa3" stroke-width="1" stroke-dasharray="6 6"/>`,
  );
  rows.push(`<line x1="${m.toPx(axleX[1]).toFixed(1)}" y1="${(m.toRow(0) + 8).toFixed(1)}" x2="${m.toPx(axleX[0]).toFixed(1)}" y2="${(m.toRow(0) + 8).toFixed(1)}" stroke="#ff8fa3" stroke-width="1"/>`);
  const labels = items.map((it) => {
    const y = m.toRow(it.y);
    return `<text x="6" y="${(y - 4).toFixed(1)}" fill="${it.color}" font-family="monospace" font-size="13">${it.label}</text>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEW.w}" height="${VIEW.h}">
    ${rows.join('\n')}
    <text x="6" y="${(m.toRow(0) - 4 - 18).toFixed(1)}" fill="#ff8fa3" font-family="monospace" font-size="13">база ${car.wheelbase.toFixed(3)}</text>
    ${labels}
  </svg>`;
  return sharp(png).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const jsonOnly = process.argv.includes('--json');
  const browser = await puppeteer.launch({
    executablePath: await chromium.executablePath(),
    args: [...chromium.args.filter((a) => a !== '--single-process'), '--no-sandbox',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    headless: 'shell',
    protocolTimeout: 60000,
  });
  try {
    const png = await renderSilhouette(browser);
    const nums = await measure(png);
    const spec = carMetrics();
    const out = {
      spec,
      measured: nums,
      ratios: {
        lengthOverHeight: +(nums.length / nums.height).toFixed(3),
        baseOverLength: +(nums.wheelbase / nums.length).toFixed(3),
        wheelOverHeight: +(nums.wheelD / nums.height).toFixed(3),
      },
    };
    console.log(JSON.stringify(out, null, 2));
    if (!jsonOnly) {
      const dir = resolve(process.env.OUT || join(import.meta.dirname, '..', '..', 'docs/reports/r31-car'));
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'profile-after.png'), await withGrid(png));
      console.log('PNG:', join(dir, 'profile-after.png'));
    }
  } finally {
    await browser.close();
  }
}
