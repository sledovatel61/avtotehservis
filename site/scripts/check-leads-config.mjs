/**
 * Круг 80 / задание 80-1, §2.5: гейт режима заявок в собранном pages-dist.
 *
 * Одна переменная сборки решает, куда уходят заявки:
 *   без PUBLIC_LEADS_ENDPOINT — демо: формы ходят на свой /api/leads, в каждой
 *     публичной странице стоит плашка «Демонстрационная версия…»;
 *   с PUBLIC_LEADS_ENDPOINT   — боевой режим: адрес прослойки запечён в клиентский JS,
 *     /api/leads в клиенте не остаётся, плашки нет, но data-preview="true" остаётся
 *     (на нём держатся гейты раскладки).
 *
 * Дополнительно проверяем формат адреса (только https, без хвостового слэша и пробелов)
 * и что в артефактах нет токена бота. Нарушение — код 1.
 *
 * В npm run build:pages гейт НЕ подключён: сборка должна собирать оба режима,
 * а падать на несоответствии — отдельный шаг приёмки.
 *
 * Клиентский адрес проверяется не грепом, а импортом собранного модуля
 * `_astro/leads-endpoint.<hash>.js`: минификатор схлопывает `/api/` + `leads`
 * в шаблон, и литерал `/api/leads` в бандле отсутствует в обоих режимах.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseLeadsEndpoint } from '../src/shared/leads-endpoint.ts';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'pages-dist');
const rawEnv = process.env.PUBLIC_LEADS_ENDPOINT ?? '';
const conf = parseLeadsEndpoint(rawEnv);
/* Намерение оператора: переменная задана и непустая. */
const wantRelay = rawEnv.trim() !== '';
const problems = [];
const ok = (msg) => console.log(`ok   ${msg}`);
const bad = (msg) => { problems.push(msg); console.log(`FAIL ${msg}`); };

const NOTICE = 'Демонстрационная версия';
const BOT_TOKEN = /\d{8,10}:[A-Za-z0-9_-]{35}/;

async function walk(dir) {
  const out2 = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out2.push(...await walk(path));
    else out2.push(path);
  }
  return out2;
}

if (!(await stat(out).catch(() => null))) {
  console.error('check-leads-config: нет pages-dist — сначала npm run build:pages');
  process.exit(1);
}

/* ---------- 1. формат адреса ---------- */
if (wantRelay && conf.error) {
  bad(`PUBLIC_LEADS_ENDPOINT: ${conf.error} (значение: «${rawEnv}»)`);
} else if (wantRelay) {
  ok(`адрес прослойки корректный: ${conf.base}`);
  if (!conf.base.startsWith('https://')) bad('адрес прослойки не https://');
  if (conf.base.endsWith('/')) bad('адрес прослойки с хвостовым слэшем');
  if (/\s/.test(conf.base)) bad('адрес прослойки с пробелом');
} else {
  ok('PUBLIC_LEADS_ENDPOINT не задан — проверяем демо-режим');
}

/* ---------- 2. файлы ---------- */
const files = await walk(out);
const html = files.filter((f) => f.endsWith('.html'));
const js = files.filter((f) => f.endsWith('.js'));
const texts = new Map();
for (const f of files) {
  if (/\.(html|js|css|json|xml|svg|txt|webmanifest)$/.test(f)) texts.set(f, await readFile(f, 'utf8'));
}
const rel = (f) => relative(out, f).split('\\').join('/');
const isRedirectStub = (text) => /http-equiv="refresh"/.test(text);
const publicPages = html.filter((f) => !rel(f).startsWith('manage/') && !isRedirectStub(texts.get(f) ?? ''));
if (publicPages.length < 8) bad(`публичных страниц слишком мало: ${publicPages.length}`);

/* data-preview="true" — в обоих режимах (на нём стоят гейты раскладки) */
const withoutPreview = html.filter((f) => !/data-preview="true"/.test(texts.get(f) ?? ''));
if (withoutPreview.length) bad(`нет data-preview="true": ${withoutPreview.map(rel).join(', ')}`);
else ok(`data-preview="true" во всех ${html.length} HTML`);

/* плашка «Демонстрационная версия…» */
const withNotice = publicPages.filter((f) => (texts.get(f) ?? '').includes(NOTICE));
if (wantRelay) {
  if (withNotice.length) bad(`плашка осталась в ${withNotice.length} стр.: ${withNotice.slice(0, 5).map(rel).join(', ')}`);
  else ok(`плашки нет ни в одной из ${publicPages.length} публичных страниц`);
} else {
  const missing = publicPages.filter((f) => !withNotice.includes(f));
  if (missing.length) bad(`плашки нет в ${missing.length} стр.: ${missing.slice(0, 5).map(rel).join(', ')}`);
  else ok(`плашка есть во всех ${publicPages.length} публичных страницах`);
}

/* ---------- 3. адрес в собранном клиентском модуле ---------- */
const chunk = js.find((f) => /[/\\]leads-endpoint\.[^/\\]+\.js$/.test(f));
if (!chunk) {
  bad('в pages-dist нет собранного модуля leads-endpoint*.js');
} else {
  const saved = process.env.PUBLIC_LEADS_ENDPOINT;
  /* в модуле есть фолбэк на process.env (для скриптов и тестов) — убираем его,
     чтобы проверялось именно то, что запечено в бандл сборкой */
  delete process.env.PUBLIC_LEADS_ENDPOINT;
  let mod;
  try {
    mod = await import(pathToFileURL(chunk).href + '?v=' + Date.now());
  } catch (err) {
    bad(`собранный модуль не импортируется: ${err.message}`);
  }
  if (saved !== undefined) process.env.PUBLIC_LEADS_ENDPOINT = saved;
  if (mod) {
    /* имена экспортов в общем чанке минифицированы (Rollup: minifyInternalExports),
       поэтому ищем значения по поведению: булев флаг режима и функция адреса. */
    const values = Object.values(mod);
    const relayFlag = values.find((v) => typeof v === 'boolean');
    const urlFn = values.find((v) => typeof v === 'function' && v.length === 2
      && typeof v('leads') === 'string' && String(v('leads')).endsWith('/leads'));
    const leads = urlFn ? String(urlFn('leads')) : '';
    const slots = urlFn ? String(urlFn('slots', 'date=2026-10-21')) : '';
    if (!urlFn) bad('в собранном модуле не нашлась функция адреса заявок');
    if (wantRelay && !conf.error) {
      if (relayFlag !== true) bad('в собранном модуле relayMode = false, хотя адрес задан');
      if (leads !== `${conf.base}/leads`) bad(`заявки уходят не туда: «${leads}» вместо «${conf.base}/leads»`);
      if (slots !== `${conf.base}/slots?date=2026-10-21`) bad(`слоты запрашиваются не там: «${slots}»`);
      if (leads === `${conf.base}/leads`) ok(`клиент шлёт заявки по ${leads}, слоты по ${slots}`);
      for (const f of js) {
        const text = texts.get(f) ?? '';
        if (text.includes('/api/leads') || text.includes('/api/slots')) bad(`в ${rel(f)} остался адрес своего сервера (/api/leads или /api/slots)`);
      }
      const withBase = js.filter((f) => (texts.get(f) ?? '').includes(conf.base));
      if (!withBase.length) bad(`адрес прослойки ${conf.base} не найден ни в одном клиентском JS`);
      else ok(`адрес прослойки запечён в клиентский JS: ${withBase.map(rel).join(', ')}`);
    } else {
      if (relayFlag !== false) bad('в демо-сборке relayMode = true');
      if (leads !== '/api/leads') bad(`демо-форма шлёт не на /api/leads: «${leads}»`);
      if (slots !== '/api/slots?date=2026-10-21') bad(`демо-слоты запрашиваются не с /api/slots: «${slots}»`);
      if (leads === '/api/leads' && slots.startsWith('/api/slots')) ok('клиент шлёт заявки на /api/leads, слоты на /api/slots');
      const anyEndpoint = js.filter((f) => /https:\/\/[a-z0-9.-]+\.workers\.dev/i.test(texts.get(f) ?? ''));
      if (anyEndpoint.length) bad(`в демо-сборке найден адрес прослойки: ${anyEndpoint.map(rel).join(', ')}`);
      else ok('адреса прослойки в клиентском JS нет');
    }
  }
}

/* ---------- 4. секреты ---------- */
const secretFiles = [];
for (const [f, text] of texts) {
  if (BOT_TOKEN.test(text) || text.includes('BOT_TOKEN')) secretFiles.push(rel(f));
}
if (secretFiles.length) bad(`похоже на токен бота: ${secretFiles.slice(0, 5).join(', ')}`);
else ok(`токена бота нет в ${texts.size} текстовых файлах pages-dist`);

/* ---------- 5. гейт не в сборке ---------- */
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (String(pkg.scripts?.['build:pages'] ?? '').includes('check-leads-config')) {
  bad('check-leads-config подключён к build:pages — сборка не должна зависеть от режима');
} else {
  ok('check-leads-config не подключён к build:pages');
}

if (problems.length) {
  console.error(`\ncheck-leads-config: ПРОВАЛ (${problems.length})`);
  for (const p of problems) console.error(` - ${p}`);
  process.exit(1);
}
console.log(`\ncheck-leads-config: OK (${wantRelay ? 'режим прослойки: ' + conf.base : 'демо-режим'}; ${html.length} HTML, ${js.length} JS)`);
