/* Круг 74 (13.11.2026): на публикации НЕТ заставки и НЕТ 3D-фона.

   Зачем отдельный гейт. Владелец показывает страницу заказчику, и оба эффекта
   он не принял («очень топорно», «сейчас вообще не годится»). Поэтому:
     • `voyah-intro.ts` выключен флагом сборки PUBLIC_VY_INTRO (по умолчанию off);
     • `BG3D` по умолчанию `off`, а workflow больше не выставляет
       `BG3D=voyah-free BG3D_DEMO=1` (именно он и включал сцену на превью).
   Проверять это «глазами» в этой песочнице нельзя: @sparticuz/chromium требует
   libnss3, которого в образе нет, и `check-voyah-layout.mjs` здесь не стартует.
   Зато всё, что нужно, видно в собранном артефакте — по нему и проверяем.

   Что проверяется в site/pages-dist:
     1. на /voyah-free/ нет разметки заставки (`.vy-intro`, `vy-intro-poster`)
        и нет маркера «заставка включена»;
     2. в HTML нет 3D-слоя: `data-bg3d`, `bg3d-canvas`, кнопки «Выключить 3D-фон»;
     3. ни в одной странице нет `<canvas>` — 3D-фон единственный их источник;
     4. в `_astro/*.js` нет шейдеров заставки (`#version 300 es`) — при выключенном
        флаге бандлер обязан выкинуть их целиком, иначе мы «выключили» только вид;
     5. в inline-модуле страницы есть маркер `window.__vyIntro = 'off'` — это
        единственный след выключенной заставки, по нему удобно ловить регресс;
     6. в CSS заставки нет… ничего не проверяем: стили остаются в бандле как
        мёртвый груз в 1,5 КБ (нужны для возврата флага) — это осознанно.

   Флаги:
     --expect=off   (по умолчанию) — заставки и 3D быть не должно;
     --expect=on    — обратная проверка для сборки PUBLIC_VY_INTRO=1: заставка
                      вернулась (шейдеры в бандле, маркера off нет).
   Запуск: node scripts/check-intro-3d-off.mjs [--expect=on]
   Выход 1 при нарушении. */

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'pages-dist');
const ASSETS = join(DIST, '_astro');

const expectArg = process.argv.find((a) => a.startsWith('--expect='));
const EXPECT = expectArg ? expectArg.split('=')[1] : 'off';
if (EXPECT !== 'off' && EXPECT !== 'on') {
  console.error(`check-intro-3d-off: неизвестное --expect=${EXPECT} (off|on)`);
  process.exit(2);
}

const fails = [];
const bad = (m) => fails.push(m);

async function walkHtml(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === '_astro' || e.name === 'img' || e.name === 'fonts') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walkHtml(p)));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const pages = (await walkHtml(DIST)).sort();
const rel = (p) => p.slice(DIST.length + 1);
const voyah = join(DIST, 'voyah-free', 'index.html');

/* ---------- 1–3: разметка ---------- */
for (const p of pages) {
  const html = await readFile(p, 'utf8');
  const name = rel(p);
  if (EXPECT === 'off') {
    if (/class="[^"]*\bvy-intro\b/.test(html)) bad(`${name}: в разметке оверлей заставки .vy-intro`);
    if (html.includes('vy-intro-poster')) bad(`${name}: постер заставки в разметке`);
    if (/data-bg3d/.test(html)) bad(`${name}: в разметке 3D-слой data-bg3d`);
    if (/bg3d-canvas/.test(html)) bad(`${name}: в разметке canvas 3D-фона`);
    if (html.includes('Выключить 3D-фон')) bad(`${name}: в разметке кнопка «Выключить 3D-фон»`);
    if (/<canvas\b/.test(html)) bad(`${name}: в разметке <canvas> — 3D-фон должен быть выключен`);
  }
}

/* ---------- 4: шейдеры заставки в бандле ---------- */
async function shaderHits() {
  const hits = [];
  for (const f of await readdir(ASSETS)) {
    if (!f.endsWith('.js')) continue;
    const txt = await readFile(join(ASSETS, f), 'utf8');
    if (txt.includes('#version 300 es')) hits.push(f);
  }
  return hits;
}
const shaders = await shaderHits();

/* ---------- 5: маркер и inline-модуль страницы ---------- */
const vHtml = await readFile(voyah, 'utf8');
const markerOff = /__vyIntro\s*=\s*["'`]off["'`]/.test(vHtml);
const inlineLen = [...vHtml.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)]
  .reduce((n, m) => n + m[1].length, 0);

if (EXPECT === 'off') {
  if (!markerOff) bad('voyah-free: нет маркера window.__vyIntro = "off" — заставка включена сборкой');
  if (shaders.length) bad(`_astro: шейдеры заставки в бандле (${shaders.join(', ')}) — код не выкинут`);
  if (inlineLen > 200) bad(`voyah-free: inline-модуль ${inlineLen} Б при выключенной заставке — лишний код в странице`);
  if (!vHtml.includes('v-hero-h')) bad('voyah-free: нет заголовка героя — страница собралась не та');
  if (!vHtml.includes('vy-art')) bad('voyah-free: нет кадров vy-art — фото героя пропало (симптом включённого 3D/заставки)');
} else {
  if (markerOff) bad('сборка PUBLIC_VY_INTRO=1: остался маркер выключенной заставки');
  if (!shaders.length) bad('сборка PUBLIC_VY_INTRO=1: шейдеров заставки нет в бандле — флаг не сработал');
}

/* ---------- отчёт ---------- */
if (fails.length) {
  for (const f of fails) console.log('FAIL ' + f);
  console.log(`INTRO-3D-OFF (${EXPECT}): ${fails.length} провалов`);
  process.exit(1);
}
if (EXPECT === 'off') {
  console.log(`ok   страниц ${pages.length}: ни заставки, ни 3D-слоя, ни <canvas>`);
  console.log('ok   шейдеры заставки выкинуты из бандла; inline-модуль ' + inlineLen + ' Б (маркер off)');
  console.log('INTRO-3D-OFF: заставка и 3D выключены, как требует показ заказчику');
} else {
  console.log(`ok   обратная сборка: шейдеры вернулись (${shaders.join(', ')}), маркера off нет`);
  console.log('INTRO-3D-OFF: флаг PUBLIC_VY_INTRO работает в обе стороны');
}
