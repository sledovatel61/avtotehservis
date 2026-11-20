import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { makeTicket, type Env } from '../src/index.ts';
import { validateLead, normalizePhone } from '../src/validate.ts';
import { getSlots, isValidSlotDate } from '../src/slots.ts';
import { composeTelegram } from '../src/telegram.ts';

const uuid = (): string => crypto.randomUUID();
const api = 'https://tg.test';

interface Call { url: string; body: Record<string, unknown>; form?: FormData }
let calls: Call[] = [];
let tgStatus = 200;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  const raw = init?.body;
  /* sendMessage идёт JSON, sendPhoto — multipart: сохраняем как есть, тесты смотрят нужное. */
  if (raw instanceof FormData) {
    calls.push({ url, body: {}, form: raw });
  } else {
    const body = raw ? JSON.parse(String(raw)) as Record<string, unknown> : {};
    calls.push({ url, body });
  }
  return new Response(JSON.stringify(tgStatus === 200 ? { ok: true } : { ok: false }), { status: tgStatus });
}) as typeof fetch;

function env(over: Partial<Env> = {}): Env {
  return {
    BOT_TOKEN: '123:TEST',
    TELEGRAM_CHAT_ID: '-1001234567890',
    TELEGRAM_API_BASE: api,
    ALLOWED_ORIGINS: 'https://sledovatel61.github.io,http://localhost:4321',
    SITE_NAME: 'АвтоТехСервис',
    SITE_ADDRESS: 'Ростов-на-Дону, ул. Портовая, 439',
    CONSENT_VERSION: '2026-11-20',
    ...over,
  };
}

const booking = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Сергей',
  phone: '+7 (951) 826-98-39',
  contact_method: 'call',
  car: { brand: 'Kia', model: 'Ceed', year: 2019, vin: null, mileage: 84000 },
  services: ['shinomontazh'],
  preferred: { date: null, slot: null, asap: true },
  photos: [],
  consent: true,
  consent_version: '2026-11-20',
  page: 'appointment',
  idempotency_key: uuid(),
  honeypot: '',
  form_started_at: Date.now() - 10_000,
  ...over,
});

async function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return worker.fetch(new Request('https://relay.test/leads', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://sledovatel61.github.io', ...headers },
    body: JSON.stringify(body),
  }), env());
}

test.beforeEach(() => { calls = []; tgStatus = 200; });

test('health: отвечает ok и показывает, настроен ли Telegram', async () => {
  const r = await worker.fetch(new Request('https://relay.test/health'), env());
  assert.equal(r.status, 200);
  const j = await r.json() as { ok: boolean; service: string; telegram: boolean; consentVersion: string };
  assert.equal(j.ok, true);
  assert.equal(j.service, 'ats-leads');
  assert.equal(j.telegram, true);
  /* версия согласия видна снаружи: по ней смоук и владелец сверяют сборку */
  assert.equal(j.consentVersion, '2026-11-20');

  const off = await worker.fetch(new Request('https://relay.test/health'), env({ BOT_TOKEN: undefined }));
  assert.equal((await off.json() as { telegram: boolean }).telegram, false);
});

test('CORS: preflight разрешает свой origin, чужой не пропускает', async () => {
  const ok = await worker.fetch(new Request('https://relay.test/leads', {
    method: 'OPTIONS', headers: { origin: 'https://sledovatel61.github.io' },
  }), env());
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://sledovatel61.github.io');
  assert.equal(ok.headers.get('access-control-allow-methods'), 'GET,POST,OPTIONS');

  const bad = await worker.fetch(new Request('https://relay.test/leads', {
    method: 'OPTIONS', headers: { origin: 'https://evil.example' },
  }), env());
  assert.notEqual(bad.headers.get('access-control-allow-origin'), 'https://evil.example');
});

test('заявка на сервис: 201 с талоном и сообщением в Telegram', async () => {
  const r = await post(booking({ idempotency_key: uuid() }));
  assert.equal(r.status, 201);
  const j = await r.json() as { ticket: string; lead_id: number; status: string; duplicate: boolean };
  assert.match(j.ticket, /^A-\d{4}-\d{4}$/);
  assert.equal(j.lead_id, 0);
  assert.equal(j.status, 'accepted');
  assert.equal(j.duplicate, false);

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/bot123:TEST\/sendMessage$/);
  const text = String(calls[0].body.text);
  assert.match(text, /Заявка на сервис/);
  assert.match(text, /Сергей/);
  assert.match(text, /\+7 \(951\) 826-98-39/);
  assert.match(text, /Kia Ceed/);
  assert.match(text, /как можно скорее/);
  assert.match(text, /Время предварительное — подтвердить звонком/);
  assert.equal(calls[0].body.parse_mode, 'HTML');
});

test('желаемая дата: попадает в сообщение как пожелание', async () => {
  const d = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
  const r = await post(booking({
    idempotency_key: uuid(),
    preferred: { date: d, slot: '10:00', asap: false },
  }));
  assert.equal(r.status, 201);
  const text = String(calls[0].body.text);
  assert.match(text, /Желаемое время/);
  assert.match(text, /10:00/);
  assert.match(text, /Время предварительное/);
});

test('идемпотентность: повтор с тем же ключом — тот же талон и без второго сообщения', async () => {
  const key = uuid();
  const first = await post(booking({ idempotency_key: key }), { 'x-forwarded-for': '10.1.1.1' });
  const t1 = (await first.json() as { ticket: string }).ticket;
  const second = await post(booking({ idempotency_key: key }), { 'x-forwarded-for': '10.1.1.1' });
  const j2 = await second.json() as { ticket: string; duplicate: boolean };
  assert.equal(second.status, 201);
  assert.equal(j2.ticket, t1);
  assert.equal(j2.duplicate, true);
  assert.equal(calls.length, 1);
});

test('валидация: пустые поля → 400 с русскими текстами', async () => {
  const r = await post({ ...booking(), name: '', phone: '123', idempotency_key: uuid() });
  assert.equal(r.status, 400);
  const j = await r.json() as { error: { code: string; fields: Record<string, string> } };
  assert.equal(j.error.code, 'validation');
  assert.equal(j.error.fields.name, 'Укажите имя');
  assert.match(j.error.fields.phone, /Телефон/);
  assert.equal(calls.length, 0);
});

test('валидация: без согласия и с плохим VIN — не проходит', async () => {
  const r = await post(booking({
    consent: false,
    idempotency_key: uuid(),
    car: { brand: 'Kia', vin: 'ABC', year: 2019, model: null, mileage: null },
  }));
  const j = await r.json() as { error: { fields: Record<string, string> } };
  assert.equal(j.error.fields.consent, 'Без согласия на обработку данных отправить нельзя');
  assert.match(j.error.fields['car.vin'], /VIN/);
});

test('устаревшая версия согласия → 400 consent_version', async () => {
  const r = await post(booking({ consent_version: '2025-01-01', idempotency_key: uuid() }));
  assert.equal(r.status, 400);
  assert.equal((await r.json() as { error: { code: string } }).error.code, 'consent_version');
  assert.equal(calls.length, 0);
});

test('honeypot: отвечаем как при успехе, но ничего не отправляем', async () => {
  const r = await post(booking({ honeypot: 'bot-was-here', idempotency_key: uuid() }));
  assert.equal(r.status, 201);
  assert.match((await r.json() as { ticket: string }).ticket, /^A-\d{4}-\d{4}$/);
  assert.equal(calls.length, 0);
});

test('слишком быстрое заполнение формы — тихий успех без отправки', async () => {
  const r = await post(booking({ form_started_at: Date.now() - 500, idempotency_key: uuid() }));
  assert.equal(r.status, 201);
  assert.equal(calls.length, 0);
});

test('Telegram лежит → 502 и понятный текст, талон не выдаём', async () => {
  tgStatus = 500;
  const r = await post(booking({ idempotency_key: uuid() }));
  assert.equal(r.status, 502);
  const j = await r.json() as { error: { code: string; message: string } };
  assert.equal(j.error.code, 'telegram');
  assert.match(j.error.message, /Позвоните/);
  assert.equal(calls.length, 2, 'одна попытка + один повтор');
});

test('вопрос с формы контактов: 201 и сообщение без блока авто', async () => {
  const r = await post({
    name: 'Анна',
    phone: '89289065700',
    message: 'Нужна диагностика подвески, стучит справа.',
    consent: true,
    consent_version: '2026-11-20',
    page: 'contacts',
    idempotency_key: uuid(),
    honeypot: '',
  });
  assert.equal(r.status, 201);
  const text = String(calls[0].body.text);
  assert.match(text, /Обращение с сайта/);
  assert.match(text, /Анна/);
  assert.match(text, /диагностика подвески/);
});

test('лимит: шестая заявка с одного адреса → 429 с Retry-After', async () => {
  const ip = '10.9.9.9';
  const codes: number[] = [];
  for (let i = 0; i < 6; i++) {
    const r = await post(booking({ idempotency_key: uuid() }), { 'x-forwarded-for': ip });
    codes.push(r.status);
    if (r.status === 429) {
      assert.equal(r.headers.get('retry-after'), '600');
      const j = await r.json() as { error: { code: string } };
      assert.equal(j.error.code, 'too_many');
    }
  }
  assert.deepEqual(codes.slice(0, 5), [201, 201, 201, 201, 201]);
  assert.equal(codes[5], 429);
});

test('слоты: 10 часов, прошедшие сегодня закрыты, дата вне 14 дней — 400', async () => {
  const d = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  const r = await worker.fetch(new Request(`https://relay.test/slots?date=${d}`), env());
  assert.equal(r.status, 200);
  const j = await r.json() as { date: string; slots: { time: string; available: boolean; reason?: string }[] };
  assert.equal(j.date, d);
  assert.equal(j.slots.length, 10);
  assert.ok(j.slots.every((s) => s.available));

  const bad = await worker.fetch(new Request('https://relay.test/slots?date=2020-01-01'), env());
  assert.equal(bad.status, 400);
  assert.equal((await bad.json() as { error: { code: string } }).error.code, 'bad_date');
});

test('неизвестный адрес → 404', async () => {
  const r = await worker.fetch(new Request('https://relay.test/nope'), env());
  assert.equal(r.status, 404);
});

/* ---------- юниты ---------- */

test('normalizePhone: 8/7/10 цифр → +7XXXXXXXXXX', () => {
  assert.equal(normalizePhone('8 (951) 826-98-39'), '+79518269839');
  assert.equal(normalizePhone('+7 951 826 98 39'), '+79518269839');
  assert.equal(normalizePhone('9518269839'), '+79518269839');
  assert.equal(normalizePhone('123'), null);
});

test('validateLead: пожелание времени обязательно, если не «как можно скорее»', () => {
  const r = validateLead(booking({ preferred: { date: null, slot: null, asap: false }, idempotency_key: uuid() }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.fields.preferred, /Выберите дату и время/);
});

test('makeTicket: формат A-ММДД-NNNN по московскому времени', () => {
  const t = makeTicket(new Date('2026-11-18T21:30:00Z'), () => 0.5); // 19.11 00:30 МСК
  assert.equal(t, 'A-1119-5500');
});

test('isValidSlotDate: сегодня и +13 дней можно, +14 нельзя', () => {
  const now = new Date();
  const iso = (n: number): string => new Date(now.getTime() + n * 86400_000).toISOString().slice(0, 10);
  assert.equal(isValidSlotDate(iso(0), now), true);
  assert.equal(isValidSlotDate(iso(13), now), true);
  assert.equal(isValidSlotDate(iso(20), now), false);
  assert.equal(isValidSlotDate('18.11.2026', now), false);
});

test('getSlots: сегодня прошедшие часы помечены past', () => {
  const now = new Date('2026-11-18T09:00:00Z'); // 12:00 МСК
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(now);
  const slots = getSlots(today, now);
  assert.equal(slots[0].available, false);
  assert.equal(slots[0].reason, 'past');
  assert.equal(slots.at(-1)?.available, true);
});

test('composeTelegram: экранирует HTML и пишет источник', () => {
  const v = validateLead(booking({ name: 'Иван <b>', idempotency_key: uuid() }));
  assert.equal(v.ok, true);
  if (!v.ok || v.value.kind !== 'booking') return;
  const text = composeTelegram(v.value, 'A-1118-1234', { siteName: 'АвтоТехСервис', address: 'Портовая, 439' });
  assert.ok(text.includes('Иван &lt;b&gt;'));
  assert.ok(!text.includes('Иван <b>'));
  assert.ok(text.includes('appointment'));
});

/* ---------- фото в заявке: multipart ---------- */

function formWith(files: File[], payload = booking()): FormData {
  const fd = new FormData();
  fd.append('payload', JSON.stringify(payload));
  for (const [i, f] of files.entries()) fd.append('photo', f, `photo-${i + 1}.jpg`);
  return fd;
}

let ipSeq = 0;
async function postForm(fd: FormData): Promise<Response> {
  /* у каждого теста свой IP: лимит 5 заявок на адрес, иначе тесты съедают друг друга */
  return worker.fetch(new Request('https://relay.test/leads', {
    method: 'POST',
    headers: {
      origin: 'https://sledovatel61.github.io',
      'cf-connecting-ip': `10.0.1.${++ipSeq}`,
    },
    body: fd,
  }), env());
}

const jpeg = (name = 'krylo.jpg', bytes = 1024): File =>
  new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' });

test('multipart: заявка с фото принимается и фото уходят в группу', async () => {
  const res = await postForm(formWith([jpeg(), jpeg('bamper.jpg', 2048)]));
  assert.equal(res.status, 201);
  const j = await res.json() as { ticket: string };
  assert.match(j.ticket, /^A-\d{4}-\d{4}$/);

  const msg = calls.find((c) => c.url.endsWith('/sendMessage'));
  assert.ok(msg);
  const photos = calls.filter((c) => c.url.endsWith('/sendPhoto'));
  assert.equal(photos.length, 2);
  assert.equal(photos[0].form?.get('chat_id'), '-1001234567890');
  assert.match(String(photos[0].form?.get('caption')), new RegExp(`к заявке ${j.ticket}`));
  assert.ok(photos[0].form?.get('photo') instanceof File);
});

test('multipart: заявка без фото работает как раньше', async () => {
  const res = await postForm(formWith([]));
  assert.equal(res.status, 201);
  assert.equal(calls.filter((c) => c.url.endsWith('/sendPhoto')).length, 0);
});

test('multipart: больше 3 фото — 400 и ничего не отправлено', async () => {
  const res = await postForm(formWith([jpeg(), jpeg(), jpeg(), jpeg()]));
  assert.equal(res.status, 400);
  const j = await res.json() as { error: { code: string } };
  assert.equal(j.error.code, 'validation');
  assert.equal(calls.length, 0);
});

test('multipart: не изображение — 400', async () => {
  const bad = new File([new Uint8Array(64)], 'doc.pdf', { type: 'application/pdf' });
  const res = await postForm(formWith([bad]));
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test('multipart: фото больше 6 МБ — 400', async () => {
  const heavy = new File([new Uint8Array(6 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' });
  const res = await postForm(formWith([heavy]));
  assert.equal(res.status, 400);
});

test('multipart: битый payload — 400 bad_json', async () => {
  const fd = new FormData();
  fd.append('payload', '{не json');
  fd.append('photo', jpeg(), 'p.jpg');
  const res = await postForm(fd);
  assert.equal(res.status, 400);
  const j = await res.json() as { error: { code: string } };
  assert.equal(j.error.code, 'bad_json');
});

test('multipart: ошибка Telegram на фото не отменяет принятую заявку', async () => {
  let n = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    n++;
    const url = String(input);
    const raw = init?.body;
    if (raw instanceof FormData) calls.push({ url, body: {}, form: raw });
    else calls.push({ url, body: raw ? JSON.parse(String(raw)) as Record<string, unknown> : {} });
    /* первое сообщение с заявкой — ок, фото — падает */
    return new Response(JSON.stringify({ ok: url.endsWith('/sendMessage') }), { status: url.endsWith('/sendMessage') ? 200 : 400 });
  }) as typeof fetch;
  try {
    const res = await postForm(formWith([jpeg()]));
    assert.equal(res.status, 201);
    assert.ok(n >= 2);
  } finally {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const raw = init?.body;
      if (raw instanceof FormData) calls.push({ url, body: {}, form: raw });
      else calls.push({ url, body: raw ? JSON.parse(String(raw)) as Record<string, unknown> : {} });
      return new Response(JSON.stringify(tgStatus === 200 ? { ok: true } : { ok: false }), { status: tgStatus });
    }) as typeof fetch;
  }
});

test('composeTelegram: в уведомлении есть версия согласия и отметка времени', () => {
  const v = validateLead(booking({ idempotency_key: uuid(), consent_version: '2026-11-20' }));
  assert.equal(v.ok, true);
  if (!v.ok) return;
  const text = composeTelegram(v.value, 'A-1118-1234', { siteName: 'АвтоТехСервис', at: new Date('2026-11-18T09:15:00Z') });
  assert.match(text, /Согласие на обработку ПД: версия <b>2026-11-20<\/b>/);
  assert.match(text, /отметка 18 ноя, 12:15 МСК/);
});

/* ---------- почта-дубль ---------- */

import { composeEmail, emailProvider, emailFrom, DEFAULT_EMAIL_TO, buildAttachments } from '../src/email.ts';

const baseFetch = globalThis.fetch;
function mockFetch(statuses: Record<string, number>): { urls: string[]; bodies: Record<string, unknown>[] } {
  const urls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    urls.push(url);
    const raw = init?.body;
    if (raw && typeof raw === 'string') bodies.push(JSON.parse(raw) as Record<string, unknown>);
    else if (raw instanceof FormData) bodies.push({});
    const key = Object.keys(statuses).find((k) => url.includes(k));
    const status = key ? statuses[key] : 200;
    return new Response(JSON.stringify({ ok: status < 400, id: 'test' }), { status });
  }) as typeof fetch;
  return { urls, bodies };
}

test('emailProvider: Brevo в приоритете, без ключей почта выключена', () => {
  assert.equal(emailProvider({}), null);
  assert.equal(emailProvider({ RESEND_API_KEY: 'r' }), 'resend');
  assert.equal(emailProvider({ RESEND_API_KEY: 'r', BREVO_API_KEY: 'b' }), 'brevo');
});

test('emailFrom: по умолчанию свой ящик, Resend — адрес на подтверждённом домене', () => {
  assert.equal(emailFrom({ BREVO_API_KEY: 'b' }, 'Pavel.yakovenko@mail.ru'), 'Pavel.yakovenko@mail.ru');
  assert.equal(emailFrom({ RESEND_API_KEY: 'r' }, 'x@y.ru'), 'АвтоТехСервис <no-reply@ats-rostov.ru>');
  assert.equal(emailFrom({ BREVO_API_KEY: 'b', EMAIL_FROM: 'Сервис <box@site.ru>' }, 'x@y.ru'), 'Сервис <box@site.ru>');
});

test('composeEmail: тема и текст содержат талон, имя, телефон и версию согласия', () => {
  const v = validateLead(booking({ idempotency_key: uuid(), name: 'Иван', consent_version: '2026-11-20' }));
  assert.equal(v.ok, true);
  if (!v.ok) return;
  const m = composeEmail(v.value, 'A-1118-7777', {
    siteName: 'АвтоТехСервис', address: 'Портовая, 439', at: new Date('2026-11-18T09:15:00Z'),
  });
  assert.match(m.subject, /A-1118-7777/);
  assert.match(m.subject, /Иван/);
  assert.match(m.subject, /\+7 \(951\) 826-98-39/);
  assert.match(m.text, /Согласие: версия 2026-11-20/);
  assert.match(m.text, /18 ноября 2026, 12:15 \(МСК\)/);
  assert.match(m.text, /Автомобиль: Kia Ceed 2019 г\./);
  assert.match(m.html, /<html/);
  assert.match(m.html, /Позвонить/);
});

test('composeEmail: обращение без авто не упоминает автомобиль', () => {
  const v = validateLead(booking({ idempotency_key: uuid(), car: undefined, services: undefined, preferred: undefined, message: 'Здравствуйте, нужна консультация по ТО' }));
  assert.equal(v.ok, true);
  if (!v.ok) return;
  const m = composeEmail(v.value, 'A-1118-0001', { siteName: 'АвтоТехСервис' });
  assert.match(m.subject, /Обращение с сайта/);
  assert.ok(!m.text.includes('Автомобиль'));
  assert.match(m.text, /Сообщение: Здравствуйте/);
});

test('buildAttachments: png сохраняет расширение и кодируется в base64', async () => {
  const png = new File([new Uint8Array([137, 80, 78, 71])], 'p.png', { type: 'image/png' });
  const list = await buildAttachments([png]);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'zayavka-foto-1.png');
  assert.equal(atob(list[0].content).charCodeAt(0), 137);
});

test('Brevo: письмо уходит на Pavel.yakovenko@mail.ru с фото во вложении', async () => {
  const { urls, bodies } = mockFetch({ 'brevo.com': 201 });
  try {
    const res = await postForm(formWith([jpeg()]));
    assert.equal(res.status, 201);
    const j = await res.json() as { delivered: { telegram: boolean; email: boolean } };
    assert.equal(j.delivered.telegram, true);
    assert.equal(j.delivered.email, false, 'в env() нет ключа почты — канал выключен');

    const env2 = env({ BREVO_API_KEY: 'brevo-key' });
    const res2 = await worker.fetch(new Request('https://relay.test/leads', {
      method: 'POST',
      headers: { origin: 'https://sledovatel61.github.io', 'cf-connecting-ip': '10.20.0.1' },
      body: formWith([jpeg()]),
    }), env2);
    assert.equal(res2.status, 201);
    const j2 = await res2.json() as { delivered: { telegram: boolean; email: boolean } };
    assert.deepEqual(j2.delivered, { telegram: true, email: true });

    const mail = urls.findIndex((u) => u.includes('brevo.com'));
    assert.ok(mail >= 0, urls.join(','));
    const body = bodies[mail] as {
      to: { email: string }[]; subject: string; htmlContent: string;
      attachment: { name: string; content: string }[];
    };
    assert.equal(body.to[0].email, DEFAULT_EMAIL_TO);
    assert.match(body.subject, /Заявка Kia Ceed/);
    assert.ok(body.htmlContent.includes('Позвонить'));
    assert.equal(body.attachment.length, 1);
    assert.equal(body.attachment[0].name, 'zayavka-foto-1.jpg');
  } finally { globalThis.fetch = baseFetch; }
});

test('почта упала, Telegram дошёл → заявка всё равно принята (201)', async () => {
  mockFetch({ 'brevo.com': 500 });
  try {
    const res = await worker.fetch(new Request('https://relay.test/leads', {
      method: 'POST',
      headers: { origin: 'https://sledovatel61.github.io', 'cf-connecting-ip': '10.20.0.2' },
      body: formWith([]),
    }), env({ BREVO_API_KEY: 'k' }));
    assert.equal(res.status, 201);
    const j = await res.json() as { delivered: { telegram: boolean; email: boolean } };
    assert.deepEqual(j.delivered, { telegram: true, email: false });
  } finally { globalThis.fetch = baseFetch; }
});

test('оба канала упали → 502 delivery', async () => {
  mockFetch({ 'tg.test': 500, 'brevo.com': 500 });
  try {
    const res = await worker.fetch(new Request('https://relay.test/leads', {
      method: 'POST',
      headers: { origin: 'https://sledovatel61.github.io', 'cf-connecting-ip': '10.20.0.3' },
      body: formWith([]),
    }), env({ BREVO_API_KEY: 'k' }));
    assert.equal(res.status, 502);
    const j = await res.json() as { error: { code: string } };
    assert.equal(j.error.code, 'delivery');
  } finally { globalThis.fetch = baseFetch; }
});

/* Небольшой KV-заглушка: проверяем, что причина ошибки письма переживает запрос
   и видна в /health, а не только в логах Cloudflare. */
function fakeKv(): { store: Map<string, string>; get(k: string): Promise<string | null>; put(k: string, v: string): Promise<void> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k) => store.get(k) ?? null,
    put: async (k, v) => { store.set(k, v); },
  };
}

test('/health: телеграм дошёл, письмо упало — причина видна как emailLastError', async () => {
  const kv = fakeKv();
  const mail = env({ RESEND_API_KEY: 'r', ATS_KV: kv as never });
  mockFetch({ 'api.resend.com': 403 });
  try {
    const res = await worker.fetch(new Request('https://relay.test/leads', {
      method: 'POST',
      headers: { origin: 'https://sledovatel61.github.io', 'cf-connecting-ip': '10.30.0.1' },
      body: formWith([]),
    }), mail);
    assert.equal(res.status, 201, 'заявка принята: Telegram сработал');

    const health = await (await worker.fetch(new Request('https://relay.test/health'), mail)).json() as {
      email: string; emailLastError?: string; emailLastErrorAt?: string; emailLastOk?: string;
    };
    assert.equal(health.email, 'resend');
    assert.equal(health.emailLastError, 'email_resend_http:403', 'код ошибки, без данных клиента');
    assert.ok(health.emailLastErrorAt, 'время ошибки');
    assert.equal(health.emailLastOk, undefined, 'успеха ещё не было');
    assert.ok(!`${health.emailLastError}${health.emailLastErrorAt}`.includes('@'), 'в коде ошибки нет адресов почты');
  } finally { globalThis.fetch = baseFetch; }
});

test('/health: после успешного письма прошлая ошибка снимается', async () => {
  const kv = fakeKv();
  const mail = env({ RESEND_API_KEY: 'r', ATS_KV: kv as never });
  mockFetch({ 'api.resend.com': 500 });
  try {
    await worker.fetch(new Request('https://relay.test/leads', {
      method: 'POST',
      headers: { origin: 'https://sledovatel61.github.io', 'cf-connecting-ip': '10.30.0.2' },
      body: formWith([]),
    }), mail);
  } finally { globalThis.fetch = baseFetch; }
  const sent = mockFetch({ 'api.resend.com': 200 });
  try {
    const res = await worker.fetch(new Request('https://relay.test/leads', {
      method: 'POST',
      headers: { origin: 'https://sledovatel61.github.io', 'cf-connecting-ip': '10.30.0.3' },
      body: formWith([]),
    }), mail);
    assert.equal(res.status, 201);
    assert.ok(sent.urls.some((u) => u.includes('api.resend.com')), 'письмо ушло');
  } finally { globalThis.fetch = baseFetch; }
  const health = await (await worker.fetch(new Request('https://relay.test/health'), mail)).json() as {
    emailLastError?: string; emailLastOk?: string;
  };
  assert.equal(health.emailLastError, undefined, 'ошибка снята успехом');
  assert.ok(health.emailLastOk, 'время последнего письма');
});

test('/health показывает канал почты и адрес получателя', async () => {
  const r1 = await worker.fetch(new Request('https://relay.test/health'), env());
  const j1 = await r1.json() as { email: string | null };
  assert.equal(j1.email, null);
  const r2 = await worker.fetch(new Request('https://relay.test/health'), env({ BREVO_API_KEY: 'k' }));
  const j2 = await r2.json() as { email: string | null; emailTo: string };
  assert.equal(j2.email, 'brevo');
  assert.equal(j2.emailTo, DEFAULT_EMAIL_TO);
});
