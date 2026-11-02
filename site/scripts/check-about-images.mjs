/* Раунд 23 (задание №25, §A3): гейт качества изображений страницы «О компании».
   Входы: файлы public/img/ab-*.{avif,webp}, мастера docs/photos-source/r23-about/,
   разметка src/pages/about.astro.
   Проверки:
     I1. резкость: дисперсия отклика лапласиана по серому в НАТИВНОМ разрешении файла ≥ 200
         — для всех ab-* (фоны, мобильные кропы, media, карточки .feat, обложки кейсов);
     I2. плотность кода: ≥ 15 КБ/МП для webp и ≥ 8 КБ/МП для avif (ловит «пережатые в кашу»);
     I3. ноль апскейла: у каждой пары «ассет → мастер» ширина ассета ≤ ширины мастера;
         у каждого ассета есть мастер, у каждого ожидаемого ассета — файл на диске;
     I4. .about-media — не фасад: src/srcset только ab-media-*; запрещённые имена
         (about-service-*, original-front*, service-front*, hero-*) не встречаются в секции;
     I5. подпись media переписана: содержит «Иллюстрация:», старой подписи
         «Портовая, 439 — бокс и зона выдачи» в about.astro нет;
     I6. кейсы на about: шесть пар ab-case-N-640.{avif,webp} в разметке, никаких .svg
         в галерее about, ярлык «пример работы» вместо бейджа «до / после».
   --self-test: 7 мутантов, каждый обязан ронять гейт (6 из задания №25 + «нет мастера»). */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = join(ROOT, 'site');
const IMG = join(SITE, 'public', 'img');
const MASTERS = join(ROOT, 'docs', 'photos-source', 'r23-about');
const ASTRO = join(SITE, 'src', 'pages', 'about.astro');

/* пары «ассет → мастер» (§A3). Ключ — имя файла без расширения. */
const PAIRS = {
  'ab-head': 'scene-head.jpg', 'ab-head-m': 'scene-head.jpg',
  'ab-t': 'scene-text.jpg', 'ab-t-m': 'scene-text.jpg',
  'ab-feats': 'scene-feats.jpg', 'ab-feats-m': 'scene-feats.jpg',
  'ab-media-1080': 'scene-media.jpg', 'ab-media-720': 'scene-media.jpg', 'ab-media-480': 'scene-media.jpg',
  'ab-f1-640': 'card-f1.jpg', 'ab-f2-640': 'card-f2.jpg', 'ab-f3-640': 'card-f3.jpg', 'ab-f4-640': 'card-f4.jpg',
  'ab-case-1-640': 'case-1-tyre-cut.jpg', 'ab-case-2-640': 'case-2-tyre-hernia.jpg',
  'ab-case-3-640': 'case-3-rim-straight.jpg', 'ab-case-4-640': 'case-4-brake-pads.jpg',
  'ab-case-5-640': 'case-5-oil.jpg', 'ab-case-6-640': 'case-6-glass.jpg',
};
const LAPVAR_MIN = 200;
const DENSITY = { webp: 15, avif: 8 };   /* КБ на мегапиксель */
const BANNED_MEDIA = /(about-service|original-front|service-front|hero-)/;

/* дисперсия отклика лапласиана (4·c − соседи) по серому, нативное разрешение */
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

const masterWidth = async (file, cache) => {
  if (cache[file] == null) {
    const p = join(MASTERS, file);
    cache[file] = existsSync(p) ? (await sharp(p).metadata()).width : -1;
  }
  return cache[file];
};

export async function checkAboutImages(opts = {}) {
  const fails = [];
  const warn = (m) => { if (!opts.quiet) console.log('WARN ' + m); };
  const mCache = {};
  const buffers = opts.buffers || {};      /* self-test: подменённые байты файлов */
  const pairs = opts.pairs || PAIRS;
  const astro = opts.astro ?? readFileSync(ASTRO, 'utf8');

  /* ---------- I1–I3. файлы ---------- */
  for (const [name, master] of Object.entries(pairs)) {
    for (const ext of ['avif', 'webp']) {
      const file = `${name}.${ext}`;
      const path = join(IMG, file);
      let buf = buffers[file];
      if (!buf) {
        if (!existsSync(path)) { fails.push(`I3 нет файла ${file}`); continue; }
        buf = readFileSync(path);
      }
      const meta = await sharp(buf).metadata();
      const w = meta.width, h = meta.height;
      /* I1 резкость */
      const lv = await lapvar(buf);
      if (lv < LAPVAR_MIN) fails.push(`I1 ${file}: lapvar ${lv.toFixed(0)} < ${LAPVAR_MIN} (нерезко/мыло)`);
      /* I2 плотность */
      const mp = (w * h) / 1e6;
      const dens = buf.length / 1024 / mp;
      if (dens < DENSITY[ext]) fails.push(`I2 ${file}: плотность ${dens.toFixed(1)} КБ/МП < ${DENSITY[ext]} (пережат)`);
      /* I3 апскейл */
      const mw = master ? await masterWidth(master, mCache) : null;
      if (mw == null) { fails.push(`I3 ${file}: нет мастера ${master}`); continue; }
      if (mw < 0) { fails.push(`I3 мастер ${master} для ${file} отсутствует на диске`); continue; }
      if (w > mw) fails.push(`I3 ${file}: ширина ${w} > ширины мастера ${master} (${mw}) — апскейл`);
    }
  }

  /* ---------- I4. media — не фасад ---------- */
  const figM = astro.match(/<figure class="about-media[^\s\S]*?[\s\S]*?<\/figure>/);
  if (!figM) fails.push('I4 в about.astro нет <figure class="about-media">');
  else {
    const fig = figM[0];
    if (!/\/img\/ab-media-1080\.(avif|webp)/.test(fig) || !/\/img\/ab-media-720\./.test(fig) || !/\/img\/ab-media-480\./.test(fig))
      fails.push('I4 media: ожидается три источника ab-media-480/720/1080');
    if (BANNED_MEDIA.test(fig)) fails.push('I4 media: запрещённый фасадный кадр в figure');
    if (/alt="Автомобиль на подъёмнике в боксе сервиса"/.test(fig) !== true)
      fails.push('I4 media: alt не соответствует заданию №25 §C («Автомобиль на подъёмнике в боксе сервиса»)');
  }

  /* ---------- I5. подпись ---------- */
  if (!/<figcaption>Иллюстрация:[^<]*<\/figcaption>/.test(astro))
    fails.push('I5 подпись media не переписана: ожидается <figcaption>Иллюстрация: …</figcaption>');
  if (astro.includes('Портовая, 439 — бокс и зона выдачи'))
    fails.push('I5 старая подпись media («Портовая, 439 — бокс и зона выдачи…») осталась');

  /* ---------- I6. кейсы ---------- */
  for (let i = 1; i <= 6; i++)
    if (!astro.includes(`/img/ab-case-${i}-640.avif`) || !astro.includes(`/img/ab-case-${i}-640.webp`))
      fails.push(`I6 кейс ${i}: в разметке нет фото-обложки ab-case-${i}-640 (avif+webp)`);
  const galM = astro.match(/<section class="sec" aria-labelledby="ab-gal-h">[\s\S]*?<\/section>/);
  if (!galM) fails.push('I6 в about.astro нет секции галереи кейсов');
  else {
    if (/\.svg/.test(galM[0])) fails.push('I6 в галерее кейсов about осталась SVG-заглушка');
    if (/class="ba">до \/ после</.test(galM[0])) fails.push('I6 в галерее about остался бейдж «до / после»');
    if (!/class="ba">пример работы</.test(galM[0])) fails.push('I6 в галерее about нет ярлыка «пример работы»');
  }
  warn('проверены резкость (lapvar ≥ 200), плотность кода, ширина ≤ мастера, media/подпись/кейсы');

  if (fails.length && !opts.quiet) fails.forEach(f => console.log('FAIL ' + f));
  return { ok: fails.length === 0, fails };
}

/* ---------------- self-test ---------------- */
const MUTANTS = [
  ['1-заблюрили-фон', async ({ setBuf }) => {
    const b = readFileSync(join(IMG, 'ab-head.avif'));
    setBuf('ab-head.avif', await sharp(b).blur(9).avif({ quality: 60 }).toBuffer());
  }],
  ['2-пережали-media-в-4КБ', async ({ setBuf }) => {
    const b = readFileSync(join(IMG, 'ab-media-1080.avif'));
    const m = await sharp(b).metadata();
    /* цель мутанта — ~4 КБ: жёсткий даунскейл + апскейл обратно + quality 1 (каша) */
    const tiny = await sharp(b).resize(160, 100).toBuffer();
    setBuf('ab-media-1080.avif', await sharp(tiny).resize(m.width, m.height).avif({ quality: 1 }).toBuffer());
  }],
  ['3-апскейл-1-5x', async ({ setBuf }) => {
    const b = readFileSync(join(IMG, 'ab-head.avif'));
    const m = await sharp(b).metadata();
    setBuf('ab-head.avif', await sharp(b).resize(Math.round(m.width * 1.5), Math.round(m.height * 1.5)).avif({ quality: 60 }).toBuffer());
  }],
  ['4-media-снова-фасад', ({ setAstro }) => {
    setAstro((a) => a.replace('/img/ab-media-1080.webp', '/img/about-service-1600.webp')
      .replace('/img/ab-media-1080.avif', '/img/about-service-1600.avif'));
  }],
  ['5-кейсы-вернулись-на-svg', ({ setAstro }) => {
    setAstro((a) => a.replace('/img/ab-case-1-640.avif', '/img/case-1.svg')
      .replace('/img/ab-case-1-640.webp', '/img/case-1.svg'));
  }],
  ['6-старая-подпись-media', ({ setAstro }) => {
    setAstro((a) => a.replace('Иллюстрация: рабочий пост на два подъёмника',
      'Портовая, 439 — бокс и зона выдачи: сюда можно приехать без записи через центр'));
  }],
  ['7-мастер-исчез', ({ setPairs }) => { setPairs('ab-f2-640', 'нет-такого-мастера.jpg'); }],
];

async function selfTest() {
  const astro0 = readFileSync(ASTRO, 'utf8');
  const base = await checkAboutImages({ quiet: true, astro: astro0 });
  if (!base.ok) {
    console.log('check-about-images: self-test — базовый прогон НЕ чист:');
    base.fails.forEach(f => console.log('  ' + f));
    process.exit(1);
  }
  let fell = 0;
  for (const [name, mutate] of MUTANTS) {
    const buffers = {}; const pairs = { ...PAIRS }; let astro = astro0;
    await mutate({
      setBuf: (f, b) => { buffers[f] = b; },
      setAstro: (fn) => { astro = fn(astro); },
      setPairs: (k, v) => { pairs[k] = v; },
    });
    const r = await checkAboutImages({ quiet: true, buffers, pairs, astro });
    if (r.ok) { console.log(`МУТАНТ ВЫЖИЛ: ${name}`); }
    else { fell++; console.log(`ok   ${name}: гейт упал (${r.fails[0]})`); }
  }
  if (fell !== MUTANTS.length) { console.log(`check-about-images: ${fell}/${MUTANTS.length} мутантов — self-test провален`); process.exit(1); }
  console.log(`check-about-images: ${fell}/${MUTANTS.length} мутантов роняют гейт, база чиста`);
}

if (process.argv[1] && process.argv[1].endsWith('check-about-images.mjs')) {
  if (process.argv.includes('--self-test')) await selfTest();
  else {
    const r = await checkAboutImages();
    if (!r.ok) { console.log(`check-about-images: ${r.fails.length} нарушений`); process.exit(1); }
    console.log('check-about-images: OK (резкость, плотность, ноль апскейла, media/подпись/кейсы)');
  }
}
