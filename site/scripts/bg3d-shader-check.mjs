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
 *   2. **glslang-wasm** → SPIR-V → собственный разборщик: сколько инструкций сгенерировано,
 *      сколько из них арифметика, сколько — пересылки (их убирает оптимизатор драйвера),
 *      какие встроенные функции GLSL вызываются, и есть ли выборки текстур (обязано быть 0).
 *
 * Номера Op* и номера GLSLstd450 не выдуманы и не запомнены: таблицы взяты из
 * KhronosGroup/SPIRV-Headers (`scripts/bg3d/spirv-opcodes.json`, `scripts/bg3d/glsl450-extinst.json`,
 * MIT, получены 10.11.2026 через api.github.com). Проверял на живых данных: OpExtInst = 12,
 * OpFunction = 54, GLSLstd450 Ceil = 9, Pow = 26 — то, что «по памяти» я бы написал неправильно.
 *
 * Ограничение метода, честно: glslang отдаёт SPIR-V для клиента OpenGL без оптимизации,
 * поэтому в нём много OpVariable/OpLoad/OpStore/OpAccessChain — драйверный оптимизатор
 * раскладывает это по регистрам. Для оценки стоимости кадра в отчёте используется
 * ДИНАМИЧЕСКИЙ подсчёт из CPU-порта (tools/bg3d/ref.mjs), а SPIR-V здесь — проверка
 * компилируемости, состава операций и отсутствия текстур.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '..');
const TOOLS = join(SITE, 'tools', 'shader-check', 'node_modules');
const jsonOut = (() => { const i = process.argv.indexOf('--json'); return i > 0 ? process.argv[i + 1] : null; })();

const OPCODES = JSON.parse(readFileSync(join(HERE, 'bg3d', 'spirv-opcodes.json'), 'utf8')).opcodes;
const EXTINST = JSON.parse(readFileSync(join(HERE, 'bg3d', 'glsl450-extinst.json'), 'utf8')).extinst;

const require_ = createRequire(join(TOOLS, '_'));
async function tool(name) {
  try { return await import(require_.resolve(name)); } catch (e) {
    console.error(`Не найден пакет ${name} в ${TOOLS}\n  cd site/tools/shader-check && npm ci\n  (${e.message})`);
    process.exit(2);
  }
}

const { VERT, FRAG } = await import(join(SITE, 'src/client/bg3d/shader.ts'));

/* ================= 1. Компиляция и линковка как в браузере ================= */
const validator = await tool('@moreplease/glslang');
const validation = {};
for (const target of ['webgl1', 'webgl2']) {
  const r = await validator.validate(
    [{ name: 'bg3d.vert', source: VERT }, { name: 'bg3d.frag', source: FRAG }],
    { target },
  );
  validation[target] = { ok: !!r.ok, diagnostics: (r.diagnostics ?? []).map((d) => validator.formatDiagnostic(d)) };
  console.log(`${r.ok ? 'ok  ' : 'FAIL'}  компиляция + линковка программы, цель ${target}`);
  for (const d of validation[target].diagnostics) console.log(`      ${d}`);
}

/* ================= 2. SPIR-V ================= */
const glslangWasm = await tool('glslang-wasm');
const glslang = await glslangWasm.createGlslang();

/**
 * glslang не умеет собирать SPIR-V из ESSL 1.00 («ES shaders for SPIR-V require version 310
 * or higher»), а шейдер у нас намеренно ESSL 1.00 — один исходник и для WebGL1, и для WebGL2.
 * Поэтому для ПОДСЧЁТА ИНСТРУКЦИЙ исходник механически приводится к ESSL 3.10: меняются только
 * объявления входа/выхода (`attribute`/`varying`/`gl_FragColor`), арифметика не трогается вовсе.
 * Компиляцию настоящего ESSL 1.00 проверяет шаг 1 — по исходнику как есть.
 */
function toEssl310(source, stage) {
  let out = source.replace(/\battribute\b/g, 'in');
  if (stage === 'vertex') {
    out = out.replace(/\bvarying\b/g, 'out');
  } else {
    out = out.replace(/\bvarying\b/g, 'in').replace(/\bgl_FragColor\b/g, 'bg3d_outColor');
    out = out.replace('precision highp float;', 'precision highp float;\nlayout(location = 0) out vec4 bg3d_outColor;');
  }
  return `#version 310 es\n${out}`;
}

/** SPIR-V приходит то Uint32Array, то Uint8Array, то массивом чисел. Приводим к Uint32Array
 *  БЕЗ конвертации значений: `new Uint32Array(u8)` побайтово поднял бы каждый байт до
 *  отдельного слова и разъехался бы на 4×. */
function asU32(spirv) {
  if (spirv instanceof Uint32Array) return spirv;
  if (ArrayBuffer.isView(spirv)) return new Uint32Array(spirv.buffer, spirv.byteOffset ?? 0, (spirv.byteLength ?? spirv.length) >>> 2);
  if (Array.isArray(spirv)) {
    const isBytes = spirv.length > 4 && spirv[0] <= 0xff;
    return isBytes ? new Uint32Array(new Uint8Array(spirv).buffer) : Uint32Array.from(spirv);
  }
  return new Uint32Array(spirv);
}

async function toSpirv(source, stage) {
  const { spirv, diagnostics } = await glslang.compile(toEssl310(source, stage), {
    stage,
    name: stage === 'fragment' ? 'bg3d.frag' : 'bg3d.vert',
    client: 'opengl',
    defaultVersion: 310,
    defaultProfile: 'es',
    spirvVersion: '1.0',
    autoMap: true,
  });
  if (!spirv || (diagnostics && diagnostics.length)) return { error: diagnostics ?? ['SPIR-V не получен'] };
  return { words: asU32(spirv) };
}

/* Классификация. «Структурные» — не исполняются на пиксель вовсе.
   «Память» — артефакт неоптимизированного SPIR-V (OpVariable + Load/Store/AccessChain),
   на реальном GPU уходит в регистры. «Композитные» — сборка/разборка векторов: на GPU
   это обычно алиасы регистров, но часть из них реальная работа. */
const STRUCTURAL = new Set([
  'OpNop', 'OpUndef', 'OpSource', 'OpSourceContinued', 'OpSourceExtension', 'OpName', 'OpMemberName',
  'OpString', 'OpLine', 'OpNoLine', 'OpExtension', 'OpExtInstImport', 'OpMemoryModel', 'OpEntryPoint',
  'OpExecutionMode', 'OpCapability', 'OpDecorate', 'OpMemberDecorate', 'OpDecorationGroup',
  'OpGroupDecorate', 'OpGroupMemberDecorate', 'OpLabel', 'OpSelectionMerge', 'OpLoopMerge', 'OpBranch',
  'OpReturn', 'OpReturnValue', 'OpFunction', 'OpFunctionParameter', 'OpFunctionEnd', 'OpVariable',
]);
const isType = (n) => n.startsWith('OpType');
const isConst = (n) => n.startsWith('OpConstant') || n.startsWith('OpSpecConstant');
const MEMORY = new Set(['OpLoad', 'OpStore', 'OpAccessChain', 'OpInBoundsAccessChain', 'OpPtrAccessChain',
  'OpCopyMemory', 'OpCopyMemorySized', 'OpCopyObject', 'OpImageTexelPointer']);
const COMPOSITE = new Set(['OpCompositeConstruct', 'OpCompositeExtract', 'OpCompositeInsert',
  'OpVectorShuffle', 'OpVectorExtractDynamic', 'OpVectorInsertDynamic', 'OpTranspose']);
const TEXTURE = (n) => /^OpImage|^OpSampledImage/.test(n);
/** Трансцендентные и дорогие: на мобильных GPU уходят в SFU или считаются несколькими тактами. */
const TRANSCENDENTAL = new Set(['Pow', 'Exp', 'Log', 'Exp2', 'Log2', 'Sqrt', 'InverseSqrt', 'Sin', 'Cos', 'Tan',
  'Asin', 'Acos', 'Atan', 'Atan2', 'Sinh', 'Cosh', 'Tanh', 'Asinh', 'Acosh', 'Atanh', 'Length', 'Distance',
  'Normalize', 'Cross', 'Determinant', 'MatrixInverse', 'Radians', 'Degrees']);

function parse(words) {
  const names = new Map();
  const instrs = [];
  for (let i = 5; i < words.length;) {
    const w0 = words[i];
    const len = w0 >>> 16;
    const op = w0 & 0xffff;
    if (len === 0) break;
    const name = OPCODES[String(op)] ?? `Op#${op}`;
    instrs.push({ i, op, name, len });
    if (name === 'OpName' || name === 'OpMemberName') {
      const id = words[i + 1];
      let str = '';
      const from = name === 'OpName' ? i + 2 : i + 3;
      for (let k = from; k < i + len; k++) {
        for (const shift of [0, 8, 16, 24]) {
          const b = (words[k] >>> shift) & 0xff;
          if (b === 0) break;
          str += String.fromCharCode(b);
        }
      }
      if (name === 'OpName') names.set(id, str);
    }
    i += len;
  }

  const byOpcode = {};
  const byExt = {};
  const byFunc = {};
  const summary = {
    total: instrs.length, executable: 0, arithmetic: 0, transcendental: 0, memory: 0, composite: 0,
    texture: 0, branch: 0, controlFlow: 0, spirvBytes: words.byteLength, unknownOpcodes: [],
  };
  let cur = '(вне функций)';

  for (const ins of instrs) {
    byOpcode[ins.name] = (byOpcode[ins.name] ?? 0) + 1;
    if (!OPCODES[String(ins.op)]) summary.unknownOpcodes.push(ins.name);
    if (ins.name === 'OpFunction') {
      cur = names.get(words[ins.i + 2]) ?? names.get(words[ins.i + 1]) ?? '(функция)';
      byFunc[cur] ??= { executable: 0, arithmetic: 0, transcendental: 0, memory: 0, composite: 0 };
      continue;
    }
    if (ins.name === 'OpFunctionEnd') { cur = '(вне функций)'; continue; }
    if (TEXTURE(ins.name)) summary.texture++;
    if (ins.name === 'OpBranchConditional' || ins.name === 'OpSwitch') { summary.branch++; summary.controlFlow++; }
    if (ins.name === 'OpPhi' || ins.name === 'OpKill' || ins.name === 'OpUnreachable') summary.controlFlow++;

    if (STRUCTURAL.has(ins.name) || isType(ins.name) || isConst(ins.name)) continue;
    summary.executable++;
    let kind = 'arithmetic';
    if (MEMORY.has(ins.name)) { kind = 'memory'; summary.memory++; }
    else if (COMPOSITE.has(ins.name)) { kind = 'composite'; summary.composite++; }
    else {
      summary.arithmetic++;
      if (ins.name === 'OpExtInst') {
        const fn = EXTINST[String(words[ins.i + 4])] ?? `GLSLstd450#${words[ins.i + 4]}`;
        byExt[fn] = (byExt[fn] ?? 0) + 1;
        if (TRANSCENDENTAL.has(fn)) { summary.transcendental++; }
      }
    }
    if (cur !== '(вне функций)') {
      byFunc[cur].executable++;
      byFunc[cur][kind]++;
      if (ins.name === 'OpExtInst' && TRANSCENDENTAL.has(EXTINST[String(words[ins.i + 4])])) byFunc[cur].transcendental++;
    }
  }
  return { ...summary, byOpcode, byExt, byFunc };
}

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
    opcodeTables: JSON.parse(readFileSync(join(HERE, 'bg3d', 'spirv-opcodes.json'), 'utf8')).meta,
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
