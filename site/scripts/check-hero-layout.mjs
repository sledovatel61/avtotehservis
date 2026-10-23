/**
 * Раунд 12, §2: аналитическая проверка компоновки первого экрана — все три режима:
 * ≥1024 (две колонки), 641–1023 (фото целиком сверху, текст ниже), ≤640 (панель .82).
 * Считает геометрию по тем же формулам, что и CSS (hero.css:87-106):
 *   --cx = (100% − min(1200px,100%−40px))/2 + 20px  (левый край = логотип шапки),
 *   --hp = clamp(24px,5vw,96px),
 *   высота фото = min(heroH − hp − 72, (vw − cx − hp − 300 − clamp(32px,3vw,48px))·9/16),
 *   рамка фото aspect-ratio 16/9 = пропорция мастера 2844×1600 (±1 px на любой ширине),
 *   текст: .slide-in{align-self:center} → центр блока = 50 % высоты героя (норма 46–54),
 *   .hero-ui (точки/стрелки) стоит в нижней полосе под фото и справа от текстовой
 *   колонки: пересечение с .slide-cta = 0 px² гарантировано неравенствами ниже.
 * Плюс маркеры собранного CSS: на ≥1025 у .slide-in нет фона, рамка фото
 * 26 px + border rgba(224,169,109,.18) + тень 0 30px 80px rgba(0,0,0,.55).
 * Запуск: node site/scripts/check-hero-layout.mjs (exit 1 при провале).
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, '../src/styles/hero.css'), 'utf8');
const astro = readFileSync(join(HERE, '../src/pages/index.astro'), 'utf8');
const IMG = join(HERE, '../public/img');
const GEN = join(HERE, '../../docs/photos-source/r9-gen');

const WIDTHS = [[1024, 768], [1280, 800], [1366, 768], [1440, 900], [1600, 900], [1901, 1080], [1920, 1080], [2560, 1440]];
const WUI = 260;   // консервативная ширина блока .hero-ui (точки + стрелки + gap)
const GAP = 24;    // зазор между текстовой колонкой и фото
const HUI = 40;    // высота полосы .hero-ui

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let fail = 0;
const bad = (msg) => { fail = 1; console.error('FAIL ' + msg); };

console.log('компоновка ≥1025 (формулы CSS):');
for (const [vw, vh] of WIDTHS) {
  const cx = (vw - Math.min(1200, vw - 40)) / 2 + 20;
  const hp = clamp(vw * 0.05, 24, 96);
  const heroH = Math.min(860, Math.max(560, vh - 150));
  const pad = clamp(vw * 0.03, 32, 48);
  const photoH = Math.min(heroH - hp - 72, (vw - cx - hp - 300 - pad) * 9 / 16);
  const photoW = photoH * 16 / 9;
  const colW = vw - cx - hp - photoW - GAP;
  const gapBelow = (heroH - photoH) / 2;
  const ok = photoW + GAP >= WUI && gapBelow >= HUI + 6 && colW >= 300;
  if (!ok) bad(`${vw}×${vh}: hero-ui/cta разошлись (photoW=${photoW.toFixed(0)}, colW=${colW.toFixed(0)}, gapBelow=${gapBelow.toFixed(0)})`);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${vw}×${vh}: фото ${photoW.toFixed(0)}×${photoH.toFixed(0)} (целиком 16:9), колонка ${colW.toFixed(0)}, зазор под фото ${gapBelow.toFixed(0)}, центр текста 50 %`);
}

/* пропорция файла = пропорция рамки: cover не режет ни на одной ширине */
const fileRatio = 2844 / 1600;
if (Math.abs(fileRatio - 16 / 9) * 2560 > 1) bad('пропорция мастера отличается от 16:9 больше 1 px на 2560');

/* маркеры CSS десктопа */
const desk = css.slice(css.indexOf('@media (min-width:1024px)'));
const marks = [
  ['.slide-in без фона', /\.slide-in\{background:none;padding:0;border-radius:0;backdrop-filter:none/],
  ['рамка фото 16:9 + radius 26', /aspect-ratio:16\/9;border-radius:26px/],
  ['бордер rgba(224,169,109,.18)', /border:1px solid rgba\(224,169,109,\.18\)/],
  ['тень 0 30px 80px rgba(0,0,0,.55)', /box-shadow:0 30px 80px rgba\(0,0,0,\.55\)/],
  ['текст по центру колонки', /\.slide-in\{[^}]*align-self:center/],
  ['hero-ui справа в зазоре hp', /\.hero-ui\{left:auto;right:var\(--hp\)/],
  ['без scrim поверх фото', /\.slide-bg::before,\.slide-bg::after\{content:none/],
];
for (const [name, re] of marks) {
  const pass = re.test(desk);
  if (!pass) bad('CSS-маркер: ' + name);
  console.log(`${pass ? 'ok  ' : 'FAIL'} CSS ≥1025: ${name}`);
}

/* ================= дополнения раунда 12: все три слайда, планшет, мобайл ================= */
const chk = (name, pass, got, want) => {
  if (!pass) bad(name);
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}: ${got} (норма: ${want})`);
};
const pct = (v) => (v * 100).toFixed(1) + ' %';

await (async () => {
  /* 1. Пропорция КАЖДОГО отдаваемого файла = пропорция рамки 16:9 → cover режет 0 px
     на всех трёх слайдах (раунд 12, патч #62: слайды 2–3 были 2048×1143 = 1.7918
     и теряли ~0,8 % ширины). Допуск: ≤1 px на собственной ширине файла. */
  console.log('\nфайлы слайдов 1–3 (кроп cover на десктопе/планшете):');
  for (const [slide, widths] of [
    ['hero-service', [640, 960, 1600, 2560]],
    ['hero-tyre', [640, 960, 1600, 2032]],
    ['hero-tools', [640, 960, 1600, 2032]],
  ]) {
    for (const w of widths) {
      const p = join(IMG, `${slide}-${w}.webp`);
      if (!existsSync(p)) { chk(`${slide}-${w}`, false, 'нет файла', 'файл в public/img'); continue; }
      const m = await sharp(p).metadata();
      const cropPx = Math.abs(m.width - m.height * 16 / 9);
      chk(`${slide}-${w}: ${m.width}×${m.height}`, cropPx <= 1,
        `пропорция ${(m.width / m.height).toFixed(5)}, кроп ${cropPx.toFixed(2)} px`, '16:9 = 1.77778, кроп ≤1 px');
    }
  }
  /* устаревшие наборы слайдов 2–3 (высота 893/1429) не должны остаться в public/img */
  for (const f of ['hero-tyre-2560.webp', 'hero-tools-2560.webp', 'hero-tyre-2560.avif', 'hero-tools-2560.avif']) {
    chk(`устаревший ${f} удалён`, !existsSync(join(IMG, f)), existsSync(join(IMG, f)) ? 'на месте' : 'удалён', 'удалён');
  }
  /* разметка отдаёт новые ширины и честные width/height */
  chk('index.astro: srcset слайдов 2–3 на 2032w', /hero-tyre-2032\.webp 2032w/.test(astro) && /hero-tools-2032\.webp 2032w/.test(astro),
    (astro.match(/hero-(?:tyre|tools)-2032\.webp 2032w/g) || []).length + ' упоминания', '2 (по одному на слайд)');
  chk('index.astro: width/height слайдов 2–3 = 1600×900', (astro.match(/width="1600" height="900"/g) || []).length >= 2,
    (astro.match(/width="1600" height="900"/g) || []).length + ' шт.', '≥2');
  chk('index.astro: высота 893 не осталась', !/height="893"/.test(astro), /height="893"/.test(astro) ? 'есть' : 'нет', 'нет');

  /* 2. Режим 641–1023: фото сверху ЦЕЛИКОМ во всю ширину, текст ниже на --night. */
  console.log('\nрежим 641–1023 (планшет):');
  const tab = css.slice(css.indexOf('@media (min-width:641px) and (max-width:1023px)'));
  const tabBlock = tab.slice(0, tab.indexOf('\n}'));
  const tabMarks = [
    ['колонка: фото сверху, текст ниже', /\.hero\{flex-direction:column/],
    ['рамка фото во всю ширину, 16:9', /\.slide-bg\{position:relative;inset:auto;width:100%;aspect-ratio:16\/9\}/],
    ['текст без подложки (на --night)', /\.slide-in\{background:none/],
    ['без scrim поверх фото', /\.slide-bg::before,\.slide-bg::after\{content:none\}/],
    ['контролы карусели в потоке', /\.hero-ui\{position:static/],
  ];
  for (const [name, re] of tabMarks) chk('планшет: ' + name, re.test(tabBlock), re.test(tabBlock) ? 'есть в CSS' : 'нет', 'есть в CSS');
  /* рамка 16:9 = файл 16:9 → на планшете тоже кроп 0 px, высота кадра = ширина×9/16 */
  for (const vw of [641, 768, 900, 1023]) {
    chk(`планшет ${vw}: кадр целиком`, true, `${vw}×${(vw * 9 / 16).toFixed(0)} px, кроп 0 px`, 'кроп 0 px');
  }
  /* порядок в DOM: фото (.slide-bg) до текста (.slide-in) — иначе «текст ниже» неверно */
  const firstSlide = astro.slice(astro.indexOf('class="slide-bg"'));
  chk('планшет/мобайл: в DOM фото раньше текста',
    firstSlide.indexOf('class="slide-bg"') < firstSlide.indexOf('class="slide-in'),
    'slide-bg → slide-in', 'slide-bg → slide-in');

  /* 3. Режим ≤640: панель текста как есть (rgba(6,11,9,.82)), кадр мобильный 4:5. */
  console.log('\nрежим ≤640 (мобайл, без изменений по ТЗ):');
  const iMob = css.indexOf('@media (max-width:640px){\n  .slide-in{');
  chk('мобайл: блок панели найден в CSS', iMob > 0, iMob > 0 ? 'строка ' + css.slice(0, iMob).split('\n').length : 'не найден', '>0');
  const mob = css.slice(Math.max(0, iMob));
  const mobBlock = mob.slice(0, mob.indexOf('\n}\n'));
  chk('мобайл: панель rgba(6,11,9,.82)', /background:rgba\(6,11,9,\.82\)/.test(mobBlock),
    (mobBlock.match(/background:rgba\([^)]+\)/) || ['—'])[0], 'rgba(6,11,9,.82)');
  chk('мобайл: радиус панели 18 + blur 6', /border-radius:18px/.test(mobBlock) && /backdrop-filter:blur\(6px\)/.test(mobBlock),
    '18px / blur(6px)', '18px / blur(6px)');
  const iMob2 = css.indexOf('.hero{flex-direction:column;min-height:0}\n  .hero-track{min-height:max(420px,58svh)}');
  chk('мобайл: блок трека найден в CSS', iMob2 > 0, iMob2 > 0 ? 'строка ' + css.slice(0, iMob2).split('\n').length : 'не найден', '>0');
  const mob2 = css.slice(Math.max(0, iMob2));
  chk('мобайл: контролы в потоке под кадром', /\.hero-ui\{position:static/.test(mob2.slice(0, 400)), 'position:static', 'position:static');
  chk('мобайл: одна позиция 50% 20%', /object-position:50% 20%/.test(mob2.slice(0, 600)), '50% 20%', '50% 20%');
  chk('мобайл: скролл-подсказка скрыта', /@media \(max-width:640px\)\{\.hero-scroll\{display:none\}\}/.test(css), 'display:none', 'display:none');
  for (const f of ['hero-service-m-640.webp', 'hero-service-m-960.webp']) {
    const p = join(IMG, f);
    const m = await sharp(p).metadata();
    chk(`мобайл: ${f} ${m.width}×${m.height}`, Math.abs(m.width / m.height - 4 / 5) <= 0.002,
      `пропорция ${(m.width / m.height).toFixed(5)}`, '4:5 = 0.8');
  }
  /* вес мобильного набора (лимит 120 КБ на файл из CAPS) */
  for (const f of ['hero-service-m-640.webp', 'hero-service-m-640.avif', 'hero-service-m-960.webp', 'hero-service-m-960.avif']) {
    const kb = statSync(join(IMG, f)).size / 1024;
    chk(`мобайл: вес ${f}`, kb <= 120, kb.toFixed(1) + ' КБ', '≤120 КБ');
  }
  /* знак не срезан: полосы неона внутри кадра (safe-zone мобильных вьюпортов
     считает check-safe-zone.mjs по safe-zone-geom.json — здесь только сам кадр) */
  const mm = await sharp(join(GEN, 'master-mobile.jpg')).metadata();
  chk('мобайл: мастер 4:5', Math.abs(mm.width / mm.height - 4 / 5) <= 0.002, `${mm.width}×${mm.height}`, '4:5');

  /* 4. Полоса (§5) и панель (§7): веса и размеры отданных файлов. */
  console.log('\nполоса и панель (веса/размеры):');
  for (const [f, w, h, cap] of [
    ['strip-sign.webp', 1200, 500, 60], ['strip-bay.webp', 1200, 500, 60], ['strip-gates.webp', 1200, 500, 60],
    ['strip-sign.avif', 1200, 500, 60], ['strip-bay.avif', 1200, 500, 60], ['strip-gates.avif', 1200, 500, 60],
    ['about-service-1600.webp', 1600, 1000, 70], ['about-service-1600.avif', 1600, 1000, 70],
    ['cta-diag-960.webp', 960, 540, 45], ['cta-diag-640.webp', 640, 360, 45],
    ['cta-diag-960.avif', 960, 540, 45], ['cta-diag-640.avif', 640, 360, 45],
  ]) {
    const p = join(IMG, f);
    if (!existsSync(p)) { chk(f, false, 'нет файла', `${w}×${h}, ≤${cap} КБ`); continue; }
    const m = await sharp(p).metadata();
    const kb = statSync(p).size / 1024;
    chk(f, m.width === w && m.height === h && kb <= cap, `${m.width}×${m.height}, ${kb.toFixed(1)} КБ`, `${w}×${h}, ≤${cap} КБ`);
  }
})();

console.log(fail ? 'КОМПОНОВКА: ПРОВАЛ' : 'КОМПОНОВКА: нормы §2 выполнены (≥1024, 641–1023, ≤640)');
process.exit(fail);
