/* Раунд 21 (задание №23): процедурные мастера фактур для карточек «Услуги»,
   которые не покрыты AI-лимита круга: электрика, балансировка, ремонт шин, ходовая.
   Seeded-синтез (mulberry32), детерминированный: тёмный материал 1200×900 (4:3),
   один аффинный проход к целевой средней (пары карточек Δ ≥ 6) и разбросу ~70 (≥ 34).
   AI-мастера (фон, шиномонтаж, ТО/масло) лежат рядом как *-raw.jpg и не трогаются. */
import { writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'photos-source', 'r21-svc');
const W = 1200, H = 900;
const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/* value-noise: сетка узлов -> билинейная интерполяция, несколько октав */
function noise(seed, cells) {
  const rnd = mulberry(seed);
  const gw = cells + 1, gh = Math.round(cells * H / W) + 1;
  const g = Float64Array.from({ length: gw * gh }, () => rnd());
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {                       /* x,y ∈ [0,1) */
    const px = x * cells, py = y * (gh - 1);
    const x0 = Math.min(cells - 1, Math.floor(px)), y0 = Math.min(gh - 2, Math.floor(py));
    const tx = sm(px - x0), ty = sm(py - y0);
    const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1], c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
}
const octaves = (seed, base) => { const ns = [noise(seed, base), noise(seed + 7, base * 2), noise(seed + 13, base * 4)];
  return (x, y) => ns[0](x, y) * .55 + ns[1](x, y) * .3 + ns[2](x, y) * .15; };

/* узоры материалов: возвращают добавку −1…1 к базе */
const patElectric = (x, y) => {            /* косы кабеля: синусоидальные пряди по диагонали */
  let v = 0;
  for (let k = 0; k < 5; k++) {
    const ph = k * 1.7, off = k * .13;
    const d = Math.abs(((y + x * .35 + off) % .2) - .1);   /* прядь толщиной .04 */
    v += Math.max(0, 1 - d * 26) * Math.sin(x * 34 + ph) * .5;
  }
  const spark = (Math.sin(x * 210) * Math.sin(y * 190)) > .985 ? 1.6 : 0;  /* медные точки */
  return v * .8 + spark;
};
const patBalance = (x, y) => {             /* концентические канавки диска вокруг центра */
  const dx = x - .5, dy = (y - .5) * H / W;
  const r = Math.sqrt(dx * dx + dy * dy);
  return Math.sin(r * 150) * .55 * Math.max(0, 1 - r * 1.4) + Math.sin(Math.atan2(dy, dx) * 24) * .12;
};
const patTread = (x, y) => {               /* шашки протектора: косая сетка с канавками */
  const u = (x * 9 + y * 3) % 1, v = (y * 7 - x * 2 + 10) % 1;
  const groove = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v));
  return (groove < .12 ? -.9 : .25) + Math.sin(x * 60) * .08;
};
const patSusp = (x, y) => {                /* металлическая щётка по диагонали + диск тормоза */
  const brush = Math.sin((x * .8 + y * .6) * 260) * .3;
  const dx = x - .68, dy = (y - .42) * H / W;
  const r = Math.sqrt(dx * dx + dy * dy);
  const disc = r < .3 ? Math.sin(r * 90) * .35 + .3 : 0;
  return brush + disc;
};

const CARDS = [
  { file: 'elec-raw-synth.jpg', seed: 2101, target: 81, pat: patElectric, base: 6 },
  { file: 'bal-raw-synth.jpg', seed: 2102, target: 93, pat: patBalance, base: 6 },
  { file: 'tread-raw-synth.jpg', seed: 2103, target: 57, pat: patTread, base: 5 },
  { file: 'susp-raw-synth.jpg', seed: 2104, target: 99, pat: patSusp, base: 6 },
];

for (const c of CARDS) {
  const n = octaves(c.seed, c.base);
  const buf = Buffer.alloc(W * H * 3);
  let s = 0, npx = 0, mn = 1e9, mx = -1e9;
  const raw = new Float64Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    let val = n(u, v) * 1.1 + c.pat(u, v) * .55 - .35;
    raw[y * W + x] = val; s += val; npx++;
    mn = Math.min(mn, val); mx = Math.max(mx, val);
  }
  const mean = s / npx, spread = mx - mn;
  const a = 70 / spread, b = c.target - a * mean;         /* один аффинный проход: разброс 70, средняя = цель */
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let g = raw[y * W + x] * a + b;
    /* лёгкая виньетка к краям, как у фото, и тёплый оттенок меди в светах */
    const u = x / W - .5, v = y / H - .5;
    g -= (u * u + v * v) * 26;
    g = Math.max(0, Math.min(255, g));
    const i = (y * W + x) * 3;
    buf[i] = Math.round(g * .98); buf[i + 1] = Math.round(g); buf[i + 2] = Math.round(g * .96);
  }
  const out = join(OUT, c.file);
  const tmp = out + '.tmp';
  await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 95 }).toFile(tmp);
  const { renameSync } = await import('node:fs');
  renameSync(tmp, out);
  /* контроль: фактические средняя/разброс мастерa */
  const im = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  const d = im.data; let ss = 0, nn = 0, lo = 255, hi = 0;
  for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) { const i = (y * W + x) * 3;
    const L = .2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]; ss += L; nn++; lo = Math.min(lo, L); hi = Math.max(hi, L); }
  console.log(`${c.file}: средняя ${(ss / nn).toFixed(1)} (цель ${c.target}), разброс ${(hi - lo).toFixed(0)} (норма ≥34)`);
  void existsSync; void writeFileSync;
}
console.log('синтез карточек r21 готов (детерминированный, seed фиксирован)');
