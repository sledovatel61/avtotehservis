/* Админка: вход, блокировка, CSRF, сессия, видимость черновиков, статусы и журнал. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';

const SITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = mkdtempSync(join(tmpdir(), 'ats-adm-'));
const DIRS = { data: join(TMP, 'data'), media: join(TMP, 'media'), mail: join(TMP, 'mail') };
mkdirSync(DIRS.mail, { recursive: true });

let port = 0, srv: ChildProcess | null = null, BASE = '';
const ADMIN_LOGIN = 'owner';
const ADMIN_PASS = 'очень-надёжный-пароль-42';

function freePort(): Promise<number> {
  return new Promise((r, e) => {
    const s = net.createServer();
    s.once('error', e);
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); });
  });
}

async function dbOf<T>(sql: string, ...args: unknown[]): Promise<T[]> {
  process.env.DATA_DIR = DIRS.data;
  const { closeDb, db } = await import('../src/server/db.ts');
  closeDb();
  return db().prepare(sql).all(...args) as T[];
}

before(async () => {
  process.env.DATA_DIR = DIRS.data; process.env.MEDIA_DIR = DIRS.media;
  const { runMigrations } = await import('../scripts/migrate.ts');
  const { runSeed } = await import('../scripts/seed.ts');
  runMigrations(); runSeed();
  const { hashPassword } = await import('../src/server/auth.ts');
  const { db } = await import('../src/server/db.ts');
  db().prepare(`INSERT INTO admin_users(login, password_hash, role) VALUES(?,?, 'owner')`)
    .run(ADMIN_LOGIN, await hashPassword(ADMIN_PASS));
  port = await freePort();
  BASE = `http://127.0.0.1:${port}`;
  srv = spawn(process.execPath, [join(SITE_ROOT, 'dist/server/entry.mjs')], {
    cwd: SITE_ROOT,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), SMTP_JSON_DIR: DIRS.mail, SESSION_SECRET: 'adm-test', RATE_LIMIT_LEADS: '1000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stderr?.on('data', (d) => { if (process.env.TEST_DEBUG) console.error('[adm-srv]', String(d)); });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch { /* ждём */ }
    await new Promise((r2) => setTimeout(r2, 250));
  }
});
after(() => { srv?.kill('SIGKILL'); });

function csrfFrom(res: Response): { token: string; cookie: string } | null {
  const cookies = res.headers.getSetCookie();
  for (const c of cookies) {
    if (c.startsWith('ats_csrf=')) {
      const token = c.split(';')[0].slice('ats_csrf='.length);
      return { token, cookie: `ats_csrf=${token}` };
    }
  }
  return null;
}

let sessionCookie = '';

test('без сессии /admin → редирект на /admin/login', async () => {
  const r = await fetch(`${BASE}/admin`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(new URL(r.headers.get('location') ?? '', BASE).pathname, '/admin/login');
  const r2 = await fetch(`${BASE}/admin/leads`, { redirect: 'manual' });
  assert.equal(r2.status, 302);
});

test('вход: неверный пароль → 401, без записи сессии', async () => {
  const page = await fetch(`${BASE}/admin/login`);
  const csrf = csrfFrom(page);
  assert.ok(csrf, 'страница входа ставит CSRF-cookie');
  const r = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: csrf.cookie, Origin: BASE },
    body: new URLSearchParams({ _csrf: csrf.token, login: ADMIN_LOGIN + 'x', password: 'неверный-пароль-123' }),
    redirect: 'manual',
  });
  assert.equal(r.status, 401);
  assert.ok(!(r.headers.getSetCookie() ?? []).some((c) => c.startsWith('ats_session=')));
});

test('вход: блокировка после 5 попыток за 15 минут', async () => {
  const page = await fetch(`${BASE}/admin/login`);
  const csrf = csrfFrom(page)!;
  let lastStatus = 0, lastBody = '';
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${BASE}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: csrf.cookie, Origin: BASE },
      body: new URLSearchParams({ _csrf: csrf.token, login: 'locktest', password: 'неверный-пароль-123' }),
    });
    lastStatus = r.status;
    lastBody = await r.text();
  }
  assert.equal(lastStatus, 401);
  assert.ok(lastBody.includes('Слишком много попыток'), 'сообщение о блокировке');
});

test('вход: ротация первого значения X-Forwarded-For не обходит блокировку (блокер ревью round5)', async () => {
  const attempt = async (csrf: { token: string; cookie: string }, headers: Record<string, string>, login: string): Promise<Response> =>
    fetch(`${BASE}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: csrf.cookie, Origin: BASE, ...headers },
      body: new URLSearchParams({ _csrf: csrf.token, login, password: 'неверный-пароль-123' }),
    });

  // Имитация nginx: реальный адрес в X-Real-IP и в конце XFF, первое значение XFF атакующий ротирует.
  const page1 = await fetch(`${BASE}/admin/login`);
  const csrf1 = csrfFrom(page1)!;
  let lastStatus = 0, lastBody = '';
  for (let i = 0; i < 6; i++) {
    const r = await attempt(csrf1, { 'X-Real-IP': '203.0.113.77', 'X-Forwarded-For': `9.9.9.${i}, 203.0.113.77` }, 'xfflock-a');
    lastStatus = r.status; lastBody = await r.text();
  }
  assert.equal(lastStatus, 401);
  assert.ok(lastBody.includes('Слишком много попыток'), 'блокировка на 6-й попытке при ротации первого значения XFF');

  // Без X-Real-IP (старая схема прокси) — ключом служит ПОСЛЕДНИЙ элемент XFF, результат тот же.
  const page2 = await fetch(`${BASE}/admin/login`);
  const csrf2 = csrfFrom(page2)!;
  for (let i = 0; i < 6; i++) {
    const r = await attempt(csrf2, { 'X-Forwarded-For': `9.9.8.${i}, 203.0.113.78` }, 'xfflock-b');
    lastStatus = r.status; lastBody = await r.text();
  }
  assert.equal(lastStatus, 401);
  assert.ok(lastBody.includes('Слишком много попыток'), 'блокировка работает и без X-Real-IP, по последнему элементу XFF');
});

test('CSRF: POST без совпадения cookie/поля → 403', async () => {
  const page = await fetch(`${BASE}/admin/login`);
  const csrf = csrfFrom(page)!;
  const r = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: csrf.cookie, Origin: BASE },
    body: new URLSearchParams({ _csrf: 'подделка', login: ADMIN_LOGIN, password: ADMIN_PASS }),
  });
  assert.equal(r.status, 403);
  // чужой Origin — тоже отказ
  const r2 = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: csrf.cookie, Origin: 'https://evil.example' },
    body: new URLSearchParams({ _csrf: csrf.token, login: ADMIN_LOGIN, password: ADMIN_PASS }),
  });
  assert.equal(r2.status, 403);
});

test('успешный вход → сессия, дашборд, журнал login', async () => {
  const page = await fetch(`${BASE}/admin/login`);
  const csrf = csrfFrom(page)!;
  const r = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: csrf.cookie, Origin: BASE },
    body: new URLSearchParams({ _csrf: csrf.token, login: ADMIN_LOGIN, password: ADMIN_PASS }),
    redirect: 'manual',
  });
  assert.equal(r.status, 302);
  const sess = r.headers.getSetCookie().find((c) => c.startsWith('ats_session='));
  assert.ok(sess, 'сессия установлена');
  assert.ok(sess.includes('HttpOnly'), 'httpOnly');
  assert.ok(sess.includes('SameSite=Lax') || sess.includes('samesite=lax'), 'SameSite=Lax');
  sessionCookie = `${csrf.cookie}; ${sess.split(';')[0]}`;
  const dash = await fetch(`${BASE}/admin`, { headers: { Cookie: sessionCookie } });
  assert.equal(dash.status, 200);
  const html = await dash.text();
  assert.ok(html.includes('Дашборд') && html.includes('noindex'));
  const logs = await dbOf<{ action: string }>(`SELECT action FROM audit_log WHERE action='login'`);
  assert.ok(logs.length >= 1, 'вход записан в журнал');
});

test('заявка с сайта видна в админке; смена статуса + журнал', async () => {
  const lead = await fetch(`${BASE}/api/leads`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Админ Тест', phone: '+79289065700', contact_method: 'call',
      car: { brand: 'Kia', model: 'Rio', year: 2020, vin: null, mileage: null },
      services: ['balansirovka'], preferred: { date: null, slot: null, asap: true },
      photos: [], consent: true, consent_version: '2026-10-21', page: 'appointment',
      idempotency_key: crypto.randomUUID(), honeypot: '', form_started_at: Date.now() - 60000,
    }),
  });
  const j = await lead.json() as { lead_id: number; ticket: string };
  assert.equal(lead.status, 201);
  const list = await fetch(`${BASE}/admin/leads`, { headers: { Cookie: sessionCookie } });
  const listHtml = await list.text();
  assert.ok(listHtml.includes(j.ticket), 'талон виден в списке');

  const page = await fetch(`${BASE}/admin/leads/${j.lead_id}`, { headers: { Cookie: sessionCookie } });
  const csrf = csrfFrom(page) ?? { token: sessionCookie.match(/ats_csrf=([^;]+)/)?.[1] ?? '', cookie: '' };
  const r = await fetch(`${BASE}/admin/leads/${j.lead_id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sessionCookie, Origin: BASE },
    body: new URLSearchParams({ _csrf: csrf.token, action: 'status', status: 'confirmed' }),
    redirect: 'manual',
  });
  assert.equal(r.status, 302);
  const row = await dbOf<{ status: string }>('SELECT status FROM leads WHERE id=?', j.lead_id);
  assert.equal(row[0]?.status, 'confirmed');
  const logs = await dbOf<{ action: string }>(`SELECT action FROM audit_log WHERE action='lead_status'`);
  assert.ok(logs.length >= 1, 'смена статуса в журнале');
});

test('черновик кейса не виден публично; публикация — виден; скрытие — снова нет', async () => {
  const { db } = await import('../src/server/db.ts');
  db().prepare(`INSERT INTO cases(slug,title,description,status,sort) VALUES('testovyy-keys','Тестовый кейс ХХХ','описание','draft',0)`).run();
  let home = await (await fetch(`${BASE}/`)).text();
  assert.ok(!home.includes('Тестовый кейс ХХХ'), 'черновик не на главной');
  db().prepare(`UPDATE cases SET status='published', published_at=datetime('now'), cover_static='/img/case-1.svg' WHERE slug='testovyy-keys'`).run();
  home = await (await fetch(`${BASE}/`)).text();
  assert.ok(home.includes('Тестовый кейс ХХХ'), 'опубликованный кейс на главной');
  db().prepare(`UPDATE cases SET status='draft' WHERE slug='testovyy-keys'`).run();
  home = await (await fetch(`${BASE}/`)).text();
  assert.ok(!home.includes('Тестовый кейс ХХХ'), 'скрытый кейс снова не виден');
  db().prepare(`DELETE FROM cases WHERE slug='testovyy-keys'`).run();
});

test('черновик новости: 404 публично, публикация — 200', async () => {
  const { db } = await import('../src/server/db.ts');
  db().prepare(`INSERT INTO news(slug,title,body_md,category,status) VALUES('testovaya-novost','Тестовая новость','# Текст','sovety','draft')`).run();
  assert.equal((await fetch(`${BASE}/news/testovaya-novost`)).status, 404);
  db().prepare(`UPDATE news SET status='published', published_at=datetime('now') WHERE slug='testovaya-novost'`).run();
  const r = await fetch(`${BASE}/news/testovaya-novost`);
  assert.equal(r.status, 200);
  assert.ok((await r.text()).includes('Тестовая новость'));
  const listHtml = await (await fetch(`${BASE}/news`)).text();
  assert.ok(listHtml.includes('Тестовая новость'), 'статья в списке');
  db().prepare(`DELETE FROM news WHERE slug='testovaya-novost'`).run();
});

test('медиа: обложка опубликованного кейса защищена от удаления из библиотеки (M1 ревью round4)', async () => {
  const csrfToken = sessionCookie.match(/ats_csrf=([^;]+)/)?.[1] ?? '';
  // 1) Фото через публичный API — медиа в библиотеке, attached_to = NULL (сценарий ревью).
  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 80, height: 60, channels: 3, background: { r: 12, g: 34, b: 56 } } }).png().toBuffer();
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'cover.png');
  const up = await fetch(`${BASE}/api/uploads`, { method: 'POST', body: fd });
  assert.equal(up.status, 201);
  const { id: mid } = await up.json() as { id: string };
  const attached0 = await dbOf<{ attached_to: string | null }>(`SELECT attached_to FROM media WHERE id=?`, mid);
  assert.equal(attached0[0]?.attached_to, null, 'загрузка из библиотеки не привязана');

  // 2) Опубликованный кейс с этой обложкой.
  const { db } = await import('../src/server/db.ts');
  db().prepare(`INSERT INTO cases(slug,title,description,status,published_at,sort,cover_media_id)
    VALUES('keys-s-oblozhkoy','Кейс с обложкой МММ','описание','published',datetime('now'),0,?)`).run(mid);
  const caseRow = await dbOf<{ id: number }>(`SELECT id FROM cases WHERE slug='keys-s-oblozhkoy'`);
  const caseId = caseRow[0]!.id;

  const del = (): Promise<Response> => fetch(`${BASE}/admin/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sessionCookie, Origin: BASE },
    body: new URLSearchParams({ _csrf: csrfToken, action: 'delete', id: mid }),
    redirect: 'manual',
  });

  // 3) Точный сценарий ревью: attached_to NULL, но медиа — обложка опубликованного кейса → отказ.
  let r = await del();
  assert.equal(r.status, 302);
  let loc = r.headers.get('location') ?? '';
  assert.ok(loc.includes('err='), 'удаление обложки опубликованного кейса отклонено (проверка по факту использования)');
  assert.ok(!loc.includes('msg='), 'это отказ, а не «Медиа удалено»');
  assert.equal((await dbOf(`SELECT id FROM media WHERE id=?`, mid)).length, 1, 'строка media на месте');
  assert.ok(existsSync(join(DIRS.media, mid)), 'файлы на диске на месте');

  // 4) «Сделать обложкой» через карточку кейса дополнительно привязывает медиа (защита №1).
  const cov = await fetch(`${BASE}/admin/cases/${caseId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sessionCookie, Origin: BASE },
    body: new URLSearchParams({ _csrf: csrfToken, action: 'cover', media_id: mid }),
    redirect: 'manual',
  });
  assert.equal(cov.status, 302);
  const attached1 = await dbOf<{ attached_to: string | null }>(`SELECT attached_to FROM media WHERE id=?`, mid);
  assert.equal(attached1[0]?.attached_to, `case:${caseId}`, 'после «Сделать обложкой» медиа привязано к кейсу');

  // 5) Повторное удаление — тоже отказ (двойная защита).
  r = await del();
  loc = r.headers.get('location') ?? '';
  assert.ok(loc.includes('err='), 'удаление по-прежнему отклоняется');
  assert.equal((await dbOf(`SELECT id FROM media WHERE id=?`, mid)).length, 1);

  db().prepare(`DELETE FROM cases WHERE slug='keys-s-oblozhkoy'`).run();
  db().prepare(`UPDATE media SET attached_to=NULL WHERE id=?`).run(mid);
});

test('настройки: пустые рейтинги не убивают публичные страницы, форма возвращает строки (B1 ревью round4)', async () => {
  const csrfToken = sessionCookie.match(/ats_csrf=([^;]+)/)?.[1] ?? '';
  const rows = await dbOf<{ key: string; value: string }>(`SELECT key, value FROM settings`);
  const cur: Record<string, any> = {};
  for (const r of rows) { try { cur[r.key] = JSON.parse(r.value); } catch { /* дефолты getSettings */ } }

  const form = (ratings: Array<{ source: string; value: string; count: number; note: string; url: string }>): URLSearchParams => {
    const p = new URLSearchParams({
      _csrf: csrfToken,
      site_name: String(cur.site_name ?? 'АвтоТехСервис'), hours: String(cur.hours ?? 'ежедневно 9:00–19:00'),
      slot_capacity: String(cur.slot_capacity ?? 2),
      phone_main: String(cur.phone_main ?? '+7 (928) 906-57-00'),
      phone_main_tel: String(cur.phone_main_tel ?? '+79289065700'),
      e0_title: String(cur.phones_extra?.[0]?.title ?? ''), e0_display: String(cur.phones_extra?.[0]?.display ?? ''), e0_tel: String(cur.phones_extra?.[0]?.tel ?? ''),
      e1_title: String(cur.phones_extra?.[1]?.title ?? ''), e1_display: String(cur.phones_extra?.[1]?.display ?? ''), e1_tel: String(cur.phones_extra?.[1]?.tel ?? ''),
      telegram_phone: String(cur.telegram_phone ?? ''), telegram_url: String(cur.telegram_url ?? ''),
      email: String(cur.email ?? 'avtotehservis439@mail.ru'),
      address_full: String(cur.address_full ?? ''), address: String(cur.address ?? ''), address_short: String(cur.address_short ?? ''),
      landmark: String(cur.landmark ?? ''),
      lat: String(cur.coords?.lat ?? 47.193068), lon: String(cur.coords?.lon ?? 39.648295),
      map_link: String(cur.map_link ?? ''),
      legal_name: String(cur.legal?.name ?? ''), legal_inn: String(cur.legal?.inn ?? ''), legal_ogrnip: String(cur.legal?.ogrnip ?? ''),
      consent_version: String(cur.consent_version ?? '2026-10-21'),
      brands: Array.isArray(cur.brands) ? cur.brands.join('\n') : '',
    });
    if (cur.ratings_visible) p.set('ratings_visible', '1');
    ratings.forEach((r, i) => {
      p.set(`r${i}_source`, r.source); p.set(`r${i}_value`, r.value);
      p.set(`r${i}_count`, String(r.count)); p.set(`r${i}_note`, r.note); p.set(`r${i}_url`, r.url);
    });
    return p;
  };
  const save = (ratings: Parameters<typeof form>[0]): Promise<Response> => fetch(`${BASE}/admin/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sessionCookie, Origin: BASE },
    body: form(ratings),
    redirect: 'manual',
  });

  // Форма всегда показывает три строки рейтингов — даже при пустом списке.
  const page = await fetch(`${BASE}/admin/settings`, { headers: { Cookie: sessionCookie } });
  const html = await page.text();
  assert.equal((html.match(/name="r\d_source"/g) ?? []).length, 3, 'в форме всегда 3 строки рейтингов');

  // Штатное действие владельца: очистить источники → сохранить.
  const r1 = await save([]);
  assert.equal(r1.status, 302);
  assert.ok((r1.headers.get('location') ?? '').includes('msg='));
  const empty = await dbOf<{ value: string }>(`SELECT value FROM settings WHERE key='ratings'`);
  assert.equal(empty[0]?.value, '[]', 'рейтинги сохранены пустыми');
  assert.equal((await fetch(`${BASE}/`)).status, 200, 'главная жива после очистки рейтингов');
  assert.equal((await fetch(`${BASE}/about`)).status, 200, '/about жив после очистки рейтингов');

  // minor-2: tel: не теряет «+» после сохранения.
  const tel = await dbOf<{ value: string }>(`SELECT value FROM settings WHERE key='phone_main_tel'`);
  const telVal = String(JSON.parse(String(tel[0]?.value ?? '""')));
  assert.ok(telVal.startsWith('+7'), `phone_main_tel хранится с «+»: ${telVal}`);

  // Возврат рейтингов через ту же форму (без правки БД) — страницы живы.
  const r2 = await save([{ source: 'Яндекс.Карты', value: '4.9', count: 42, note: 'проверка', url: 'https://yandex.ru/maps/' }]);
  assert.equal(r2.status, 302);
  const back = await dbOf<{ value: string }>(`SELECT value FROM settings WHERE key='ratings'`);
  const parsed = JSON.parse(back[0]?.value ?? '[]') as unknown[];
  assert.equal(parsed.length, 1, 'строка рейтинга вернулась через админку');
  assert.equal((await fetch(`${BASE}/`)).status, 200);
});

test('выход из админки', async () => {
  const csrfToken = sessionCookie.match(/ats_csrf=([^;]+)/)?.[1] ?? '';
  const r = await fetch(`${BASE}/admin/logout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: sessionCookie, Origin: BASE },
    body: new URLSearchParams({ _csrf: csrfToken }),
    redirect: 'manual',
  });
  assert.equal(r.status, 302);
  const after = await fetch(`${BASE}/admin`, { headers: { Cookie: sessionCookie }, redirect: 'manual' });
  assert.equal(after.status, 302, 'сессия уничтожена');
});

test('видео: без ffmpeg обязателен постер; с постером — принимается', async () => {
  const { processVideoUpload, detectVideo } = await import('../src/server/video.ts');
  const mp4Head = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(64)]);
  assert.equal(detectVideo(mp4Head), 'mp4');
  assert.equal(detectVideo(Buffer.from('<svg/>')), null);
  delete process.env.FFMPEG_PATH;
  assert.throws(() => processVideoUpload(mp4Head, null), /постер/i, 'без постера — отказ');
  const poster = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64)]);
  const v = processVideoUpload(mp4Head, poster);
  assert.match(v.id, /^vid_/);
  assert.equal(v.mime, 'video/mp4');
});
