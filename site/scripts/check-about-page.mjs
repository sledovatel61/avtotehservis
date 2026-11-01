/* Раунд 22 (задание №24): гейт страницы «О компании» (/about) и каталога /services.
   Входы: разметка about.astro, CSS (sections+media), собранный HTML pages-dist,
   геометрия рендера site/data/about-geom.json (снимается render-about.mjs, Chromium DPR1),
   файлы public/img (ab-*), исходники /services.
   8 групп проверок (часть C задания №24):
     1) фоны page-head / текстовой секции / «Как мы работаем»: picture-слой, mean 26…46,
        разброс ≥22, попарная разница третей ≥3, деталь X/Y ≥0.8, покрытие ~100×100 %,
        кадры не из запрещённого списка;
     2) .about-media: не SVG, выбранный файл ≥640 px (1440/1280), alt осмысленный,
        3 источника 480/720/1080, sizes из задания, aspect 16/10;
     3) карточки .feat: у каждой div.feat-bg img, 4 разных кадра ab-f1…ab-f4 (не about-c*),
        mean 34…96, разброс ≥34, попарная Δ средних ≥6;
     4) контраст по худшему пикселю: h1 ≥7, lead ≥4.5, h3 карточек ≥7, p ≥4.5,
        aside h3 ≥7 / p ≥4.5 (B6);
     5) дубли текста: ни одна строка >80 символов не встречается в собранном HTML дважды;
     6) /services: «фото появится» по site/src = 0, картинки карточек не .svg;
     7) геометрия: текстовая секция @390 ≤1500 px, .about-media ≥70 % колонки на 1024/768,
        overflow 0 на всех ширинах, rate-note ровно один (B4);
     8) вес about: потолок = замер «до» (base-проход render-about) + 60 КБ на ширину.
   Мутанты --self-test: 17, каждый валит гейт (12 обязательных из задания + 5 доп.). */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = join(ROOT, 'site');
const IMG = join(SITE, 'public', 'img');
const WIDTHS = ['1440', '1280', '1024', '768', '390'];
/* Потолки веса (группа 8): base-проход render-about.mjs (страница без новых ab-картинок)
   + 60 КБ. Base: 1440/1280 = 242, 1024 = 232, 768 = 234, 390 = 226 КБ. */
const WEIGHT_CAP = { 1440: 302, 1280: 302, 1024: 292, 768: 294, 390: 286 };
/* геометрия файлов-слоёв (производные r22, блок «10d» build-images) */
const BG_FILES = [
  ['ab-head-1600.avif', 620, 795], ['ab-head-1600.webp', 620, 795],
  ['ab-feats-1600.avif', 920, 576], ['ab-feats-1600.webp', 920, 576],
  ['ab-feats-m-960.avif', 460, 1280], ['ab-feats-m-960.webp', 460, 1280],
  ['ab-t-1440.avif', 640, 1280], ['ab-t-1440.webp', 640, 1280],
  ['ab-t-m-960.avif', 380, 1380], ['ab-t-m-960.webp', 380, 1380],
];
const BANNED_FRAMES = /(hero-|strip-|tri-|about-c[1-4]|est-|svc-)/;

const walkSrc = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' ? [] : walkSrc(p);
  return /\.(astro|ts|js|css|mdx?)$/.test(e.name) ? [p] : [];
});

export async function checkAboutPage(opts = {}) {
  const fails = [];
  const astro = opts.astro ?? readFileSync(join(SITE, 'src/pages/about.astro'), 'utf8');
  const css = opts.css ?? readFileSync(join(SITE, 'src/styles/sections.css'), 'utf8')
    + '\n' + readFileSync(join(SITE, 'src/styles/media.css'), 'utf8');
  const html = opts.html ?? (existsSync(join(SITE, 'pages-dist/about/index.html'))
    ? readFileSync(join(SITE, 'pages-dist/about/index.html'), 'utf8') : '');
  const srcAll = opts.srcAll ?? walkSrc(join(SITE, 'src')).map((f) => readFileSync(f, 'utf8')).join('\n');
  const geom = opts.geom ?? JSON.parse(readFileSync(join(SITE, 'data/about-geom.json'), 'utf8'));

  /* ---------- 1. фоны трёх секций ---------- */
  const BG = [
    ['.abh-bg', '.page-head', 'ab-head-1600', 'headBg', 'coverHead'],
    ['.ab-text-bg', 'section[aria-labelledby="ab-text-h"]', 'ab-t-1440', 'textBg', 'coverText'],
    ['.ab-feats-bg', '.ab-feats', 'ab-feats-1600', 'featsBg', 'coverFeats'],
  ];
  for (const [cls, , file] of BG) {
    const re = new RegExp(`<div class="${cls.slice(1)}" aria-hidden="true">\\s*<picture>[\\s\\S]*?${file}\\.(avif|webp)`);
    if (!re.test(astro)) fails.push(`C1 ${cls}: в разметке нет picture-слоя с ${file}`);
    if (!new RegExp(`\\${cls}\\{[^}]*position:absolute`).test(css)
      && !new RegExp(`[^{}]*${cls.replace('.', '\\.')}[^{}]*\\{[^}]*position:absolute`).test(css))
      fails.push(`C1 ${cls}: слой не position:absolute`);
    if (new RegExp(`${cls.replace('.', '\\.')}[^{}]*\\{[^}]*background-image:url`).test(css))
      fails.push(`C1 ${cls}: фон обязан быть picture-слоем, не background-image`);
  }
  /* z-index: контент выше слоя */
  if (!/\.page-head>\.container\{[^}]*z-index:2/.test(css)) fails.push('C1 .page-head>.container без z-index:2');
  if (!/section\[aria-labelledby="ab-text-h"\]>\.container\{[^}]*z-index:2/.test(css)) fails.push('C1 контейнер текстовой секции без z-index:2');
  if (!/\.ab-feats>\.container\{[^}]*z-index:2/.test(css)) fails.push('C1 .ab-feats>.container без z-index:2');
  /* reduced-data и print гасят все три слоя */
  for (const media of ['(prefers-reduced-data:reduce)', 'print']) {
    const esc = media.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const bodies = [...css.matchAll(new RegExp(`@media ${esc}\\{([^@]*)\\}`, 'g'))].map((m) => m[1]).join('\n');
    if (!bodies) { fails.push(`C1 нет @media ${media} для слоёв about`); continue; }
    for (const cls of ['.abh-bg', '.ab-text-bg', '.ab-feats-bg'])
      if (!bodies.includes(cls)) fails.push(`C1 @media ${media} не гасит ${cls}`);
  }
  /* стык соседних фонов: явная граница-разделитель между секциями (B1) */
  if (!/section\[aria-labelledby="ab-text-h"\]\{[^}]*border-top:1px solid var\(--line\)/.test(css))
    fails.push('C1 нет границы-разделителя между page-head и текстовой секцией');
  if (!/\.ab-feats\{[^}]*border-top:1px solid var\(--line\)/.test(css))
    fails.push('C1 нет границы-разделителя между текстовой секцией и «Как мы работаем»');
  /* антиобход: базовые правила слоёв без display:none / opacity / !important вне медиа */
  const clean = css
    .replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  for (const cls of ['.abh-bg', '.ab-text-bg', '.ab-feats-bg', '.abh-bg img', '.ab-text-bg img', '.ab-feats-bg img']) {
    let i = -1;
    while ((i = clean.indexOf(cls + '{', i + 1)) >= 0) {
      const body = clean.slice(i, clean.indexOf('}', i));
      if (/display:\s*none/.test(body)) fails.push(`C1 антиобход: ${cls} display:none в базовых правилах`);
      const op = body.match(/opacity:\s*([.\d]+)/); if (op && +op[1] < 0.95) fails.push(`C1 антиобход: ${cls} opacity ${op[1]}`);
      if (/!important/.test(body)) fails.push(`C1 антиобход: ${cls} !important`);
    }
  }
  /* файлы на месте и заявленной геометрии */
  if (!opts.skipFiles) for (const [f, w, h] of BG_FILES) {
    const p = join(IMG, f);
    if (!existsSync(p)) { fails.push(`C1 нет файла ${f}`); continue; }
    const m = await sharp(p).metadata();
    if (m.width !== w || m.height !== h) fails.push(`C1 ${f}: ${m.width}×${m.height}, ждал ${w}×${h}`);
  }
  /* кадры не из запрещённого списка (hero/strip/tri/about-c/est/svc) */
  const bgSrc = (astro.match(/class="ab(?:h|text|feats)-bg"[\s\S]*?<\/picture>/g) ?? []).join('\n');
  for (const m of bgSrc.matchAll(/\/img\/([\w.-]+)/g))
    if (BANNED_FRAMES.test(m[1])) fails.push(`C1 фон использует запрещённый кадр ${m[1]}`);
  /* числа фонов: mean/spread/трети/деталь/покрытие — на всех пяти ширинах */
  for (const w of WIDTHS) {
    const d = geom.widths?.[w];
    if (!d) { fails.push(`C1 нет замеров для ${w}`); continue; }
    for (const [cls, , , key, coverKey] of BG) {
      const b = d[key]; const cv = d[coverKey];
      if (!b) { fails.push(`C1 ${w}: нет ${key}`); continue; }
      if (b.mean < 26 || b.mean > 46) fails.push(`C1 ${w} ${cls}: mean ${b.mean} вне 26…46`);
      if (b.spread < 22) fails.push(`C1 ${w} ${cls}: разброс ${b.spread} < 22`);
      const [t1, t2, t3] = b.thirds;
      const minPair = Math.min(Math.abs(t1 - t2), Math.abs(t2 - t3), Math.abs(t1 - t3));
      if (minPair < 3) fails.push(`C1 ${w} ${cls}: трети ${b.thirds.join('/')} — мин. попарная разница ${minPair.toFixed(1)} < 3`);
      if (b.detailX < 0.8) fails.push(`C1 ${w} ${cls}: detailX ${b.detailX} < 0.8`);
      if (b.detailY < 0.8) fails.push(`C1 ${w} ${cls}: detailY ${b.detailY} < 0.8`);
      if (!cv || cv.w < 99.5 || cv.h < 99.5) fails.push(`C1 ${w} ${cls}: покрытие ${cv ? cv.w + '×' + cv.h : 'нет'} < 100×100`);
    }
  }

  /* ---------- 2. .about-media ---------- */
  const figBlock = astro.match(/<figure class="about-media[\s\S]*?<\/figure>/);
  if (!figBlock) fails.push('C2 нет figure.about-media с picture');
  else {
    const fb = figBlock[0];
    if (/\.svg/.test(fb)) fails.push('C2 .about-media снова SVG');
    for (const n of [480, 720, 1080]) if (!fb.includes(`ab-media-${n}.avif`) || !fb.includes(`ab-media-${n}.webp`))
      fails.push(`C2 в picture нет источника ab-media-${n} (avif+webp)`);
    if (!fb.includes('sizes="(max-width:768px) 92vw, (max-width:1024px) 46vw, 526px"'))
      fails.push('C2 sizes не соответствует заданию B2');
    const alt = fb.match(/alt="([^"]*)"/);
    if (!alt || alt[1].trim().length < 12 || /появится/i.test(alt[1])) fails.push(`C2 alt не осмысленный: ${alt ? alt[1] : 'нет'}`);
  }
  if (!/\.about-media img\{[^}]*aspect-ratio:16\/10/.test(css)) fails.push('C2 .about-media img без aspect-ratio 16/10');
  for (const [f, w] of [['ab-media-480.avif', 480], ['ab-media-720.avif', 720], ['ab-media-1080.avif', 1080]]) {
    if (opts.skipFiles) break;
    const p = join(IMG, f);
    if (!existsSync(p)) { fails.push(`C2 нет файла ${f}`); continue; }
    const m = await sharp(p).metadata();
    if (m.width !== w) fails.push(`C2 ${f}: ширина ${m.width}, ждал ${w}`);
  }
  for (const w of ['1440', '1280']) {
    const sel = geom.widths?.[w]?.media?.sel;
    if (!(sel >= 640)) fails.push(`C2 ${w}: выбранный файл ${sel} px < 640 (naturalWidth для srcset — density-corrected, проверяем ширину выбранного кадра)`);
  }

  /* ---------- 3. карточки .feat ---------- */
  const featImgs = [...astro.matchAll(/<div class="feat-bg"[^>]*>\s*<picture>[\s\S]*?src="\/img\/([\w.-]+)"/g)].map((m) => m[1]);
  if (featImgs.length !== 4) fails.push(`C3 в разметке ${featImgs.length} слоёв .feat-bg, ждал 4`);
  const want = ['ab-f1-480', 'ab-f2-480', 'ab-f3-480', 'ab-f4-480'];
  featImgs.forEach((f, i) => { if (!f.startsWith(want[i])) fails.push(`C3 карточка ${i + 1}: кадр ${f}, ждал ${want[i]}.*`); });
  for (const f of featImgs) if (/about-c[1-4]/.test(f)) fails.push(`C3 карточка переиспользует ${f} с главной`);
  if (!opts.skipFiles) {
    const hashes = want.map((n) => createHash('sha256').update(readFileSync(join(IMG, `${n}.avif`))).digest('hex'));
    if (new Set(hashes).size !== 4) fails.push('C3 кадры карточек не уникальны (совпадают хеши)');
  }
  for (const w of WIDTHS) {
    const z = geom.widths?.[w]?.featZones;
    if (!z || z.length !== 4) { fails.push(`C3 ${w}: нет зон 4 карточек`); continue; }
    const means = z.map((v) => v.mean);
    means.forEach((m, i) => {
      if (m < 34 || m > 96) fails.push(`C3 ${w}: карточка ${i + 1} mean ${m} вне 34…96`);
      if (z[i].spread < 34) fails.push(`C3 ${w}: карточка ${i + 1} разброс ${z[i].spread} < 34`);
    });
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++)
      if (Math.abs(means[i] - means[j]) < 6) fails.push(`C3 ${w}: Δ(${i + 1},${j + 1}) = ${Math.abs(means[i] - means[j]).toFixed(1)} < 6`);
  }

  /* ---------- 4. контраст по худшему пикселю ---------- */
  for (const w of WIDTHS) {
    const c = geom.contrast?.[w];
    if (!c) { fails.push(`C4 нет контрастов для ${w}`); continue; }
    if (c.h1 < 7) fails.push(`C4 ${w}: h1 ${c.h1} < 7`);
    if (c.lead < 4.5) fails.push(`C4 ${w}: lead ${c.lead} < 4.5`);
    if (c.featH3 < 7) fails.push(`C4 ${w}: h3 карточек ${c.featH3} < 7`);
    if (c.featP < 4.5) fails.push(`C4 ${w}: p карточек ${c.featP} < 4.5`);
    if (c.asideH3 < 7) fails.push(`C4 ${w}: aside h3 ${c.asideH3} < 7 (B6)`);
    if (c.asideP < 4.5) fails.push(`C4 ${w}: aside p ${c.asideP} < 4.5 (B6)`);
  }

  /* ---------- 5. дубли строк в собранном HTML ---------- */
  if (!html) fails.push('C5 нет собранного pages-dist/about/index.html (сначала build:pages)');
  else {
    const seen = new Map();
    for (const line of html.split('\n')) {
      const t = line.trim();
      if (t.length <= 80) continue;
      seen.set(t, (seen.get(t) ?? 0) + 1);
    }
    for (const [t, n] of seen) if (n > 1) fails.push(`C5 строка >80 символов встречается ${n} раза: «${t.slice(0, 60)}…»`);
  }

  /* ---------- 6. /services ---------- */
  /* проверка задания: grep -r "фото появится" site/src = 0 (регистрозависимо, как в задании;
     «Фото появится…» в seed-data — демо-контент круга 15, главная его вычищает .replace) */
  if (srcAll.includes('фото появится')) fails.push('C6 в site/src встречается «фото появится»');
  const svcFiles = ['src/pages/services.astro', 'src/pages/services/[slug].astro', 'src/server/svc-img.ts'];
  for (const f of svcFiles) {
    const txt = opts.svc?.[f] ?? (existsSync(join(SITE, f)) ? readFileSync(join(SITE, f), 'utf8') : '');
    if (!txt) { fails.push(`C6 нет ${f}`); continue; }
    if (/<img[^>]+src="[^"]+\.svg"/.test(txt) || /svc-\d+\.svg/.test(txt)) fails.push(`C6 ${f}: картинка карточки — .svg`);
  }

  /* ---------- 7. геометрия ---------- */
  const t390 = geom.widths?.['390']?.textH;
  if (!(t390 <= 1500)) fails.push(`C7 текстовая секция @390 = ${t390} px > 1500`);
  for (const w of ['1024', '768']) {
    const cr = geom.widths?.[w]?.media?.colRatio;
    if (!(cr >= 0.7)) fails.push(`C7 ${w}: .about-media ${((cr ?? 0) * 100).toFixed(0)} % колонки < 70 %`);
  }
  for (const w of WIDTHS) if (!geom.scroll?.[w]) fails.push(`C7 ${w}: горизонтальная прокрутка`);
  for (const w of WIDTHS) {
    const n = geom.widths?.[w]?.rateNotes;
    if (n !== 1) fails.push(`C7 ${w}: rate-note встречается ${n} раз, ждал 1 (B4)`);
  }

  /* ---------- 8. вес ---------- */
  for (const w of WIDTHS) {
    const wAbs = geom.weights?.[w]; const base = geom.weightsBase?.[w];
    if (wAbs == null || base == null) { fails.push(`C8 нет замеров веса для ${w}`); continue; }
    const cap = Math.min(WEIGHT_CAP[w], base + 60);
    if (wAbs > cap) fails.push(`C8 ${w}: вес ${wAbs} КБ > потолка ${cap} (база ${base} + 60)`);
  }
  return { fails };
}

/* ---------- мутанты ---------- */
const MUTANTS = {
  /* 12 обязательных из задания №24 */
  'фон-display-none': ({ o }) => { o.css += '\n.abh-bg{display:none}\n'; },
  'фон-сплошной-заливкой': ({ o }) => { o.astro = o.astro.replace(/<div class="abh-bg"[\s\S]*?<\/picture>\s*<\/div>/, ''); },
  'фото-в-полосы-0.2': ({ G }) => { G.widths['1440'].headBg.detailX = 0.2; },
  'одна-картинка-на-4-карточки': ({ o }) => { o.astro = o.astro.replace(/ab-f[2-4]-480/g, 'ab-f1-480'); },
  'карточка-mean-120': ({ G }) => { G.widths['1440'].featZones[2].mean = 120; },
  'rate-note-продублирован': ({ G }) => { for (const w of Object.keys(G.widths)) G.widths[w].rateNotes = 2; },
  'about-media-вернулась-на-svg': ({ o }) => { o.astro = o.astro.replace(/<figure class="about-media[\s\S]*?<\/figure>/, '<figure class="about-media"><img src="/img/svc-4.svg" alt="схема"></figure>'); },
  'alt-фото-появится': ({ o }) => { o.astro = o.astro.replace(/(class="about-media[^"]*"[\s\S]*?)alt="[^"]+"/, '$1alt="фото появится после съёмки"'); },
  'h3-карточки-контраст-4': ({ G }) => { G.contrast['1440'].featH3 = 4; },
  'покрытие-слоя-80': ({ G }) => { G.widths['1440'].coverHead = { w: 80, h: 80 }; },
  '390-секция-1600': ({ G }) => { G.widths['390'].textH = 1600; },
  'деталь-фона-0.5': ({ G }) => { G.widths['1440'].textBg.detailY = 0.5; },
  /* дополнительные */
  'трети-плоские': ({ G }) => { G.widths['1440'].headBg.thirds = [30, 31, 30.5]; },
  'дубль-строки-в-html': ({ o }) => { const l = '<div>' + 'x'.repeat(90) + '</div>'; o.html = `${l}\n<p>unique</p>\n${l}`; },
  'services-фото-появится': ({ o }) => { o.srcAll += '\n<img alt="фото появится после съёмки">\n'; },
  'вес-сверх-потолка': ({ G }) => { G.weights['1440'] = G.weightsBase['1440'] + 61; },
  'media-50-процентов-колонки': ({ G }) => { G.widths['768'].media.colRatio = 0.5; },
  'стык-без-разделителя': ({ o }) => { o.css = o.css.replace(/border-top:1px solid var\(--line\)/g, ''); },
};

const load = () => ({
  astro: readFileSync(join(SITE, 'src/pages/about.astro'), 'utf8'),
  css: readFileSync(join(SITE, 'src/styles/sections.css'), 'utf8') + '\n' + readFileSync(join(SITE, 'src/styles/media.css'), 'utf8'),
  html: existsSync(join(SITE, 'pages-dist/about/index.html')) ? readFileSync(join(SITE, 'pages-dist/about/index.html'), 'utf8') : '',
  srcAll: walkSrc(join(SITE, 'src')).map((f) => readFileSync(f, 'utf8')).join('\n'),
  geom: JSON.parse(readFileSync(join(SITE, 'data/about-geom.json'), 'utf8')),
  skipFiles: true,
});

const arg = process.argv[2] || '';
if (arg === '--self-test') {
  let bad = 0;
  for (const [name, mut] of Object.entries(MUTANTS)) {
    const o = load();
    mut({ o, G: o.geom });
    const { fails } = await checkAboutPage(o);
    const ok = fails.length > 0;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} мутант «${name}»: поломок ${fails.length}${fails[0] ? ' — ' + fails[0] : ''}`);
  }
  const { fails } = await checkAboutPage(load());
  console.log(`${fails.length ? 'FAIL' : 'ok  '} базовый прогон (без файлов): ошибок ${fails.length}`);
  if (fails.length || bad) { fails.forEach((f) => console.log('  ' + f)); process.exit(1); }
  console.log(`check-about-page: ${Object.keys(MUTANTS).length}/12+ мутантов роняют гейт, база чиста`);
} else {
  const { fails } = await checkAboutPage();
  if (fails.length) { fails.forEach((f) => console.log('FAIL ' + f)); process.exit(1); }
  console.log('check-about-page: OK (все 8 групп задания №24 пройдены, файлы ab-* на месте)');
}
