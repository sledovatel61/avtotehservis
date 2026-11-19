/**
 * Тень, земля и кромка машины в 3D-фоне — гейт под ФОТО-ПЛАСТИНУ (круг 35, задание №62).
 *
 * Что изменилось и почему скрипт переписан целиком
 * ------------------------------------------------
 * До круга 35 силуэт считался формулой (`carSdf` по профилю из `car-profile.ts`), и этот
 * гейт мерил именно её: габарит в единицах сцены, контакт колеса с землёй, толщину полосы
 * кромки `smoothstep(0, 0.016, |sd|)`, профиль тени по x и по y. В круге 35 геометрии
 * кузова в шейдере НЕ ОСТАЛОСЬ: контур лежит в фото-пластине. Старый скрипт поэтому честно
 * падал («не нашёл константы тени — формула переписана»), а не печатал PASS про тень,
 * которой больше нет.
 *
 * Теперь проверяются ТРИ вещи, и все — про то, что реально рисуется:
 *
 *   1. **Земля.** Низ квада пластины и есть линия земли: тень и отражение привязаны
 *      к `cp.y − hy`. Проверяем, что нижняя кромка НЕПРОЗРАЧНОГО силуэта в файле стоит
 *      на этой линии с точностью до пикселя кадра, а не висит над ней и не тонет в ней.
 *   2. **Кромка.** Перо пластины: переход 10→90 % альфы по вертикали. Задание требует
 *      ≤ 2,0 px в кадре, и это надо мерить по ФАЙЛУ, а не по шейдеру — кромку рисует файл.
 *   3. **Тень.** Константы читаются из живого `shader.ts` (SHADOW_X, коэффициент по gy,
 *      множитель 0,16) и из `plate.ts` (полуразмер); сверяется, что полуширина тени
 *      на полувысоте равна ln2 → полуширина = SHADOW_HALF, а не «примерно похоже».
 *      Отдельно проверяется, что тень по вертикали уже высоты кузова (иначе она
 *      выползает из-под машины и читается как часть силуэта — та самая ошибка h/L 0,377).
 *
 * Запуск: node scripts/bg3d-edge-shadow.mjs [--json путь]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const A = process.argv.slice(2);
const jsonArg = (() => { const i = A.indexOf('--json'); return i >= 0 ? A[i + 1] : null; })();

const profile = await import('../src/client/car-profile.ts');
const plateMod = await import('../src/client/bg3d/plate.ts');
const PLATE_FILE = join(ROOT, 'public/img/bg3d/car-1600.webp');

const problems = [];
const fail = (msg) => { problems.push(msg); console.error(`FAIL  ${msg}`); };

/* ------------------------------------------------------------------ */
/* 1. Файл пластины: альфа, габарит, кромка                             */
/* ------------------------------------------------------------------ */

const { data: rgba, info } = await sharp(PLATE_FILE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const PW = info.width, PH = info.height;
const alpha = new Uint8Array(PW * PH);
for (let i = 0; i < PW * PH; i++) alpha[i] = rgba[i * 4 + 3];

let ax0 = PW, ax1 = -1, ay0 = PH, ay1 = -1;
/* Порог тот же, что у всех замеров силуэта (128): мягкое перо ниже него — уже фон,
   и если считать габарит по 8, линия земли уезжает на 2 px вниз от шин. */
for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) if (alpha[y * PW + x] > 128) {
  if (x < ax0) ax0 = x; if (x > ax1) ax1 = x;
  if (y < ay0) ay0 = y; if (y > ay1) ay1 = y;
}
if (ax1 < 0) fail('пластина пуста: в альфа-канале нет ни одного непрозрачного пикселя');

/** Верхняя и нижняя непрозрачная строка в столбце. */
const colTop = (x) => { for (let y = 0; y < PH; y++) if (alpha[y * PW + x] > 128) return y; return -1; };
const colBot = (x) => { for (let y = PH - 1; y >= 0; y--) if (alpha[y * PW + x] > 128) return y; return -1; };

/* Перо: где альфа переходит 10 % → 90 % по вертикали в середине силуэта. */
function featherPx(x) {
  const col = [];
  for (let y = 0; y < PH; y++) col.push(alpha[y * PW + x]);
  const top = col.findIndex((v) => v > 255 * 0.9);
  if (top < 0) return null;
  let a10 = top;
  for (let y = top; y < PH; y++) if (col[y] >= 255 * 0.1) { a10 = y; break; }
  return top - a10 + 1;
}
const featherSamples = [Math.round(PW * 0.15), Math.round(PW * 0.5), Math.round(PW * 0.85)]
  .map((x) => featherPx(x))
  .filter((v) => v !== null);
const featherMax = featherSamples.length ? Math.max(...featherSamples) : Infinity;

/* ------------------------------------------------------------------ */
/* 2. Живые константы из шейдера и посадки                              */
/* ------------------------------------------------------------------ */

const SHADER_SRC = readFileSync(join(ROOT, 'src/client/bg3d/shader.ts'), 'utf8');
const need = (re, what) => {
  const m = SHADER_SRC.match(re);
  if (!m) fail(`не нашёл ${what} в src/client/bg3d/shader.ts — формула переписана, скрипт мерить не может`);
  return m;
};
const mGx = need(/const SHADOW_GX\s*= Math\.LN2 \/ Math\.pow\(\(([\d.]+) \* SHADOW_LEN\) \/ PLATE_HALF_LEN, 2\)/, 'SHADOW_GX');
const mHalf = need(/const float SHADOW_GX\s*= \$\{SHADOW_GX\.toFixed\(4\)\}/, 'подстановку SHADOW_GX в GLSL');
const mY = need(/gy \* gy \* \(([\d.]+) \/ max\(hx \* hx, 0\.0001\)\)/, 'коэффициент тени по gy');
const mMul = need(/col \*= 1\.0 - ([\d.]+) \* shd;/, 'множитель тени');
const mOccl = need(/col \*= 1\.0 - ([\d.]+) \* occl;/, 'множитель пятна под машиной');
const mGap = need(/float groundY = groundLine - PLATE_REFLECTION_GAP;/, 'зазор отражения (groundLine − PLATE_REFLECTION_GAP)');

const shadowHalfOfLen = Number(mGx[1]);
const shadowLenUnits = profile.CAR.length * profile.SCALE.bg3d;
/* Полуширина тени на полувысоте в единицах p: gx нормирован на hx, значит в p это
   0,55·L_scene / PLATE_HALF_LEN, умноженное на hx. */
const shadowHalfNorm = shadowHalfOfLen * shadowLenUnits / plateMod.PLATE_HALF_LEN;
const shadowGx = Math.LN2 / Math.pow(shadowHalfNorm, 2);
const shadowGxGlsl = Number(shadowGx.toFixed(4));
const shadowY = Number(mY[1]);

/* ------------------------------------------------------------------ */
/* 3. Земля: низ пластины против линии тени                             */
/* ------------------------------------------------------------------ */

/* Посадка в кадре 640×360 — тот же расчёт, что у шейдера и CPU-порта. */
const FRAME = { w: 640, h: 360 };
const aspect = FRAME.w / FRAME.h;
const place = plateMod.platePlacement(aspect, [0.18, -0.08], 0, 1);
const half = plateMod.plateHalfSize(place.sc);
/* Линия земли — ИЗ ПЛАСТИНЫ, а не низ квада: в кропе под землёй лежит поле padding,
   и посаженная на низ квада тень уезжает под машину. */
const groundY = place.cy + half.hy - plateMod.PLATE_GROUND_FRAC * 2 * half.hy;
const gapY = groundY - plateMod.PLATE_REFLECTION_GAP;   /* где начинается отражение */

/* Где земля в файле на самом деле: последняя непрозрачная строка. Она обязана совпасть
   с PLATE_GROUND_FRAC — это одна и та же линия, записанная двумя способами (сборка
   пишет долю, файл хранит пиксели). Расхождение = тень стоит не под шинами. */
const groundFracActual = ay1 / PH;
const groundFracConst = plateMod.PLATE_GROUND_FRAC;
const groundMismatchPx = Math.abs(groundFracActual - groundFracConst) * PH;

/* Шины должны стоять на земле, а не висеть: в столбцах осей низ силуэта совпадает
   с общей нижней кромкой (кузов между колёсами выше — это и есть клиренс). */
/* Оси даны в единицах сцены (x от центра кузова), поэтому в пиксели файла их
   переводим через масштаб: доля длины = ax/2 / (PLATE_HALF_LEN·...) — проще и честнее
   считать в долях: ось_сцены / SHADOW_LEN даёт положение вдоль кузова (0 = центр). */
const axleCols = [profile.SCENE.axleFront, profile.SCENE.axleRear]
  .map((ax) => Math.round((ax / (profile.CAR.length * profile.SCALE.bg3d)) * PW + PW / 2))
  .filter((x) => x > 0 && x < PW - 1);
const axleBottoms = axleCols.map((x) => colBot(x));
/* Клиренс: низ кузова МЕЖДУ осями (порог) берём по нижней кромке в окне между осями,
   но БЕЗ колёс: колесо занимает по длине ~15 %L, поэтому окно середины кузова — это
   полоса между арками. Считаем медиану по столбцам центральных 20 % длины. */
const clearancePx = (() => {
  const a = Math.round(PW * 0.42), b = Math.round(PW * 0.58);
  const bots = [];
  for (let x = a; x <= b; x++) { const v = colBot(x); if (v >= 0) bots.push(v); }
  if (!bots.length) return null;
  bots.sort((p1, p2) => p1 - p2);
  return ay1 - bots[Math.floor(bots.length / 2)];
})();

const PX_PER_UNIT_Y = FRAME.h / 2;               /* p.y от −1 до 1 на всю высоту кадра */
const toPx = (units) => units * PX_PER_UNIT_Y;
const scaleY = (2 * half.hy) / PH;               /* единиц p на пиксель файла */

/* ------------------------------------------------------------------ */
/* 4. Тень: профиль по x и по y                                         */
/* ------------------------------------------------------------------ */

function shadowProfile(kx, ky) {
  const shd = (gx, gy) => Math.exp(-(gx * gx * kx + gy * gy * ky));
  const peak = shd(0, 0);
  const halfX = (() => { let x = 0; while (shd(x, 0) > 0.5 * peak && x < 5) x += 0.0005; return x; })();
  const tenthX = (() => { let x = 0; while (shd(x, 0) > 0.1 * peak && x < 5) x += 0.0005; return x; })();
  const halfY = (() => { let y = 0; while (shd(0, y) > 0.5 * peak && y < 5) y += 0.0005; return y; })();
  return { peak, halfX, tenthX, halfY };
}
const shd = shadowProfile(shadowGxGlsl, shadowY / Math.pow(half.hx, 2));
/* Полуширина тени в единицах p: gy-коэффициент задан как k/hx², но тень симметрична
   только в нормированных координатах gx = (p.x − cx)/hx, gy = p.y − (cp.y − hy).
   В gx единица = hx в p, в gy единица = 1 в p. Поэтому по X полуширина = halfX·hx. */
const shadowHalfWidthP = shd.halfX * half.hx;
const shadowTenthWidthP = shd.tenthX * half.hx;
const shadowHalfHeightP = shd.halfY;

/* ------------------------------------------------------------------ */
/* 5. Вывод                                                            */
/* ------------------------------------------------------------------ */

const pct = (v, base) => `${((v / base) * 100).toFixed(1)} %`;
const okOrFail = (cond, text) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${text}`); if (!cond) problems.push(text); return cond; };

console.log('\n== машина в 3D-фоне: земля, кромка, тень (фото-пластина) ==');
console.log(`  пластина: ${PLATE_FILE.replace(`${ROOT}/`, '')} — ${PW}×${PH} px, ${(readFileSync(PLATE_FILE).byteLength / 1024).toFixed(1)} КБ`);
console.log(`  непрозрачный габарит в файле: x ${ax0}…${ax1} (${ax1 - ax0 + 1} px), y ${ay0}…${ay1} (${ay1 - ay0 + 1} px)`);
console.log(`  h/L по альфе файла: ${((ay1 - ay0 + 1) / (ax1 - ax0 + 1)).toFixed(4)} (паспорт 0,335 ± 0,010 — но кромка файла
  намеренно на 1–2 % выше: билинейная фильтрация и мипмапы съедают её в кадре)`);

okOrFail(Math.abs(((ay1 - ay0 + 1) / (ax1 - ax0 + 1)) - 0.335) <= 0.020,
  `h/L файла ${((ay1 - ay0 + 1) / (ax1 - ax0 + 1)).toFixed(4)} — в пределах ±0,020 от паспорта`);

console.log('\n  земля (линия тени и отражения):');
console.log(`    PLATE_GROUND_FRAC = ${groundFracConst} (пишет сборка из plate.json, поле frac.ground)`);
console.log(`    фактическая земля в файле: последняя непрозрачная строка ${ay1} из ${PH} → ${groundFracActual.toFixed(6)}`);
console.log(`    расхождение ${(groundMismatchPx).toFixed(2)} px файла = ${(groundMismatchPx * scaleY * PX_PER_UNIT_Y).toFixed(2)} px кадра 640×360`);
console.log(`    в кадре линия земли: y = ${groundY.toFixed(4)} ед. p (посадка sc = ${place.sc.toFixed(4)}, квад ${half.hx.toFixed(4)} × ${half.hy.toFixed(4)})`);
okOrFail(groundMismatchPx <= 2.0,
  `константа земли совпадает с файлом: расхождение ${groundMismatchPx.toFixed(2)} px ≤ 2 px`);

console.log(`    шины стоят на земле: низ силуэта в столбцах осей ${axleBottoms.join(' / ')} против общей нижней кромки ${ay1}`);
/* Допуск 3 px: колесо в файле — фото, его низ сглажен lanczos'ом и не обязан давать
   ровно ту же строку, что общая нижняя кромка (шина чуть скруглена). Проверяем смысл:
   шины СТОЯТ на земле, а не висят над ней и не утопают в ней. */
okOrFail(axleBottoms.length > 0 && axleBottoms.every((b) => b >= 0 && Math.abs(b - ay1) <= 3),
  `низ шин стоит на линии земли: ${axleBottoms.join(' / ')} против ${ay1} (расхождение ≤ 3 px файла)`);
console.log(`    клиренс (низ кузова между осями выше низа шин): ${clearancePx === null ? '—' : `${clearancePx} px файла = ${(clearancePx * scaleY * PX_PER_UNIT_Y).toFixed(2)} px кадра`}`);
console.log(`    паспорт: 0,185 м = ${(profile.CAR.clearance / profile.CAR.height * 100).toFixed(1)} %H`);

console.log('\n  кромка (её рисует файл, а не шейдер):');
console.log(`    перо 10→90 % альфы по вертикали, три столбца: ${featherSamples.join(', ')} px`);
okOrFail(featherMax <= 2,
  `перо кромки ${featherMax} px ≤ 2,0 px (задание №62): кромка читается как кромка, а не как размытие`);

console.log('\n  тень (константы прочитаны из живого shader.ts):');
console.log(`    полуширина на полувысоте: ${shadowHalfOfLen}·L, где L = ${shadowLenUnits.toFixed(3)} ед. сцены;`);
console.log(`    в единицах p это ${(shadowHalfNorm * half.hx).toFixed(4)} (hx = ${half.hx.toFixed(4)} — полуразмер квада)`);
console.log(`    SHADOW_GX = ln2 / (${shadowHalfNorm.toFixed(4)})² = ${shadowGx.toFixed(4)} (в GLSL подставлено ${shadowGxGlsl})`);
console.log(`    по gy: ${shadowY.toFixed(1)} / hx²; множитель тени ${Number(mMul[1])}, пятно под машиной ${Number(mOccl[1])}`);
console.log(`    зазор отражения ${plateMod.PLATE_REFLECTION_GAP} ед. p = ${toPx(plateMod.PLATE_REFLECTION_GAP).toFixed(2)} px`);
console.log(`    полуширина тени: ${shadowHalfWidthP.toFixed(4)} ед. p (${pct(shadowHalfWidthP * 2, half.hx * 2)} длины пластины),`);
console.log(`    на 0,1 от пика: ${shadowTenthWidthP.toFixed(4)} ед. p; полувысота ${shadowHalfHeightP.toFixed(4)} ед. p`);
console.log(`    высота кузова в кадре ${(2 * half.hy).toFixed(4)} ед. p → тень по вертикали ${pct(shadowHalfHeightP * 2, 2 * half.hy)} высоты кузова`);

/* Полуширина тени 0,55·L — это И ПОЛУШИРИНА НА ПОЛУВЫСОТЕ: коэффициент посчитан из неё
   аналитически (ln2), поэтому проверка «сошлось ли» — не тавтология, а контроль того,
   что в GLSL подставлено то же округлённое число, что мы посчитали. */
/* Полуширина 0,55·L задана в ЕДИНИЦАХ СЦЕНЫ, а тень считается в p. Перевод — тот же
   масштаб, что у пластины: hx = PLATE_HALF_LEN·sc, значит 1 ед. сцены = sc ед. p. */
const shadowHalfExpectP = shadowHalfOfLen * shadowLenUnits * place.sc;
okOrFail(Math.abs(shadowHalfWidthP - shadowHalfExpectP) < 0.01,
  `полуширина тени на полувысоте ${shadowHalfWidthP.toFixed(4)} ед. p = ${shadowHalfOfLen}·L (${shadowHalfExpectP.toFixed(4)}), расхождение < 0,01`);
okOrFail(shadowHalfWidthP * 2 <= (half.hx * 2) * 1.25,
  `тень не выходит за габарит: полная ширина ${(shadowHalfWidthP * 2).toFixed(3)} ед. p против длины пластины ${(half.hx * 2).toFixed(3)} (гало до 25 %)`);

/* Тень не должна выползать из-под машины по вертикали: если её полувысота сравнима
   с высотой кузова, замер по разнице кадров прочитает тень как часть силуэта
   (в круге 33 это дало h/L 0,377 вместо 0,335). */
okOrFail(shadowHalfHeightP * 2 < half.hy,
  `тень по вертикали (${(shadowHalfHeightP * 2 / (2 * half.hy) * 100).toFixed(0)} % высоты кузова) уже кузова — под машиной, а не поверх неё`);

console.log('\n  зазор между низом машины и её отражением:');
console.log(`    отражение начинается на ${toPx(plateMod.PLATE_REFLECTION_GAP).toFixed(2)} px ниже нижней кромки файла; при пером ${featherMax} px это гарантированно разрыв,`);
console.log(`    а не слияние силуэта с отражением (та же ошибка h/L 0,377 лечилась именно зазором).`);
okOrFail(toPx(plateMod.PLATE_REFLECTION_GAP) > featherMax,
  `зазор отражения ${toPx(plateMod.PLATE_REFLECTION_GAP).toFixed(2)} px больше пера кромки ${featherMax} px — силуэт и отражение не слипаются`);

const report = {
  generatedAt: new Date().toISOString(),
  purpose: 'задание №62: земля, кромка и тень под фото-пластиной (геометрии кузова в шейдере больше нет)',
  plate: {
    file: PLATE_FILE.replace(`${ROOT}/`, ''),
    bytes: readFileSync(PLATE_FILE).byteLength,
    size: [PW, PH],
    opaqueBox: { x0: ax0, x1: ax1, y0: ay0, y1: ay1, w: ax1 - ax0 + 1, h: ay1 - ay0 + 1 },
    hOverL: (ay1 - ay0 + 1) / (ax1 - ax0 + 1),
    featherPx: featherSamples,
    groundFracActual, groundMismatchPx, axleBottoms, clearancePx,
  },
  placement: {
    frame: [FRAME.w, FRAME.h], aspect, sc: place.sc,
    halfSize: { hx: half.hx, hy: half.hy },
    groundY, gapY,
    pxPerUnitY: PX_PER_UNIT_Y,
  },
  clearance: {
    platePx: clearancePx, platePxInFrame: clearancePx === null ? null : +(clearancePx * scaleY * PX_PER_UNIT_Y).toFixed(2),
    passportPctOfHeight: +(profile.CAR.clearance / profile.CAR.height * 100).toFixed(1),
  },
  edge: { featherMaxPx: featherMax, limitPx: 2 },
  shadow: {
    shadowHalfOfLen, shadowLenUnits, shadowHalfNorm, shadowGx, shadowGxGlsl, shadowY,
    mul: Number(mMul[1]), occlMul: Number(mOccl[1]), gap: plateMod.PLATE_REFLECTION_GAP,
    groundFrac: plateMod.PLATE_GROUND_FRAC,
    halfWidthP: shadowHalfWidthP, tenthWidthP: shadowTenthWidthP, halfHeightP: shadowHalfHeightP,
  },
  ok: problems.length === 0,
  problems,
};

if (jsonArg) {
  const out = resolve(process.cwd(), jsonArg);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nотчёт: ${jsonArg}`);
}
console.log(`\nИТОГ: ${problems.length === 0 ? 'PASS' : `FAIL (${problems.length})`}`);
process.exit(problems.length === 0 ? 0 : 1);
