/*
 * Круг 85, задание 85-2 (Агент 11): раздел «Цены и услуги» в серверной админке.
 *
 * Тест поднимает настоящий сервер (dist/server/entry.mjs) и ходит по нему как браузер:
 * вход → /admin/prices → правка → сохранение. Файл цен при этом подменяется копией во
 * временном каталоге (PRICES_FILE), чтобы тест не трогал `content/prices.json` репозитория.
 *
 * Что проверяется:
 *  1. без сессии раздел недоступен, а «Скачать файл цен» не отдаёт цены;
 *  2. правка цены → файл изменился → дата обновилась → запись в /admin/log;
 *  3. добавление строки встаёт в КОНЕЦ категории;
 *  4. скрытие не удаляет строку физически (hidden: true) и убирает её с экрана;
 *  5. битая цена отклоняется по-русски, файл не меняется;
 *  6. CSRF: без токена — отказ, файл не меняется;
 *  7. «Сохранить всё» сохраняет несколько категорий за один POST;
 *  8. в интерфейсе нет слов JSON/API/коммит/репозиторий/токен;
 *  9. атомарность и last-write-wins: правка из /manage/ между чтением и записью не теряется;
 * 10. роль: раздел доступен обычному пользователю (не только владельцу).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';

const SITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = mkdtempSync(join(tmpdir(), 'ats-prices-'));
const DIRS = { data: join(TMP, 'data'), media: join(TMP, 'media'), mail: join(TMP, 'mail') };
mkdirSync(DIRS.mail, { recursive: true });
DIRS.media = DIRS.media;
mkdirSync(DIRS.media, { recursive: true });

/** Копия файла цен на время теста: правки не должны попадать в репозиторий. */
const PRICES_COPY = join(TMP, 'prices.json');
copyFileSync(join(SITE_ROOT, 'content/prices.json'), PRICES_COPY);

const ADMIN_LOGIN = 'master';
const ADMIN_PASS = 'пароль-мастера-42';

let port = 0, srv: ChildProcess | null = null, BASE = '';
let sessionCookie = '';
let csrf = { token: '', cookie: '' };

function freePort(): Promise<number> {
  return new Promise((r, e) => {
    const s = net.createServer();
    s.once('error', e);
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); });
  });
}

function prices(): Record<string, any> {
  return JSON.parse(readFileSync(PRICES_COPY, 'utf8'));
}

function csrfFrom(res: Response): { token: string; cookie: string } | null {
  for (const c of res.headers.getSetCookie()) {
    if (c.startsWith('ats_csrf=')) {
      const token = c.split(';')[0].slice('ats_csrf='.length);
      return { token, cookie: `ats_csrf=${token}` };
    }
  }
  return null;
}

/** POST формы от имени вошедшего мастера. */
async function post(fields: Record<string, string> | URLSearchParams, opts: { cookie?: string; withCsrf?: boolean } = {}): Promise<Response> {
  const body = fields instanceof URLSearchParams ? fields : new URLSearchParams(fields);
  if (opts.withCsrf !== false) body.set('_csrf', csrf.token);
  return fetch(`${BASE}/admin/prices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: opts.cookie ?? `${csrf.cookie}; ${sessionCookie}`,
      Origin: BASE,
    },
    body,
    redirect: 'manual',
  });
}

before(async () => {
  process.env.DATA_DIR = DIRS.data;
  process.env.MEDIA_DIR = DIRS.media;
  const { runMigrations } = await import('../scripts/migrate.ts');
  const { runSeed } = await import('../scripts/seed.ts');
  runMigrations();
  runSeed();
  const { hashPassword } = await import('../src/server/auth.ts');
  const { db } = await import('../src/server/db.ts');
  /* Роль НЕ owner: по заданию раздел нужен обычному мастеру, а не только владельцу. */
  db().prepare(`INSERT INTO admin_users(login, password_hash, role) VALUES(?,?, 'master')`)
    .run(ADMIN_LOGIN, await hashPassword(ADMIN_PASS));

  port = await freePort();
  BASE = `http://127.0.0.1:${port}`;
  srv = spawn(process.execPath, [join(SITE_ROOT, 'dist/server/entry.mjs')], {
    cwd: SITE_ROOT,
    env: {
      ...process.env,
      HOST: '127.0.0.1', PORT: String(port),
      SMTP_JSON_DIR: DIRS.mail, SESSION_SECRET: 'prices-test',
      PRICES_FILE: PRICES_COPY,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stderr?.on('data', (d) => { if (process.env.TEST_DEBUG) console.error('[prices-srv]', String(d)); });

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch { /* ждём */ }
    await new Promise((r2) => setTimeout(r2, 250));
  }

  /* Вход: страница логина ставит CSRF-cookie, POST логина — сессию. */
  const page = await fetch(`${BASE}/admin/login`);
  const c = csrfFrom(page)!;
  const login = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: c.cookie, Origin: BASE },
    body: new URLSearchParams({ _csrf: c.token, login: ADMIN_LOGIN, password: ADMIN_PASS }),
    redirect: 'manual',
  });
  assert.equal(login.status, 302, 'вход мастера');
  sessionCookie = (login.headers.getSetCookie() ?? []).map((x) => x.split(';')[0]).find((x) => x.startsWith('ats_session='))!;
  assert.ok(sessionCookie, 'сессия выдана');

  /* CSRF для страницы цен. */
  const pricesPage = await fetch(`${BASE}/admin/prices`, { headers: { Cookie: sessionCookie } });
  assert.equal(pricesPage.status, 200);
  csrf = csrfFrom(pricesPage) ?? c;
});

after(() => { srv?.kill('SIGKILL'); });

/* ---------- 1. доступ ---------- */

test('без сессии: /admin/prices → вход, файл цен не отдаётся', async () => {
  const r = await fetch(`${BASE}/admin/prices`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(new URL(r.headers.get('location') ?? '', BASE).pathname, '/admin/login');

  const ex = await fetch(`${BASE}/admin/prices/export`, { redirect: 'manual' });
  assert.equal(ex.status, 302, 'скачивание без сессии не отдаёт цены');
});

test('с сессией: страница открывается и показывает категории', async () => {
  const r = await fetch(`${BASE}/admin/prices`, { headers: { Cookie: sessionCookie } });
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /Цены и услуги/);
  assert.match(html, /Тормоза/);
  assert.match(html, /Шиномонтаж комплекта/);
  assert.match(html, /Voyah Free/);
  assert.match(html, /Сохранить всё/);
  assert.match(html, /Скачать файл цен/);
});

/* ---------- 2. правка цены ---------- */

test('правка цены: файл изменён, дата обновилась, запись в журнале', async () => {
  const before = prices();
  const group = before.groups.find((g: any) => g.id === 'tormoza');
  const row = group.items[0];
  const oldPrice = row.price;

  const r = await post({ action: 'save', cat: 'group:tormoza', [`price:${row.id}`]: '1400 ₽' });
  assert.equal(r.status, 302);

  const after = prices();
  const changed = after.groups.find((g: any) => g.id === 'tormoza').items[0];
  assert.equal(changed.price, '1400 ₽', 'новая цена записана');
  assert.notEqual(changed.price, oldPrice);
  assert.equal(changed.id, row.id, 'строка та же — id не пересоздан');
  assert.match(after.updated_at, /^\d{4}-\d{2}-\d{2}$/);
  /* Дата — календарный день, поэтому «стало другое» проверяется только если правка
     пришлась на другой день. Формат ГГГГ-ММ-ДД и запись файла — проверяются всегда. */
  const today = new Date().toISOString().slice(0, 10);
  if (before.updated_at !== today) {
    assert.equal(after.updated_at, today, 'дата подтверждения стала сегодняшней');
  }

  /* Журнал: одна запись на категорию, читается в /admin/log. */
  const log = await fetch(`${BASE}/admin/log`, { headers: { Cookie: sessionCookie } });
  const logHtml = await log.text();
  assert.match(logHtml, /prices_save/, 'действие попало в журнал');
  assert.match(logHtml, /group:tormoza/, 'в журнале видно, какая категория');
});

test('«Сохранить» без изменений не двигает дату подтверждения', async () => {
  const before = prices();
  const r = await post({ action: 'save', cat: 'group:tormoza', [`price:${before.groups.find((g: any) => g.id === 'tormoza').items[0].id}`]: '1400 ₽' });
  assert.equal(r.status, 302);
  assert.equal(prices().updated_at, before.updated_at, 'дата не сдвинулась от пустого нажатия');
});

/* ---------- 3. добавление строки ---------- */

test('добавление строки: встаёт в конец категории', async () => {
  const before = prices();
  const group = before.groups.find((g: any) => g.id === 'podveska');
  const countBefore = group.items.length;

  const r = await post({ action: 'add', cat: 'group:podveska', newName: 'Развал-схождение', newPrice: '1500 ₽' });
  assert.equal(r.status, 302);

  const after = prices();
  const g = after.groups.find((x: any) => x.id === 'podveska');
  assert.equal(g.items.length, countBefore + 1, 'строка добавлена');
  const added = g.items[g.items.length - 1];
  assert.equal(added.name, 'Развал-схождение');
  assert.equal(added.price, '1500 ₽');
  assert.equal(added.id, 'razval-shozhdenie', 'id из названия: латиницей');
});

test('добавление двух строк с одинаковым названием не рвёт уникальность id', async () => {
  await post({ action: 'add', cat: 'group:podveska', newName: 'Развал-схождение', newPrice: '1600 ₽' });
  const g = prices().groups.find((x: any) => x.id === 'podveska');
  const ids = g.items.map((i: any) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'id уникальны');
  assert.ok(ids.includes('razval-shozhdenie-2'), 'второй такой строке достался суффикс');
});

/* ---------- 4. скрытие ---------- */

test('скрытие: строка помечена hidden, физически не удалена и пропала с экрана', async () => {
  const row = prices().groups.find((g: any) => g.id === 'tormoza').items[1];
  /* Кнопка «Скрыть» лежит в форме сохранения и шлёт hideRow — так недописанные
     цены в этой же категории не теряются. */
  const r = await post({ action: 'save', cat: 'group:tormoza', hideRow: row.id });
  assert.equal(r.status, 302);

  const hidden = prices().groups.find((g: any) => g.id === 'tormoza').items.find((i: any) => i.id === row.id);
  assert.ok(hidden, 'строка осталась в файле');
  assert.equal(hidden.hidden, true, 'пометка hidden');
  assert.equal(hidden.name, row.name, 'история сохранена');

  const page = await (await fetch(`${BASE}/admin/prices`, { headers: { Cookie: sessionCookie } })).text();
  /* Таблица группы не должна содержать поле цены для скрытой строки… */
  assert.ok(!page.includes(`price:${row.id}`), 'скрытой строки нет в таблице цен');
  /* …а «Скрытые строки» её показывают, и оттуда можно вернуть. */
  assert.match(page, /Скрытые строки/);
});

test('«Скрыть» не теряет поправленную в той же категории цену', async () => {
  const p0 = prices();
  const g = p0.groups.find((x: any) => x.id === 'kondicioner');
  const keep = g.items[0];
  const target = g.items[1];
  const r = await post({
    action: 'save', cat: 'group:kondicioner',
    [`price:${keep.id}`]: '2100 ₽',
    hideRow: target.id,
  });
  assert.equal(r.status, 302);
  const g1 = prices().groups.find((x: any) => x.id === 'kondicioner');
  assert.equal(g1.items[0].price, '2100 ₽', 'поправленная цена сохранена вместе со скрытием');
  assert.equal(g1.items[1].hidden, true, 'строка скрыта');
});

test('скрытую строку можно вернуть', async () => {
  const row = prices().groups.find((g: any) => g.id === 'tormoza').items.find((i: any) => i.hidden);
  const r = await post({ action: 'restore', cat: 'group:tormoza', rowId: row.id });
  assert.equal(r.status, 302);
  const back = prices().groups.find((g: any) => g.id === 'tormoza').items.find((i: any) => i.id === row.id);
  assert.notEqual(back.hidden, true, 'строка снова видна');
});

/* ---------- 5. ошибки ---------- */

test('битая цена: отказ по-русски, файл не меняется', async () => {
  const before = readFileSync(PRICES_COPY, 'utf8');
  const row = prices().groups.find((g: any) => g.id === 'grm').items[0];
  const r = await post({ action: 'save', cat: 'group:grm', [`price:${row.id}`]: 'дорого' });
  assert.equal(r.status, 302);
  const loc = decodeURIComponent(r.headers.get('location') ?? '');
  assert.match(loc, /err=/, 'ошибка вернулась в адресной строке');
  assert.match(loc, /Похоже, это не цена/, 'текст ошибки — как в задании');
  assert.equal(readFileSync(PRICES_COPY, 'utf8'), before, 'файл байт в байт прежний');
});

test('«0 ₽» отклоняется: это не цена', async () => {
  const row = prices().groups.find((g: any) => g.id === 'grm').items[0];
  const r = await post({ action: 'save', cat: 'group:grm', [`price:${row.id}`]: '0 ₽' });
  const loc = decodeURIComponent(r.headers.get('location') ?? '');
  assert.match(loc, /err=/);
});

test('пустое название новой строки отклоняется', async () => {
  const r = await post({ action: 'add', cat: 'group:grm', newName: 'X', newPrice: '100 ₽' });
  const loc = decodeURIComponent(r.headers.get('location') ?? '');
  assert.match(loc, /err=/);
  assert.match(loc, /Название слишком короткое/);
});

/* ---------- 6. CSRF ---------- */

test('POST без CSRF-токена: отказ, файл не меняется', async () => {
  const before = readFileSync(PRICES_COPY, 'utf8');
  const row = prices().groups.find((g: any) => g.id === 'to').items[0];
  const r = await post({ action: 'save', cat: 'group:to', [`price:${row.id}`]: '999 ₽' }, { withCsrf: false });
  assert.equal(r.status, 302);
  const loc = decodeURIComponent(r.headers.get('location') ?? '');
  assert.match(loc, /CSRF/);
  assert.equal(readFileSync(PRICES_COPY, 'utf8'), before);
});

test('POST с чужим Origin: отказ', async () => {
  const before = readFileSync(PRICES_COPY, 'utf8');
  const row = prices().groups.find((g: any) => g.id === 'to').items[0];
  const r = await fetch(`${BASE}/admin/prices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: `${csrf.cookie}; ${sessionCookie}`, Origin: 'https://evil.example' },
    body: new URLSearchParams({ _csrf: csrf.token, action: 'save', cat: 'group:to', [`price:${row.id}`]: '999 ₽' }),
    redirect: 'manual',
  });
  assert.equal(r.status, 302);
  assert.equal(readFileSync(PRICES_COPY, 'utf8'), before, 'чужой источник не изменил файл');
});

/* ---------- 7. «Сохранить всё» ---------- */

test('«Сохранить всё»: две категории за один POST', async () => {
  const p = prices();
  const a = p.groups.find((g: any) => g.id === 'diagnostika').items[0];
  const b = p.groups.find((g: any) => g.id === 'svarka').items[0];
  /* Категории передаёт скрипт страницы — только те, где есть правки. */
  const body = new URLSearchParams({
    action: 'saveAll',
    catAll: 'group:diagnostika',
    [`price:${a.id}`]: '600 ₽',
  });
  body.append('catAll', 'group:svarka');
  body.set(`price:${b.id}`, 'от 1700 ₽ за место');
  const r = await post(body);
  assert.equal(r.status, 302);

  const after = prices();
  assert.equal(after.groups.find((g: any) => g.id === 'diagnostika').items[0].price, '600 ₽');
  assert.equal(after.groups.find((g: any) => g.id === 'svarka').items[0].price, 'от 1700 ₽ за место');
  const loc = decodeURIComponent(r.headers.get('location') ?? '');
  assert.match(loc, /изменено 2/);
});

/* ---------- 8. тексты ---------- */

test('в интерфейсе нет технических слов', async () => {
  const html = await (await fetch(`${BASE}/admin/prices`, { headers: { Cookie: sessionCookie } })).text();
  /* Берём только видимый текст: скрипт и стили в счёт не идут. */
  const visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  for (const word of ['JSON', 'API', 'коммит', 'репозитори', 'токен']) {
    assert.ok(!new RegExp(word, 'i').test(visible), `в тексте для мастера нет слова «${word}»`);
  }
  assert.ok(!/мгновенно/i.test(visible), 'нет обещания мгновенного обновления сайта');
  assert.match(visible, /после публикации/i, 'честно сказано, когда изменения попадут на сайт');
});

/* ---------- 9. скачивание ---------- */

test('«Скачать файл цен»: отдаёт валидный файл как вложение, без кеша', async () => {
  const r = await fetch(`${BASE}/admin/prices/export`, { headers: { Cookie: sessionCookie } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition') ?? '', /attachment; filename=prices\.json/);
  assert.match(r.headers.get('cache-control') ?? '', /no-store/);
  const text = await r.text();
  const parsed = JSON.parse(text);
  assert.ok(Array.isArray(parsed.groups));
  assert.equal(text, readFileSync(PRICES_COPY, 'utf8'), 'отдан именно файл, байт в байт');
});

/* ---------- 10. парадокс «двух правок»: last-write-wins по строке ---------- */

test('чужая правка между чтением и записью не теряется (last-write-wins по строке)', async () => {
  const { readPrices, applyChanges } = await import('../src/server/prices-admin-store.ts');

  /* Путь к файлу — тот же, что у сервера: тест и сервер смотрят в одну копию. */
  process.env.PRICES_FILE = PRICES_COPY;
  const start = readPrices();
  const group = start.groups.find((g) => g.id === 'to')!;
  const mine = group.items[0];
  const theirs = group.items[1];

  /* Пока мастер думал, «/manage/» поправил СОСЕДНЮЮ строку прямо в файле. */
  const edited = JSON.parse(readFileSync(PRICES_COPY, 'utf8'));
  edited.groups.find((g: any) => g.id === 'to').items[1].price = '1777 ₽';
  writeFileSync(PRICES_COPY, JSON.stringify(edited, null, 2) + '\n');

  /* Теперь сохраняет мастер — свою строку. */
  applyChanges('group:to', { [mine.id]: { price: '1111 ₽' } });

  const after = JSON.parse(readFileSync(PRICES_COPY, 'utf8'));
  const items = after.groups.find((g: any) => g.id === 'to').items;
  assert.equal(items.find((i: any) => i.id === mine.id).price, '1111 ₽', 'правка мастера записана');
  assert.equal(items.find((i: any) => i.id === theirs.id).price, '1777 ₽', 'чужая правка не откатилась');
});

test('запись атомарная: временного файла после сохранения нет', async () => {
  assert.ok(!existsSync(`${PRICES_COPY}.tmp`), 'prices.json.tmp убран через rename');
});
