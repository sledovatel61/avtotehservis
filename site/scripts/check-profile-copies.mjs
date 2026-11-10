#!/usr/bin/env node
/**
 * Гейт зависимости: «одна машина — одна таблица геометрии» (задание №55, круг 31, фаза 1, §0.3).
 *
 *   node scripts/check-profile-copies.mjs              # проверка
 *   node scripts/check-profile-copies.mjs --self-test  # детектор обязан ловить подложенную таблицу
 *   node scripts/check-profile-copies.mjs --root /путь/к/site --strict
 *
 * Смысл. Машину в этом проекте описывает ОДИН модуль геометрии — `car-profile.ts` (его пишет
 * A11, задание №54). Всё остальное — фон `bg3d/shader.ts`, заставка `voyah-intro.ts` — обязано
 * либо брать геометрию оттуда, либо рисовать свою проекцию (заставка после правки A5 —
 * фронтальный силуэт, и это НЕ дубликат: другая проекция для другой задачи, редакция 2 задания).
 * Чего быть не должно: второй копии опорных точек, тихо разъехавшейся с первой.
 *
 * Что проверяем (в `bg3d/shader.ts` и `voyah-intro.ts`):
 *   1. нет собственных таблиц опорных точек: объявления вида `const CAR = […]`, `PROFILE = […]`,
 *      `vec2 POINTS[12] = vec2[12](…)`, массивы кортежей/чисел длиной больше 10 элементов;
 *   2. нет «таблицы в строке»: больше 10 литералов `vec2(…, …)` подряд через запятую внутри одной
 *      шаблонной строки шейдера;
 *   3. когда `car-profile.ts` на месте: ни одна числовая последовательность из 4+ чисел модуля
 *      не встречается в шейдерах дословно (копия, а не ссылка).
 *
 * Чего НЕ проверяем и почему: процедурные SDF-примитивы с отдельными скалярами
 * (`sdBox2(p - vec2(0.0, 0.70), vec2(2.16, 0.30), 0.17)` в заставке ДО правки A5) таблицей не
 * являются — это форма, записанная кодом, и запретить её значило бы запретить шейдер вовсе.
 * Это не дыра в гейте, а его граница: гейт ловит именно разъезжающиеся НАБОРЫ ТОЧЕК,
 * а «заставка рисует свой силуэт» после правки A5 ловит сравнение кадров в фазе 2.
 * Про текущее состояние заставки (свой профиль сбоку кодом) сказано в отчёте фазы 1.
 *
 * Коды выхода: 0 — копий нет; 1 — найдена таблица/копия; 2 — нечего проверять и включён --strict.
 * Без --strict отсутствие файлов — предупреждение (фаза 1: заставки и car-profile.ts
 * в этом дереве ещё нет, гейт обязан стоять и молча ждать их появления).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractGlslFromModule } from '../tools/shader-check/spirv.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = (() => { const i = process.argv.indexOf('--root'); return i > 0 ? resolve(process.argv[i + 1]) : resolve(HERE, '..'); })();
const STRICT = process.argv.includes('--strict');
const SELF_TEST = process.argv.includes('--self-test');
const JSON_I = process.argv.indexOf('--json');
const JSON_OUT = JSON_I > 0 ? process.argv[JSON_I + 1] : null;

/** Порог из задания: массив опорных точек «длиной > 10». */
const TABLE_MIN = 11;

const SHADER_FILES = [
  { id: 'bg3d', file: 'src/client/bg3d/shader.ts' },
  { id: 'intro', file: 'src/client/voyah-intro.ts' },
];
const PROFILE_FILE = 'src/client/bg3d/car-profile.ts';

/* ---------------- детекторы ---------------- */

/** Таблицы вида `const NAME = [ … ]` / `export const NAME: Vec2[] = [ … ]` / `vec2 P[N] = vec2[N](…)`. */
export function findPointTables(source) {
  const hits = [];
  /* фигурные/квадратные скобки с большим числом элементов */
  const re = /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(\[)/g;
  let m;
  while ((m = re.exec(source))) {
    const name = m[1];
    const start = m.index + m[0].length - 1;
    const end = matchBracket(source, start);
    if (end < 0) continue;
    const body = source.slice(start + 1, end);
    const elems = splitTopLevel(body);
    const numeric = elems.filter((e) => /vec\d\s*\(|\[\s*-?\d|^-?\d|^[\w$]+\s*,/.test(e.trim()));
    if (elems.length >= TABLE_MIN && numeric.length >= TABLE_MIN) {
      hits.push({ kind: 'array-literal', name, elements: elems.length, snippet: body.slice(0, 120) });
    }
  }
  /* GLSL: `vec2 NAME[N] = vec2[N]( … );` */
  const reGlsl = /\bvec(\d)\s+([A-Za-z_]\w*)\s*\[\s*\d+\s*\]\s*=\s*vec\d\s*\[\s*\d+\s*\]\s*\(/g;
  while ((m = reGlsl.exec(source))) {
    const end = matchBracket(source, m.index + m[0].length - 1, '(', ')');
    if (end < 0) continue;
    const elems = splitTopLevel(source.slice(m.index + m[0].length, end));
    if (elems.length >= TABLE_MIN) hits.push({ kind: 'glsl-array', name: m[2], elements: elems.length, snippet: source.slice(m.index, m.index + 120) });
  }
  return hits;
}

/** Больше 10 литералов vecN(…) подряд через запятую — «таблица в строке». */
export function findVecRuns(source) {
  const hits = [];
  const re = /vec\d\s*\([^()]*\)\s*(?:,\s*vec\d\s*\([^()]*\)\s*){10,}/g;
  let m;
  while ((m = re.exec(source))) {
    const count = (m[0].match(/vec\d\s*\(/g) ?? []).length;
    hits.push({ kind: 'vec-run', elements: count, snippet: m[0].slice(0, 120) });
  }
  return hits;
}

/** Числовые последовательности модуля геометрии, повторённые в шейдере дословно. */
export function findCopiedSequences(profileSource, shaderSource, minLen = 4) {
  const seqs = [];
  const re = /-?\d+\.\d+(?:\s*,\s*-?\d+\.\d+)+/g;
  let m;
  while ((m = re.exec(profileSource))) {
    const nums = m[0].split(',').map((s) => s.trim());
    if (nums.length >= minLen) seqs.push(nums);
  }
  /* нормализуем шейдер: убираем пробелы у запятых, чтобы копия нашлась и с другой вёрсткой */
  const flat = shaderSource.replace(/\s*,\s*/g, ', ');
  const found = [];
  for (const nums of seqs) {
    const probe = nums.join(', ');
    if (flat.includes(probe)) found.push(probe);
  }
  return found;
}

function matchBracket(s, openIdx, open = '[', close = ']') {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close) { depth--; if (!depth) return i; }
  }
  return -1;
}

function splitTopLevel(body) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of body) {
    if (ch === '[' || ch === '(') depth++;
    if (ch === ']' || ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/* ---------------- проверка файлов ---------------- */

function checkFile(id, file, path) {
  if (!existsSync(path)) {
    return { id, file, path, present: false, tables: [], runs: [], notes: ['файла нет в этом дереве — гейт ждёт его появления'] };
  }
  const source = readFileSync(path, 'utf8');
  const tables = findPointTables(source);
  const runs = findVecRuns(source);
  const notes = [];
  /* пояснение про процедурную форму: считаем литералы vec2 в GLSL-строках, чтобы видеть масштаб */
  const glsl = extractGlslFromModule(source);
  const vec2Total = glsl.reduce((a, g) => a + (g.source.match(/vec2\s*\(/g) ?? []).length, 0);
  notes.push(`литералов vec2( в GLSL-строках: ${vec2Total} (порог срабатывания — ${TABLE_MIN} подряд в одной таблице)`);
  return { id, file, path, present: true, tables, runs, notes, vec2Total, glslNames: glsl.map((g) => g.name) };
}

const results = [];
for (const f of SHADER_FILES) results.push(checkFile(f.id, f.file, join(ROOT, f.file)));

const profilePath = join(ROOT, PROFILE_FILE);
let copies = [];
if (existsSync(profilePath)) {
  const prof = readFileSync(profilePath, 'utf8');
  for (const r of results.filter((x) => x.present)) {
    const found = findCopiedSequences(prof, readFileSync(r.path, 'utf8'));
    for (const f of found) copies.push({ in: r.id, sequence: f });
  }
} else {
  copies = [];
}

/* ---------------- самопроверка ---------------- */

let selfTest = null;
if (SELF_TEST) {
  const MUTANT_TABLE = `export const CAR_PROFILE_POINTS = [
  [2.16, 0.30], [1.40, 1.03], [0.72, 0.12], [-0.68, -0.73], [0.70, -0.71],
  [1.50, 0.35], [-1.50, 0.35], [0.355, 0.115], [0.46, 1.10], [0.00, 0.70],
  [-1.70, 1.02], [0.10, 1.66],
];`;
  const MUTANT_GLSL = 'const vec2 P[12] = vec2[12](vec2(0.0, 0.1), vec2(0.2, 0.3), vec2(0.4, 0.5), vec2(0.6, 0.7), vec2(0.8, 0.9), vec2(1.0, 1.1), vec2(1.2, 1.3), vec2(1.4, 1.5), vec2(1.6, 1.7), vec2(1.8, 1.9), vec2(2.0, 2.1), vec2(2.2, 2.3));';
  const MUTANT_RUN = 'vec2(0.0, 0.1), vec2(0.2, 0.3), vec2(0.4, 0.5), vec2(0.6, 0.7), vec2(0.8, 0.9), vec2(1.0, 1.1), vec2(1.2, 1.3), vec2(1.4, 1.5), vec2(1.6, 1.7), vec2(1.8, 1.9), vec2(2.0, 2.1)';
  selfTest = [
    { case: 'TS-таблица из 12 кортежей', found: findPointTables(MUTANT_TABLE).length > 0 },
    { case: 'GLSL-массив vec2[12]', found: findPointTables(MUTANT_GLSL).length > 0 },
    { case: '11 vec2(…) подряд', found: findVecRuns(MUTANT_RUN).length > 0 },
    { case: 'дословная копия последовательности', found: findCopiedSequences('const a = [1.40, 1.03, 0.72, 0.12, 0.35];', 'sdRot(p, vec2(1.40, 1.03, 0.72, 0.12, 0.35));').length > 0 },
    /* отрицательные кейсы: процедурная форма и короткие списки ловиться НЕ должны */
    { case: 'процедурный SDF не считается таблицей', found: findPointTables('const d = sdBox2(p - vec2(0.0, 0.70), vec2(2.16, 0.30), 0.17);').length > 0, expectFalse: true },
    { case: 'короткий список (5 точек) не считается таблицей', found: findPointTables('const A = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]];').length > 0, expectFalse: true },
  ];
}

/* ---------------- вывод ---------------- */

console.log('== Гейт «две копии профиля» (задание №55, §0.3) ==');
console.log(`корень: ${ROOT}`);
let failures = 0;
for (const r of results) {
  if (!r.present) {
    console.log(`\n${STRICT ? 'FAIL' : 'ВНИМАНИЕ'}  ${r.id}: ${r.file} отсутствует${STRICT ? ' (--strict: отсутствие недопустимо)' : ' — гейт стоит и ждёт'}`);
    if (STRICT) failures++;
    continue;
  }
  const bad = r.tables.length + r.runs.length;
  failures += bad;
  console.log(`\n${bad ? 'FAIL' : 'ok  '}  ${r.id}: ${r.file}${r.glslNames ? ` (GLSL: ${r.glslNames.join(', ')})` : ''}`);
  for (const n of r.notes) console.log(`      ${n}`);
  for (const t of r.tables) console.log(`      таблица ${t.kind} «${t.name}»: ${t.elements} элементов (порог ${TABLE_MIN}) — ${t.snippet.replace(/\n/g, ' ')}…`);
  for (const v of r.runs) console.log(`      строка из ${v.elements} vec2(…) подряд — ${v.snippet.replace(/\n/g, ' ')}…`);
}
if (existsSync(profilePath)) {
  failures += copies.length;
  console.log(`\n${copies.length ? 'FAIL' : 'ok  '}  ${PROFILE_FILE}: числовых последовательностей, дословно повторённых в шейдерах, — ${copies.length}`);
  for (const c of copies) console.log(`      копия в ${c.in}: ${c.sequence}`);
} else {
  console.log(`\nВНИМАНИЕ  ${PROFILE_FILE} ещё нет в этом дереве (его пишет A11) — сверка копий включится сама, как только модуль появится`);
}

if (SELF_TEST) {
  console.log('\n-- самопроверка детектора --');
  let badCases = 0;
  for (const c of selfTest) {
    const ok = c.expectFalse ? !c.found : c.found;
    if (!ok) badCases++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${c.case}${c.expectFalse ? ' (не ловится — правильно)' : ''}`);
  }
  failures += badCases;
  if (badCases) console.log(`\nFAIL  детектор слеп в ${badCases} кейсах`);
}

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ generatedAt: new Date().toISOString(), root: ROOT, results, copies, selfTest, ok: failures === 0 }, null, 2));
  console.log(`\nотчёт: ${JSON_OUT}`);
}

if (failures === 0) {
  console.log('\nok    собственных таблиц опорных точек в шейдерах нет: геометрия живёт в одном месте');
  process.exit(0);
}
console.error(`\nFAIL  ${failures} нарушений(ия): найдена вторая копия геометрии или слепой детектор`);
process.exit(1);
