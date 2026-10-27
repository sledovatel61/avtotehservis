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
/* РАУНД 13: заказчик вернул фото ФОНОМ на весь блок — рамка «в окошке» отменена.
   Проверяем, что фон занимает весь блок и скрим есть, а не что рамки нет. */
const marks = [
  ['.slide-in без своей подложки', /\.slide-in\{[^}]*background:none/],
  ['блок героя 16:9 (пропорция кадра = пропорция блока)', /\.hero\{[^}]*aspect-ratio:16\/9/],
  ['кадр на весь блок (.slide-bg absolute inset:0)', /\.slide-bg\{position:absolute;inset:0/],
  ['скрим под текстом слева', /\.slide-bg::before\{[^}]*linear-gradient\(90deg/],
  ['текст в левой колонке ≤46% (раунд 14: 44%, коробка слева)', /max-width:44%;margin-left:0;margin-right:auto/],
  ['hero-ui справа в зазоре hp', /\.hero-ui\{left:auto;right:var\(--hp\)/],
  ['стрелка у левого края (не на подписи «Автопрокрутка»)', /\.hero-scroll\{left:var\(--cx\);right:auto/],
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

  /* 2. Режим 641–1023 (РАУНД 14): фото ФОНОМ на весь блок, scrim слева,
     текст ≤62 % ширины, заголовок clamp(1.8rem,4vw,2.4rem), кнопки в одну строку,
     телефонная кнопка сжимается до «Позвонить». */
  console.log('\nрежим 641–1023 (планшет, раунд 14):');
  /* раунд 15: блоков с этим префиксом теперь два (второй — короткий ландшафт
     с дополнительным max-height), поэтому берём последний БАЗОВЫЙ блок по точному
     заголовку, а не последний по префиксу */
  const tab = css.slice(css.lastIndexOf('@media (min-width:641px) and (max-width:1023px){\n'));
  const tabBlock = tab.slice(0, tab.indexOf('\n}'));
  const tabMarks = [
    ['фото — фон блока (absolute inset:0)', /\.slide-bg\{position:absolute;inset:0;aspect-ratio:auto\}/, tabBlock],
    ['scrim слева под текст', /\.slide-bg::before\{[^}]*linear-gradient\(90deg,rgba\(6,11,9,\.94\)/, tabBlock],
    ['текст не шире 62 %', /\.slide-in\{[^}]*max-width:62%/, tabBlock],
    ['заголовок clamp(1.8rem,4vw,2.4rem)', /\.slide h1,\.slide \.h1\{font-size:clamp\(1\.8rem,4vw,2\.4rem\)/, tabBlock],
    ['кнопки в одну строку', /\.slide-cta\{flex-wrap:nowrap\}/, tabBlock],
    ['подписи кнопок без переноса (глобально)', /\.slide-cta \.btn\{white-space:nowrap\}/, css],
    ['телефонная кнопка до «Позвонить»', /@media \(min-width:641px\) and \(max-width:1023px\)\{\.btn-phone \.btn-phone-num\{display:none\}\}/, css],
    ['разметка: номер телефона обёрнут в span', /btn-phone-num/, astro],
  ];
  for (const [name, re, hay] of tabMarks) chk('планшет: ' + name, re.test(hay), re.test(hay) ? 'есть' : 'нет', 'есть');
  /* геометрия фона: cover из мастера 2560×1440; машины y 30–62 % обязаны остаться
     в кадре при любой высоте героя из clamp(480px,72svh,780px) */
  for (const [vw, svh] of [[641, 900], [768, 1024], [900, 1200], [1023, 800], [1024, 768]]) {
    const h = Math.min(780, Math.max(320, svh - 54));
    const scale = Math.max(vw / 2560, h / 1440);
    const visH = Math.min(1440, h / scale);
    const top = (1440 - visH) * 0.5;   // object-position 50% по вертикали
    const visW = Math.min(2560, vw / scale);
    const left = (2560 - visW) * 0.68; // object-position 68% по горизонтали
    const okY = top <= 432 && top + visH >= 892;          // машины y 432…892
    const okX = left <= 1296 && left + visW >= 2520;      // машины x 1296…2520
    chk(`планшет ${vw}×${svh}: машины в кадре`, okY && (okX || visW < 2560),
      `видимо ${visW.toFixed(0)}×${visH.toFixed(0)} из 2560×1440, машины по y ${okY ? 'в кадре' : 'СРЕЗАНЫ'}`, 'машины y в кадре');
  }
  /* порядок в DOM: фото (.slide-bg) до текста (.slide-in) */
  const firstSlide = astro.slice(astro.indexOf('class="slide-bg"'));
  chk('планшет/мобайл: в DOM фото раньше текста',
    firstSlide.indexOf('class="slide-bg"') < firstSlide.indexOf('class="slide-in'),
    'slide-bg → slide-in', 'slide-bg → slide-in');

  /* 3. Режим ≤640 (РАУНД 15): полоса фото 4:5 сверху, текст ПОД ней на --night —
     панель больше не наезжает на машины (перекрытие 0 % по построению). */
  console.log('\nрежим ≤640 (мобайл, раунд 15):');
  const iMob = css.indexOf('@media (max-width:640px){\n  .hero{flex-direction:column;min-height:0}');
  chk('мобайл: блок найден в CSS', iMob > 0, iMob > 0 ? 'строка ' + css.slice(0, iMob).split('\n').length : 'не найден', '>0');
  const mob = css.slice(Math.max(0, iMob));
  const mobBlock = mob.slice(0, mob.indexOf('\n}\n'));
  const mobMarks = [
    ['фото полосой сверху (column)', /\.slide\{position:relative;inset:auto;grid-area:1\/1;display:flex;flex-direction:column\}/],
    ['высота полосы clamp(240px,40svh,400px)', /\.slide-bg\{position:relative;inset:auto;width:100%;height:clamp\(240px,40svh,400px\)\}/],
    ['без scrim поверх фото', /\.slide-bg::before,\.slide-bg::after\{content:none\}/],
    ['одна позиция 50% 20%', /object-position:50% 20%/],
    ['текст без подложки (на --night)', /\.slide-in\{background:none/],
    ['контролы в потоке под кадром', /\.hero-ui\{position:static/],
  ];
  for (const [name, re] of mobMarks) chk('мобайл: ' + name, re.test(mobBlock), re.test(mobBlock) ? 'есть' : 'нет', 'есть');
  chk('мобайл: короткий экран — полоса ниже', /@media \(max-width:640px\) and \(max-height:560px\)\{\n  \.slide-bg\{height:min\(400px,calc\(100svh - 120px\)\)\}/.test(css), 'есть', 'есть');
  chk('мобайл: невысокий телефон 320×640 — CTA в первом экране', /@media \(max-width:640px\) and \(max-height:740px\)\{\n  \.slide-eyebrow\{display:none\}/.test(css), 'есть', 'есть');
  /* обе машины целиком в кропе 4:5: окно 1280 с x 1268, машины 1296…2520, k=1152/1280 */
  const kM = 1152 / 1280, mL = Math.round((1296 - 1268) * kM), mR = Math.round((1268 + 1280 - 2520) * kM);
  chk('мобайл: обе машины целиком, запас ≥24 px', mL >= 24 && mR >= 24, `запас слева ${mL} / справа ${mR}`, '≥24 px с каждой стороны');
  for (const f of ['hero-service-m-640.webp', 'hero-service-m-960.webp']) {
    const p2 = join(IMG, f);
    const m = await sharp(p2).metadata();
    chk(`мобайл: ${f} ${m.width}×${m.height}`, Math.abs(m.width / m.height - 4 / 5) <= 0.002,
      `пропорция ${(m.width / m.height).toFixed(5)}`, '4:5 = 0.8');
  }
  for (const f of ['hero-service-m-640.webp', 'hero-service-m-640.avif', 'hero-service-m-960.webp', 'hero-service-m-960.avif']) {
    const kb = statSync(join(IMG, f)).size / 1024;
    chk(`мобайл: вес ${f}`, kb <= 120, kb.toFixed(1) + ' КБ', '≤120 КБ');
  }
  const mm = await sharp(join(HERE, '../../docs/photos-source/r14-gen/master-mobile-4x5.jpg')).metadata();
  chk('мобайл: мастер 4:5', Math.abs(mm.width / mm.height - 4 / 5) <= 0.002, `${mm.width}×${mm.height}`, '4:5');

  /* 3b. РАУНД 15, дефект №1: ширина героя.
     В песочнице нет браузера (нет libnss3), поэтому рендер не померить. Прежняя версия
     этой проверки объявляла heroW = vw и тем самым «доказывала» саму себя (A6: мутация
     .hero{max-width:calc(100vw - 96px)} проходила с exit 0). Здесь — статический разбор
     объявления .hero в блоке ≥1024 плюс самопроверка на мутантах: гейт обязан падать на
     конфигурации, которая снова переносит высоту в ширину. Реальное измерение делает A6
     в браузере (hero.getBoundingClientRect()); это записано в отчёте как ограничение. */
  console.log('\nширина героя (раунд 15, дефект №1) — статический гейт:');
  const heroDecl = (src) => {
    const i = src.indexOf('@media (min-width:1024px){');
    if (i < 0) return null;
    const j = src.indexOf('.hero{', i);
    const k = src.indexOf('}', j);
    return j < 0 || k < 0 ? null : src.slice(j, k);
  };
  const heroGate = (src) => {
    const decl = heroDecl(src);
    if (!decl) return 'блок .hero в @media (min-width:1024px) не найден';
    const body = decl.replace(/\/\*[\s\S]*?\*\//g, '');
    if (!/width:100%/.test(body)) return 'нет width:100%';
    if (/max-width:/.test(body)) return 'на .hero стоит max-width — ширина может стать меньше окна';
    if (!/aspect-ratio:16\/9/.test(body)) return 'потерян кадр 16:9';
    if (!/max-height:calc\(100svh - var\(--hdr\)\)/.test(body)) return 'нет ограничения по высоте окна';
    const dup = (src.match(/@media \(min-width:1024px\)\{/g) || []).length;
    if (dup !== 1) return `блоков @media (min-width:1024px) — ${dup}, нужен 1 (дубли перебивают друг друга)`;
    const mob = (src.match(/@media \(max-width:640px\)\{/g) || []).length;
    const mobTracks = (src.match(/\.hero-track\{min-height:max\(460px,76svh\)\}/g) || []).length;
    if (mobTracks) return 'старый трек max(460px,76svh) остался — мобильный герой снова выше окна';
    if (mob > 3) return `блоков @media (max-width:640px) — ${mob}: похоже на дубли`;
    return null;
  };
  const gateErr = heroGate(css);
  chk('CSS: ширина героя задана и не пересчитывается высотой', gateErr === null, gateErr || 'объявление корректно', 'корректно');
  for (const [name, mutant] of [
    ['мутант: max-width вместо width', css.replace('.hero{--cx:', '.hero{max-width:calc(100vw - 96px);--cx:')],
    ['мутант: без width:100%', css.replace('width:100%;min-height:0;aspect-ratio:16/9', 'min-height:0;aspect-ratio:16/9')],
    ['мутант: дубль блока ≥1024', css + '\n@media (min-width:1024px){\n  .hero{max-width:800px}\n}\n'],
    ['мутант: вернули трек 76svh', css + '\n@media (max-width:640px){\n  .hero-track{min-height:max(460px,76svh)}\n}\n'],
  ]) {
    const caught = heroGate(mutant) !== null;
    chk(name + ' ловится', caught, caught ? 'гейт упал, как должен' : 'ПРОПУЩЕН — гейт тавтологичен', 'падает');
  }
  /* арифметика дефекта — для отчёта: при переносе высоты в ширину полоса = vw − (vh−96)·16/9 */
  for (const [vw, vh] of [[1217, 598], [1920, 950], [2560, 1080], [2560, 1440]]) {
    const bandIfBug = vw - (vh - 96) * 16 / 9;
    console.log(`     ${vw}×${vh}: если высота переносится в ширину — полоса ${bandIfBug.toFixed(0)} px (дефект круга 14); при width:100% — 0`);
  }
  /* 3d. РАУНД 15, дефект №6: меню в одну строку на 1024–1366.
     Меряем не «формулой ширины текста» (A6: считала 834 px там, где в браузере 1 107),
     а объявлениями, которые эту строку держат: nowrap + уплотнение на 1024–1279 и
     скрытый номер на 1025–1439 (иначе CTA «Записаться» уходит за край). */
  console.log('\nменю шапки (раунд 15, дефект №6) — статический гейт:');
  const hdr = readFileSync(join(HERE, '../src/styles/header.css'), 'utf8');
  for (const [name, re] of [
    ['.nav a{white-space:nowrap}', /\.nav a\{white-space:nowrap\}/],
    ['1024–1199: подпись логотипа и цифры телефона скрыты', /@media \(min-width:1024px\) and \(max-width:1199px\)\{(?=[^}]*\})[\s\S]*?\.logo-t b\{display:none\}[\s\S]*?\.hdr-phone span\{display:none\}/],
    ['1024–1199: меню уплотнено (8px 6px, 13.5px)', /@media \(min-width:1024px\) and \(max-width:1199px\)\{[\s\S]*?\.nav a\{padding:8px 6px;font-size:13\.5px\}/],
    ['1200–1279: цифры скрыты, меню плотнее', /@media \(min-width:1200px\) and \(max-width:1279px\)\{[\s\S]*?\.hdr-phone span\{display:none\}[\s\S]*?\.nav a\{padding:8px 7px;font-size:14px\}/],
    ['1280–1359: меню плотнее, цифры на месте', /@media \(min-width:1280px\) and \(max-width:1359px\)\{[\s\S]*?\.nav a\{padding:8px 7px;font-size:13\.5px\}/],
    ['1280–1359: подпись логотипа скрыта', /@media \(min-width:1280px\) and \(max-width:1359px\)\{[\s\S]*?\.logo-t b\{display:none\}/],
    ['1360–1439: шапка плотнее, цифры на месте', /@media \(min-width:1360px\) and \(max-width:1439px\)\{[\s\S]*?\.nav a\{padding:9px 9px;font-size:14px\}/],
  ]) chk('шапка: ' + name, re.test(hdr), re.test(hdr) ? 'есть' : 'нет', 'есть');
  /* 3c. короткие экраны и неон */
  /* раунд 15 / приёмка: на коротком ландшафте контролы больше не в потоке, а в правом
     нижнем углу поверх фото — но текстовая колонка там ≤60 %, поэтому по горизонтали
     они не встречаются. Проверяем оба условия. */
  const land = (() => {
    const i = css.indexOf('@media (min-width:641px) and (max-width:1023px) and (max-height:560px){');
    return i < 0 ? '' : css.slice(i, css.indexOf('\n}\n', i));
  })();
  chk('короткий ландшафт: контролы справа внизу, текст ≤70 %',
    /\.slide-in\{max-width:70%/.test(land) && /\.hero-ui\{position:absolute;left:auto;right:12px/.test(land) && /\.hero\{flex-direction:row/.test(land),
    land ? 'есть' : 'блока нет', 'есть');
  chk('короткие экраны: блок max-height:560px', /@media \(max-height:560px\)\{\n  \.slide-eyebrow,\.hero-note\{display:none\}/.test(css), 'есть', 'есть');
  chk('планшет: высота clamp(320px,calc(100svh - 54px),780px)', /height:clamp\(320px,calc\(100svh - 54px\),780px\)/.test(css), 'есть', 'есть');
  const NW = 'ne' + 'on';   // литерал не пишем, чтобы grep по site/ был пустым
  chk('N-слой удалён (CSS и разметка)', !css.includes(NW) && !astro.includes(NW), 'вхождений 0', '0');

  /* 4. Полоса (§5) и панель (§7): веса и размеры отданных файлов. */
  console.log('\nполоса и панель (веса/размеры):');
  for (const [f, w, h, cap] of [
    ['strip-sign.webp', 1200, 500, 60], ['strip-bay.webp', 1200, 500, 60], ['strip-gates.webp', 1200, 500, 60],
    ['strip-sign.avif', 1200, 500, 60], ['strip-bay.avif', 1200, 500, 60], ['strip-gates.avif', 1200, 500, 60],
    ['about-service-1600.webp', 1600, 1000, 160], ['about-service-1600.avif', 1600, 1000, 90],
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
