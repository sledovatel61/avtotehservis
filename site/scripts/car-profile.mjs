#!/usr/bin/env node
/**
 * Орто-рендер профиля и его числа (задание №54).
 *
 * Рендер идёт **из GLSL**: `PROFILE_GLSL` компилируется в headless Chromium
 * (SwiftShader), кадр читается через `readPixels`. JS-версия
 * (`carProfileJS`) используется только для чисел и сверки — не для картинки:
 * иначе гейт проверял бы JS и не заметил, что шейдер рисует другое.
 *
 * Выход:
 *   docs/reports/r31-car-profile/ortho.png        1200×500, с направляющими
 *   docs/reports/r31-car-profile/ortho-mask.png   только маска силуэта
 *   docs/reports/r31-car-profile/overlay-side.jpg контур поверх фото
 *   docs/reports/r31-car-profile/metrics.json     числа и сверка GLSL ↔ JS
 *
 * Запуск:
 *   node site/scripts/car-profile.mjs
 *   node site/scripts/car-profile.mjs --overlay docs/brand/voyah/refs/r31/side-white-1456.jpg
 *   node site/scripts/car-profile.mjs --json
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, '..');
const ROOT = join(SITE, '..');
const OUT = join(ROOT, 'docs/reports/r31-car-profile');

export const W = 1200;
export const H = 500;
/** Кадр в метрах: машина 4,905 при 1200 px ⇒ 245 px/м, поля по 58 px. */
export const VIEW = { x0: -2.6, x1: 2.6, y0: -0.08, y1: 1.72 };

const { PROFILE_GLSL, carProfileJS, CAR, SCALE, SCENE, measureJS, NODES, topAt, bottomAt } =
  await import(join(SITE, 'src/client/car-profile.ts'));

const mapX = (x) => ((x - VIEW.x0) / (VIEW.x1 - VIEW.x0)) * W;
const mapY = (y) => H - ((y - VIEW.y0) / (VIEW.y1 - VIEW.y0)) * H;

const LAUNCH = {
  args: [...chromium.args.filter((a) => a !== '--single-process'), '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader'],
  headless: 'shell',
};

/**
 * Сверка GLSL ↔ JS по маске. Расхождение — это баг шейдера, а не «допуск»:
 * формулы обязаны совпадать, потому что числа принимаются по JS, а картинка
 * рисуется шейдером.
 */
export async function compareMasks({ width = 400, height = 160, glsl = PROFILE_GLSL } = {}) {
  const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), ...LAUNCH });
  try {
    const page = await browser.newPage();
    await page.setContent('<canvas id="c"></canvas>');
    const res = await page.evaluate(({ src, w, h, view }) => {
      const c = document.getElementById('c');
      c.width = w;
      c.height = h;
      const gl = c.getContext('webgl2') ?? c.getContext('webgl');
      if (!gl) return { error: 'нет WebGL' };
      const vs = 'attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }';
      const fs = `precision highp float;
        uniform vec4 uView; uniform vec2 uRes;
        ${src}
        void main(){
          vec2 p = vec2(mix(uView.x, uView.y, gl_FragCoord.x / uRes.x), mix(uView.z, uView.w, gl_FragCoord.y / uRes.y));
          float d = carProfile(p);
          float v = 1.0 - smoothstep(-0.002, 0.002, d);
          gl_FragColor = vec4(v, v, v, 1.0);
        }`;
      const mk = (t, s) => {
        const sh = gl.createShader(t);
        gl.shaderSource(sh, s);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(sh)}`);
        return sh;
      };
      const pr = gl.createProgram();
      gl.attachShader(pr, mk(gl.VERTEX_SHADER, vs));
      gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(`link: ${gl.getProgramInfoLog(pr)}`);
      gl.useProgram(pr);
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform4f(gl.getUniformLocation(pr, 'uView'), view[0], view[1], view[2], view[3]);
      gl.uniform2f(gl.getUniformLocation(pr, 'uRes'), w, h);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const out = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) out[i] = px[i * 4] > 127 ? 1 : 0;
      return { mask: Array.from(out), version: gl.getParameter(gl.VERSION) };
    }, { src: glsl, w: width, h: height, view: [VIEW.x0, VIEW.x1, VIEW.y0, VIEW.y1] });
    if (res.error) throw new Error(res.error);

    const jsMask = new Uint8Array(width * height);
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const x = VIEW.x0 + ((i + 0.5) / width) * (VIEW.x1 - VIEW.x0);
        const y = VIEW.y0 + ((j + 0.5) / height) * (VIEW.y1 - VIEW.y0);
        jsMask[j * width + i] = carProfileJS(x, y) <= 0 ? 1 : 0;
      }
    }
    const gl = Uint8Array.from(res.mask);
    let inter = 0;
    let union = 0;
    for (let i = 0; i < gl.length; i++) {
      if (gl[i] && jsMask[i]) inter++;
      if (gl[i] || jsMask[i]) union++;
    }
    return { iou: union ? inter / union : 1, gl, js: jsMask, width, height, glVersion: res.version };
  } finally {
    await browser.close();
  }
}

/** Числа по JS-версии — те же формулы, что в шейдере. */
export function numbers() {
  const m = measureJS(0.003);
  return {
    ...m,
    spec: { length: CAR.length, height: CAR.height, wheelbase: CAR.wheelbase, tyre: CAR.tyre },
    delta: {
      lengthPct: ((m.length - CAR.length) / CAR.length) * 100,
      heightPct: ((m.height - CAR.height) / CAR.height) * 100,
      lengthToHeightSpec: CAR.length / CAR.height,
      wheelbaseToLengthSpec: CAR.wheelbase / CAR.length,
      wheelToHeightSpec: CAR.tyre / CAR.height,
    },
    scene: {
      scale: SCALE.bg3d,
      ground: SCENE.ground,
      axleFront: SCENE.axleFront,
      axleRear: SCENE.axleRear,
      tyreRadius: SCENE.tyreRadius,
      bodyHeightUnits: CAR.height * SCALE.bg3d,
    },
    segments: NODES.length,
  };
}

/** Орто-рендер в сырой RGBA (перевёрнутый readPixels → сверху вниз). */
async function renderOrtho() {
  const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), ...LAUNCH });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await page.setContent('<canvas id="c" style="display:block"></canvas>');
    const shot = await page.evaluate(({ glsl, w, h, view }) => {
      const c = document.getElementById('c');
      c.width = w;
      c.height = h;
      document.body.style.margin = '0';
      const gl = c.getContext('webgl2') ?? c.getContext('webgl');
      const vs = 'attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }';
      const fs = `precision highp float;
        uniform vec4 uView; uniform vec2 uRes;
        ${glsl}
        void main(){
          vec2 p = vec2(mix(uView.x, uView.y, gl_FragCoord.x / uRes.x), mix(uView.z, uView.w, gl_FragCoord.y / uRes.y));
          float d = carProfile(p);
          float body = 1.0 - smoothstep(-0.012, 0.004, d);
          float cabin = 1.0 - smoothstep(-0.002, 0.002, carCabin(p));
          float wheel = 1.0 - smoothstep(-0.004, 0.004, carWheels(p));
          vec3 bg = vec3(0.027, 0.043, 0.071);
          vec3 paint = vec3(0.788, 0.827, 0.870);
          vec3 col = mix(bg, paint, body);
          col = mix(col, vec3(0.16, 0.20, 0.24), cabin * body);
          col = mix(col, vec3(0.06, 0.07, 0.08), wheel);
          gl_FragColor = vec4(col, 1.0);
        }`;
      const mk = (t, s) => {
        const sh = gl.createShader(t);
        gl.shaderSource(sh, s);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
        return sh;
      };
      const pr = gl.createProgram();
      gl.attachShader(pr, mk(gl.VERTEX_SHADER, vs));
      gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(pr);
      gl.useProgram(pr);
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform4f(gl.getUniformLocation(pr, 'uView'), view[0], view[1], view[2], view[3]);
      gl.uniform2f(gl.getUniformLocation(pr, 'uRes'), w, h);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0.027, 0.043, 0.071, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { px: Array.from(px) };
    }, { glsl: PROFILE_GLSL, w: W, h: H, view: [VIEW.x0, VIEW.x1, VIEW.y0, VIEW.y1] });

    const buf = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4;
      for (let x = 0; x < W * 4; x++) buf[y * W * 4 + x] = shot.px[src + x];
    }
    return buf;
  } finally {
    await browser.close();
  }
}

/** Направляющие: земля, крыша, оси, база, длина, порог. */
function guidesSvg() {
  const L = CAR.length;
  const g = [];
  const line = (x1, y1, x2, y2, color, dash = '', width = 1.2, opacity = 0.85) =>
    `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ''} opacity="${opacity}"/>`;
  const label = (x, y, text, color) =>
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="DejaVu Sans" font-size="13" fill="${color}">${text}</text>`;

  g.push(line(0, mapY(0), W, mapY(0), '#00e5ff', '8 6'));
  g.push(label(8, mapY(0) - 6, 'земля y = 0', '#00e5ff'));
  g.push(line(0, mapY(CAR.height), W, mapY(CAR.height), '#ffd400', '4 6', 1, 0.6));
  g.push(label(8, mapY(CAR.height) - 6, `крыша ${CAR.height} м`, '#ffd400'));
  for (const axle of CAR.axles) {
    g.push(line(mapX(axle), mapY(0), mapX(axle), mapY(1.3), '#ff4fd8', '6 5', 1.1, 0.75));
    g.push(label(mapX(axle) - 16, mapY(1.3) + 14, `ось ${axle > 0 ? '+' : ''}${axle}`, '#ff4fd8'));
  }
  g.push(line(mapX(CAR.axles[0]), mapY(-0.06), mapX(CAR.axles[1]), mapY(-0.06), '#ff4fd8', '', 2));
  g.push(label((mapX(CAR.axles[0]) + mapX(CAR.axles[1])) / 2 - 46, mapY(-0.06) - 8, `база ${CAR.wheelbase} м`, '#ff4fd8'));
  g.push(line(mapX(-L / 2), mapY(0.06), mapX(L / 2), mapY(0.06), '#9aa7b4', '', 1.6));
  g.push(label(mapX(-L / 2) + 4, mapY(0.06) - 8, `длина ${L} м`, '#9aa7b4'));
  g.push(line(mapX(-L / 2), mapY(0), mapX(-L / 2), mapY(CAR.height), '#9aa7b4', '2 5', 1, 0.5));
  g.push(line(mapX(L / 2), mapY(0), mapX(L / 2), mapY(CAR.height), '#9aa7b4', '2 5', 1, 0.5));
  const sill = bottomAt(0);
  g.push(line(0, mapY(sill), W, mapY(sill), '#8ce99a', '10 6', 1, 0.5));
  g.push(label(W - 170, mapY(sill) - 6, `порог ${sill.toFixed(3)} м`, '#8ce99a'));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${g.join('')}</svg>`;
}

/**
 * Наложение контура на фото. Важно не перепутать две системы: в модуле X
 * нормирован на паспортную длину (kx) и сдвинут к центру кузова, Y — на
 * паспортную высоту (ky). Обратный пересчёт обязан вернуть оба множителя и
 * сдвиг, иначе контур «улетает» на 7–8 %.
 */
async function renderOverlay(photoRel) {
  const photo = resolve(ROOT, photoRel);
  const { width: pw, height: ph } = await sharp(photo).metadata();
  const ref = JSON.parse(readFileSync(join(OUT, 'profile-ref.json'), 'utf8'));
  const p = ref.pixels;
  const { kx, ky } = ref.fit;
  const mpp = ref.spec.wheelbase / (p.rearAxleX - p.frontAxleX);
  const scaleX = pw / p.width;
  const scaleY = ph / p.height;
  const groundAtPx = (xPix) =>
    p.groundRearY + ((xPix - p.rearAxleX) * (p.groundFrontY - p.groundRearY)) / (p.frontAxleX - p.rearAxleX);
  const shift = (ref.contour[0].x + ref.contour[ref.contour.length - 1].x) / 2;
  const toPx = (X, Y) => {
    const xPix = (p.frontAxleX + p.rearAxleX) / 2 - (X + shift) / (mpp * kx);
    return [xPix * scaleX, (groundAtPx(xPix) - Y / (mpp * ky)) * scaleY];
  };

  const top = [];
  const bottom = [];
  const N = 400;
  for (let i = 0; i < N; i++) {
    const x = -CAR.length / 2 + (i / (N - 1)) * CAR.length;
    top.push(toPx(x, Math.max(topAt(x), 0)));
    bottom.push(toPx(x, bottomAt(x)));
  }
  const dTop = top.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const dBot = bottom.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [fx, fy] = toPx(-CAR.axles[0], 0);
  const [rx, ry] = toPx(-CAR.axles[1], 0);
  const [, ty] = toPx(0, CAR.height);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}">
    <line x1="0" y1="${p.groundFrontY * scaleY}" x2="${pw}" y2="${p.groundRearY * scaleY}" stroke="#00e5ff" stroke-width="1.5" stroke-dasharray="12 8" opacity=".8"/>
    <line x1="${fx.toFixed(1)}" y1="${fy.toFixed(1)}" x2="${fx.toFixed(1)}" y2="${ty.toFixed(1)}" stroke="#ffd400" stroke-width="1.5" stroke-dasharray="6 5" opacity=".7"/>
    <line x1="${rx.toFixed(1)}" y1="${ry.toFixed(1)}" x2="${rx.toFixed(1)}" y2="${ty.toFixed(1)}" stroke="#ffd400" stroke-width="1.5" stroke-dasharray="6 5" opacity=".7"/>
    <path d="${dTop}" fill="none" stroke="#39ff14" stroke-width="2.5"/>
    <path d="${dBot}" fill="none" stroke="#00e5ff" stroke-width="2"/>
  </svg>`;
  const out = join(OUT, 'overlay-side.jpg');
  await sharp(photo).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 92 }).toFile(out);
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  mkdirSync(OUT, { recursive: true });
  const nums = numbers();
  const cmp = await compareMasks({ width: 400, height: 160 });
  const metrics = {
    source: {
      profile: 'site/src/client/car-profile.ts',
      spec: 'задание №54 §3.1 (паспорт)',
      form: ['docs/brand/voyah/refs/r31/side-white-1456.jpg', 'docs/brand/voyah/refs/r31/side-black.webp'],
    },
    numbers: nums,
    glslVsJs: { iou: +cmp.iou.toFixed(5), mask: '400×160', gl: cmp.glVersion },
  };

  if (!process.argv.includes('--json')) {
    const px = await renderOrtho();
    const raw = join(OUT, 'ortho-raw.png');
    await sharp(px, { raw: { width: W, height: H, channels: 4 } }).png().toFile(raw);
    const ortho = join(OUT, 'ortho.png');
    await sharp(raw).composite([{ input: Buffer.from(guidesSvg()) }]).png().toFile(ortho);
    const maskBuf = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const light = px[i * 4] > 60;
      maskBuf[i * 4] = light ? 255 : 0;
      maskBuf[i * 4 + 1] = light ? 255 : 0;
      maskBuf[i * 4 + 2] = light ? 255 : 0;
      maskBuf[i * 4 + 3] = 255;
    }
    await sharp(maskBuf, { raw: { width: W, height: H, channels: 4 } }).png().toFile(join(OUT, 'ortho-mask.png'));
    metrics.artifacts = { ortho, mask: join(OUT, 'ortho-mask.png') };

    const idx = process.argv.indexOf('--overlay');
    if (idx > 0) metrics.artifacts.overlay = await renderOverlay(process.argv[idx + 1]);
    console.log(`орто: ${ortho} (${W}×${H})`);
  }

  writeFileSync(join(OUT, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  const n = nums;
  console.log(`длина ${n.length.toFixed(3)} м (${n.delta.lengthPct > 0 ? '+' : ''}${n.delta.lengthPct.toFixed(2)} %), высота ${n.height.toFixed(3)} м (${n.delta.heightPct > 0 ? '+' : ''}${n.delta.heightPct.toFixed(2)} %)`);
  console.log(`длина/высота ${n.lengthToHeight.toFixed(3)} (паспорт ${n.delta.lengthToHeightSpec.toFixed(3)}), база/длина ${n.wheelbaseToLength.toFixed(3)} (${n.delta.wheelbaseToLengthSpec.toFixed(3)}), колесо/высота ${n.wheelToHeight.toFixed(4)} (${n.delta.wheelToHeightSpec.toFixed(4)})`);
  console.log(`GLSL ↔ JS: IoU ${cmp.iou.toFixed(5)} (${cmp.glVersion})`);
}
