#!/usr/bin/env node
/**
 * Наложение финального кадра заставки на эталон владельца (задание №52 §7.1).
 *
 * Что делает:
 *   1. снимает кадр заставки в 1920×1080 в заданной фазе (`window.__vyIntroStill`);
 *   2. меряет на нём и на `hero-front-red.png` одни и те же ориентиры FRONT.md
 *      (кромки кузова по строкам, полоса ДХО, знак) — в пикселях и в долях кадра;
 *   3. пишет `overlay-final.jpg` (эталон + наши кромки) и `overlay-diff.jpg`;
 *   4. печатает таблицу «эталон / у нас / отклонение» и валит с exit 1, если
 *      ориентир выехал дальше ±1,5 % кадра.
 *
 * Запуск (нужен поднятый сервер, как у intro-stills.mjs):
 *   LD_LIBRARY_PATH=/tmp/al2023/lib node scripts/intro-overlay.mjs
 *   UT=0.72 OUT=../docs/reports/r31-intro node scripts/intro-overlay.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import sharp from 'sharp';

const BASE = process.env.BASE || 'http://127.0.0.1:4321';
const PAGE = process.env.PAGE || '/voyah-free';
const OUT = resolve(process.env.OUT || join(import.meta.dirname, '..', '..', 'docs/reports/r31-intro'));
const UT = Number(process.env.UT || 0.72);
const REF = resolve(import.meta.dirname, '..', '..', 'docs/brand/voyah/refs/r31/hero-front-red.png');
const W = 1920;
const H = 1080;
const SCENE_MS = 1950; /* --vy-scene на десктопе; в кадре-документации t = ms / sceneMs */

/* ------------------------------ измерения --------------------------------- */

const raw = async (file) => {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, c: info.channels };
};

/* Кузов: тёмный И нейтральный (max−min мало). Красный фон насыщенный, полоса и знак
   белые — обе не проходят. Затем берём непрерывный отрезок, содержащий ось кадра. */
const neutral = (im, x, y) => {
  const i = (y * im.w + x) * im.c;
  const r = im.data[i];
  const g = im.data[i + 1];
  const b = im.data[i + 2];
  const mx = Math.max(r, g, b);
  return mx - Math.min(r, g, b) < 18 && mx < 95;
};

function rowExtent(im, y) {
  const segs = [];
  let st = -1;
  for (let x = 0; x < im.w; x++) {
    if (neutral(im, x, y)) { if (st < 0) st = x; } else if (st >= 0) { segs.push([st, x - 1]); st = -1; }
  }
  if (st >= 0) segs.push([st, im.w - 1]);
  if (!segs.length) return { y, L: -1, R: -1 };
  const cx = Math.round(im.w / 2);
  const around = segs.filter(([a, b]) => a <= cx && cx <= b);
  const best = (around.length ? around : segs).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
  return { y, L: best[0], R: best[1] };
}

const rows = (im, ys) => ys.map((y) => rowExtent(im, y));

/* верх кузова: первая строка, где у оси кадра есть широкая тёмная полоса */
function roofTop(im) {
  for (let y = 60; y < 400; y++) {
    const r = rowExtent(im, y);
    if (r.L >= 0 && r.R - r.L > 120) return r;
  }
  return { y: null, L: -1, R: -1 };
}

const isBright = (im, x, y) => {
  const i = (y * im.w + x) * im.c;
  return Math.min(im.data[i], im.data[i + 1], im.data[i + 2]) > 120;
};

function brightBox(im, x0, x1, y0, y1) {
  let minX = 1e9;
  let maxX = -1;
  let minY = 1e9;
  let maxY = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (!isBright(im, x, y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { minX, maxX, minY, maxY };
}

function stripAt(im, x) {
  const ys = [];
  for (let y = 330; y < 470; y++) if (isBright(im, x, y)) ys.push(y);
  if (!ys.length) return null;
  return { top: ys[0], bot: ys[ys.length - 1], mid: (ys[0] + ys[ys.length - 1]) / 2, thick: ys.length };
}

function measure(im) {
  /* строки выбраны вне полосы ДХО (410…455) и выше линии пола (608) */
  const bodyRows = rows(im, [120, 200, 280, 560, 600]);
  const top = roofTop(im);
  const widest = bodyRows.reduce((a, r) => (r.L >= 0 && r.R - r.L > (a ? a.R - a.L : -1) ? r : a), null);
  const strip = [420, 700, 900, 1020, 1300, 1500].map((x) => ({ x, ...(stripAt(im, x) ?? {}) }));
  const mark = brightBox(im, 900, 1020, 455, 545);
  return { bodyRows, top, widest, strip, mark };
}

/* ------------------------------- рисование -------------------------------- */

const polyline = (pts, color, width = 2, dash = '') =>
  `<polyline points="${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${width}" ${dash}/>`;

/* кромки кузова по строкам → две ломаные (левая и правая) */
function edges(im, color) {
  const ys = [];
  for (let y = 100; y <= 600; y += 6) ys.push(y);
  const rs = ys.map((y) => rowExtent(im, y)).filter((r) => r.L >= 0 && r.R - r.L > 60);
  if (!rs.length) return '';
  const left = rs.map((r) => [r.L, r.y]);
  const right = rs.map((r) => [r.R, r.y]);
  return polyline(left, color, 1.6) + polyline(right, color, 1.6);
}

/* --------------------------------- прогон --------------------------------- */

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [...chromium.args.filter((a) => a !== '--single-process'), '--no-sandbox',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  headless: 'shell',
  defaultViewport: null,
});
let shot;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((v) => { window.__vyIntroStill = v; }, Math.round(UT * SCENE_MS));
  await page.goto(BASE + PAGE, { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 2500));
  shot = await page.screenshot({ type: 'png' });
  await page.close();
} finally {
  await browser.close();
}

const ourPath = join(OUT, 'render-final.png');
/* сначала копим в буфер: 1920×1080 png нужен и для мер, и для наложения */
const refIm = await raw(REF);
const oursRawBuf = await sharp(shot).flatten({ background: '#070B12' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const oursIm = { data: oursRawBuf.data, w: oursRawBuf.info.width, h: oursRawBuf.info.height, c: oursRawBuf.info.channels };

const ref = measure(refIm);
const ours = measure(oursIm);

/* --- таблица --- */
const fr = (v) => (v / W) * 100;
const rowsOut = [];
const push = (name, a, b, unit = 'px') => {
  if (a == null || b == null) { rowsOut.push({ name, a, b, d: null }); return; }
  rowsOut.push({ name, a, b, d: b - a, unit });
};

push('верх крыши, y', ref.top.y, ours.top.y);
const roofRef = rowExtent(refIm, 140);
const roofOurs = rowExtent(oursIm, 140);
push('полуширина крыши (y=140)', roofRef.L >= 0 ? (roofRef.R - roofRef.L) / 2 : null,
  roofOurs.L >= 0 ? (roofOurs.R - roofOurs.L) / 2 : null);
push('полная ширина кузова', ref.widest ? (ref.widest.R - ref.widest.L) / 2 : null,
  ours.widest ? (ours.widest.R - ours.widest.L) / 2 : null);
for (const y of [120, 200, 280]) {
  const a = ref.bodyRows.find((r) => r.y === y);
  const b = ours.bodyRows.find((r) => r.y === y);
  push(`полуширина на y=${y}`, a && a.L >= 0 ? (a.R - a.L) / 2 : null, b && b.L >= 0 ? (b.R - b.L) / 2 : null);
}
const sRef = ref.strip.find((s) => s.x === 900 && s.mid != null) ?? ref.strip.find((s) => s.mid != null);
const sOurs = ours.strip.find((s) => s.x === 900 && s.mid != null) ?? ours.strip.find((s) => s.mid != null);
push('полоса: y у центра', sRef?.mid ?? null, sOurs?.mid ?? null);
push('полоса: y у конца (x=420)', ref.strip.find((s) => s.x === 420)?.mid ?? null, ours.strip.find((s) => s.x === 420)?.mid ?? null);
push('полоса: толщина', sRef?.thick ?? null, sOurs?.thick ?? null);
push('знак: верх', ref.mark?.minY ?? null, ours.mark?.minY ?? null);
push('знак: высота', ref.mark ? ref.mark.maxY - ref.mark.minY : null, ours.mark ? ours.mark.maxY - ours.mark.minY : null);
push('знак: ширина', ref.mark ? ref.mark.maxX - ref.mark.minX : null, ours.mark ? ours.mark.maxX - ours.mark.minX : null);

const TOL = 0.015 * W;
let bad = 0;
console.log(`\nФаза uT=${UT} (${Math.round(UT * SCENE_MS)} мс), кадр ${W}×${H}, допуск ±${TOL.toFixed(0)} px (1,5 % кадра)\n`);
console.log('  ориентир                        эталон      у нас    откл., px   откл., % кадра');
for (const r of rowsOut) {
  const d = r.d == null ? null : r.d;
  const pct = d == null ? null : Math.abs(fr(d));
  const mark = d == null ? '?' : pct <= 1.5 ? ' ok ' : 'FAIL';
  if (d != null && pct > 1.5) bad += 1;
  console.log(`  [${mark}] ${r.name.padEnd(30)} ${String(r.a ?? '—').padStart(8)} ${String(r.b ?? '—').padStart(9)}` +
    ` ${d == null ? '—' : (d >= 0 ? '+' : '') + d.toFixed(0).padStart(6)}   ${pct == null ? '—' : pct.toFixed(2)}`);
}

/* --- картинки --- */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  ${edges(refIm, 'rgba(255,255,255,0.55)')}
  ${edges(oursIm, '#39e08a')}
  <line x1="0" y1="${ref.strip[1]?.mid ?? 448}" x2="${W}" y2="${ref.strip[1]?.mid ?? 448}" stroke="rgba(255,255,255,0.25)" stroke-width="1" stroke-dasharray="10 10"/>
</svg>`;
const overlay = await sharp(REF).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 90 }).toBuffer();
await writeFile(join(OUT, 'overlay-final.jpg'), overlay);

/* разница: усиленная |эталон − наш кадр| по яркости */
const refSmall = await sharp(REF).removeAlpha().raw().toBuffer();
const oursSmall = oursIm.data;
const diff = Buffer.alloc(W * H * 3);
for (let i = 0, j = 0; i < W * H; i++, j += 3) {
  const dr = Math.abs(refSmall[j] - oursSmall[j]);
  const dg = Math.abs(refSmall[j + 1] - oursSmall[j + 1]);
  const db = Math.abs(refSmall[j + 2] - oursSmall[j + 2]);
  const m = Math.min(255, (dr + dg + db) * 1.4);
  diff[j] = m;
  diff[j + 1] = m;
  diff[j + 2] = m;
}
await sharp(diff, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 88 }).toFile(join(OUT, 'overlay-diff.jpg'));
await sharp(shot).resize(W, H).png().toFile(ourPath);

console.log(`\nPNG: ${ourPath}`);
console.log(`Наложение: ${join(OUT, 'overlay-final.jpg')}`);
console.log(`Разница:   ${join(OUT, 'overlay-diff.jpg')}`);
if (bad) {
  console.log(`\n✗ ориентиров вне допуска: ${bad}`);
  process.exit(1);
}
console.log('\n✓ все ориентиры в пределах ±1,5 % кадра');
