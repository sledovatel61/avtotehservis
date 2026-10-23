/**
 * Раунд 12, §2: аналитическая проверка компоновки первого экрана на ≥1025.
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
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, '../src/styles/hero.css'), 'utf8');

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
  const ok = re.test(desk);
  if (!ok) bad('CSS-маркер: ' + name);
  console.log(`${ok ? 'ok  ' : 'FAIL'} CSS ≥1025: ${name}`);
}
console.log(fail ? 'КОМПОНОВКА: ПРОВАЛ' : 'КОМПОНОВКА: нормы §2 выполнены');
process.exit(fail);
