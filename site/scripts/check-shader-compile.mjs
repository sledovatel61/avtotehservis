#!/usr/bin/env node
/**
 * Гейт компиляции шейдеров (задание №55, круг 31, фаза 1, §1.1).
 *
 *   node scripts/check-shader-compile.mjs                 # проверка
 *   node scripts/check-shader-compile.mjs --self-test     # мутанты обязаны ронять гейт
 *   node scripts/check-shader-compile.mjs --json отчёт.json
 *   node scripts/check-shader-compile.mjs --engine glslang --root /путь/к/site
 *
 * Зачем. `tests/bg3d.test.ts` проверяет ТЕКСТ шейдера (нет sampler, вес, ESSL 1.00,
 * `gl_FragColor`), а jsdom с mock-GL шейдер не компилирует. Значит любая синтаксическая
 * ошибка — например в `carProfile`, который принесёт A11, — доехала бы до продакшена
 * зелёной. Этот гейт компилирует по-настоящему.
 *
 * Что компилируем (цели разные, и в этом смысл проверки):
 *   • 3D-фон `src/client/bg3d/shader.ts` — ESSL 1.00, один исходник на двух потребителей:
 *     компилируется и линкуется как `webgl1` И как `webgl2`;
 *   • заставка `src/client/voyah-intro.ts` — `#version 300 es`, только `webgl2`
 *     (на WebGL1 она не рисуется вовсе): вершинный + ТРИ фрагментных (scene, bright, comp),
 *     то есть три программы.
 *
 * Движок по умолчанию — **headless Chromium на SwiftShader**: настоящий `compileShader` +
 * `linkProgram` драйвера ANGLE, настоящий `getShaderInfoLog`. Требование: лог пустой —
 * ни error, ни warning (предупреждение драйвера на одном устройстве завтра станет ошибкой
 * на другом). Рецепт запуска браузера в песочнице — из шапки `scripts/intro-stills.mjs`:
 * бинарнику не хватает libnss3/libnspr4, они лежат в `@sparticuz/chromium/bin/al2023.tar.br`;
 * гейт распаковывает их сам в /tmp/al2023 и запускает браузер с `LD_LIBRARY_PATH`.
 *
 * Запасной движок — эталонный компилятор Khronos glslang (WASM, `tools/shader-check`):
 * он не браузер, зато всегда доступен и проверяет то же самое (компиляция+линковка по целям
 * webgl1/webgl2). Включается сам, если браузера нет, и печатает об этом громко;
 * `--engine browser` запрещает запасной вариант (для CI, где браузер обязан быть).
 *
 * `--self-test` — проверка самого гейта: в каждый фрагментный шейдер вносятся два мутанта
 * («запятая вместо точки с запятой» и «необъявленная переменная»), и гейт ОБЯЗАН упасть,
 * процитировав текст ошибки драйвера. Гейт, который всегда зелёный, хуже отсутствия гейта.
 *
 * Коды выхода: 0 — всё компилируется; 1 — ошибка компиляции/линковки, непустой лог,
 * мутант не пойман или состав шейдеров не тот; 2 — нет ни одного движка.
 */
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createBrotliDecompress } from 'node:zlib';
import { classifyShader, extractGlslFromModule, loadToolchain, validateProgram } from '../tools/shader-check/spirv.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE_DEFAULT = resolve(HERE, '..');

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(`--${n}`);

const ROOT = resolve(arg('root', SITE_DEFAULT));
const ENGINE = arg('engine', 'auto');            /* auto | browser | glslang */
const JSON_OUT = arg('json', null);
const STRICT = flag('strict');
const ALLOW_WARNINGS = flag('allow-warnings');
const SELF_TEST = flag('self-test');
const LIST = flag('list');

/* Наборы шейдеров. `expect` — сколько их обязано найтись: если A5 переименует проход
   или удалит comp, гейт скажет об этом сразу, а не через неделю на проде. */
const SETS = [
  {
    id: 'bg3d', title: '3D-фон', file: 'src/client/bg3d/shader.ts',
    expect: { vertex: 1, fragment: 1 },
    note: 'ESSL 1.00: один исходник, два потребителя — webgl1 и webgl2',
  },
  {
    id: 'intro', title: 'заставка Voyah', file: 'src/client/voyah-intro.ts',
    expect: { vertex: 1, fragment: 3 },
    note: '#version 300 es: только webgl2; вершинный + scene, bright, comp',
  },
];

/* ------------------------------------------------------------------ */
/* 1. Добыть исходники шейдеров                                        */
/* ------------------------------------------------------------------ */

/**
 * Как добыть исходник — два пути, в порядке надёжности.
 *
 *  1. **Импорт модуля** (`await import(file)`) и взять настоящие значения экспортов. Это
 *     единственный путь, который видит шейдер таким, каким он уедет в браузер: с 21.10 шейдер
 *     фона собирается подстановкой (`${PROFILE_GLSL}`, `SCALE`, `SCENE`), и текст шаблона в файле —
 *     уже не тот GLSL, который компилируется. Разбор текста на таком шейдере даёт `$` и падает
 *     «invalid character» на живой, работающей геометрии — проверено при сведении A11 в круг 31.
 *  2. **Разбор текста** (`extractGlslFromModule`) — запасной путь для файлов без экспортов:
 *     статическая шаблонная строка читается как есть.
 *
 *  Импорт .ts работает через type-stripping Node (>=22.18); модули шейдеров — чистый TS без DOM.
 */
/**
 * Импортировать модуль и взять его GLSL-экспорты в порядке объявления в файле.
 * `null`, если модуль не импортируется или ничего похожего на GLSL не экспортирует —
 * тогда работает разбор текста.
 */
const STAGE_HINT = /void\s+main\s*\(/;
async function collectViaImport(path) {
  let mod;
  try {
    mod = await import(pathToFileURL(path).href);
  } catch {
    return null;
  }
  const text = readFileSync(path, 'utf8');
  const names = [...text.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const out = [];
  for (const name of names) {
    const value = mod[name];
    if (typeof value !== 'string' || !STAGE_HINT.test(value)) continue;
    if (/\$\{/.test(value)) {
      throw new Error(`${path}: экспорт ${name} содержит незакрытую подстановку $\{…} — это не GLSL`);
    }
    out.push({ name, source: value });
  }
  return out.length ? out : null;
}

async function collectSets() {
  const found = [];
  const problems = [];
  for (const set of SETS) {
    const path = join(ROOT, set.file);
    if (!existsSync(path)) {
      problems.push({ set: set.id, kind: 'missing-file', path, strict: STRICT });
      continue;
    }
    const text = readFileSync(path, 'utf8');
    const glsl = (await collectViaImport(path)) || extractGlslFromModule(text);
    if (!glsl.length) {
      problems.push({ set: set.id, kind: 'no-glsl-found', path });
      continue;
    }
    const shaders = glsl.map((g) => ({ ...g, ...classifyShader(g.source) }));
    const vertex = shaders.filter((s) => s.stage === 'vertex');
    const fragment = shaders.filter((s) => s.stage === 'fragment');
    if (vertex.length !== set.expect.vertex || fragment.length !== set.expect.fragment) {
      problems.push({
        set: set.id, kind: 'unexpected-count', path,
        got: { vertex: vertex.length, fragment: fragment.length }, expect: set.expect,
      });
    }
    /* пары: каждый фрагментный линкуется с каждым вершинным той же версии ESSL
       (в обоих наборах вершинный один — как и в реальном коде: voyah-intro.ts:587) */
    const programs = [];
    for (const f of fragment) {
      for (const v of vertex.filter((x) => x.version === f.version)) {
        programs.push({ name: `${v.name}+${f.name}`, vertex: v, fragment: f, targets: f.targets });
      }
    }
    found.push({ ...set, path, shaders, vertex, fragment, programs });
  }
  return { found, problems };
}

/* ------------------------------------------------------------------ */
/* 2. Мутанты для --self-test                                          */
/* ------------------------------------------------------------------ */

/** Вставляет строку перед последней закрывающей скобкой `void main(){…}`. */
function injectIntoMain(source, line) {
  const i = source.lastIndexOf('}');
  if (i < 0) return null;
  return `${source.slice(0, i)}  ${line}\n${source.slice(i)}`;
}

const MUTANTS = [
  {
    id: 'comma-instead-of-semicolon',
    title: 'запятая вместо точки с запятой',
    apply: (src) => injectIntoMain(src, 'float zzMutant = 1.0,'),
    /* драйвер обязан ругнуться на синтаксис */
    expectText: /error|syntax|unexpected/i,
  },
  {
    id: 'undeclared-variable',
    title: 'переменная не объявлена',
    apply: (src) => injectIntoMain(src, 'zzUndeclared += 1.0;'),
    expectText: /error|undeclared|not declared|unknown/i,
  },
];

/* ------------------------------------------------------------------ */
/* 3. Движок A: headless Chromium (SwiftShader/ANGLE) — настоящий      */
/* ------------------------------------------------------------------ */

async function ensureChromiumLibs() {
  const libDir = '/tmp/al2023';
  const marker = join(libDir, 'lib', 'libnss3.so');
  const archive = join(ROOT, 'node_modules/@sparticuz/chromium/bin/al2023.tar.br');
  if (existsSync(marker)) return libDir;
  if (!existsSync(archive)) return null;
  /* рецепт из шапки scripts/intro-stills.mjs: распаковать один раз */
  mkdirSync(join(libDir, 'lib'), { recursive: true });
  const tmpTar = '/tmp/al2023.tar';
  await pipeline(createReadStream(archive), createBrotliDecompress(), (await import('node:fs')).createWriteStream(tmpTar));
  const r = spawnSync('tar', ['-xf', tmpTar, '-C', libDir], { stdio: 'ignore' });
  return r.status === 0 && existsSync(marker) ? libDir : null;
}

async function browserEngine() {
  let puppeteer, chromium;
  try {
    ({ default: puppeteer } = await import('puppeteer-core'));
    ({ default: chromium } = await import('@sparticuz/chromium'));
  } catch (e) {
    return { error: `puppeteer-core / @sparticuz/chromium не установлены: ${e.message.split('\n')[0]}` };
  }
  const libDir = await ensureChromiumLibs();
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: await chromium.executablePath(),
      /* SwiftShader: в песочнице нет GPU. Для проверки КОМПИЛЯЦИИ это ровно то, что нужно
         (ANGLE собирает шейдер по-настоящему), но это не показатель fps. */
      args: [...chromium.args.filter((a) => a !== '--single-process'), '--no-sandbox',
        '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
      headless: 'shell',
      defaultViewport: null,
      env: libDir ? { ...process.env, LD_LIBRARY_PATH: `${join(libDir, 'lib')}${process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ''}` } : process.env,
    });
  } catch (e) {
    return { error: `браузер не запустился: ${String(e.message).split('\n')[0]}${libDir ? '' : ' (библиотеки al2023 не найдены и не распаковались)'}` };
  }
  const page = await browser.newPage();
  const info = await page.evaluate(() => {
    /* по канвасу на каждый контекст: у одного canvas второй getContext() вернёт null */
    const c2 = document.createElement('canvas');
    const c1 = document.createElement('canvas');
    const gl2 = c2.getContext('webgl2');
    const gl1 = c1.getContext('webgl') ?? c1.getContext('experimental-webgl');
    const g = gl2 ?? gl1;
    const dbg = g?.getExtension('WEBGL_debug_renderer_info');
    const out = {
      webgl1: !!gl1, webgl2: !!gl2,
      renderer: dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
      glsl: g ? g.getParameter(g.SHADING_LANGUAGE_VERSION) : null,
    };
    for (const gl of [gl1, gl2]) gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return out;
  });
  if (!info.webgl1 || !info.webgl2) {
    await browser.close();
    return { error: `в браузере нет обоих контекстов (webgl1=${info.webgl1}, webgl2=${info.webgl2})` };
  }

  return {
    name: 'browser',
    info,
    /** @param jobs [{set, target, shaders:[{name,stage,source}], programs:[{name, vertex, fragment}]}] */
    async run(jobs) {
      return page.evaluate((jobs) => jobs.map((job) => {
        const canvas = document.createElement('canvas');
        canvas.width = 8; canvas.height = 8;
        const gl = canvas.getContext(job.target === 'webgl1' ? 'webgl' : 'webgl2');
        const out = { set: job.set, target: job.target, ok: true, context: !!gl, shaders: [], programs: [] };
        if (!gl) { out.ok = false; return out; }
        const handles = {};
        for (const s of job.shaders) {
          const sh = gl.createShader(s.stage === 'vertex' ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER);
          gl.shaderSource(sh, s.source);
          gl.compileShader(sh);
          const ok = gl.getShaderParameter(sh, gl.COMPILE_STATUS);
          const log = gl.getShaderInfoLog(sh) ?? '';
          if (!ok) gl.deleteShader(sh); else handles[s.name] = sh;
          out.shaders.push({ name: s.name, stage: s.stage, ok, log });
          if (!ok || log.trim()) out.ok = false;
        }
        for (const p of job.programs) {
          const vs = handles[p.vertex], fs = handles[p.fragment];
          if (!vs || !fs) { out.programs.push({ name: p.name, ok: false, log: 'шейдеры не скомпилированы — линковать нечего' }); out.ok = false; continue; }
          const prog = gl.createProgram();
          gl.attachShader(prog, vs); gl.attachShader(prog, fs);
          gl.linkProgram(prog);
          const ok = gl.getProgramParameter(prog, gl.LINK_STATUS);
          const log = gl.getProgramInfoLog(prog) ?? '';
          gl.deleteProgram(prog);
          out.programs.push({ name: p.name, ok, log });
          if (!ok || log.trim()) out.ok = false;
        }
        const lose = gl.getExtension('WEBGL_lose_context');
        lose?.loseContext();
        return out;
      }), jobs);
    },
    async close() { await browser.close(); },
  };
}

/* ------------------------------------------------------------------ */
/* 4. Движок B: glslang (WASM) — запасной                              */
/* ------------------------------------------------------------------ */

async function glslangEngine() {
  try {
    const { validator, formatDiagnostic } = await loadToolchain();
    return {
      name: 'glslang',
      info: { validator: '@moreplease/glslang 16.6.0-1 (Khronos, WASM)' },
      async run(jobs) {
        const out = [];
        for (const job of jobs) {
          const res = { set: job.set, target: job.target, ok: true, context: true, shaders: [], programs: [] };
          for (const p of job.programs) {
            const r = await validateProgram(validator, formatDiagnostic, [
              { name: `${p.vertex}.vert`, source: job.shaders.find((s) => s.name === p.vertex)?.source ?? '' },
              { name: `${p.fragment}.frag`, source: job.shaders.find((s) => s.name === p.fragment)?.source ?? '' },
            ], job.target);
            res.programs.push({ name: p.name, ok: r.ok, log: r.diagnostics.join('\n') });
            /* glslang валидирует программу целиком: логиshader'ов те же, что и у программы */
            for (const n of [p.vertex, p.fragment]) {
              if (!res.shaders.some((s) => s.name === n)) res.shaders.push({ name: n, stage: n === p.vertex ? 'vertex' : 'fragment', ok: r.ok, log: r.diagnostics.join('\n') });
            }
            if (!r.ok || (!ALLOW_WARNINGS && r.diagnostics.length)) res.ok = false;
          }
          out.push(res);
        }
        return out;
      },
      async close() {},
    };
  } catch (e) {
    return { error: e.message.split('\n')[0] };
  }
}

/* ------------------------------------------------------------------ */
/* 5. Прогон                                                           */
/* ------------------------------------------------------------------ */

function jobsFor(sets, override) {
  const jobs = [];
  for (const set of sets) {
    const shaders = set.shaders.map((s) => ({ name: s.name, stage: s.stage, source: s.source }));
    const programs = set.programs.map((p) => ({ name: p.name, vertex: p.vertex.name, fragment: p.fragment.name }));
    if (override?.set === set.id) {
      const i = shaders.findIndex((s) => s.name === override.shader);
      if (i >= 0) shaders[i] = { ...shaders[i], source: override.source };
    }
    for (const target of [...new Set(set.shaders.flatMap((s) => s.targets))]) {
      /* цель webgl1 имеет смысл только если в наборе все шейдеры ESSL 1.00 */
      const usable = set.shaders.every((s) => s.targets.includes(target));
      if (!usable) continue;
      jobs.push({ set: set.id, target, shaders, programs });
    }
  }
  return jobs;
}

function reportRun(results, label) {
  const failures = [];
  for (const r of results) {
    for (const s of r.shaders) {
      const bad = !s.ok || (!ALLOW_WARNINGS && s.log.trim());
      if (bad) failures.push({ where: `${label}/${r.set}/${r.target}`, what: `шейдер ${s.name}`, log: s.log.trim() || 'COMPILE_STATUS = false (лог пустой)' });
    }
    for (const p of r.programs) {
      const bad = !p.ok || (!ALLOW_WARNINGS && p.log.trim());
      if (bad) failures.push({ where: `${label}/${r.set}/${r.target}`, what: `программа ${p.name}`, log: p.log.trim() || 'LINK_STATUS = false (лог пустой)' });
    }
    if (!r.context) failures.push({ where: `${label}/${r.set}/${r.target}`, what: 'контекст', log: 'не получен' });
  }
  return { results, failures };
}

const { found, problems } = await collectSets();

if (LIST) {
  for (const s of found) {
    console.log(`${s.id}: ${s.path}`);
    for (const sh of s.shaders) console.log(`  ${sh.name.padEnd(10)} ${sh.stage.padEnd(9)} ${sh.essl.padEnd(9)} цели: ${sh.targets.join(', ')}`);
  }
  process.exit(0);
}

console.log('== Гейт компиляции шейдеров (задание №55, §1.1) ==');
console.log(`корень: ${ROOT}`);
for (const s of found) {
  console.log(`\nнабор «${s.title}» — ${s.file} (${s.note})`);
  for (const sh of s.shaders) console.log(`  ${sh.name.padEnd(10)} ${sh.stage.padEnd(9)} ${sh.essl.padEnd(9)} → цели ${sh.targets.join(' + ')}`);
  console.log(`  программ: ${s.programs.map((p) => p.name).join(', ')}`);
}
for (const p of problems) {
  const fatal = p.kind !== 'missing-file' || STRICT;
  console.log(`\n${fatal ? 'FAIL' : 'ВНИМАНИЕ'}  набор «${p.set}»: ${p.kind === 'missing-file' ? `файл не найден (${p.path})` : p.kind === 'no-glsl-found' ? 'в файле не найдено ни одного GLSL-исходника (извлечение сломалось?)' : `найдено ${JSON.stringify(p.got)}, ожидалось ${JSON.stringify(p.expect)}`}`);
}

if (!found.length) {
  console.error('\nFAIL  компилировать нечего: ни один набор шейдеров не найден');
  process.exit(1);
}
const hardProblems = problems.filter((p) => p.kind !== 'missing-file' || STRICT);
if (hardProblems.length) {
  console.error('\nFAIL  состав шейдеров не тот — гейт не может считать проверку пройденной');
  process.exit(1);
}

/* выбираем движок */
let engine = null;
const engineErrors = [];
if (ENGINE === 'browser' || ENGINE === 'auto') {
  engine = await browserEngine();
  if (engine.error) { engineErrors.push(`browser: ${engine.error}`); engine = null; }
}
if (!engine && (ENGINE === 'glslang' || ENGINE === 'auto')) {
  engine = await glslangEngine();
  if (engine.error) { engineErrors.push(`glslang: ${engine.error}`); engine = null; }
}
if (!engine) {
  console.error('\nFAIL  ни одного движка компиляции:');
  for (const e of engineErrors) console.error(`  ${e}`);
  console.error('\n  браузер: cd site && npm i -D puppeteer-core @sparticuz/chromium');
  console.error('  glslang: cd site/tools/shader-check && npm ci');
  process.exit(2);
}
if (ENGINE === 'browser' && engine.name !== 'browser') { console.error('FAIL  --engine browser, но браузер недоступен'); process.exit(2); }

console.log(`\nдвижок: ${engine.name}${engine.name === 'browser' ? ` — ${engine.info.renderer}` : ' — ЗАПАСНОЙ ВАРИАНТ, не драйвер браузера'}`);
if (engine.name !== 'browser') {
  console.log('ВНИМАНИЕ: браузер недоступен, проверка идёт эталонным компилятором Khronos.');
  console.log(`  причины: ${engineErrors.join(' | ') || '—'}`);
  console.log('  Для CI, где браузер обязан быть, запускайте с --engine browser.');
}
for (const e of engineErrors) if (engine.name === 'browser') console.log(`  (запасной движок не понадобился: ${e})`);

/* --- основная проверка --- */
const base = reportRun(await engine.run(jobsFor(found)), 'проверка');
let failures = base.failures.length;
console.log('\n-- компиляция и линковка --');
for (const r of base.results) {
  const logs = [...r.shaders, ...r.programs].map((x) => x.log.trim()).filter(Boolean);
  console.log(`  ${r.ok && !logs.length ? 'ok  ' : 'FAIL'}  ${r.set} · ${r.target} · шейдеров ${r.shaders.length} · программ ${r.programs.length}${logs.length ? ` · логов: ${logs.length}` : ' · логи чистые'}`);
  for (const f of base.failures.filter((x) => x.where.includes(`/${r.set}/${r.target}`))) {
    console.log(`        ${f.what}: ${f.log.split('\n').slice(0, 6).join(' | ')}`);
  }
}

/* --- мутанты --- */
let mutantRows = [];
if (SELF_TEST) {
  console.log('\n-- самопроверка: мутанты обязаны ронять гейт --');
  for (const set of found) {
    for (const frag of set.fragment) {
      for (const m of MUTANTS) {
        const mutated = m.apply(frag.source);
        if (!mutated) { mutantRows.push({ set: set.id, shader: frag.name, mutant: m.id, caught: false, why: 'не удалось внести мутацию' }); continue; }
        /* мутант должен быть ОТЛИЧИМ от исходника — иначе самопроверка бессмысленна */
        if (mutated === frag.source) { mutantRows.push({ set: set.id, shader: frag.name, mutant: m.id, caught: false, why: 'мутация ничего не изменила' }); continue; }
        const res = await engine.run(jobsFor(found, { set: set.id, shader: frag.name, source: mutated }));
        const rep = reportRun(res, 'мутант');
        const caught = rep.failures.length > 0;
        const log = rep.failures[0]?.log ?? '';
        const hasDriverText = /ERROR|error:|Warning|WARNING/i.test(log);
        mutantRows.push({
          set: set.id, shader: frag.name, mutant: m.id, title: m.title, caught,
          matchesExpectation: caught && m.expectText.test(log), hasDriverText,
          firstLogLine: log.split('\n')[0]?.slice(0, 200) ?? '',
        });
        console.log(`  ${caught && hasDriverText ? 'ok  ' : 'FAIL'}  ${set.id}/${frag.name} · ${m.title}${caught ? ` → пойман: ${log.split('\n')[0].slice(0, 110)}` : ' → НЕ ПОЙМАН (гейт слеп)'}`);
      }
    }
  }
  const blind = mutantRows.filter((r) => !r.caught || !r.hasDriverText);
  if (blind.length) {
    failures += blind.length;
    console.log(`\nFAIL  самопроверка: ${blind.length} мутант(ов) не пойманы или пойманы без текста ошибки драйвера`);
  } else {
    console.log(`\nok    самопроверка: все ${mutantRows.length} мутантов пойманы с текстом ошибки драйвера`);
  }
}

/* --- итог --- */
const summary = {
  generatedAt: new Date().toISOString(),
  root: ROOT,
  engine: engine.name,
  engineInfo: engine.info,
  engineErrors,
  sets: found.map((s) => ({
    id: s.id, file: s.file, path: s.path,
    shaders: s.shaders.map((sh) => ({ name: sh.name, stage: sh.stage, essl: sh.essl, version: sh.version, targets: sh.targets, bytes: sh.source.length })),
    programs: s.programs.map((p) => p.name),
  })),
  problems,
  results: base.results,
  failures: base.failures,
  mutants: mutantRows,
  allowWarnings: ALLOW_WARNINGS,
  ok: failures === 0,
};
if (JSON_OUT) {
  mkdirSync(dirname(JSON_OUT), { recursive: true });
  writeFileSync(JSON_OUT, JSON.stringify(summary, null, 2));
  console.log(`\nотчёт: ${JSON_OUT}`);
}

await engine.close();
const total = base.results.reduce((a, r) => a + r.shaders.length + r.programs.length, 0);
if (failures === 0) {
  console.log(`\nok    скомпилировано и слинковано ${total} объектов (${base.results.length} прогонов), логи драйвера чистые${SELF_TEST ? `, мутанты пойманы (${mutantRows.length})` : ''}`);
  process.exit(0);
}
console.error(`\nFAIL  ${failures} проблем(ы): ${base.failures.length} в компиляции/линковке${SELF_TEST ? `, ${mutantRows.filter((r) => !r.caught || !r.hasDriverText).length} в самопроверке` : ''}`);
process.exit(1);
