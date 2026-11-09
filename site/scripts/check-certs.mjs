/* Круг 26 (задание №30, §3): гейт иллюстраций сертификатов блока «Сертификаты» (/about).
   Входы: файлы public/img/cert-*.{avif,webp} (720×960 и 1200×1600), мастера
   docs/photos-source/r26-certs/cert-*.jpg (рендер render-certs.mjs, Chromium, 1200×1600),
   разметка src/pages/about.astro.
   Проверки:
     C1. резкость: дисперсия отклика лапласиана в нативном разрешении ≥ 200 (все 16 файлов);
     C2. плотность кода: ≥ 15 КБ/МП для webp и ≥ 8 КБ/МП для avif (не «пережато в кашу»);
     C3. ноль апскейла: ширина И высота ассета ≤ мастера (1200×1600); у каждого ассета есть
         мастер, все 16 ожидаемых файлов на диске;
     C4. геометрия ровно 720×960 и 1200×1600; webp 1200-производной ≤ 120 КБ (задание §3);
     C5. разметка: секция aria-labelledby="ab-cert-h" с четырьмя <figure class="cert">,
         у каждой picture с avif+webp, alt начинается с «Иллюстрация:», есть сноска
         «оформленные сертификаты можно посмотреть в сервисе»; ссылки на сканы из
         docs/content-source/r26 в разметке не встречаются.
     C6 (круг 27, задание №31 §1.4): бланки светлые и разные между собой:
         C6a средняя яркость каждого из 16 файлов cert-* в коридоре 165…242 (не «чёрная
             карточка» круга 26, которую забраковал владелец);
         C6b попарное среднеквадратичное отличие rms ≥ 18 для 4 брендов по 1200-производной,
             приведённой к 120×160 RGB (четыре разных фирменных дизайна, а не один шаблон).
   --self-test: 6 мутантов, каждый обязан ронять гейт (5-чёрная-карточка → C6a,
   6-клоны-брендов → C6b).
   Запуск: node scripts/check-certs.mjs [--self-test] */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = join(ROOT, 'site');
const IMG = join(SITE, 'public', 'img');
const MASTERS = join(ROOT, 'docs', 'photos-source', 'r26-certs');
const ASTRO = join(SITE, 'src', 'pages', 'about.astro');

const BRANDS = ['lynxauto', 'sufix', 'korson', 'ngn'];
const masterKey = (assetName) => assetName.replace(/^cert-/, '').replace(/-\d+$/, '');
const GEOM = { 720: [720, 960], 1200: [1200, 1600] };
const PAIRS = {};
for (const k of BRANDS) for (const sz of [720, 1200]) PAIRS[`cert-${k}-${sz}`] = `cert-${k}.jpg`;
const LAPVAR_MIN = 200;
const MEAN_RANGE = [165, 242];      /* C6a: светлый бумажный бланк */
const BRAND_RMS_MIN = 18;           /* C6b: минимум отличия двух брендов */
const DENSITY = { webp: 15, avif: 8 };   /* КБ на мегапиксель */
const WEBP_1200_CAP_KB = 120;

async function lapvar(buf) {
  const im = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = im.info;
  const d = im.data;
  const at = (x, y) => d[(y * w + x) * c];
  let s = 0, s2 = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 4 * at(x, y)
      - at(Math.min(w - 1, Math.max(0, x - 1)), y) - at(Math.min(w - 1, Math.max(0, x + 1)), y)
      - at(x, Math.min(h - 1, Math.max(0, y - 1))) - at(x, Math.min(h - 1, Math.max(0, y + 1)));
    s += v; s2 += v * v; n++;
  }
  const mean = s / n;
  return s2 / n - mean * mean;
}

async function greyMean(buf) {
  const st = await sharp(buf).greyscale().stats();
  return st.channels[0].mean;
}

async function thumb(buf) {
  return sharp(buf).resize(120, 160, { fit: 'fill' }).removeAlpha().raw().toBuffer();
}

function rms(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s / n);
}

export async function checkCerts(opts = {}) {
  const fails = [];
  const buffers = opts.buffers || {};
  const astro = opts.astro ?? readFileSync(ASTRO, 'utf8');

  const brandThumbs = {};
  for (const [name, master] of Object.entries(PAIRS)) {
    for (const ext of ['avif', 'webp']) {
      const file = `${name}.${ext}`;
      let buf = buffers[file];
      if (!buf) {
        const path = join(IMG, file);
        if (!existsSync(path)) { fails.push(`C3 нет файла ${file}`); continue; }
        buf = readFileSync(path);
      }
      const meta = await sharp(buf).metadata();
      const w = meta.width, h = meta.height;
      const lv = await lapvar(buf);
      if (lv < LAPVAR_MIN) fails.push(`C1 ${file}: lapvar ${lv.toFixed(0)} < ${LAPVAR_MIN}`);
      const mp = (w * h) / 1e6;
      const dens = buf.length / 1024 / mp;
      if (dens < DENSITY[ext]) fails.push(`C2 ${file}: плотность ${dens.toFixed(1)} КБ/МП < ${DENSITY[ext]}`);
      const sz = name.endsWith('-720') ? 720 : 1200;
      if (w !== GEOM[sz][0] || h !== GEOM[sz][1]) fails.push(`C4 ${file}: геометрия ${w}×${h} ≠ ${GEOM[sz].join('×')}`);
      const mpath = join(MASTERS, master);
      if (!existsSync(mpath)) { fails.push(`C3 ${file}: нет мастера ${master}`); continue; }
      const mm = await sharp(mpath).metadata();
      if (w > mm.width) fails.push(`C3 ${file}: ширина ${w} > мастера (${mm.width}) — апскейл`);
      if (h > mm.height) fails.push(`C3 ${file}: высота ${h} > мастера (${mm.height}) — апскейл`);
      if (ext === 'webp' && sz === 1200 && buf.length / 1024 > WEBP_1200_CAP_KB) {
        fails.push(`C4 ${file}: ${(buf.length / 1024).toFixed(0)} КБ > ${WEBP_1200_CAP_KB} КБ (задание §3)`);
      }
      /* C6a: светлый бланк, а не чёрная карточка */
      const mean = await greyMean(buf);
      if (mean < MEAN_RANGE[0] || mean > MEAN_RANGE[1]) {
        fails.push(`C6a ${file}: средняя яркость ${mean.toFixed(0)} вне ${MEAN_RANGE[0]}…${MEAN_RANGE[1]}`);
      }
      if (ext === 'webp' && sz === 1200) brandThumbs[masterKey(name)] = await thumb(buf);
    }
  }

  /* C6b: четыре разных фирменных дизайна, а не один шаблон */
  const keys = BRANDS.filter((k) => brandThumbs[k]);
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    if (keys[i] === keys[j]) continue;
    const d = rms(brandThumbs[keys[i]], brandThumbs[keys[j]]);
    if (d < BRAND_RMS_MIN) fails.push(`C6b ${keys[i]}/${keys[j]}: rms ${d.toFixed(1)} < ${BRAND_RMS_MIN} (похожи как один шаблон)`);
  }

  /* C5 разметка блока сертификатов */
  const sec = astro.match(/<section class="sec sec--ivory" aria-labelledby="ab-cert-h">[\s\S]*?<\/section>/);
  if (!sec) fails.push('C5 нет секции «Сертификаты» (aria-labelledby="ab-cert-h")');
  else {
    const s = sec[0];
    const figs = s.match(/<figure class="cert">/g) || [];
    if (figs.length !== 4) fails.push(`C5 фигур сертификатов ${figs.length} ≠ 4`);
    for (const k of BRANDS) {
      if (!s.includes(`/img/cert-${k}-720.webp`) || !s.includes(`/img/cert-${k}-720.avif`)) fails.push(`C5 нет производных cert-${k}-720 в разметке`);
      if (!s.includes(`/img/cert-${k}-1200.webp`) || !s.includes(`/img/cert-${k}-1200.avif`)) fails.push(`C5 нет производных cert-${k}-1200 в разметке`);
    }
    const alts = [...s.matchAll(/alt="([^"]+)"/g)].map((m) => m[1]);
    if (alts.length < 4 || alts.filter((a) => a.startsWith('Иллюстрация:')).length < 4) fails.push('C5 alt иллюстраций сертификатов без пометки «Иллюстрация:»');
    if (!s.includes('оформленные сертификаты можно посмотреть в сервисе')) fails.push('C5 нет сноски «оформленные сертификаты можно посмотреть в сервисе»');
  }
  if (/content-source\/r26/.test(astro)) fails.push('C5 разметка ссылается на сканы docs/content-source/r26');

  return { ok: fails.length === 0, fails };
}

/* ---------------- self-test ---------------- */
const MUTANTS = [
  ['1-заблюрили-сертификат', async ({ setBuf }) => {
    const b = readFileSync(join(IMG, 'cert-lynxauto-720.webp'));
    setBuf('cert-lynxauto-720.webp', await sharp(b).blur(9).webp({ quality: 66 }).toBuffer());
  }],
  ['2-пережали-1200-в-кашу', async ({ setBuf }) => {
    const b = readFileSync(join(IMG, 'cert-sufix-1200.webp'));
    const tiny = await sharp(b).resize(120, 160).toBuffer();
    setBuf('cert-sufix-1200.webp', await sharp(tiny).resize(1200, 1600).webp({ quality: 5 }).toBuffer());
  }],
  ['3-апскейл-свыше-мастера', async ({ setBuf }) => {
    const b = readFileSync(join(IMG, 'cert-korson-1200.avif'));
    setBuf('cert-korson-1200.avif', await sharp(b).resize(1300, 1733).avif({ quality: 60 }).toBuffer());
  }],
  ['4-сноска-исчезла', ({ setAstro }) => {
    setAstro((a) => a.replace('оформленные сертификаты можно посмотреть в сервисе', 'сканы лежат в архиве сервиса'));
  }],
  /* круг 27: владелец забраковал чёрные карточки — мутант возвращает круг 26 */
  ['5-чёрная-карточка', async ({ setBuf }) => {
    /* тёмная «карточка с текстом» круга 26: яркость ~26, но зерно/фактура есть, поэтому
       C1 (резкость) и C2 (плотность) проходят — ронять обязан именно C6a */
    const dark = (w, h) => {
      const d = Buffer.alloc(w * h * 3);
      let seed = 271;
      /* блочное зерно 2×2 и амплитуда ±30: переживает avif q70, поэтому C1 остаётся живым,
         а падает именно C6a */
      for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const v = 24 + (seed % 30);
        for (let dy = 0; dy < 2 && y + dy < h; dy++) for (let dx = 0; dx < 2 && x + dx < w; dx++) {
          const i = ((y + dy) * w + (x + dx)) * 3;
          d[i] = v; d[i + 1] = v + 3; d[i + 2] = v + 1;
        }
      }
      return d;
    };
    for (const [file, w, h] of [['cert-korson-1200.webp', 1200, 1600], ['cert-korson-720.webp', 720, 960],
      ['cert-korson-1200.avif', 1200, 1600], ['cert-korson-720.avif', 720, 960]]) {
      const raw = dark(w, h);
      const pipe = sharp(raw, { raw: { width: w, height: h, channels: 3 } });
      setBuf(file, file.endsWith('.avif') ? await pipe.avif({ quality: 70 }).toBuffer() : await pipe.webp({ quality: 90 }).toBuffer());
    }
  }],
  /* круг 27: подмена буфера — все бренды стали клонами LYNXauto */
  ['6-клоны-брендов', ({ setBuf }) => {
    const lynx = readFileSync(join(IMG, 'cert-lynxauto-1200.webp'));
    setBuf('cert-sufix-1200.webp', lynx);
  }],
];

async function selfTest() {
  const astro0 = readFileSync(ASTRO, 'utf8');
  const base = await checkCerts({ astro: astro0, quiet: true });
  if (!base.ok) {
    console.log('check-certs: self-test — базовый прогон НЕ чист:');
    base.fails.forEach((f) => console.log('  ' + f));
    process.exit(1);
  }
  let fell = 0;
  for (const [name, mutate] of MUTANTS) {
    const buffers = {}; let astro = astro0;
    await mutate({
      setBuf: (f, b) => { buffers[f] = b; },
      setAstro: (fn) => { astro = fn(astro); },
    });
    const r = await checkCerts({ quiet: true, buffers, astro });
    if (r.ok) console.log(`МУТАНТ ВЫЖИЛ: ${name}`);
    else { fell++; console.log(`ok   ${name}: гейт упал (${r.fails[0]})`); }
  }
  if (fell !== MUTANTS.length) { console.log(`check-certs: ${fell}/${MUTANTS.length} мутантов — self-test провален`); process.exit(1); }
  console.log(`check-certs: ${fell}/${MUTANTS.length} мутантов роняют гейт, база чиста`);
}

if (process.argv[1] && process.argv[1].endsWith('check-certs.mjs')) {
  if (process.argv.includes('--self-test')) await selfTest();
  else {
    const r = await checkCerts();
    if (!r.ok) { r.fails.forEach((f) => console.log('FAIL ' + f)); process.exit(1); }
    console.log('check-certs: OK — 16 файлов, геометрия/резкость/плотность/апскейл/разметка в норме');
  }
}
