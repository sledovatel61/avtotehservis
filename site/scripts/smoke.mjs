#!/usr/bin/env node
/**
 * smoke — проверка ЖИВОГО сервера одной командой (этап 6, пусковой круг).
 *
 *   npm run smoke -- https://домен        (по умолчанию http://localhost:4321)
 *
 * Только чтения и health: заявку НЕ отправляет (не засорять боевую базу) —
 * форму проверяем руками при приёмке (docs/13-launch-checklist.md §8).
 * Каждая проверка — строка «ok» или «FAIL …»; итоговый код выхода:
 * 0 — все проверки прошли, 1 — хотя бы одна упала (для CI и cron).
 *
 * Про canonical: он берётся из PUBLIC_SITE_URL, зафиксированного НА СБОРКЕ
 * (astro.config.mjs → site:). Поэтому smoke против боевого домена имеет смысл
 * запускать после сборки на сервере с заполненным env (deploy/deploy.md §3, §9).
 * Против локального сервера без PUBLIC_SITE_URL canonical будет localhost —
 * проверка «не localhost» выполняется только когда сам url — не localhost.
 */

const BASE = (process.argv[2] ?? process.env.SMOKE_URL ?? 'http://localhost:4321').replace(/\/+$/, '');
const ORIGIN = new URL(BASE).origin;
const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(BASE).hostname);
const TIMEOUT_MS = 15_000;

let fails = 0;
let total = 0;
function line(ok, name, extra = '') {
  total++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) fails++;
}

async function get(path) {
  try {
    return await fetch(BASE + path, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    return { status: 0, headers: new Headers(), text: async () => '', json: async () => { throw e; }, error: e };
  }
}

/* ---------- 1. Публичные страницы: 200 и text/html ---------- */
const PAGES = ['/', '/about', '/services', '/appointment', '/news', '/contacts', '/privacy'];
for (const p of PAGES) {
  const r = await get(p);
  const ct = r.headers.get('content-type') ?? '';
  line(r.status === 200 && ct.includes('text/html'), `${p} → 200 text/html`, r.status === 200 ? ct.split(';')[0] : `получен ${r.status || 'нет соединения'}`);
}

/* ---------- 2. /api/health: 200, db и schema в порядке ---------- */
{
  const r = await get('/api/health');
  let j = {};
  try { j = await r.json(); } catch { /* тело не JSON — отметим ниже */ }
  line(r.status === 200 && j.db === true && j.schema === true, '/api/health → 200, db:true, schema:true',
    r.status === 200 ? `status=${j.status} db=${j.db} schema=${j.schema}` : `получен ${r.status || 'нет соединения'}`);
}

/* ---------- 3. /api/slots?date=<завтра по Москве>: есть свободные ---------- */
{
  const tomorrow = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() + 86_400_000));
  const r = await get(`/api/slots?date=${tomorrow}`);
  let j = {};
  try { j = await r.json(); } catch { /* не JSON */ }
  const slots = Array.isArray(j.slots) ? j.slots : [];
  const free = slots.filter((s) => s.available === true).length;
  line(r.status === 200 && free > 0, `/api/slots?date=${tomorrow} → 200, есть available:true`,
    r.status === 200 ? `слотов ${slots.length}, свободных ${free}` : `получен ${r.status || 'нет соединения'}`);
}

/* ---------- 4. robots.txt и sitemap.xml ---------- */
{
  const r = await get('/robots.txt');
  line(r.status === 200, '/robots.txt → 200', r.status === 200 ? '' : `получен ${r.status || 'нет соединения'}`);
}
{
  const r = await get('/sitemap.xml');
  const body = r.status === 200 ? await r.text() : '';
  const locs = body.match(/<loc>/g) ?? [];
  const hasPages = body.includes('/about') && body.includes('/contacts') && body.includes('/services');
  line(r.status === 200 && locs.length >= 7 && hasPages, '/sitemap.xml → 200, страницы перечислены',
    r.status === 200 ? `URL: ${locs.length}, /about+/contacts+/services: ${hasPages}` : `получен ${r.status || 'нет соединения'}`);
}

/* ---------- 5. /admin без сессии → 302 на /admin/login ---------- */
{
  const r = await get('/admin');
  const loc = r.headers.get('location') ?? '';
  let path = '';
  try { path = new URL(loc, BASE).pathname; } catch { /* битый location */ }
  line(r.status === 302 && path === '/admin/login', '/admin без сессии → 302 /admin/login', `получен ${r.status} location=${loc || '—'}`);
}

/* ---------- 6. /media/<несуществующий> → 404, не 500 ---------- */
{
  const r = await get('/media/upl_smoke_ne_sushchestvuet/master.jpg');
  line(r.status === 404, '/media/<несуществующий> → 404 (не 500)', `получен ${r.status || 'нет соединения'}`);
}

/* ---------- 7. canonical на / — указанный адрес, не localhost (для боевого url) ---------- */
{
  const r = await get('/');
  const html = r.status === 200 ? await r.text() : '';
  const m = /<link rel="canonical" href="([^"]+)"/.exec(html);
  const href = m ? m[1] : '';
  const hasOrigin = href.startsWith(ORIGIN);
  const noLocalhost = IS_LOCAL || !href.includes('localhost');
  const hint = href && !hasOrigin && IS_LOCAL
    ? ` (сервер собран с другим PUBLIC_SITE_URL — для локальной проверки пересоберите: PUBLIC_SITE_URL=${ORIGIN} npm run build)`
    : '';
  line(r.status === 200 && hasOrigin && noLocalhost, `canonical на / содержит ${ORIGIN}${IS_LOCAL ? '' : ' и не localhost'}`,
    (href ? `canonical=${href}` : `получен ${r.status || 'нет соединения'}, canonical не найден`) + hint);
}

/* ---------- итог ---------- */
console.log(`\nsmoke ${ORIGIN}: проверок ${total}, провалено ${fails}`);
process.exit(fails > 0 ? 1 : 0);
