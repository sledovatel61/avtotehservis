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
const VERIFY_W = Number(arg('verify-w', 160));
const VERIFY_H = Number(arg('verify-h', 90));
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
const marchMatch = SCENE.source.match(/for\s*\(\s*int\s+i\s*=\s*0\s*;\s*i\s*<\s*(\d+)\s*;/);
const marchSteps = marchMatch ? Number(marchMatch[1]) : null;
if (marchSteps !== null) console.log(`  ${marchSteps === 72 ? 'ok  ' : 'НЕТ '}  шагов марша в исходнике: ${marchSteps} (порт считает 72)`);

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
  const grid = ref.probeDerivatives(WIDTH, HEIGHT, U);
  ref.setDerivSource(grid);
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
console.log('  uT     inst/px   scalar/px   scalar max   марш ср/макс   попаданий   normalAt/px   map/px   нс/px (CPU)');
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
    marchItersAvg: f.ops.marchItersAvg,
    marchItersMax: f.ops.marchItersMax,
    hitRatio: f.ops.hitRatio,
    normalAtPerPx: f.counts.normalAtCalls / f.pixels,
    mapCallsPerPx: f.counts.mapCalls / f.pixels,
    fwidthPerPx: f.counts.fwidthPerPx,
    floorPixelsRatio: f.counts.floorPixels / f.pixels,
    nsPerPx: timing.nsPerPx,
    cpuMsPerFrame: timing.cpuMs,
    probeCostPerPx: f.ops.probeCostPerPx,
  };
  samples.push(row);
  console.log(`  ${String(t).padEnd(6)} ${row.instPerPx.toFixed(1).padStart(8)} ${row.scalarPerPx.toFixed(1).padStart(11)} `
    + `${row.scalarPerPxMax.toFixed(0).padStart(12)} ${`${row.marchItersAvg.toFixed(1)}/${row.marchItersMax}`.padStart(14)} `
    + `${(row.hitRatio * 100).toFixed(1).padStart(9)} % ${row.normalAtPerPx.toFixed(3).padStart(13)} ${row.mapCallsPerPx.toFixed(2).padStart(8)} ${row.nsPerPx.toFixed(0).padStart(10)}`);
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
console.log(`  для сравнения, 3D-фон раунда 30: 940.9 scalar/px (вариант B, качество 2, 640×360)`);
console.log(`  цена helper-lane'ов (probe-прогон для fwidth, в число выше НЕ входит): `
  + `${worst.probeCostPerPx.scalar.toFixed(1)} scalar/px`);

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
  portFuncCost('hash13', () => ref.hash13(0.3, 1.7, -2.2)),
  portFuncCost('smin', () => ref.smin(0.4, 0.9, 0.09)),
  portFuncCost('sdBox2', () => ref.sdBox2(0.3, 0.2, 2.16, 0.30, 0.17)),
  portFuncCost('sdRot', () => ref.sdRot(1.3, 1.0, 1.40, 1.03, 0.72, 0.12, -0.10, 0.10)),
  portFuncCost('sdCylZ', () => ref.sdCylZ(1.2, 0.4, 0.3, 1.50, 0.35, 0.46, 1.1)),
  portFuncCost('sdExt', () => ref.sdExt(0.1, 0.2, 0.9, 0.075)),
  portFuncCost('cabin', () => ref.cabin(0.2, 1.3)),
  portFuncCost('prof', () => ref.prof(1.1, 0.8)),
  portFuncCost('map', () => ref.map(1.1, 0.8, 0.4)),
  portFuncCost('normalAt', () => ref.normalAt(1.1, 0.8, 0.4)),
  portFuncCost('camera', () => ref.camera(0.5)),
];

/* Граф вызовов порта — ровно тот, что в GLSL. Нужен, чтобы сравнивать «своё тело» функции:
   в SPIR-V стоимость вызванной функции лежит в ЕЁ записи, а вызов стоит одну OpFunctionCall.
   Сравнивать полные счётчики нельзя — получится двойной счёт (урок раунда 30). */
const CALL_GRAPH = {
  hash13: {}, smin: {}, sdBox2: {}, sdCylZ: {}, sdExt: {}, cabin: {}, camera: {},
  sdRot: { sdBox2: 1 },
  prof: { sdBox2: 1, sdRot: 1, smin: 2, cabin: 1 },
  map: { prof: 1, sdExt: 1, sdCylZ: 6 },
  normalAt: { map: 4 },
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
    ref.setDerivSource(grid);
    ref.shadePixel(WIDTH / 2 + 0.5, HEIGHT / 2 + 0.5, { res: [WIDTH, HEIGHT], t: 0.5 },
      { gx: WIDTH >> 1, gy: HEIGHT >> 1, collect: true, once: true });
    const mainOnce = { name: 'main', inst: ref.T.inst, scalar: ref.T.scalar };
    const MAIN_CALLS = { camera: 1, map: 1, normalAt: 1, cabin: 1, hash13: 2 };
    let mainOwn = mainOnce.inst, mainCalls = 0;
    for (const [k, c] of Object.entries(MAIN_CALLS)) { mainOwn -= c * byNameCost[k].inst; mainCalls += c; }

    console.log('\n-- сверка порта со статическим подсчётом glslang (SPIR-V) --');
    console.log(`  SPIR-V сцены: ${parsed.executable} исполняемых инструкций (${parsed.arithmetic} арифметики, `
      + `${parsed.transcendental} трансцендентных, ${parsed.memory} памяти, ${parsed.composite} композитных, `
      + `${parsed.texture} выборок текстур), ${parsed.spirvBytes} Б`);
    console.log('  Сравнивается «своё тело» функции (без вызванных) + число вызовов — против столбца «арифметика» SPIR-V:');
    console.log('  память (OpLoad/OpStore/OpAccessChain) — артефакт неоптимизированного SPIR-V, на GPU уходит в регистры.');
    console.log('  функция        порт всего   своё тело   вызовов   SPIR-V арифм.        Δ   почему');
    let worstDelta = 0;
    for (const f of portFuncs) {
      const own = ownBody(f.name);
      const sp = byName[f.name];
      const spArith = sp ? sp.arithmetic : null;
      const d = spArith === null ? null : own.inst + own.calls - spArith;
      if (d !== null && Math.abs(d) > Math.abs(worstDelta)) worstDelta = d;
      spirvReport.perFunction.push({ ...f, ownBody: own, spirv: sp ?? null, spirvArithmetic: spArith, delta: d, why: whyDelta(f.name, d, sp, own) });
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
    console.log(`\n  худшее |Δ| по функциям: ${Math.abs(worstDelta)} инструкции`);
    spirvReport.worstAbsDelta = Math.abs(worstDelta);
  }
}

function whyDelta(name, delta, sp, own) {
  if (!sp) return 'в SPIR-V такой функции нет — проверьте имя';
  if (delta === 0) return 'совпало';
  const known = {
    hash13: 'Δ +1: перестановка p.yzx в SPIR-V уехала в композитные (OpVectorShuffle)',
    sdRot: 'Δ -1: mat2(co,s,-s,co) в SPIR-V — композитная сборка, не арифметика',
    sdCylZ: 'Δ +1: vec2(length(…), p.z) в SPIR-V — композитная сборка',
    sdExt: 'Δ +1: vec2(dd+r, …) в SPIR-V — композитная сборка',
    cabin: 'Δ +2: две normalize(vec2(константа)) — драйвер сворачивает их при компиляции',
    camera: 'Δ +1: часть констант (vec3(0,0.8,0), 1.80) сворачивается',
    map: 'Δ +1: константы vec3(0,0,±0.80) сворачиваются в адреса',
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
  verifyReport = await verifyAgainstDriver(SCENE.source, VERT_SRC.source, TIMES[0]);
  if (verifyReport.error) {
    console.error(`FAIL  ${verifyReport.error}`);
    process.exit(3);
  }
  console.log(`  движок: ${verifyReport.renderer}`);
  console.log(`  кадр ${VERIFY_W}×${VERIFY_H}, uT=${verifyReport.time}`);
  console.log(`  значений совпало бит в бит: ${(verifyReport.exactRatio * 100).toFixed(1)} %`);
  console.log(`  среднее |Δ| по каналам: ${verifyReport.meanAbsDelta.toFixed(3)} / 255; по квадратам 4×4: ${verifyReport.boxMeanAbsDelta.toFixed(3)} / 255`);
  console.log(`  максимальное |Δ|: ${verifyReport.maxAbsDelta} / 255; пикселей с Δ > 4: ${verifyReport.pixelsOver4} (${(verifyReport.pixelsOver4Ratio * 100).toFixed(2)} %)`);
  console.log(`  крупнейшее пятно таких пикселей (соседей 3×3): ${verifyReport.worstCluster} из 8 — ${verifyReport.worstCluster <= 5 ? 'это край силуэта, а не область' : 'ПОХОЖЕ НА ОБЛАСТЬ, порт неверен'}`);
  console.log(`  допуск: среднее ≤ 2/255, 4×4 ≤ 1/255, Δ>4 ≤ 5 % пикселей и без пятен`);
  console.log(`  ${verifyReport.ok ? 'ok  ' : 'FAIL'}  порт ${verifyReport.ok ? 'совпадает с драйвером: расхождения только на крае силуэта (переворот проверки попадания от разницы highp/float64)' : 'НЕ совпадает с драйвером: расхождение больше допуска'}`);
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
    let worstCluster = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (dmap[y * W + x] <= 4) continue;
        let near = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= H || xx >= W) continue;
          if (dmap[yy * W + xx] > 4) near++;
        }
        if (near > worstCluster) worstCluster = near;
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
      worstCluster,
      /* допуски: highp на GPU против float64 в порте, fwidth по квадратам 2×2, округление в 8 бит.
         Среднее ≤ 2/255, по квадратам 4×4 ≤ 1/255, крупных Δ ≤ 5 % пикселей и они не сбиваются в пятно. */
      ok: meanAbsDelta <= 2 && boxMeanAbsDelta <= 1 && over4 / (W * H) <= 0.05 && worstCluster <= 5,
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
  purpose: '«до» по заставке: стоимость кадра scene-прохода ДО правки A5 (задание №55, §1.2)',
  source: SRC,
  shader: { name: SCENE.name, lines: SCENE.source.split('\n').length, bytes: SCENE.source.length, marchSteps },
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
    helperLaneScalarPerPx: Number(worst.probeCostPerPx.scalar.toFixed(1)),
    helperLaneNote: 'стоимость предварительного прогона, который собирает значения соседей для fwidth. Артефакт метода: на GPU эти значения приходят из тех же пикселей кадра (каждый пиксель исполняется один раз), дополнительной работой является только расхождение веток внутри квадрата 2×2. В headline НЕ входит.',
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
    'замер снят до правки A5: после неё эти числа описывают уже несуществующий шейдер',
  ],
};

if (JSON_OUT) {
  mkdirSync(dirname(JSON_OUT), { recursive: true });
  writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  console.log(`\nотчёт: ${JSON_OUT}`);
}

console.log(`\nok    заставка до правки: ${worst.scalarPerPx.toFixed(1)} scalar/px (худший кадр uT=${worst.t}), `
  + `среднее ${meanScalar.toFixed(1)} scalar/px; фон раунда 30 — 940.9 scalar/px`);
process.exit(0);
