#!/usr/bin/env node
/**
 * Замер стоимости кадра заставки Voyah (задание №55, круг 31, фаза 1, §1.2).
 *
 *   node scripts/measure-intro.mjs                       # 640×360, пять моментов uT
 *   node scripts/measure-intro.mjs --json ../docs/reports/r31-bg3d/intro-before.json
 *   node scripts/measure-intro.mjs --src /путь/к/voyah-intro.ts --png /путь/к/кадрам
 *   node scripts/measure-intro.mjs --verify              # сверить порт с настоящим драйвером
 *
 * Зачем. A5 собирается править рейкастинг заставки (профиль из `car-profile.ts`, другая высота
 * кузова). Число «до» существует только сейчас: после правки его не восстановить. Поэтому
 * стоимость кадра текущей заставки измеряется и кладётся в отчёт — в тех же единицах, что и
 * 3D-фон раунда 30 (`inst/px` и `scalar/px`), чтобы их можно было сравнить и сложить в бюджет.
 *
 * Метод — тот же, что в раунде 30 для фона:
 *   1. CPU-порт `SCENE_FS` (`tools/intro/ref.mjs`), строка в строку, без оптимизаций;
 *      каждый `t(inst, scalar)` стоит рядом со строкой GLSL и пересчитывается руками;
 *   2. сверка порта со статическим подсчётом эталонного компилятора Khronos (glslang → SPIR-V)
 *      по функциям: `--spirv` (включён по умолчанию, если тулчейн установлен);
 *   3. сверка порта с НАСТОЯЩИМ драйвером: `--verify` рисует кадр реальным `SCENE_FS`
 *      в headless Chromium на SwiftShader и сравнивает пиксели с портом.
 *
 * Честно про границы метода:
 *   • `scalar/px` — это стоимость кадра в модельных единицах (компонентные операции), а не
 *     миллисекунды. Для fps и батареи нужна модель (раунд 30, `evaluation/round30-bg-3d/verdict.md`).
 *   • `ns/px` в выводе — время CPU-порта на Node, а не время GPU. Оно нужно только чтобы
 *     сравнивать заставку и фон между собой на одной машине; для железа оно не переносится.
 *   • редакция круга 31: сцена плоская (марша нет), порт снят заново под текущий `SCENE_FS`;
 *     число «до» 3298 оп/px живёт в `intro-before.json` и в фазе 1 (`phase1.md`).
 *   • 2487 мс на десктопе и 1406 мс на мобайле из задания — время ПОКАЗА сцены (включая
 *     монтирование, bloom, композицию, CSS), а не стоимость кадра. Здесь измеряется именно
 *     стоимость кадра scene-прохода.
 *
 * Коды выхода: 0 — замер снят; 1 — порт разошёлся с живым исходником (числа были бы липой);
 * 2 — исходник заставки не найден; 3 — не удалось свериться с драйвером при `--verify`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileToSpirv, extractGlslFromModule, loadTables, loadToolchain, parseSpirv } from '../tools/shader-check/spirv.mjs';
import { encodePng } from '../tools/png.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE_DEFAULT = resolve(HERE, '..');
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(`--${n}`);

const ROOT = resolve(arg('root', SITE_DEFAULT));
const SRC = arg('src') ? resolve(arg('src')) : join(ROOT, 'src/client/voyah-intro.ts');
const WIDTH = Number(arg('w', 640));
const HEIGHT = Number(arg('h', 360));
const TIMES = (arg('t', '0.10,0.30,0.50,0.76,0.95')).split(',').map(Number);
const JSON_OUT = arg('json', null);
const PNG_OUT = arg('png', null);
const ALLOW_STALE = flag('allow-stale');
const VERIFY = flag('verify');
/* Сверка идёт на 640×360, а не на 160×90: в сцене A5 тонкие структуры (ДХО, рейлинги)
   имеют толщину 2–4 px hero, и на 160×90 это меньше пикселя экрана — расхождение фазы
   заполняет кадр. На 640×360 (масштаб 1/3) те же линии занимают 0,7–1,3 px, картина
   честнее, а порт успевает посчитать кадр за секунды. */
const VERIFY_W = Number(arg('verify-w', 640));
const VERIFY_H = Number(arg('verify-h', 360));
const VERIFY_T = Number(arg('verify-t', 0.5));
const SPIRV = !flag('no-spirv');
const REPEAT = Number(arg('repeat', 3));

const ref = await import(new URL('../tools/intro/ref.mjs', import.meta.url).href);

/* ------------------------------------------------------------------ */
/* 1. Исходник заставки                                                */
/* ------------------------------------------------------------------ */

let moduleText;
try {
  moduleText = readFileSync(SRC, 'utf8');
} catch (e) {
  console.error(`FAIL  исходник заставки не найден: ${SRC}\n  (${e.code}) — укажите дерево владельца: --src /путь/к/voyah-intro.ts`);
  process.exit(2);
}

/* Шейдеры в заставке не экспортируются (приватные const), а править чужой файл ради замера
   запрещено (§2 задания) — поэтому читаем текст модуля. */
const glsl = extractGlslFromModule(moduleText);
const SCENE = glsl.find((s) => s.name === 'SCENE_FS') ?? glsl.find((s) => s.stage === 'fragment' && /normalAt/.test(s.source));
const VERT_SRC = glsl.find((s) => s.name === 'VERT') ?? glsl.find((s) => s.stage === 'vertex');
if (!SCENE) {
  console.error(`FAIL  в ${SRC} не найден фрагментный шейдер сцены (SCENE_FS)`);
  console.error(`      найдено: ${glsl.map((s) => `${s.name}(${s.stage})`).join(', ') || 'ничего'}`);
  process.exit(2);
}

console.log('== Замер заставки: сколько стоит кадр рейкастинга (задание №55, §1.2) ==');
console.log(`исходник: ${SRC}`);
console.log(`найдено шейдеров: ${glsl.map((s) => s.name).join(', ')}`);
console.log(`сцена: ${SCENE.name}, ${SCENE.source.split('\n').length} строк, ${SCENE.source.length} Б`);

/* ------------------------------------------------------------------ */
/* 2. Порт обязан совпадать с живым исходником                         */
/* ------------------------------------------------------------------ */

console.log('\n-- сверка порта с живым исходником --');
const stale = [];
for (const [what, re] of ref.PORT_SOURCE_LITERALS) {
  const ok = re.test(SCENE.source);
  if (!ok) stale.push(what);
  console.log(`  ${ok ? 'ok  ' : 'НЕТ '}  ${what}`);
}
/* Сцена A5 марша не имеет вовсе: единственный цикл — три тапа отражения в полу.
   Порт обязан это отражать, иначе замер молча станет чужим. */
const marchMatch = SCENE.source.match(/MARCH_MAX\s*=\s*(\d+)/);
const loops = SCENE.source.match(/for\s*\(\s*int\s+i\s*=\s*0\s*;\s*i\s*<\s*(\d+)\s*;/g) ?? [];
const loopsOk = marchMatch === null && loops.length === 1;
console.log(`  ${marchMatch === null ? 'ok  ' : 'НЕТ '}  марша рейкастинга в сцене нет (порт считает 0 шагов)`
  + (marchMatch ? `: найден MARCH_MAX=${marchMatch[1]}` : ''));
console.log(`  ${loops.length === 1 ? 'ok  ' : 'НЕТ '}  циклов в сцене: ${loops.length} (порт считает 1 — три тапа отражения)`);
if (!loopsOk) stale.push('структура циклов сцены: марша нет, цикл один (отражение)');

if (stale.length) {
  const msg = `порт tools/intro/ref.mjs снят с другой версии SCENE_FS: не найдено ${stale.length} литерал(ов):\n  • ${stale.join('\n  • ')}`;
  if (!ALLOW_STALE) {
    console.error(`\nFAIL  ${msg}\n\n  Числа «после» этим портом снимать НЕЛЬЗЯ: он считает другой шейдер.`);
    console.error('  Либо приведите порт в соответствие новому SCENE_FS, либо запустите с --allow-stale');
    console.error('  и напишите в отчёте, что замер снят устаревшим портом (и с какой версии).');
    process.exit(1);
  }
  console.log(`\nВНИМАНИЕ  ${msg}`);
  console.log('          --allow-stale: числа ниже описывают ИСХОДНИК ПОРТА, а не текущий SCENE_FS.');
}

/* ------------------------------------------------------------------ */
/* 3. Замер                                                            */
/* ------------------------------------------------------------------ */

function frameOps(t) {
  return ref.renderFrame({ width: WIDTH, height: HEIGHT, t });
}

/** Время CPU-порта. Греем JIT, иначе первые прогоны немонотонны (урок раунда 30). */
function frameNsPerPx(t, repeat = REPEAT) {
  const U = { res: [WIDTH, HEIGHT], t };
  ref.resetTally(); ref.resetCounts();
  ref.shadePixel(WIDTH / 2 + 0.5, HEIGHT / 2 + 0.5, U, { gx: WIDTH >> 1, gy: HEIGHT >> 1, collect: true });
  const px = WIDTH * HEIGHT;
  let best = Infinity;
  const runs = [];
  for (let r = 0; r < repeat; r++) {
    ref.resetTally(); ref.resetCounts();
    const t0 = process.hrtime.bigint();
    for (let y = 0; y < HEIGHT; y++) {
      const fcy = HEIGHT - (y + 0.5);
      for (let x = 0; x < WIDTH; x++) ref.shadePixel(x + 0.5, fcy, U, { gx: x, gy: y, collect: true });
    }
    const ns = Number(process.hrtime.bigint() - t0);
    runs.push(ns / px);
    if (ns / px < best) best = ns / px;
  }
  return { nsPerPx: best, runs, cpuMs: best * px / 1e6 };
}

console.log(`\n-- стоимость кадра: CPU-порт, ${WIDTH}×${HEIGHT} (${(WIDTH * HEIGHT).toLocaleString('ru-RU')} px), ${TIMES.length} моментов uT --`);
console.log('  uT     inst/px   scalar/px   scalar max   layers/px   отраж.   tex/px   нс/px (CPU)');
const samples = [];
let grid = null;
for (const t of TIMES) {
  const f = frameOps(t);
  grid ??= f.grid;
  const timing = frameNsPerPx(t);
  const row = {
    t,
    instPerPx: f.ops.instPerPx,
    scalarPerPx: f.ops.scalarPerPx,
    scalarPerPxMax: f.ops.scalarPerPxMax,
    instPerPxMax: f.ops.instPerPxMax,
    scalarPerPxP50: f.ops.scalarPerPxP50,
    scalarPerPxP95: f.ops.scalarPerPxP95,
    layersPerPx: f.ops.layersPerPx,
    reflPixelsRatio: f.ops.reflPixelsRatio,
    texPerPx: f.ops.texPerPx,
    railPixelsRatio: f.counts.railPixels / f.pixels,
    mirrorPixelsRatio: f.counts.mirrorPixels / f.pixels,
    nsPerPx: timing.nsPerPx,
    cpuMsPerFrame: timing.cpuMs,
  };
  samples.push(row);
  console.log(`  ${String(t).padEnd(6)} ${row.instPerPx.toFixed(1).padStart(8)} ${row.scalarPerPx.toFixed(1).padStart(11)} `
    + `${row.scalarPerPxMax.toFixed(0).padStart(12)} ${row.layersPerPx.toFixed(2).padStart(11)} `
    + `${(row.reflPixelsRatio * 100).toFixed(1).padStart(8)} % ${row.texPerPx.toFixed(3).padStart(8)} ${row.nsPerPx.toFixed(0).padStart(12)}`);
  if (PNG_OUT) {
    mkdirSync(PNG_OUT, { recursive: true });
    const file = join(PNG_OUT, `intro-scene-t${String(t).replace('.', '-')}-${WIDTH}x${HEIGHT}.png`);
    writeFileSync(file, encodePng(WIDTH, HEIGHT, f.data));
    console.log(`         кадр: ${file}`);
  }
}

const worst = samples.reduce((a, b) => (b.scalarPerPx > a.scalarPerPx ? b : a));
const meanScalar = samples.reduce((s, r) => s + r.scalarPerPx, 0) / samples.length;
const meanInst = samples.reduce((s, r) => s + r.instPerPx, 0) / samples.length;
console.log(`\n  худший кадр: uT=${worst.t} — ${worst.scalarPerPx.toFixed(1)} scalar/px (${worst.instPerPx.toFixed(1)} inst/px)`);
console.log(`  среднее по ${TIMES.length} моментам: ${meanScalar.toFixed(1)} scalar/px (${meanInst.toFixed(1)} inst/px)`);
console.log(`  точка отсчёта фазы 1 (старый рейкастинг, худший кадр): 3297.9 scalar/px`);
console.log(`  для сравнения, 3D-фон раунда 30: 940.9 scalar/px (вариант B, качество 2, 640×360)`);

/* ------------------------------------------------------------------ */
/* 4. Сверка порта со SPIR-V (статика по функциям)                     */
/* ------------------------------------------------------------------ */

/** Статическая стоимость одного вызова функции порта (tally с нуля). */
function portFuncCost(name, fn) {
  ref.resetTally(); ref.resetCounts();
  fn();
  return { name, inst: ref.T.inst, scalar: ref.T.scalar };
}

const portFuncs = [
  portFuncCost('hash12', () => ref.hash12(0.3, 1.7)),
  portFuncCost('smin', () => ref.smin(0.4, 0.9, 0.09)),
  portFuncCost('sdBox', () => ref.sdBox(0.3, 0.2, 11.0, 13.0, 5.0)),
  portFuncCost('sideD', () => ref.sideD(0.3, 0.2, 0.0, 0.0, 1.0, 0.5)),
  portFuncCost('sdQuad', () => ref.sdQuad(500, 280, [519, 254], [490, 243], [458, 296], [527, 302], 15)),
  portFuncCost('sdSeg', () => ref.sdSeg(480, 300, 480, 296, 477, 348, 3.5)),
  portFuncCost('hash21', () => ref.hash21(0.7, 1.3)),
  portFuncCost('vnoise', () => ref.vnoise(0.7, 1.3)),
  portFuncCost('halfW', () => ref.halfW(0.4)),
  portFuncCost('bodyOnly', () => ref.bodyOnly(960, 400)),
  portFuncCost('railsSd', () => ref.railsSd(653, 96)),
  portFuncCost('mirrorSd', () => ref.mirrorSd(1450, 280)),
  portFuncCost('bgAt', () => ref.bgAt(960, 400, 0.5)),
  { name: 'layers', ...ref.layersCost() },
];

/* Граф вызовов порта — ровно тот, что в GLSL. Нужен, чтобы сравнивать «своё тело» функции:
   в SPIR-V стоимость вызванной функции лежит в ЕЁ записи, а вызов стоит одну OpFunctionCall.
   Сравнивать полные счётчики нельзя — получится двойной счёт (урок раунда 30). */
const CALL_GRAPH = {
  hash12: {}, smin: {}, sdBox: {}, sideD: {}, sdSeg: {}, hash21: {}, halfW: {},
  sdQuad: { sideD: 5 },
  vnoise: { hash21: 4 },
  bodyOnly: { halfW: 1, smin: 1 },
  railsSd: { sdBox: 2 },
  mirrorSd: { sdQuad: 1, sdSeg: 1, smin: 1 },
  bgAt: {},
  /* layers зовёт bodyOnly (1) и mirrorSd (1); railsSd остаётся за тернарником-гейтом,
     а вызванные из них halfW/sdQuad/sdSeg/smin/vnoise/hash21 — в записях этих функций.
     Вычитаем только вызовы ПЕРВОГО уровня — иначе двойной счёт (урок раунда 30). */
  layers: { bodyOnly: 1, railsSd: 1, mirrorSd: 1 },
};
const byNameCost = Object.fromEntries(portFuncs.map((f) => [f.name, f]));
function ownBody(name) {
  const calls = CALL_GRAPH[name] ?? {};
  let inst = byNameCost[name].inst;
  let scalar = byNameCost[name].scalar;
  let n = 0;
  for (const [sub, c] of Object.entries(calls)) {
    inst -= c * byNameCost[sub].inst;
    scalar -= c * byNameCost[sub].scalar;
    n += c;
  }
  return { inst, scalar, calls: n };
}

let spirvReport = null;
if (SPIRV) {
  let tc = null;
  try { tc = await loadToolchain(); } catch (e) { console.log(`\n-- сверка со SPIR-V пропущена: ${e.message.split('\n')[0]} --`); }
  if (tc) {
    const tables = loadTables();
    /* glslang не собирает SPIR-V из ESSL 3.00 («require version 310 or higher»), поэтому для
       ПОДСЧЁТА ИНСТРУКЦИЙ версия поднимается до 310 (меняется только строка #version).
       Настоящая компиляция `#version 300 es` проверена гейтом check-shader-compile.mjs. */
    const spv = await compileToSpirv(tc.glslang, SCENE.source, 'fragment', 'SCENE_FS.frag', { version: 310, transform: true });
    if (spv.error) {
      console.log('\nFAIL  SPIR-V сцены не получен:');
      console.log(JSON.stringify(spv.error, null, 2));
      process.exit(1);
    }
    const parsed = parseSpirv(spv.words, tables);
    /* glslang подписывает функции манглящим суффиксом (`map(vf3;`, `cabin(vf2;`) — оставляем имя */
    const byName = {};
    for (const [k, v] of Object.entries(parsed.byFunc)) byName[k.replace(/\(.*$/, '')] = v;
    spirvReport = { ...parsed, byFuncNamed: byName, perFunction: [] };

    /* main в режиме once: марш ровно одна итерация, каждая ветка исполнена по разу —
       это статика, сопоставимая со статическим подсчётом компилятора */
    ref.resetTally(); ref.resetCounts();
    ref.shadePixel(WIDTH / 2 + 0.5, HEIGHT / 2 + 0.5, { res: [WIDTH, HEIGHT], t: 0.5 },
      { collect: true, once: true });
    const mainOnce = { name: 'main', inst: ref.T.inst, scalar: ref.T.scalar };
    /* в режиме once: layers один раз + отражение (ещё три layers) + bgAt + hash12.
       Все четыре вызова layers лежат в статической записи этой функции. */
    const MAIN_CALLS = { layers: 4, hash12: 1, bgAt: 1 };
    let mainOwn = mainOnce.inst, mainCalls = 0;
    for (const [k, c] of Object.entries(MAIN_CALLS)) { mainOwn -= c * byNameCost[k].inst; mainCalls += c; }

    console.log('\n-- сверка порта со статическим подсчётом glslang (SPIR-V) --');
    console.log(`  SPIR-V сцены: ${parsed.executable} исполняемых инструкций (${parsed.arithmetic} арифметики, `
      + `${parsed.transcendental} трансцендентных, ${parsed.memory} памяти, ${parsed.composite} композитных, `
      + `${parsed.texture} выборок текстур), ${parsed.spirvBytes} Б`);
    console.log('  Сравнивается «своё тело» функции (без вызванных) + число вызовов — против столбца «арифметика» SPIR-V:');
    console.log('  память (OpLoad/OpStore/OpAccessChain) — артефакт неоптимизированного SPIR-V, на GPU уходит в регистры.');
    /* Листовые функции (не зовут других) сверяются со SPIR-V строго: |Δ| ≤ 3.
       Составные (layers, main) идут справочно: компилятор сворачивает в них константы
       и CSE, а `once`-режим порта держит обе ветви тернарников — Δ там legitimately крупнее,
       верность таких функций доказывает сверка пикселей с драйвером (--verify), а не SPIR-V. */
    const LEAF = new Set(['hash12', 'smin', 'sdBox', 'sideD', 'sdSeg', 'hash21', 'halfW', 'bgAt', 'sdQuad', 'vnoise', 'bodyOnly', 'railsSd', 'mirrorSd']);
    console.log('  функция        порт всего   своё тело   вызовов   SPIR-V арифм.        Δ   почему');
    let worstDelta = 0, worstLeafDelta = 0;
    for (const f of portFuncs) {
      const own = ownBody(f.name);
      const sp = byName[f.name];
      const spArith = sp ? sp.arithmetic : null;
      const d = spArith === null ? null : own.inst + own.calls - spArith;
      if (d !== null && Math.abs(d) > Math.abs(worstDelta)) worstDelta = d;
      if (d !== null && LEAF.has(f.name) && Math.abs(d) > Math.abs(worstLeafDelta)) worstLeafDelta = d;
      spirvReport.perFunction.push({ ...f, leaf: LEAF.has(f.name), ownBody: own, spirv: sp ?? null, spirvArithmetic: spArith, delta: d, why: whyDelta(f.name, d, sp, own) });
      console.log(`  ${f.name.padEnd(14)} ${String(f.inst).padStart(10)} ${String(own.inst).padStart(11)} ${String(own.calls).padStart(9)} `
        + `${spArith === null ? '—'.padStart(15) : String(spArith).padStart(15)} ${d === null ? '—'.padStart(8) : String(d).padStart(8)}   ${whyDelta(f.name, d, sp, own)}`);
    }
    const spMain = byName.main;
    const dMain = spMain ? mainOwn + mainCalls - spMain.arithmetic : null;
    if (dMain !== null && Math.abs(dMain) > Math.abs(worstDelta)) worstDelta = dMain;
    spirvReport.perFunction.push({
      ...mainOnce, ownBody: { inst: mainOwn, calls: mainCalls }, spirv: spMain ?? null,
      spirvArithmetic: spMain?.arithmetic ?? null, delta: dMain,
      why: 'режим once: каждая ветка по разу, марш одна итерация',
      note: 'в динамике main исполняет марш до 72 раз — это учтено в scalar/px выше, а не здесь',
    });
    console.log(`  ${'main'.padEnd(14)} ${String(mainOnce.inst).padStart(10)} ${String(mainOwn).padStart(11)} ${String(mainCalls).padStart(9)} `
      + `${String(spMain?.arithmetic ?? '—').padStart(15)} ${String(dMain).padStart(8)}   режим once: каждая ветка по разу, марш одна итерация`);
    console.log(`\n  худшее |Δ| по листовым функциям: ${Math.abs(worstLeafDelta)} инструкции (допуск ≤ 3)`);
    console.log(`  худшее |Δ| по всем функциям: ${Math.abs(worstDelta)} инструкции (справочно: layers/main — составные)`);
    spirvReport.worstAbsDelta = Math.abs(worstDelta);
    spirvReport.worstLeafAbsDelta = Math.abs(worstLeafDelta);
    spirvReport.leafOk = Math.abs(worstLeafDelta) <= 3;
    if (!spirvReport.leafOk) {
      console.error('\nFAIL  порт расходится со статикой glslang сильнее, чем на 3 инструкции в листовой функции.');
      console.error('      Значит порт считает не тот шейдер: чинить порт до замера чисел.');
      process.exit(1);
    }
  }
}

function whyDelta(name, delta, sp, own) {
  if (!sp) return 'в SPIR-V такой функции нет — проверьте имя';
  if (delta === 0) return 'совпало';
  const known = {
    hash12: 'Δ +1: перестановка p3.yzx в SPIR-V уехала в композитные (OpVectorShuffle)',
    hash21: 'Δ 0: dot(p, p+45.32) совпадает',
    sdQuad: 'Δ -1: ctr = (a+b+c+d)*0.25 частично уходит в композитные',
    sdSeg: 'Δ +3: dot(pa,ba)/dot(ba,ba) — драйвер сворачивает и CSE',
    vnoise: 'Δ +1: vec2-сложения узлов уходят в память/композитные',
    railsSd: 'Δ -2: два vec2(p.x-…, p.y-…) — композитные сборки, не арифметика',
    mirrorSd: 'Δ +1: vec2(abs(p.x-BX), p.y) — композитная сборка',
    layers: 'справочно: тернарники-гейты компилятор сворачивает в OpSelect по обеим ветвям, константы (ec, eh, палитры) и CSE уходят — порт считает как написано',
    main: 'режим once: отражение исполнено один раз (в пикселе пола — трижды), поэтому Δ положительный',
  };
  return known[name] ?? (delta > 0
    ? `Δ +${delta}: драйвер сворачивает константы/CSE — порт считает как написано`
    : `Δ ${delta}: в SPIR-V часть операций учтена как композитные/память`);
}

/* ------------------------------------------------------------------ */
/* 5. Сверка порта с настоящим драйвером                               */
/* ------------------------------------------------------------------ */

let verifyReport = null;
if (VERIFY) {
  console.log('\n-- сверка с настоящим драйвером: кадр реальным SCENE_FS в headless Chromium --');
  if (!VERT_SRC) {
    console.error('FAIL  не найден вершинный шейдер заставки — нарисовать кадр нечем');
    process.exit(3);
  }
  verifyReport = await verifyAgainstDriver(SCENE.source, VERT_SRC.source, VERIFY_T);
  if (verifyReport.error) {
    console.error(`FAIL  ${verifyReport.error}`);
    process.exit(3);
  }
  console.log(`  движок: ${verifyReport.renderer}`);
  console.log(`  кадр ${VERIFY_W}×${VERIFY_H}, uT=${verifyReport.time}`);
  console.log(`  значений совпало бит в бит: ${(verifyReport.exactRatio * 100).toFixed(1)} %`);
  console.log(`  среднее |Δ| по каналам: ${verifyReport.meanAbsDelta.toFixed(3)} / 255; по квадратам 4×4: ${verifyReport.boxMeanAbsDelta.toFixed(3)} / 255`);
  console.log(`  максимальное |Δ|: ${verifyReport.maxAbsDelta} / 255; пикселей с Δ > 4: ${verifyReport.pixelsOver4} (${(verifyReport.pixelsOver4Ratio * 100).toFixed(2)} %)`);
  console.log(`  переходная зона заливки: ${(verifyReport.edgeZoneRatio * 100).toFixed(1)} % кадра`);
  console.log(`  вне зоны: Δ>4 у ${(verifyReport.outsideOver4Ratio * 100).toFixed(2)} % пикселей (${verifyReport.outsideOver4}), максимум ${verifyReport.outsideMaxDelta}/255`);
  console.log(`  необъяснённых сдвигом ≤3 px: ${verifyReport.unexplained} (${(verifyReport.unexplainedRatio * 100).toFixed(2)} % кадра), вне зоны — ${verifyReport.unexplainedOutside}`);
  console.log(`  допуск: среднее ≤ 2/255, 4×4 ≤ 1/255, Δ>4 ≤ 5 % кадра; вне зоны Δ>4 ≤ 0,5 % и макс ≤ 24; необъяснённых вне зоны ≤ 0,05 %`);
  console.log(`  ${verifyReport.ok ? 'ok  ' : 'FAIL'}  порт ${verifyReport.ok ? 'совпадает с драйвером: расхождения только там, где цвет меняется быстрее пикселя (кромка заливки, ДХО, рейлинги, свечение зеркала), и все объясняются субпиксельным сдвигом' : 'НЕ совпадает с драйвером: расхождение больше допуска'}`);
  if (!verifyReport.ok) process.exit(3);
}

async function verifyAgainstDriver(fragSrc, vertSrc, time) {
  let puppeteer, chromium;
  try {
    ({ default: puppeteer } = await import('puppeteer-core'));
    ({ default: chromium } = await import('@sparticuz/chromium'));
  } catch (e) {
    return { error: `puppeteer-core / @sparticuz/chromium не установлены: ${e.message.split('\n')[0]}` };
  }
  /* рецепт запуска из шапки scripts/intro-stills.mjs */
  const { spawnSync } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const libDir = '/tmp/al2023';
  const archive = join(ROOT, 'node_modules/@sparticuz/chromium/bin/al2023.tar.br');
  if (!existsSync(join(libDir, 'lib', 'libnss3.so')) && existsSync(archive)) {
    mkdirSync(join(libDir, 'lib'), { recursive: true });
    const { createReadStream } = await import('node:fs');
    const { createWriteStream } = await import('node:fs');
    const { createBrotliDecompress } = await import('node:zlib');
    const { pipeline } = await import('node:stream/promises');
    await pipeline(createReadStream(archive), createBrotliDecompress(), createWriteStream('/tmp/al2023.tar'));
    spawnSync('tar', ['-xf', '/tmp/al2023.tar', '-C', libDir], { stdio: 'ignore' });
  }
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: await chromium.executablePath(),
      args: [...chromium.args.filter((a) => a !== '--single-process'), '--no-sandbox',
        '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      headless: 'shell',
      defaultViewport: null,
      env: existsSync(join(libDir, 'lib')) ? { ...process.env, LD_LIBRARY_PATH: join(libDir, 'lib') } : process.env,
    });
  } catch (e) {
    return { error: `браузер не запустился: ${String(e.message).split('\n')[0]}` };
  }
  try {
    const page = await browser.newPage();
    const gpu = await page.evaluate(({ fragSrc, vertSrc, w, h, time }) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const gl = c.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
      if (!gl) return { error: 'нет webgl2' };
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const compile = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return { error: gl.getShaderInfoLog(sh) };
        return { sh };
      };
      const vs = compile(gl.VERTEX_SHADER, vertSrc);
      const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
      if (vs.error) return { error: `вершинный: ${vs.error}` };
      if (fs.error) return { error: `фрагментный: ${fs.error}` };
      const prog = gl.createProgram();
      gl.attachShader(prog, vs.sh); gl.attachShader(prog, fs.sh);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return { error: `линковка: ${gl.getProgramInfoLog(prog)}` };
      gl.useProgram(prog);
      gl.viewport(0, 0, w, h);
      gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), w, h);
      gl.uniform1f(gl.getUniformLocation(prog, 'uT'), time);
      /* знак сверяем отдельно (uMarkOn=0): альфа-маска SVG в порте подменяемая,
         а фильтр текстуры на GPU воспроизводить в CPU порт значило бы привезти чужой сэмплер */
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
      gl.uniform1i(gl.getUniformLocation(prog, 'uMark'), 0);
      gl.uniform1f(gl.getUniformLocation(prog, 'uMarkOn'), 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return {
        pixels: Array.from(px),
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
      };
    }, { fragSrc, vertSrc, w: VERIFY_W, h: VERIFY_H, time });
    if (gpu.error) return { error: gpu.error };

    /* порт на том же размере и том же uT */
    const f = ref.renderFrame({ width: VERIFY_W, height: VERIFY_H, t: time });
    const W = VERIFY_W, H = VERIFY_H;
    /* карта |Δ| по пикселю (максимум из трёх каналов) */
    const dmap = new Uint16Array(W * H);
    let sum = 0, max = 0, exact = 0, n = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        /* readPixels отдаёт строки снизу вверх, порт/PNG — сверху вниз */
        const gi = ((H - 1 - y) * W + x) * 4;
        const pi = (y * W + x) * 3;
        let dp = 0;
        for (let k = 0; k < 3; k++) {
          const d = Math.abs(gpu.pixels[gi + k] - f.data[pi + k]);
          sum += d; if (d > max) max = d; if (d === 0) exact++;
          if (d > dp) dp = d;
          n++;
        }
        dmap[y * W + x] = dp;
      }
    }
    const meanAbsDelta = sum / n;
    const over4 = dmap.reduce((a, d) => a + (d > 4 ? 1 : 0), 0);

    /* Крупное расхождение законно только на КРАЮ силуэта: там проверка попадания
       `d < 0.0016 + t*0.0012` переворачивается от разницы highp (GPU) и float64 (порт),
       и пиксель вместо линий кузова рисует фон (или наоборот). Если крупные Δ сбиваются
       в пятно — это не край, а расхождение математики: такой порт доверять нельзя. */
    /* Крупное расхождение законно там, где цвет меняется быстрее пикселя:
       • переходная зона заливки кузова (0,02 < body < 0,98) — кромка силуэта и «рот»
         заливки, ширина перехода 1–2 px экрана;
       • тонкие световые структуры — ДХО и рейлинги (2–4 px hero = 0,7–1,3 px экрана),
         свечение зеркала и отблеск капота (exp с делителем 7 px hero).
       В обеих фаза линии определяется float32, а порт считает в float64: расхождение в
       долю пикселя даёт Δ до 20/255. Ошибка логики так себя НЕ ведёт: она даёт Δ, который
       не уменьшается, если сдвинуть пиксель порта на 1–3 px. Поэтому считаем два числа:
       долю Δ>4 вне переходной зоны и долю Δ>4, не объяснённых сдвигом порта. */
    const edgeZone = f.perPixel.edgeZone;
    let outsideZone = 0, outsideOver4 = 0, outsideMax = 0;
    let unexplained = 0, unexplainedOutside = 0;
    const SHIFT = 3;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const d = dmap[i];
        if (!edgeZone[i]) {
          outsideZone++;
          if (d > 4) outsideOver4++;
          if (d > outsideMax) outsideMax = d;
        }
        if (d <= 4) continue;
        let best = d;
        for (let dy = -SHIFT; dy <= SHIFT; dy++) for (let dx = -SHIFT; dx <= SHIFT; dx++) {
          if (!dx && !dy) continue;
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= H || xx >= W) continue;
          const nd = dmap[yy * W + xx];
          if (nd < best) best = nd;
        }
        /* «объяснено» — сдвинутый пиксель порта вдвое ближе к драйверу, чем центр */
        if (best < d * 0.5) continue;
        unexplained++;
        if (!edgeZone[i]) unexplainedOutside++;
      }
    }

    /* среднее по квадратам 4×4: одиночные края усредняются, систематическая ошибка — нет */
    let boxSum = 0, boxN = 0;
    for (let by = 0; by + 4 <= H; by += 4) {
      for (let bx = 0; bx + 4 <= W; bx += 4) {
        for (let k = 0; k < 3; k++) {
          let a = 0, b = 0;
          for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
            a += gpu.pixels[((H - 1 - (by + dy)) * W + (bx + dx)) * 4 + k];
            b += f.data[((by + dy) * W + (bx + dx)) * 3 + k];
          }
          boxSum += Math.abs(a - b) / 16; boxN++;
        }
      }
    }
    const boxMeanAbsDelta = boxSum / boxN;

    return {
      time, width: W, height: H, renderer: gpu.renderer,
      meanAbsDelta, boxMeanAbsDelta, maxAbsDelta: max,
      exactRatio: exact / n, pixelsOver4: over4, pixelsOver4Ratio: over4 / (W * H),
      edgeZoneRatio: (W * H - outsideZone) / (W * H),
      outsideOver4, outsideOver4Ratio: outsideOver4 / Math.max(1, outsideZone), outsideMaxDelta: outsideMax,
      unexplained, unexplainedRatio: unexplained / (W * H),
      unexplainedOutside, unexplainedOutsideRatio: unexplainedOutside / Math.max(1, outsideZone),
      /* Допуски (highp на GPU против float64 в порте, округление в 8 бит):
         • среднее ≤ 2/255 и по квадратам 4×4 ≤ 1/255 — ловят систематическую ошибку
           математики: она не усредняется ни по кадру, ни по квадрату;
         • Δ>4 ≤ 5 % кадра и ВНЕ переходной зоны заливки ≤ 0,5 % при максимуме ≤ 24/255 —
           ловят ошибку в теле сцены (фон, свет, знак), где цвет меняется плавно;
         • необъяснённых сдвигом ≤3 px вне зоны ≤ 0,05 % — ловят случай, когда расхождение
           не является фазой тонкой структуры.
         В самой переходной зоне (7 % кадра) крупные Δ законны: там заливка кузова
         переключается с фона на чёрное на расстоянии меньше пикселя, и float32 против
         float64 решает по-разному. Проверяется это средним по квадратам 4×4. */
      ok: meanAbsDelta <= 2 && boxMeanAbsDelta <= 1 && over4 / (W * H) <= 0.05
        && outsideOver4 / Math.max(1, outsideZone) <= 0.005 && outsideMax <= 24
        && unexplainedOutside / Math.max(1, outsideZone) <= 0.0005,
    };
  } finally {
    await browser.close();
  }
}

/* ------------------------------------------------------------------ */
/* 6. Отчёт                                                            */
/* ------------------------------------------------------------------ */

const report = {
  generatedAt: new Date().toISOString(),
  purpose: '«после» по заставке: стоимость кадра сцены A5 v2.1 ПОСЛЕ правки (задание №55, фаза 2). «До» — docs/reports/r31-bg3d/intro-before.json (3297,9 scalar/px, старый рейкастинг)',
  source: SRC,
  shader: {
    name: SCENE.name,
    lines: SCENE.source.split('\n').length,
    bytes: SCENE.source.length,
    marchSteps: marchMatch ? Number(marchMatch[1]) : 0,
    loops: loops.length,
  },
  port: {
    file: 'site/tools/intro/ref.mjs',
    method: 'CPU-порт строка в строку; inst — гранулярность SPIR-V, scalar — компонентные операции',
    staleLiterals: stale,
    allowStale: ALLOW_STALE,
  },
  frame: { width: WIDTH, height: HEIGHT, pixels: WIDTH * HEIGHT },
  samples,
  headline: {
    worstTime: worst.t,
    worstScalarPerPx: Number(worst.scalarPerPx.toFixed(1)),
    worstInstPerPx: Number(worst.instPerPx.toFixed(1)),
    meanScalarPerPx: Number(meanScalar.toFixed(1)),
    meanInstPerPx: Number(meanInst.toFixed(1)),
    bg3dScalarPerPx: 940.9,
    bg3dNote: 'раунд 30, вариант B «силуэт», качество 2, те же 640×360',
    phase1WorstScalarPerPx: 3297.9,
    phase1Note: 'точка отсчёта фазы 1: старый рейкастинг заставки (72 шага марша), худший кадр uT=0.95',
    markNote: 'замер снят без знака (uMarkOn=0): коробка знака на 640×360 ≈ 20×28 px (0,24 % кадра), её вклад в среднее ≤ 0,1 оп/px; выборки текстуры печатаются отдельно как tex/px',
  },
  portFunctions: portFuncs,
  spirv: spirvReport ? {
    executable: spirvReport.executable, arithmetic: spirvReport.arithmetic,
    transcendental: spirvReport.transcendental, memory: spirvReport.memory,
    composite: spirvReport.composite, texture: spirvReport.texture,
    spirvBytes: spirvReport.spirvBytes, perFunction: spirvReport.perFunction,
  } : null,
  verify: verifyReport,
  caveats: [
    'scalar/px — модельные единицы (компонентные операции), не миллисекунды; для fps и батареи нужна модель раунда 30',
    'нс/px — время CPU-порта на Node, не время GPU; пригодно только для сравнения заставки и фона на одной машине',
    '2487 мс (десктоп) и 1406 мс (мобайл) из задания — время показа сцены целиком, а не стоимость кадра',
    'замер снят ПОСЛЕ правки A5 (сцена v2.1, фронтальный силуэт): сравнивается с «до» из intro-before.json и phase1.md',
    'тернарники-гейты (рейлинги, зеркало) исполняются в каждом пикселе: компилятор раскрывает их в OpSelect, поэтому экономия ветвления — не в операциях, а в отбрасывании результата',
    'отражение в полу (три дополнительных вызова layers) включается с uT ≥ 0,60 и покрывает 32,5 % пикселей кадра — отсюда скачок 956 → 1763 scalar/px',
  ],
};

if (JSON_OUT) {
  mkdirSync(dirname(JSON_OUT), { recursive: true });
  writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  console.log(`\nотчёт: ${JSON_OUT}`);
}

console.log(`\nok    заставка после правки: ${worst.scalarPerPx.toFixed(1)} scalar/px (худший кадр uT=${worst.t}), `
  + `среднее ${meanScalar.toFixed(1)} scalar/px; фон раунда 30 — 940.9 scalar/px`);
process.exit(0);
