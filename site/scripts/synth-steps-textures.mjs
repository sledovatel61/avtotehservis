/**
 * Раунд 20 (задание №22, B2): детерминированный синтез 4 светлых текстур панелей
 * «Как мы работаем» (светлый металл / бумага / бетон / ткань). Без AI-генераций:
 * лимит генераций раунда потрачен на фон секции и aside (2 из 3). Цель по статистике:
 * средняя 200…220, разброс (max−min) 25…40 — задаётся амплитудами напрямую, без
 * циклов подгонки. Запуск: node site/scripts/synth-steps-textures.mjs
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('../../site/node_modules/sharp');
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../docs/photos-source/r20-steps');
mkdirSync(OUT, { recursive: true });
const W = 1200, H = 900;
const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

function make(seed, kind, base, ramp) {
  const rnd = mulberry(seed);
  /* сглаженное низкочастотное поле (пятна) — сумма синусов со случайными фазами */
  const ph = Array.from({ length: 6 }, () => rnd() * Math.PI * 2);
  const fq = Array.from({ length: 6 }, () => [1 + Math.floor(rnd() * 3), 1 + Math.floor(rnd() * 3)]);
  const low = (x, y) => { let v = 0; for (let k = 0; k < 6; k++) v += Math.sin((x / W) * Math.PI * 2 * fq[k][0] + ph[k]) * Math.cos((y / H) * Math.PI * 2 * fq[k][1] + ph[(k + 3) % 6]); return v / 6; };
  const row = new Float64Array(H); for (let y = 0; y < H; y++) row[y] = rnd() * 2 - 1;   /* штрих металла */
  const col = new Float64Array(W); for (let x = 0; x < W; x++) col[x] = rnd() * 2 - 1;   /* нить ткани */
  const d = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = base + ramp * ((x / (W - 1)) * 2 - 1);       /* живость: лево/право */
    const g = rnd() * 2 - 1;                              /* зерно */
    if (kind === 'metal') v += row[y] * 7 + low(x, y) * 4 + g * 4;
    if (kind === 'paper') v += low(x, y) * 7 + g * 6 + (rnd() < .02 ? -8 : 0);
    if (kind === 'concrete') v += low(x, y) * 10 + g * 5 + (rnd() < .008 ? -12 : 0);
    if (kind === 'fabric') v += Math.sin(x / 2.2) * 3.4 * Math.sin(y / 2.2) + low(x, y) * 4 + g * 4;
    v = Math.max(0, Math.min(255, Math.round(v)));
    const i = (y * W + x) * 3;
    /* холодный подтон: g чуть выше r, b чуть ниже — без желтизны */
    d[i] = Math.max(0, v - 3); d[i + 1] = v; d[i + 2] = Math.max(0, v - 6);
  }
  return d;
}
const JOB = [
  ['panel-1-metal-raw.jpg', 11, 'metal', 213, 10],
  ['panel-2-paper-raw.jpg', 22, 'paper', 213, 8],
  ['panel-3-concrete-raw.jpg', 33, 'concrete', 213, 12],
  ['panel-4-fabric-raw.jpg', 44, 'fabric', 214, 9],
];
for (const [name, seed, kind, base, ramp] of JOB) {
  const d0 = make(seed, kind, base, ramp);
  /* один аффинный проход к целевому разбросу 34 (середина 25…40): не цикл подгонки */
  let mn = 255, mx = 0, s = 0;
  for (let i = 0; i < d0.length; i += 3) { const v = d0[i + 1]; s += v; if (v < mn) mn = v; if (v > mx) mx = v; }
  const k = 34 / Math.max(1, mx - mn), bmean = s / (W * H);
  const d = Buffer.from(d0);
  for (let i = 0; i < d.length; i += 3) for (let q = 0; q < 3; q++)
    d[i + q] = Math.max(0, Math.min(255, Math.round(bmean + (d0[i + q] - bmean) * k)));
  mn = 255; mx = 0; s = 0;
  for (let i = 0; i < d.length; i += 3) { const v = d[i + 1]; s += v; if (v < mn) mn = v; if (v > mx) mx = v; }
  await sharp(d0, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 95 }).toFile(join(OUT, name));
  await sharp(d, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 95 }).toFile(join(OUT, name.replace('-raw.jpg', '.jpg')));
  console.log(`${name}: средняя ${(s / (W * H)).toFixed(1)}, разброс ${mx - mn} (цель 200…220 / 25…40)`);
}
console.log('синтез панелей r20 готов (детерминированный, seed фиксирован)');
