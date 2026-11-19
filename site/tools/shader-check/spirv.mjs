/**
 * Общая обвязка над эталонным компилятором Khronos glslang (WASM) — вынесена из
 * `scripts/bg3d-shader-check.mjs`, чтобы одной и той же машинерией пользовались:
 *
 *   • `scripts/bg3d-shader-check.mjs`   — глубокий разбор шейдера 3D-фона (SPIR-V, вес, текстуры);
 *   • `scripts/check-shader-compile.mjs`— гейт компиляции всех шейдеров сайта (запасной движок,
 *                                          когда headless Chromium недоступен);
 *   • `scripts/measure-intro.mjs`       — сверка CPU-порта заставки со статическим подсчётом
 *                                          инструкций (тот же приём, что в раунде 30 для фона).
 *
 * Установка (один раз, ~5 МБ wasm; вне зависимостей сайта, боевая сборка это не тащит):
 *   cd site/tools/shader-check && npm ci
 *
 * Номера Op* и GLSLstd450 не выдуманы: таблицы взяты из KhronosGroup/SPIRV-Headers (MIT)
 * и лежат в репозитории (`scripts/bg3d/spirv-opcodes.json`, `scripts/bg3d/glsl450-extinst.json`)
 * с пометкой о происхождении, чтобы проверка была воспроизводима офлайн.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '..', '..');
const TOOLS = join(SITE, 'tools', 'shader-check', 'node_modules');
const TABLES = join(SITE, 'scripts', 'bg3d');

const require_ = createRequire(join(TOOLS, '_'));

export class ToolchainMissing extends Error {
  constructor(pkg, cause) {
    super(`Не найден пакет ${pkg} в ${TOOLS}\n  cd site/tools/shader-check && npm ci\n  (${cause})`);
    this.name = 'ToolchainMissing';
    this.pkg = pkg;
  }
}

async function tool(name) {
  try { return await import(require_.resolve(name)); } catch (e) { throw new ToolchainMissing(name, e.message); }
}

export function loadTables() {
  return {
    opcodes: JSON.parse(readFileSync(join(TABLES, 'spirv-opcodes.json'), 'utf8')),
    extinst: JSON.parse(readFileSync(join(TABLES, 'glsl450-extinst.json'), 'utf8')),
  };
}

/** Компилятор (валидация + линковка как в браузере) и генератор SPIR-V. */
export async function loadToolchain() {
  const validator = await tool('@moreplease/glslang');
  const glslangWasm = await tool('glslang-wasm');
  const glslang = await glslangWasm.createGlslang();
  return { validator, glslang, formatDiagnostic: (d) => validator.formatDiagnostic(d) };
}

/**
 * Компиляция + линковка программы ровно так, как это делает браузер: цель `webgl1` или
 * `webgl2`, плюс проверка лимитов, которые гарантирует любая реализация WebGL.
 * @param shaders {{name: string, source: string}[]}
 */
export async function validateProgram(validator, formatDiagnostic, shaders, target) {
  const r = await validator.validate(shaders, { target });
  return { ok: !!r.ok, target, diagnostics: (r.diagnostics ?? []).map((d) => formatDiagnostic(d)) };
}

/**
 * glslang не умеет собирать SPIR-V из ESSL 1.00 («ES shaders for SPIR-V require version 310
 * or higher»), а шейдер 3D-фона намеренно ESSL 1.00 — один исходник и для WebGL1, и для WebGL2.
 * Поэтому для ПОДСЧЁТА ИНСТРУКЦИЙ такой исходник механически приводится к ESSL 3.10: меняются
 * только объявления входа/выхода (`attribute`/`varying`/`gl_FragColor`), арифметика не трогается.
 * Компиляцию настоящего ESSL 1.00 проверяет `validateProgram` — по исходнику как есть.
 * Шейдерам с `#version 300 es` (заставка) преобразование не нужно вовсе.
 */
export function toEssl310(source, stage, outName = 'outColor') {
  /* `#version 300 es` (заставка) — уже почти 310: достаточно поднять номер версии,
     объявления входа/выхода там написаны по-новому (`out vec4 O;`). */
  if (/^\s*#version\s+300\s+es/m.test(source)) return source.replace(/^(\s*#version\s+)300(\s+es)/m, '$1310$2');
  let out = source.replace(/\battribute\b/g, 'in');
  if (stage === 'vertex') {
    out = out.replace(/\bvarying\b/g, 'out');
  } else {
    out = out.replace(/\bvarying\b/g, 'in').replace(/\bgl_FragColor\b/g, outName);
    out = out.replace('precision highp float;', `precision highp float;\nlayout(location = 0) out vec4 ${outName};`);
  }
  return `#version 310 es\n${out}`;
}

/** SPIR-V приходит то Uint32Array, то Uint8Array, то массивом чисел. Приводим к Uint32Array
 *  БЕЗ конвертации значений: `new Uint32Array(u8)` побайтово поднял бы каждый байт до
 *  отдельного слова и разъехался бы на 4×. */
export function asU32(spirv) {
  if (spirv instanceof Uint32Array) return spirv;
  if (ArrayBuffer.isView(spirv)) return new Uint32Array(spirv.buffer, spirv.byteOffset ?? 0, (spirv.byteLength ?? spirv.length) >>> 2);
  if (Array.isArray(spirv)) {
    const isBytes = spirv.length > 4 && spirv[0] <= 0xff;
    return isBytes ? new Uint32Array(new Uint8Array(spirv).buffer) : Uint32Array.from(spirv);
  }
  return new Uint32Array(spirv);
}

/**
 * @param opts {{version?: number, transform?: boolean, outName?: string}}
 *   `transform: true` — исходник ESSL 1.00, нужно привести к 310 (см. toEssl310).
 */
export async function compileToSpirv(glslang, source, stage, name, opts = {}) {
  const { version = 310, transform = false, outName = 'outColor' } = opts;
  const src = transform ? toEssl310(source, stage, outName) : source;
  const { spirv, diagnostics } = await glslang.compile(src, {
    stage,
    name,
    client: 'opengl',
    defaultVersion: version,
    defaultProfile: 'es',
    spirvVersion: '1.0',
    autoMap: true,
  });
  if (!spirv || (diagnostics && diagnostics.length)) return { error: diagnostics ?? ['SPIR-V не получен'] };
  return { words: asU32(spirv) };
}

/* Классификация инструкций. «Структурные» — не исполняются на пиксель вовсе.
   «Память» — артефакт неоптимизированного SPIR-V (OpVariable + Load/Store/AccessChain),
   на реальном GPU уходит в регистры. «Композитные» — сборка/разборка векторов: на GPU
   это обычно алиасы регистров, но часть из них реальная работа. */
export const STRUCTURAL = new Set([
  'OpNop', 'OpUndef', 'OpSource', 'OpSourceContinued', 'OpSourceExtension', 'OpName', 'OpMemberName',
  'OpString', 'OpLine', 'OpNoLine', 'OpExtension', 'OpExtInstImport', 'OpMemoryModel', 'OpEntryPoint',
  'OpExecutionMode', 'OpCapability', 'OpDecorate', 'OpMemberDecorate', 'OpDecorationGroup',
  'OpGroupDecorate', 'OpGroupMemberDecorate', 'OpLabel', 'OpSelectionMerge', 'OpLoopMerge', 'OpBranch',
  'OpReturn', 'OpReturnValue', 'OpFunction', 'OpFunctionParameter', 'OpFunctionEnd', 'OpVariable',
]);
export const isType = (n) => n.startsWith('OpType');
export const isConst = (n) => n.startsWith('OpConstant') || n.startsWith('OpSpecConstant');
export const MEMORY = new Set(['OpLoad', 'OpStore', 'OpAccessChain', 'OpInBoundsAccessChain', 'OpPtrAccessChain',
  'OpCopyMemory', 'OpCopyMemorySized', 'OpCopyObject', 'OpImageTexelPointer']);
export const COMPOSITE = new Set(['OpCompositeConstruct', 'OpCompositeExtract', 'OpCompositeInsert',
  'OpVectorShuffle', 'OpVectorExtractDynamic', 'OpVectorInsertDynamic', 'OpTranspose']);
export const TEXTURE = (n) => /^OpImage|^OpSampledImage/.test(n);
/** Трансцендентные и дорогие: на мобильных GPU уходят в SFU или считаются несколькими тактами. */
export const TRANSCENDENTAL = new Set(['Pow', 'Exp', 'Log', 'Exp2', 'Log2', 'Sqrt', 'InverseSqrt', 'Sin', 'Cos', 'Tan',
  'Asin', 'Acos', 'Atan', 'Atan2', 'Sinh', 'Cosh', 'Tanh', 'Asinh', 'Acosh', 'Atanh', 'Length', 'Distance',
  'Normalize', 'Cross', 'Determinant', 'MatrixInverse', 'Radians', 'Degrees', 'FWidth']);

/** Разбор SPIR-V: сколько инструкций сгенерировано, каких, и по функциям. */
export function parseSpirv(words, tables = loadTables()) {
  const OPCODES = tables.opcodes.opcodes ?? tables.opcodes;
  const EXTINST = tables.extinst.extinst ?? tables.extinst;
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

/**
 * Достать из исходника модуля все строковые константы, похожие на GLSL.
 * Нужно для шейдеров, которые не экспортируются (заставка: `const SCENE_FS = \`…\``), —
 * править чужой файл ради гейта нельзя (задание №55, §2), поэтому читаем текст.
 * Работает и с обычными `const X = \`…\``, и с `export const X = \`…\`` (когда A5 их экспортирует).
 */
export function extractGlslFromModule(source) {
  const out = [];
  const re = /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*`/g;
  let m;
  while ((m = re.exec(source))) {
    const name = m[1];
    let i = re.lastIndex;
    let body = '';
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\') { body += source[i + 1] ?? ''; i += 2; continue; }
      if (ch === '`') break;
      body += ch;
      i++;
    }
    re.lastIndex = i + 1;
    /* GLSL узнаём по признакам, а не по имени: имя может быть любым */
    if (/void\s+main\s*\(/.test(body) && (/gl_Position|gl_FragColor|gl_FragCoord|\bout\s+vec4\b/.test(body) || /#version/.test(body))) {
      out.push({ name, source: body });
    }
  }
  return out;
}

/** Вершинный или фрагментный; какая версия ESSL; какие цели компиляции ему положены. */
export function classifyShader(source) {
  const versionMatch = source.match(/^\s*#version\s+(\d+)\s*(es)?/m);
  const version = versionMatch ? Number(versionMatch[1]) : 100;
  const stage = /gl_Position\s*=/.test(source) ? 'vertex' : 'fragment';
  /* ESSL 1.00 обязаны кормить и WebGL1, и WebGL2 (один исходник — два потребителя).
     ESSL 3.00 (`#version 300 es`) — только WebGL2: на WebGL1 такой шейдер не собирается вовсе. */
  const targets = version >= 300 ? ['webgl2'] : ['webgl1', 'webgl2'];
  return { version, essl: version >= 300 ? `ESSL ${(version / 100).toFixed(2)}` : 'ESSL 1.00', stage, targets };
}
