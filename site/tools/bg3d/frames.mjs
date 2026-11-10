/**
 * Контрольные кадры 3D-фона без GPU (задание №44).
 *
 *   node tools/bg3d/frames.mjs [--out ../../../evaluation/round30-bg-3d/frames]
 *
 * Это НЕ иллюстрация и не генерация картинки: `renderFrame()` считает ровно ту математику,
 * которая лежит в `src/client/bg3d/shader.ts`, только на CPU и по одному пикселю за раз.
 * Поэтому кадр здесь и кадр на GPU совпадают с точностью до округления float.
 *
 * PNG пишем сами (tools/png.mjs: node:zlib + CRC32), чтобы не тянуть зависимости: 40 строк, 0 пакетов.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../png.mjs';
import { renderFrame, resetTally, T } from './ref.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const outArg = (() => { const i = process.argv.indexOf('--out'); return i > 0 ? process.argv[i + 1] : null; })();
const OUT = outArg ? resolve(process.cwd(), outArg) : resolve(HERE, '../../../evaluation/round30-bg-3d/frames');

/* ---------- кадры ---------- */
const SHOTS = [
  { file: 'A-depth-1280x720.png', variant: 'depth', quality: 2, width: 1280, height: 720, time: 4.0, scroll: 0.0, pointer: [0.18, -0.08],
    note: 'Прототип A «глубина», качество 2 (high tier), 1280×720, t=4.0 с' },
  { file: 'A-depth-off-1280x720.png', variant: 'depth', quality: 2, width: 1280, height: 720, time: 4.0, scroll: 0.0, pointer: [0.18, -0.08], fade: 0,
    note: 'То же состояние, но uFade=0 — так страница выглядит с выключенным фоном (ровно градиент .page-head)' },
  { file: 'B-silhouette-1280x720.png', variant: 'silhouette', quality: 2, width: 1280, height: 720, time: 4.0, scroll: 0.0, pointer: [0.18, -0.08],
    note: 'Прототип B «силуэт в глубине», качество 2 (high tier), 1280×720, t=4.0 с' },
  { file: 'B-silhouette-q0-low-1280x720.png', variant: 'silhouette', quality: 0, width: 1280, height: 720, time: 4.0, scroll: 0.0, pointer: [0.18, -0.08],
    note: 'Прототип B на низком качестве (low tier): нет второго слоя шума, мокрых полос и отражения' },
  { file: 'B-silhouette-mobile-390x470.png', variant: 'silhouette', quality: 1, width: 390, height: 470, time: 4.0, scroll: 0.0, pointer: [0, 0],
    note: 'Прототип B в мобильном hero 390×470, качество 1 (mid tier на телефоне)' },
  { file: 'B-silhouette-scroll-1280x720.png', variant: 'silhouette', quality: 2, width: 1280, height: 720, time: 6.5, scroll: 0.55, pointer: [-0.3, 0.1],
    note: 'Прототип B при скролле 0.55 и указателе слева: горизонт уехал вверх, силуэт сместился — это параллакс глубины' },
];

mkdirSync(OUT, { recursive: true });
const report = [];
for (const s of SHOTS) {
  resetTally();
  const t0 = process.hrtime.bigint();
  const f = renderFrame({
    width: s.width, height: s.height, variant: s.variant, quality: s.quality,
    time: s.time, scroll: s.scroll, pointer: s.pointer, fade: s.fade ?? 1,
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const png = encodePng(s.width, s.height, f.data);
  writeFileSync(join(OUT, s.file), png);
  report.push({
    file: s.file, note: s.note, variant: s.variant, quality: s.quality,
    width: s.width, height: s.height, pngBytes: png.byteLength,
    cpuMs: Number(ms.toFixed(1)),
    cpuNsPerPx: Number(((ms * 1e6) / f.pixels).toFixed(0)),
    opsPerPx: { inst: Number(f.ops.instPerPx.toFixed(1)), scalar: Number(f.ops.scalarPerPx.toFixed(1)), scalarMax: f.ops.scalarPerPxMax },
  });
  console.log(`ok    ${s.file.padEnd(34)} ${String(png.byteLength).padStart(8)} Б · CPU ${ms.toFixed(0).padStart(6)} мс · ${(f.ops.scalarPerPx).toFixed(0)} скалярных оп/px`);
}
writeFileSync(join(OUT, 'frames.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  method: 'CPU-порт tools/bg3d/ref.mjs той же математики, что в src/client/bg3d/shader.ts; PNG собран node:zlib',
  cpu: `${process.arch} ${process.platform}, node ${process.version}`,
  frames: report,
}, null, 2));
console.log(`\nкадры: ${OUT} (${report.length} шт., всего ${(report.reduce((a, r) => a + r.pngBytes, 0) / 1024).toFixed(0)} КБ)`);
console.log(`счётчик операций за последний кадр: inst=${T.inst}, scalar=${T.scalar}, pixels=${T.pixels}`);
