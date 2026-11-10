#!/usr/bin/env node
/**
 * Проверка шейдера 3D-фона без браузера (задание №44).
 *
 *   cd site/tools/shader-check && npm ci      # один раз, ~5 МБ wasm
 *   node scripts/bg3d-shader-check.mjs [--json путь/отчёт.json]
 *
 * В песочнице нет ни GPU, ни браузера, а «компилируется ли шейдер» и «сколько в нём
 * инструкций» — не мнение, а факт. Поэтому берём эталонный компилятор Khronos (glslang)
 * в WebAssembly и спрашиваем у него:
 *
 *   1. **@moreplease/glslang** — компиляция и линковка программы ровно так, как это делает
 *      браузер: отдельно для цели `webgl1` и `webgl2`, плюс проверка лимитов, которые
 *      гарантирует любая реализация WebGL. Зелено здесь → не отвалится на старом Android.
 *   2. **glslang-wasm** → SPIR-V → разборщик (`tools/shader-check/spirv.mjs`): сколько
 *      инструкций сгенерировано, сколько из них арифметика, сколько — пересылки (их убирает
 *      оптимизатор драйвера), какие встроенные функции GLSL вызываются, и есть ли выборки
 *      текстур (обязано быть 0).
 *
 * Машинерия glslang/SPIR-V вынесена в `tools/shader-check/spirv.mjs` и используется также
 * гейтом компиляции всех шейдеров сайта (`scripts/check-shader-compile.mjs`) и сверкой
 * CPU-порта заставки (`scripts/measure-intro.mjs`) — один компилятор на все проверки.
 *
 * Ограничение метода, честно: glslang отдаёт SPIR-V для клиента OpenGL без оптимизации,
 * поэтому в нём много OpVariable/OpLoad/OpStore/OpAccessChain — драйверный оптимизатор
 * раскладывает это по регистрам. Для оценки стоимости кадра в отчёте используется
 * ДИНАМИЧЕСКИЙ подсчёт из CPU-порта (tools/bg3d/ref.mjs), а SPIR-V здесь — проверка
 * компилируемости, состава операций и отсутствия текстур.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import {
  TRANSCENDENTAL, compileToSpirv, loadTables, loadToolchain, parseSpirv, validateProgram,
} from '../tools/shader-check/spirv.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '..');
const jsonOut = (() => { const i = process.argv.indexOf('--json'); return i > 0 ? process.argv[i + 1] : null; })();
const tables = loadTables();

const { VERT, FRAG } = await import(join(SITE, 'src/client/bg3d/shader.ts'));

let validator, glslang, formatDiagnostic;
try {
  ({ validator, glslang, formatDiagnostic } = await loadToolchain());
} catch (e) {
  console.error(e.message);
  process.exit(2);
}

/* ================= 1. Компиляция и линковка как в браузере ================= */
const validation = {};
for (const target of ['webgl1', 'webgl2']) {
  const r = await validateProgram(validator, formatDiagnostic,
    [{ name: 'bg3d.vert', source: VERT }, { name: 'bg3d.frag', source: FRAG }], target);
  validation[target] = { ok: r.ok, diagnostics: r.diagnostics };
  console.log(`${r.ok ? 'ok  ' : 'FAIL'}  компиляция + линковка программы, цель ${target}`);
  for (const d of r.diagnostics) console.log(`      ${d}`);
}

/* ================= 2. SPIR-V ================= */
/* Шейдер ESSL 1.00, поэтому для подсчёта инструкций он приводится к 3.10 (transform: true);
   сама компиляция ESSL 1.00 проверена шагом 1 по исходнику как есть. */
const toSpirv = (source, stage) => compileToSpirv(glslang, source, stage, stage === 'fragment' ? 'bg3d.frag' : 'bg3d.vert', { transform: true, outName: 'bg3d_outColor' });
const parse = (words) => parseSpirv(words, tables);

const fragSpv = await toSpirv(FRAG, 'fragment');
const vertSpv = await toSpirv(VERT, 'vertex');
if (fragSpv.error) { console.error('FAIL  SPIR-V фрагментного шейдера:'); console.error(JSON.stringify(fragSpv.error, null, 2)); process.exit(1); }
const frag = parse(fragSpv.words);
const vert = vertSpv.error ? null : parse(vertSpv.words);

const okTex = frag.texture === 0;
console.log(`${okTex ? 'ok  ' : 'FAIL'}  SPIR-V фрагментного: ${frag.executable} исполняемых инструкций — `
  + `арифметика ${frag.arithmetic} (трансцендентных ${frag.transcendental}), память ${frag.memory}, `
  + `композитные ${frag.composite}, ветвлений ${frag.branch}; выборок текстур — ${frag.texture}`);
console.log(`ok    SPIR-V вершинного: ${vert ? `${vert.executable} исполняемых, арифметика ${vert.arithmetic}` : 'не получен'}`);
if (frag.unknownOpcodes.length) console.log(`      неизвестные коды: ${[...new Set(frag.unknownOpcodes)].join(', ')}`);

console.log('\nПо функциям (фрагментный шейдер):');
console.log('  функция        исполн.  арифм.  трансц.  память  композ.');
for (const [name, v] of Object.entries(frag.byFunc).sort((a, b) => b[1].arithmetic - a[1].arithmetic)) {
  console.log(`  ${name.padEnd(14)} ${String(v.executable).padStart(7)} ${String(v.arithmetic).padStart(7)} ${String(v.transcendental).padStart(8)} ${String(v.memory).padStart(7)} ${String(v.composite).padStart(8)}`);
}
console.log('\nОперации (топ-18):');
for (const [op, n] of Object.entries(frag.byOpcode).sort((a, b) => b[1] - a[1]).slice(0, 18)) {
  console.log(`  ${op.padEnd(26)} ${n}`);
}
console.log('\nВстроенные функции GLSL (GLSLstd450):');
for (const [fn, n] of Object.entries(frag.byExt).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${fn.padEnd(14)} ${String(n).padStart(3)}${TRANSCENDENTAL.has(fn) ? '   (трансцендентная/дорогая)' : ''}`);
}

/* ================= 3. Вес исходника ================= */
const src = VERT + '\n' + FRAG;
const raw = Buffer.from(src, 'utf8');
const weights = {
  rawBytes: raw.byteLength,
  gzipBytes: gzipSync(raw, { level: 9 }).byteLength,
  brotliBytes: brotliCompressSync(raw).byteLength,
  fragRawBytes: Buffer.byteLength(FRAG, 'utf8'),
  fragGzipBytes: gzipSync(Buffer.from(FRAG, 'utf8'), { level: 9 }).byteLength,
  spirvBytes: frag.spirvBytes,
  lines: src.split('\n').length,
  limitGzipBytes: 14 * 1024,
};
const okWeight = weights.gzipBytes <= weights.limitGzipBytes;
console.log(`\n${okWeight ? 'ok  ' : 'FAIL'}  вес шейдера: ${weights.rawBytes} Б raw · ${weights.gzipBytes} Б gzip · `
  + `${weights.brotliBytes} Б brotli · SPIR-V ${weights.spirvBytes} Б (лимит задания ${weights.limitGzipBytes} Б gzip)`);

const report = {
  generatedAt: new Date().toISOString(),
  toolchain: {
    glslang: '16.6.0 (Khronos, WASM)',
    validator: '@moreplease/glslang 16.6.0-1',
    opcodeTables: tables.opcodes.meta,
  },
  essl310Note: 'SPIR-V собран из механически преобразованной ESSL 3.10 версии (меняются только объявления входа/выхода); валидация шага 1 — по настоящему ESSL 1.00',
  validation,
  fragment: frag,
  vertex: vert,
  weights,
  ok: validation.webgl1.ok && validation.webgl2.ok && okTex && okWeight,
};
if (jsonOut) {
  mkdirSync(dirname(jsonOut), { recursive: true });
  writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  console.log(`\nотчёт: ${jsonOut}`);
}
process.exit(report.ok ? 0 : 1);
