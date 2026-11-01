import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';

const SITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = mkdtempSync(join(tmpdir(), 'ats-int-'));
const A = { data: join(TMP, 'a-data'), media: join(TMP, 'a-media'), mail: join(TMP, 'a-mail') };
const B = { data: join(TMP, 'b-data'), media: join(TMP, 'b-media'), mail: join(TMP, 'b-mail') };
// Сервер C: пустой DATA_DIR без миграций — для проверки /api/health → 503 degraded (M6 ревью).
const C = { data: join(TMP, 'c-data'), media: join(TMP, 'c-media'), mail: join(TMP, 'c-mail') };
mkdirSync(C.data, { recursive: true }); mkdirSync(C.media, { recursive: true }); mkdirSync(C.mail, { recursive: true });
// Сервер D: двухуровневые лимиты заявок (M2 ревью round4) — жёсткий IP-уровень маленький, чтобы проверить ротацию cookie.
const D = { data: join(TMP, 'd-data'), media: join(TMP, 'd-media'), mail: join(TMP, 'd-mail') };
mkdirSync(D.mail, { recursive: true });
// Сервер E: клиентский IP из прокси-заголовков (блокер ревью round5) — жёсткая IP-квота 3, прочие лимиты высокие.
const E = { data: join(TMP, 'e-data'), media: join(TMP, 'e-media'), mail: join(TMP, 'e-mail') };
mkdirSync(E.mail, { recursive: true });
// Сервер F: ПУСТЫЕ RATE_LIMIT_* — как после cp старого .env.example через systemd EnvironmentFile
// (блокер ревью round5: Number('') === 0 → лимит 0 → 429 на всё). Лимиты должны браться из дефолтов.
const F = { data: join(TMP, 'f-data'), media: join(TMP, 'f-media'), mail: join(TMP, 'f-mail') };
mkdirSync(F.mail, { recursive: true });
mkdirSync(A.mail, { recursive: true }); mkdirSync(B.mail, { recursive: true });
// «SMTP недоступен» для сервера B: каталог под обычным файлом → ENOTDIR при mkdir/write (работает и от root)
const blocker = join(TMP, 'b-mail-blocker');
writeFileSync(blocker, '');
const B_MAIL_BROKEN = join(blocker, 'sub');

/* ---------- заглушка Telegram (TELEGRAM_API_BASE) ---------- */
let stubMode: 'ok' | 'fail' = 'ok';
const tgMessages: string[] = [];
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.url?.endsWith('/sendMessage')) {
      tgMessages.push(body);
      if (stubMode === 'fail') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, description: 'stub down' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: { message_id: tgMessages.length } }));
      }
    } else { res.writeHead(404); res.end('{}'); }
  });
});

function freePort(): Promise<number> {
  return new Promise((r, e) => {
    const s = net.createServer();
    s.once('error', e);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => r(p));
    });
  });
}

let stubPort = 0, portA = 0, portB = 0, portC = 0, portD = 0, portE = 0, portF = 0;
let srvA: ChildProcess | null = null, srvB: ChildProcess | null = null, srvC: ChildProcess | null = null, srvD: ChildProcess | null = null, srvE: ChildProcess | null = null, srvF: ChildProcess | null = null;

/* ---------- БД в тестовом процессе ---------- */
async function prepare(dirs: { data: string; media: string }): Promise<void> {
  process.env.DATA_DIR = dirs.data;
  process.env.MEDIA_DIR = dirs.media;
  const { closeDb } = await import('../src/server/db.ts');
  closeDb();
  const { runMigrations } = await import('../scripts/migrate.ts');
  const { runSeed } = await import('../scripts/seed.ts');
  runMigrations();
  runSeed();
}

async function rows<T>(dirs: { data: string }, sql: string, ...args: unknown[]): Promise<T[]> {
  process.env.DATA_DIR = dirs.data;
  const { closeDb, db } = await import('../src/server/db.ts');
  closeDb();
  return db().prepare(sql).all(...args) as T[];
}
async function one<T>(dirs: { data: string }, sql: string, ...args: unknown[]): Promise<T | undefined> {
  const r = await rows<T>(dirs, sql, ...args);
  return r[0];
}

async function startServer(port: number, env: Record<string, string>, ready: (r: Response) => boolean = (r) => r.ok): Promise<ChildProcess> {
  const child = spawn(process.execPath, [join(SITE_ROOT, 'dist/server/entry.mjs')], {
    cwd: SITE_ROOT,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', () => { /* слушаем, но не печатаем */ });
  child.stderr?.on('data', (d) => { if (process.env.TEST_DEBUG) console.error('[srv]', String(d)); });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (ready(r)) return child;
    } catch { /* ещё не поднялся */ }
    await new Promise((r2) => setTimeout(r2, 250));
  }
  child.kill('SIGKILL');
  throw new Error(`сервер на порту ${port} не поднялся`);
}

const tgBase = (): string => `http://127.0.0.1:${stubPort}`;

function booking(over: Record<string, unknown> = {}): Record<string, unknown> {
  const d = new Date(Date.now() + 86400000);
  const date = d.toISOString().slice(0, 10);
  return {
    name: 'Пётр Тестов', phone: '+7 (928) 906-57-00', contact_method: 'call',
    car: { brand: 'Лада (LADA)', model: 'Vesta', year: 2019, vin: null, mileage: 84000 },
    services: ['to-maslo'], preferred: { date, slot: '10:00', asap: false },
    photos: [], consent: true, consent_version: '2026-10-21', page: 'appointment',
    idempotency_key: crypto.randomUUID(), honeypot: '', form_started_at: Date.now() - 60000,
    ...over,
  };
}
const postLead = (port: number, body: unknown): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}/api/leads`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

async function pollUntil(fn: () => Promise<boolean>, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return fn();
}

before(async () => {
  stubPort = await freePort();
  await new Promise<void>((r) => stub.listen(stubPort, '127.0.0.1', r));
  await prepare(A);
  await prepare(B);
  await prepare(D);
  await prepare(E);
  await prepare(F);
  portA = await freePort(); portB = await freePort();
  srvA = await startServer(portA, {
    DATA_DIR: A.data, MEDIA_DIR: A.media, SMTP_JSON_DIR: A.mail,
    TELEGRAM_API_BASE: tgBase(), BOT_TOKEN: 'TEST:TOKEN', TELEGRAM_CHAT_ID: '42',
    SESSION_SECRET: 'test-secret', RATE_LIMIT_LEADS: '1000', RATE_LIMIT_UPLOADS: '1000',
    RATE_LIMIT_ANTIFLOOD: '1000',
  });
  srvB = await startServer(portB, {
    DATA_DIR: B.data, MEDIA_DIR: B.media, SMTP_JSON_DIR: B_MAIL_BROKEN,
    TELEGRAM_API_BASE: tgBase(), BOT_TOKEN: 'TEST:TOKEN', TELEGRAM_CHAT_ID: '42',
    SESSION_SECRET: 'test-secret', RATE_LIMIT_LEADS: '4', RATE_LIMIT_UPLOADS: '1000',
    RATE_LIMIT_ANTIFLOOD: '1000',
  });
  portC = await freePort();
  srvC = await startServer(portC, {
    DATA_DIR: C.data, MEDIA_DIR: C.media, SMTP_JSON_DIR: C.mail, SESSION_SECRET: 'test-secret',
  }, () => true); // health у C отвечает 503 (схемы нет) — ждём любого ответа
  portD = await freePort();
  srvD = await startServer(portD, {
    DATA_DIR: D.data, MEDIA_DIR: D.media, SMTP_JSON_DIR: D.mail,
    TELEGRAM_API_BASE: tgBase(), BOT_TOKEN: 'TEST:TOKEN', TELEGRAM_CHAT_ID: '42',
    SESSION_SECRET: 'test-secret',
    RATE_LIMIT_LEADS: '5', RATE_LIMIT_LEADS_IP: '8',
    RATE_LIMIT_ANTIFLOOD: '1000', RATE_LIMIT_ANTIFLOOD_IP: '16', RATE_LIMIT_UPLOADS: '1000',
  });
  portE = await freePort();
  srvE = await startServer(portE, {
    DATA_DIR: E.data, MEDIA_DIR: E.media, SMTP_JSON_DIR: E.mail,
    TELEGRAM_API_BASE: tgBase(), BOT_TOKEN: 'TEST:TOKEN', TELEGRAM_CHAT_ID: '42',
    SESSION_SECRET: 'test-secret',
    RATE_LIMIT_LEADS: '1000', RATE_LIMIT_LEADS_IP: '3',
    RATE_LIMIT_ANTIFLOOD: '1000', RATE_LIMIT_ANTIFLOOD_IP: '1000', RATE_LIMIT_UPLOADS: '1000',
  });
  portF = await freePort();
  srvF = await startServer(portF, {
    DATA_DIR: F.data, MEDIA_DIR: F.media, SMTP_JSON_DIR: F.mail,
    TELEGRAM_API_BASE: tgBase(), BOT_TOKEN: 'TEST:TOKEN', TELEGRAM_CHAT_ID: '42',
    SESSION_SECRET: 'test-secret',
    // Пустые строки — ровно то, что systemd подставляет из `VAR=` (старый .env.example).
    RATE_LIMIT_LEADS: '', RATE_LIMIT_LEADS_IP: '',
    RATE_LIMIT_ANTIFLOOD: '', RATE_LIMIT_ANTIFLOOD_IP: '', RATE_LIMIT_UPLOADS: '',
  });
});

after(() => {
  srvA?.kill('SIGKILL'); srvB?.kill('SIGKILL'); srvC?.kill('SIGKILL'); srvD?.kill('SIGKILL'); srvE?.kill('SIGKILL'); srvF?.kill('SIGKILL');
  stub.close();
});

test('health: 200, без секретов', async () => {
  const r = await fetch(`http://127.0.0.1:${portA}/api/health`);
  assert.equal(r.status, 200);
  const j = await r.json() as Record<string, unknown>;
  assert.equal(j.status, 'ok');
  assert.equal(j.db, true);
  assert.ok(!JSON.stringify(j).includes('TOKEN'));
});

test('health: 503 degraded без схемы БД и проверка записываемости каталогов (M6)', async () => {
  const r = await fetch(`http://127.0.0.1:${portC}/api/health`);
  assert.equal(r.status, 503, 'без накатанной схемы health не должен рапортовать ok');
  const j = await r.json() as Record<string, unknown>;
  assert.equal(j.status, 'degraded');
  assert.equal(j.db, true, 'файл БД открывается');
  assert.equal(j.schema, false, 'схема не накатана');
  assert.equal(j.data_writable, true);
  assert.equal(j.media_writable, true);
});

test('пустые рейтинги: settings.ratings=[] не роняет / и /about (B1 ревью round4)', async () => {
  // Штатное действие владельца — очистить неподтверждённые рейтинги. Раньше / и /about
  // отвечали 500 (S.ratings[0].url), теперь страницы живы.
  process.env.DATA_DIR = A.data; process.env.MEDIA_DIR = A.media;
  const { closeDb, db } = await import('../src/server/db.ts');
  closeDb();
  const prev = (db().prepare(`SELECT value FROM settings WHERE key='ratings'`).get() as { value: string } | undefined)?.value ?? '[]';
  db().prepare(`UPDATE settings SET value='[]' WHERE key='ratings'`).run();
  try {
    assert.equal((await fetch(`http://127.0.0.1:${portA}/`)).status, 200, 'главная жива при ratings=[]');
    assert.equal((await fetch(`http://127.0.0.1:${portA}/about`)).status, 200, '/about жив при ratings=[]');
  } finally {
    db().prepare(`UPDATE settings SET value=? WHERE key='ratings'`).run(prev);
    closeDb();
  }
});

test('двухуровневые лимиты: ротация ats_cid не обходит жёсткую квоту по IP (M2 ревью round4)', async () => {
  // Сервер D: мягкая квота 5/ч (IP+cookie), жёсткая 8/ч (только IP), антифлуд IP 16/10мин.
  const post = (cid: string | null, body: unknown): Promise<Response> =>
    fetch(`http://127.0.0.1:${portD}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cid ? { Cookie: `ats_cid=${cid}` } : {}) },
      body: JSON.stringify(body),
    });
  const asap = (): Record<string, unknown> => booking({ preferred: { date: null, slot: null, asap: true } });

  // Мягкий уровень: 5 заявок с ОДНОЙ cookie — проходят (IP-квота 8 ещё не исчерпана).
  const sameCookie: number[] = [];
  for (let i = 0; i < 5; i++) sameCookie.push((await post('cid-same', asap())).status);
  assert.deepEqual(sameCookie, [201, 201, 201, 201, 201], 'обычные 5 заявок с одной cookie по-прежнему проходят');

  // Ротация cookie: мягкая квота сбрасывается, но жёсткая IP-квота (8) срабатывает на 9-й.
  const rotated: number[] = [];
  for (let i = 0; i < 5; i++) rotated.push((await post(`cid-rot-${i}`, asap())).status);
  assert.deepEqual(rotated, [201, 201, 201, 429, 429], 'после 8 успешных с IP разные cookie не помогают');

  // Жёсткий антифлуд по IP: невалидные запросы с ротацией cookie тоже упираются в 429.
  const flood: number[] = [];
  for (let i = 0; i < 10; i++) flood.push((await post(`cid-flood-${i}`, { name: 'x', phone: '1' })).status);
  assert.equal(flood[0], 400, 'первый мусорный — обычная валидация');
  assert.ok(flood.includes(429), 'антифлуд по IP (16/10 мин) срабатывает несмотря на ротацию cookie');
});

test('IP клиента из прокси-заголовков: ротация XFF не обходит квоту, разные X-Real-IP не мешают (блокер ревью round5)', async () => {
  // Сервер E: жёсткая квота RATE_LIMIT_LEADS_IP=3. Имитация nginx из deploy/nginx.conf:
  // реальный адрес попадает в X-Real-IP и В КОНЕЦ XFF (схема $proxy_add_x_forwarded_for
  // дописывает его после клиентского значения); первый элемент XFF — подконтролен атакующему.
  const post = (headers: Record<string, string>, cid: string, body: unknown): Promise<Response> =>
    fetch(`http://127.0.0.1:${portE}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `ats_cid=${cid}`, ...headers },
      body: JSON.stringify(body),
    });
  const asap = (): Record<string, unknown> => booking({ preferred: { date: null, slot: null, asap: true } });

  // Первые 3 заявки с реального IP 203.0.113.9 — проходят (лимит 3).
  const first: number[] = [];
  for (let i = 1; i <= 3; i++) {
    first.push((await post({ 'X-Real-IP': '203.0.113.9', 'X-Forwarded-For': `10.0.0.${i}, 203.0.113.9` }, `xff-e-${i}`, asap())).status);
  }
  assert.deepEqual(first, [201, 201, 201], 'первые 3 заявки с реального IP проходят');

  // 4–10-я: X-Real-IP нет, но последний элемент XFF тот же (его дописал прокси) —
  // первый элемент каждый раз новый. До правки каждый получал бы свой бакет.
  const rest: number[] = [];
  for (let i = 4; i <= 10; i++) {
    rest.push((await post({ 'X-Forwarded-For': `10.0.0.${i}, 203.0.113.9` }, `xff-e-${i}`, asap())).status);
  }
  assert.ok(rest.every((s) => s === 429), `4-й и далее — 429 несмотря на ротацию первого значения XFF (получили: ${rest.join(',')})`);

  // Обратное: два разных реальных клиента не мешают друг другу (мягкий уровень тоже жив).
  const two: number[] = [];
  for (const ip of ['203.0.113.10', '203.0.113.11']) {
    for (let i = 1; i <= 3; i++) {
      two.push((await post({ 'X-Real-IP': ip, 'X-Forwarded-For': `10.9.9.${i}, ${ip}` }, `two-${ip}-${i}`, asap())).status);
    }
  }
  assert.deepEqual(two, [201, 201, 201, 201, 201, 201], 'у каждого X-Real-IP собственный бакет');
});

test('пустые RATE_LIMIT_* (cp .env.example + systemd) не блокируют приём: заявка и загрузка → 201 (блокер ревью round5)', async () => {
  // Сервер F поднят с RATE_LIMIT_*='' — до правки Number('')=0 давал лимит 0:
  // каждая заявка и каждая загрузка получали 429. Теперь пустое значение = дефолт.
  const r = await fetch(`http://127.0.0.1:${portF}/api/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(booking({ preferred: { date: null, slot: null, asap: true } })),
  });
  assert.equal(r.status, 201, 'первая заявка принимается (до правки была 429)');
  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#09635a' } }).png().toBuffer();
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'p.png');
  const r2 = await fetch(`http://127.0.0.1:${portF}/api/uploads`, { method: 'POST', body: fd });
  assert.equal(r2.status, 201, 'первая загрузка принимается (до правки была 429)');
});

test('media: перевёрнутый Range (bytes=100-50) → 416, а не 500 (minor-1 ревью round5)', async () => {
  const dir = join(A.media, 'vid_rangetest');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'original.mp4'), Buffer.alloc(200, 7));
  const ok = await fetch(`http://127.0.0.1:${portA}/media/vid_rangetest/original.mp4`, { headers: { Range: 'bytes=0-9' } });
  assert.equal(ok.status, 206);
  assert.equal(ok.headers.get('content-range'), 'bytes 0-9/200');
  const bad = await fetch(`http://127.0.0.1:${portA}/media/vid_rangetest/original.mp4`, { headers: { Range: 'bytes=100-50' } });
  assert.equal(bad.status, 416);
  assert.equal(bad.headers.get('content-range'), 'bytes */200');
});

test('страницы и редиректы: /, /appointment, услуга, 404, .html → 301', async () => {
  const home = await fetch(`http://127.0.0.1:${portA}/`);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.ok(html.includes('АвтоТехСервис'));
  assert.ok((home.headers.get('content-security-policy') ?? '').includes("default-src 'self'"));
  assert.equal((await fetch(`http://127.0.0.1:${portA}/appointment`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${portA}/services/to-maslo`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${portA}/services/net-takoy`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${portA}/news/net-takoy`)).status, 404);
  const redir = await fetch(`http://127.0.0.1:${portA}/service.html?s=to-maslo`, { redirect: 'manual' });
  assert.equal(redir.status, 301);
  assert.equal(new URL(redir.headers.get('location') ?? '', 'http://x').pathname, '/services/to-maslo');
});

let firstTicket = '', firstLeadId = 0;

test('полный сценарий: 201 → заявка в БД → две строки outbox → telegram + email отправлены', async () => {
  const body = booking();
  const r = await postLead(portA, body);
  assert.equal(r.status, 201);
  const j = await r.json() as { ticket: string; lead_id: number; status: string; duplicate: boolean };
  assert.match(j.ticket, /^A-\d{4}-\d{4}$/);
  assert.equal(j.status, 'accepted');
  assert.equal(j.duplicate, false);
  firstTicket = j.ticket; firstLeadId = j.lead_id;

  const lead = await one<{ ticket: string; phone: string; services_json: string; ip_hash: string | null }>(
    A, 'SELECT ticket, phone, services_json, ip_hash FROM leads WHERE id=?', j.lead_id);
  assert.equal(lead?.ticket, j.ticket);
  assert.equal(lead?.phone, '+79289065700');
  assert.deepEqual(JSON.parse(lead?.services_json ?? '[]'), ['to-maslo']);
  assert.ok(lead?.ip_hash && lead.ip_hash.length === 64, 'IP хранится хешем');

  const outbox = await rows<{ channel: string; status: string }>(A, 'SELECT channel, status FROM outbox WHERE lead_id=?', j.lead_id);
  assert.equal(outbox.length, 2);

  const delivered = await pollUntil(async () => {
    const s = await rows<{ channel: string; status: string }>(A, 'SELECT channel, status FROM outbox WHERE lead_id=?', firstLeadId);
    return s.length === 2 && s.every((x) => x.status === 'sent');
  });
  assert.ok(delivered, 'оба канала доставлены');
  assert.ok(tgMessages.some((m) => m.includes(firstTicket)), 'в Telegram-сообщении есть номер заявки');
  const mails = readdirSync(A.mail).filter((f) => f.endsWith('.json'));
  assert.ok(mails.length >= 1, 'письмо записано');
  const mail = JSON.parse(readFileSync(join(A.mail, mails[mails.length - 1]), 'utf8')) as { subject: string; text: string };
  assert.ok(mail.subject.includes(firstTicket), 'в теме письма есть номер');
  assert.ok(mail.text.includes('+79289065700'), 'в письме есть телефон');
});

test('идемпотентность: повтор с тем же ключом → тот же номер, одна заявка', async () => {
  const key = crypto.randomUUID();
  const b1 = booking({ idempotency_key: key });
  const r1 = await postLead(portA, b1);
  const j1 = await r1.json() as { ticket: string; duplicate: boolean };
  assert.equal(r1.status, 201);
  assert.equal(j1.duplicate, false);
  const r2 = await postLead(portA, booking({ idempotency_key: key }));
  const j2 = await r2.json() as { ticket: string; duplicate: boolean };
  assert.equal(r2.status, 201);
  assert.equal(j2.ticket, j1.ticket);
  assert.equal(j2.duplicate, true);
  const leadRow = await one<{ id: number }>(A, 'SELECT id FROM leads WHERE ticket=?', j1.ticket);
  const ob = await rows<{ lead_id: number }>(A, 'SELECT lead_id FROM outbox WHERE lead_id=?', leadRow?.id);
  assert.equal(ob.length, 2, 'на одну заявку — ровно две строки outbox');
  const dup = await rows<{ c: number }>(A, 'SELECT COUNT(*) AS c FROM leads WHERE idempotency_key=?', key);
  assert.equal(dup[0]?.c, 1, 'заявка ровно одна');
});

test('занятый слот → 409 со списком свободных', async () => {
  const d = new Date(Date.now() + 2 * 86400000);
  const date = d.toISOString().slice(0, 10);
  const r1 = await postLead(portA, booking({ preferred: { date, slot: '11:00', asap: false } }));
  assert.equal(r1.status, 201);
  const r2 = await postLead(portA, booking({ preferred: { date, slot: '11:00', asap: false } }));
  assert.equal(r2.status, 201); // вместимость 2
  const r3 = await postLead(portA, booking({ preferred: { date, slot: '11:00', asap: false } }));
  assert.equal(r3.status, 409);
  const j = await r3.json() as { error: { code: string; slots: { time: string; available: boolean }[] } };
  assert.equal(j.error.code, 'slot_taken');
  assert.equal(j.error.slots.length, 10);
  assert.equal(j.error.slots.find((s) => s.time === '11:00')?.available, false);
  assert.equal(j.error.slots.find((s) => s.time === '12:00')?.available, true);
  // 409 не создал заявку
  const n = await one<{ c: number }>(A, 'SELECT COUNT(*) AS c FROM leads WHERE preferred_date=? AND preferred_slot=?', date, '11:00');
  assert.equal(n?.c, 2);
});

test('невалидные поля → 400 с перечнем полей', async () => {
  const cases: [Record<string, unknown>, string][] = [
    [booking({ name: '' }), 'name'],
    [booking({ phone: '123' }), 'phone'],
    [booking({ car: { brand: 'Kia', model: null, year: 1975, vin: null, mileage: null } }), 'car.year'],
    [booking({ car: { brand: 'Kia', model: null, year: 2020, vin: 'IOQ12345678901234', mileage: null } }), 'car.vin'],
    [booking({ car: { brand: 'Kia', model: null, year: 2020, vin: null, mileage: 3000000 } }), 'car.mileage'],
    [booking({ services: [] }), 'services'],
    [booking({ services: ['ne-sushchestvuet'] }), 'services'],
    [booking({ preferred: { date: null, slot: null, asap: false } }), 'preferred'],
    [booking({ consent: false }), 'consent'],
    [booking({ idempotency_key: 'не-uuid' }), 'idempotency_key'],
    [booking({ contact_method: 'email' }), 'contact_method'],
  ];
  for (const [body, field] of cases) {
    const r = await postLead(portA, body);
    assert.equal(r.status, 400, `ожидался 400 для ${field}`);
    const j = await r.json() as { error: { code: string; fields?: Record<string, string> } };
    assert.equal(j.error.code, 'validation');
    assert.ok(j.error.fields && (j.error.fields[field] ?? Object.keys(j.error.fields).some((k) => k.startsWith(field))),
      `в ответе нет поля ${field}: ${JSON.stringify(j.error.fields)}`);
  }
});

test('устаревшая версия согласия → 400 consent_version', async () => {
  const r = await postLead(portA, booking({ consent_version: '2000-01-01' }));
  assert.equal(r.status, 400);
  const j = await r.json() as { error: { code: string } };
  assert.equal(j.error.code, 'consent_version');
});

test('honeypot и мгновенная отправка — тихо игнорируются', async () => {
  const before = await one<{ c: number }>(A, 'SELECT COUNT(*) AS c FROM leads');
  const r1 = await postLead(portA, booking({ honeypot: 'я бот' }));
  assert.equal(r1.status, 201);
  assert.match((await r1.json() as { ticket: string }).ticket, /^A-\d{4}-\d{4}$/);
  const r2 = await postLead(portA, booking({ form_started_at: Date.now() }));
  assert.equal(r2.status, 201);
  const after = await one<{ c: number }>(A, 'SELECT COUNT(*) AS c FROM leads');
  assert.equal(after?.c, before?.c, 'бот-заявки не сохраняются');
});

test('обращение с контактов: талон K-, kind=message', async () => {
  const r = await postLead(portA, {
    name: 'Мария', phone: '89518269839', message: 'Работаете ли вы в новогоднюю ночь?',
    consent: true, consent_version: '2026-10-21', page: 'contacts',
    idempotency_key: crypto.randomUUID(), honeypot: '', form_started_at: Date.now() - 30000,
  });
  assert.equal(r.status, 201);
  const j = await r.json() as { ticket: string };
  assert.match(j.ticket, /^K-\d{4}-\d{4}$/);
  const lead = await one<{ kind: string; message: string }>(A, 'SELECT kind, message FROM leads WHERE ticket=?', j.ticket);
  assert.equal(lead?.kind, 'message');
  assert.ok(lead?.message?.includes('новогоднюю'));
});

let photoId = '';
test('загрузка фото: sharp-варианты, выдача, SVG отклоняется, 413 на большом файле', async () => {
  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#3a6b4f' } }).png().toBuffer();
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'foto.png');
  const r = await fetch(`http://127.0.0.1:${portA}/api/uploads`, { method: 'POST', body: fd });
  assert.equal(r.status, 201);
  const j = await r.json() as { id: string; url: string; width: number; height: number };
  photoId = j.id;
  assert.match(j.id, /^upl_/);
  assert.ok(j.width <= 2000 && j.height <= 2000, 'ресайз до 2000 px');
  const files = readdirSync(join(A.media, j.id));
  assert.deepEqual(files.sort(), ['master.jpg', 'v1600.avif', 'v1600.jpg', 'v1600.webp', 'v480.avif', 'v480.jpg', 'v480.webp', 'v960.avif', 'v960.jpg', 'v960.webp']);
  const got = await fetch(`http://127.0.0.1:${portA}${j.url}`);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/jpeg');
  assert.ok((got.headers.get('cache-control') ?? '').includes('immutable'));

  // SVG не принимается
  const fd2 = new FormData();
  fd2.append('file', new Blob([new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')], { type: 'image/svg+xml' }), 'zloy.svg');
  const r2 = await fetch(`http://127.0.0.1:${portA}/api/uploads`, { method: 'POST', body: fd2 });
  assert.equal(r2.status, 400);
  assert.equal((await r2.json() as { error: { code: string } }).error.code, 'bad_type');

  // 413 на файле больше 15 МБ
  const fd3 = new FormData();
  fd3.append('file', new Blob([new Uint8Array(Buffer.alloc(16 * 1024 * 1024, 7))], { type: 'application/octet-stream' }), 'big.bin');
  const r3 = await fetch(`http://127.0.0.1:${portA}/api/uploads`, { method: 'POST', body: fd3 });
  assert.equal(r3.status, 413);

  // path traversal
  const r4 = await fetch(`http://127.0.0.1:${portA}/media/${j.id}/..%2f..%2f..%2fetc%2fpasswd`);
  assert.ok(r4.status === 404 || r4.status === 400);
});

test('фото привязываются к заявке', async () => {
  const d = new Date(Date.now() + 86400000);
  const r = await postLead(portA, booking({ photos: [photoId], preferred: { date: d.toISOString().slice(0, 10), slot: '12:00', asap: false } }));
  assert.equal(r.status, 201);
  const j = await r.json() as { lead_id: number };
  const link = await one<{ c: number }>(A, 'SELECT COUNT(*) AS c FROM lead_photos WHERE lead_id=? AND media_id=?', j.lead_id, photoId);
  assert.equal(link?.c, 1);
  const m = await one<{ attached_to: string }>(A, 'SELECT attached_to FROM media WHERE id=?', photoId);
  assert.equal(m?.attached_to, `lead:${j.lead_id}`);
});

test('слоты API: дата обязательна, 14 дней, занятость из БД', async () => {
  const bad = await fetch(`http://127.0.0.1:${portA}/api/slots?date=2020-01-01`);
  assert.equal(bad.status, 400);
  const d = new Date(Date.now() + 3 * 86400000);
  const date = d.toISOString().slice(0, 10);
  const r = await fetch(`http://127.0.0.1:${portA}/api/slots?date=${date}`);
  assert.equal(r.status, 200);
  const j = await r.json() as { date: string; slots: { time: string; available: boolean }[] };
  assert.equal(j.date, date);
  assert.equal(j.slots.length, 10);
  assert.ok(j.slots.every((s) => s.available), 'свежая дата — всё свободно');
});

test('Telegram недоступен → письмо уходит; заявка видна', async () => {
  stubMode = 'fail';
  try {
    const d = new Date(Date.now() + 86400000);
    const r = await postLead(portA, booking({ preferred: { date: d.toISOString().slice(0, 10), slot: '13:00', asap: false } }));
    assert.equal(r.status, 201);
    const j = await r.json() as { lead_id: number };
    const ok = await pollUntil(async () => {
      const s = await rows<{ channel: string; status: string; attempts: number; next_attempt_at: string | null }>(
        A, 'SELECT channel, status, attempts, next_attempt_at FROM outbox WHERE lead_id=?', j.lead_id);
      const tg = s.find((x) => x.channel === 'telegram');
      const em = s.find((x) => x.channel === 'email');
      return !!tg && tg.status === 'failed' && tg.attempts === 1 && !!tg.next_attempt_at && !!em && em.status === 'sent';
    });
    assert.ok(ok, 'telegram — failed с ретраем, email — sent');
    const lead = await one<{ ticket: string }>(A, 'SELECT ticket FROM leads WHERE id=?', j.lead_id);
    assert.ok(lead?.ticket, 'заявка в БД несмотря на сбой канала');
  } finally { stubMode = 'ok'; }
});

test('ручной/повторный прогон outbox доставляет отложенный telegram', async () => {
  const failed = await one<{ id: number }>(A, `SELECT id FROM outbox WHERE status='failed' AND channel='telegram' ORDER BY id DESC LIMIT 1`);
  assert.ok(failed, 'есть недоставленный telegram');
  process.env.DATA_DIR = A.data; process.env.MEDIA_DIR = A.media;
  process.env.SMTP_JSON_DIR = A.mail; process.env.TELEGRAM_API_BASE = tgBase();
  process.env.BOT_TOKEN = 'TEST:TOKEN'; process.env.TELEGRAM_CHAT_ID = '42';
  const { closeDb } = await import('../src/server/db.ts');
  closeDb();
  const { runOutboxOnce } = await import('../src/server/outbox.ts');
  // next_attempt_at в будущем (+1 мин) — сдвигаем в прошлое, имитируя «пора»
  const { db } = await import('../src/server/db.ts');
  db().prepare(`UPDATE outbox SET next_attempt_at=datetime('now','-1 minutes') WHERE id=?`).run(failed.id);
  await runOutboxOnce();
  const row = await one<{ status: string; sent_at: string | null }>(A, 'SELECT status, sent_at FROM outbox WHERE id=?', failed.id);
  assert.equal(row?.status, 'sent');
  assert.ok(row?.sent_at);
});

test('сервер B: SMTP недоступен → Telegram уходит', async () => {
  const r = await postLead(portB, booking());
  assert.equal(r.status, 201);
  const j = await r.json() as { lead_id: number };
  const ok = await pollUntil(async () => {
    const s = await rows<{ channel: string; status: string }>(B, 'SELECT channel, status FROM outbox WHERE lead_id=?', j.lead_id);
    const tg = s.find((x) => x.channel === 'telegram');
    const em = s.find((x) => x.channel === 'email');
    return !!tg && tg.status === 'sent' && !!em && em.status === 'failed';
  });
  assert.ok(ok, 'telegram sent, email failed');
  const emRow = await one<{ last_error: string | null; attempts: number }>(B, `SELECT last_error, attempts FROM outbox WHERE lead_id=? AND channel='email'`, j.lead_id);
  assert.ok(emRow?.last_error && emRow.last_error.length > 0, 'текст ошибки сохранён');
  assert.equal(emRow?.attempts, 1);
});

test('сервер B: оба канала недоступны → заявка в БД, две строки failed; затем догоняющая доставка', async () => {
  stubMode = 'fail';
  let leadId = 0;
  try {
    const r = await postLead(portB, booking());
    assert.equal(r.status, 201);
    const j = await r.json() as { lead_id: number };
    leadId = j.lead_id;
    const ok = await pollUntil(async () => {
      const s = await rows<{ channel: string; status: string }>(B, 'SELECT channel, status FROM outbox WHERE lead_id=?', leadId);
      return s.length === 2 && s.every((x) => x.status === 'failed');
    });
    assert.ok(ok, 'обе строки failed (доставка догонит позже)');
    const lead = await one<{ ticket: string }>(B, 'SELECT ticket FROM leads WHERE id=?', leadId);
    assert.ok(lead?.ticket, 'заявка видна в БД и в админке');
  } finally { stubMode = 'ok'; }

  // догоняющая доставка другим процессом с исправными каналами
  process.env.DATA_DIR = B.data; process.env.MEDIA_DIR = B.media;
  process.env.SMTP_JSON_DIR = B.mail; process.env.TELEGRAM_API_BASE = tgBase();
  process.env.BOT_TOKEN = 'TEST:TOKEN'; process.env.TELEGRAM_CHAT_ID = '42';
  const { closeDb, db } = await import('../src/server/db.ts');
  closeDb();
  db().prepare(`UPDATE outbox SET next_attempt_at=datetime('now','-1 minutes') WHERE lead_id=?`).run(leadId);
  const { runOutboxOnce } = await import('../src/server/outbox.ts');
  await runOutboxOnce();
  const s = await rows<{ channel: string; status: string }>(B, 'SELECT channel, status FROM outbox WHERE lead_id=?', leadId);
  assert.equal(s.length, 2);
  assert.ok(s.every((x) => x.status === 'sent'), 'после восстановления каналов обе доставки sent');
});

test('rate-limit: ошибки не тратят квоту, 429 — только после лимита успешных', async () => {
  // У сервера B квота 4 УСПЕШНЫХ заявки в час; две уже созданы предыдущими тестами.
  // 5 невалидных отправок — каждая 400 и ни одна не расходует квоту (M3 ревью).
  for (let i = 0; i < 5; i++) {
    const bad = await postLead(portB, booking({ phone: '1', name: '' }));
    assert.equal(bad.status, 400, `невалидная заявка ${i + 1} → 400, не 429`);
  }
  // Две валидные проходят (всего 4 успешных = квота), третья — 429.
  const ok1 = await postLead(portB, booking({ preferred: { date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), slot: '11:00', asap: false } }));
  assert.equal(ok1.status, 201);
  const ok2 = await postLead(portB, booking({ preferred: { date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), slot: '12:00', asap: false } }));
  assert.equal(ok2.status, 201);
  const r = await postLead(portB, booking());
  assert.equal(r.status, 429);
  const j = await r.json() as { error: { code: string } };
  assert.equal(j.error.code, 'too_many');
  assert.ok(Number(r.headers.get('retry-after') ?? '0') > 0);
});

test('rate-limit: антифлуд срабатывает на шквал любых запросов', async () => {
  // Сервер A: антифлуд 1000/10мин не достижим в тестах — проверяем механизм на
  // живом ключе через юнит-импорт: peek не расходует, consume расходует.
  const { peekLimit, consumeLimit } = await import('../src/server/ratelimit.ts');
  const key = 'peek-' + crypto.randomUUID();
  assert.equal(peekLimit(key, 2, 60000).ok, true);
  assert.equal(peekLimit(key, 2, 60000).ok, true, 'peek не расходует квоту');
  consumeLimit(key); consumeLimit(key);
  const denied = peekLimit(key, 2, 60000);
  assert.equal(denied.ok, false);
  assert.ok(denied.retryAfterSec > 0);
});

test('кейсы: свежая публикация сразу видна на / и /about, выше старых', async () => {
  process.env.DATA_DIR = A.data; process.env.MEDIA_DIR = A.media;
  const { closeDb, db } = await import('../src/server/db.ts');
  closeDb();
  db().prepare(`INSERT INTO cases(slug,title,description,service_slug,cover_static,status,published_at,sort)
    VALUES('test-fresh-case','Свежий кейс ПРОВЕРКА','Описание свежего кейса',NULL,'/img/case-1.svg','published',datetime('now'),99)`).run();
  try {
    const home = await (await fetch(`http://127.0.0.1:${portA}/`)).text();
    assert.ok(home.includes('Свежий кейс ПРОВЕРКА'), 'новый кейс виден на главной');
    const about = await (await fetch(`http://127.0.0.1:${portA}/about`)).text();
    assert.ok(about.includes('Свежий кейс ПРОВЕРКА'), 'новый кейс виден на /about');
    // Новые выше старых: свежий кейс встречается в галерее раньше первого сеянного.
    assert.ok(home.indexOf('Свежий кейс ПРОВЕРКА') < home.indexOf('Боковой порез шины'), 'порядок: свежий кейс первым в галерее');
  } finally {
    db().prepare(`DELETE FROM cases WHERE slug='test-fresh-case'`).run();
    closeDb();
  }
});

test('лимиты: checkLimit (юнит-проверка окна)', async () => {
  const { checkLimit } = await import('../src/server/ratelimit.ts');
  const key = 'test-' + crypto.randomUUID();
  assert.equal(checkLimit(key, 2, 60000).ok, true);
  assert.equal(checkLimit(key, 2, 60000).ok, true);
  const third = checkLimit(key, 2, 60000);
  assert.equal(third.ok, false);
  assert.ok(third.retryAfterSec > 0);
});
