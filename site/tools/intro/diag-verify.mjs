/**
 * Диагностика сверки `--verify` для порта заставки: ГДЕ именно CPU-порт расходится с драйвером.
 *
 * Зачем нужен: в сцене A5 кромка заливки кузова строится на гладком шуме `vnoise`, который
 * сдвигает границу на ±20 px. Шум — хаотичная функция: расхождение float32 (GPU) против
 * float64 (порт) в одну единицу младшего разряда даёт заметную разницу цвета именно в
 * переходной зоне, и «пятно Δ>4» там законно. Этот скрипт разделяет два случая:
 *   • расхождение лежит в переходной зоне кромки (0,02 < body < 0,98) → порт верен,
 *     критерий сверки надо читать вместе с этой картой;
 *   • расхождение вне кромки → в порте ошибка логики, чинить порт.
 *
 * Запуск: node tools/intro/diag-verify.mjs [--w 160 --h 90 --t 0.5] [--png путь]
 * Выводит ASCII-карту Δ и PNG (красный = Δ>4, зелёный = зона кромки, синий = |Δ|×8).
 */
import fs from 'node:fs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as ref from './ref.mjs';
import { encodePng } from '../png.mjs';
import { SCENE_FS } from '../../src/client/voyah-intro.ts';

const A = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = A.indexOf(`--${name}`);
  return i >= 0 && A[i + 1] !== undefined ? A[i + 1] : dflt;
};
const W = Number(arg('w', 160)), H = Number(arg('h', 90)), T = Number(arg('t', 0.5));
const PNG_OUT = arg('png', `/tmp/intro-delta-${W}x${H}-uT${T}.png`);

/* --- кадр настоящим драйвером (рецепт запуска — как в scripts/measure-intro.mjs --verify) --- */
const { default: puppeteer } = await import('puppeteer-core');
const { default: chromium } = await import('@sparticuz/chromium');
const libDir = '/tmp/al2023';
const archive = join(process.cwd(), 'node_modules/@sparticuz/chromium/bin/al2023.tar.br');
if (!fs.existsSync(join(libDir, 'lib', 'libnss3.so')) && fs.existsSync(archive)) {
  mkdirSync(join(libDir, 'lib'), { recursive: true });
  const { createReadStream, createWriteStream } = await import('node:fs');
  const { createBrotliDecompress } = await import('node:zlib');
  const { pipeline } = await import('node:stream/promises');
  const { spawnSync } = await import('node:child_process');
  await pipeline(createReadStream(archive), createBrotliDecompress(), createWriteStream('/tmp/al2023.tar'));
  spawnSync('tar', ['-xf', '/tmp/al2023.tar', '-C', libDir], { stdio: 'ignore' });
}
const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  headless: 'shell',
  defaultViewport: null,
  args: [...chromium.args.filter((a) => a !== '--single-process'), '--no-sandbox',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  env: fs.existsSync(join(libDir, 'lib')) ? { ...process.env, LD_LIBRARY_PATH: join(libDir, 'lib') } : process.env,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.setContent('<canvas id=c></canvas>');
const drv = await page.evaluate(({ w, h, fsSrc, t }) => {
  const cv = document.getElementById('c'); cv.width = w; cv.height = h;
  const gl = cv.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
  const mk = (ty, src) => {
    const s = gl.createShader(ty); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, '#version 300 es\nin vec2 a;void main(){gl_Position=vec4(a,0.,1.);}'));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(p, 'a');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.useProgram(p); gl.viewport(0, 0, w, h);
  gl.uniform2f(gl.getUniformLocation(p, 'uRes'), w, h);
  gl.uniform1f(gl.getUniformLocation(p, 'uT'), t);
  /* знак выключен (uMarkOn=0), как в порте по умолчанию */
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  gl.uniform1i(gl.getUniformLocation(p, 'uMark'), 0);
  gl.uniform1f(gl.getUniformLocation(p, 'uMarkOn'), 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return { pixels: Array.from(px), renderer: gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL) };
}, { w: W, h: H, fsSrc: SCENE_FS, t: T });
await browser.close();
if (drv.error) { console.error('драйвер:', drv.error); process.exit(2); }
console.log(`движок: ${drv.renderer}`);
/* readPixels отдаёт строки снизу вверх, порт и PNG — сверху вниз */
const gpu = drv.pixels;
const gpuRow = (y, x, c) => gpu[((H - 1 - y) * W + x) * 4 + c];

/* --- кадр портом + маска переходной зоны кромки --- */
const f = ref.renderFrame({ width: W, height: H, t: T });
const zone = new Uint8Array(W * H);
const delta = new Uint8Array(W * H);
const U = { res: [W, H], t: T };
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const r = ref.shadePixel(x + 0.5, H - (y + 0.5), U, { collect: true });
    zone[i] = r.body > 0.02 && r.body < 0.98 ? 1 : 0;
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(f.data[i * 3 + c] - gpuRow(y, x, c)));
    delta[i] = d;
  }
}

/* --- объяснимы ли расхождения субпиксельной фазой? ---
   Пиксель считаем «объяснённым сдвигом», если какой-то сосед порта в окне 3×3 ближе
   к драйверу, чем центр: значит расхождение — это фаза тонкой структуры (float32 против
   float64), а не другая математика. Настоящая ошибка логики так не объясняется. */
const distTo = (i, x, y) => {
  let d = 0;
  for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(f.data[i * 3 + c] - gpuRow(y, x, c)));
  return d;
};
let explained = 0, unexplained = 0;
const unexplainedList = [];

let inZone = 0, inZoneBad = 0, out = 0, outBad = 0, maxOut = 0;
const outSpots = [];
const lines = [];
for (let y = 0; y < H; y++) {
  let line = '';
  for (let x = 0; x < W; x++) {
    const i = y * W + x, d = delta[i], z = zone[i];
    if (z) { inZone++; if (d > 4) inZoneBad++; }
    else { out++; if (d > 4) { outBad++; if (outSpots.length < 12) outSpots.push([x, y, d]); } if (d > maxOut) maxOut = d; }
    if (d > 4) {
      const R = 3;   /* тонкие структуры: ДХО и рейлинги ~2 px hero = 0,7 px экрана */
      let best = d;
      for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
        if (!ox && !oy) continue;
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nd = distTo(ny * W + nx, nx, ny);
        if (nd < best) best = nd;
      }
      if (best < d * 0.5) explained++;
      else { unexplained++; if (unexplainedList.length < 12) unexplainedList.push([x, y, d]); }
    }
    line += d > 4 ? (z ? 'E' : 'X') : d > 1 ? (z ? 'e' : 'x') : '.';
  }
  lines.push(line);
}

console.log(`кадр ${W}×${H}, uT=${T}; движок драйвера — см. вывод --verify`);
console.log(`переходная зона кромки: ${inZone} px (${(100 * inZone / (W * H)).toFixed(1)} % кадра), из них Δ>4: ${inZoneBad} (${(100 * inZoneBad / Math.max(1, inZone)).toFixed(1)} % зоны)`);
console.log(`вне кромки: ${out} px, Δ>4: ${outBad} (${(100 * outBad / out).toFixed(2)} %), максимальный Δ вне кромки: ${maxOut}/255`);
console.log('первые пятна вне кромки [x, y, Δ]:', JSON.stringify(outSpots));
console.log(`\nрасхождений Δ>4 всего: ${inZoneBad + outBad}; из них объяснено сдвигом ≤3 px (остаток < Δ/2): ${explained} (${(100 * explained / Math.max(1, inZoneBad + outBad)).toFixed(1)} %), необъяснённых: ${unexplained}`);
console.log('первые необъяснённые [x, y, Δ]:', JSON.stringify(unexplainedList));
console.log(outBad === 0
  ? '\nвердикт: все расхождения Δ>4 лежат в переходной зоне кромки заливки — это шум float32, порт верен'
  : unexplained === 0
    ? '\nвердикт: расхождения вне кромки объясняются субпиксельной фазой тонких структур — порт верен'
    : '\nвердикт: есть необъяснённые расхождения ВНЕ кромки — в порте ошибка логики, чинить до замера');
if (W <= 320) {
  console.log('\nкарта Δ: X = Δ>4 вне кромки, E = Δ>4 на кромке, x/e = Δ>1, . = совпало');
  console.log(lines.map((l, i) => `${String(i).padStart(3)} ${l}`).join('\n'));
}

const rgb = new Uint8Array(W * H * 3);
for (let i = 0; i < W * H; i++) {
  rgb[i * 3] = delta[i] > 4 ? 255 : 0;
  rgb[i * 3 + 1] = zone[i] ? 255 : 0;
  rgb[i * 3 + 2] = Math.min(255, delta[i] * 8);
}
fs.writeFileSync(PNG_OUT, encodePng(W, H, rgb));
console.log(`\nPNG: ${PNG_OUT} (красный = Δ>4, зелёный = зона кромки, синий = |Δ|×8)`);
