/* Круг 80 / 80-1: адрес приёмника заявок и неизменность тела заявки.
   Проверяем три вещи:
   1) разбор PUBLIC_LEADS_ENDPOINT — https, без хвостового слэша, без пробелов, http:// отвергается;
   2) адреса ресурсов: демо → /api/leads и /api/slots, прослойка → <база>/leads и <база>/slots;
   3) тело заявки не изменилось — текущие payload-ы формы всё ещё проходят bookingSchema/messageSchema,
      а испорченные — падают с полями (контракт прослойки принимает ровно это тело). */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseLeadsEndpoint, buildLeadsUrl, leadsUrl, relayMode, LEADS_BASE, retryAfterSeconds, LEADS_TIMEOUT_MS } from '../src/shared/leads-endpoint.ts';

/* Талоны и заявки проверяем настоящими схемами сервера — их же использует POST /api/leads. */
before(() => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'ats-leads-'));
});

test('без переменной — демо-режим: пустая база, /api/leads и /api/slots', () => {
  assert.deepEqual(parseLeadsEndpoint(undefined), { base: '', error: null });
  assert.deepEqual(parseLeadsEndpoint(''), { base: '', error: null });
  assert.deepEqual(parseLeadsEndpoint('   '), { base: '', error: null });
  /* В этом процессе переменной нет — модуль собрался в демо-режим. */
  assert.equal(LEADS_BASE, '');
  assert.equal(relayMode, false);
  assert.equal(leadsUrl('leads'), '/api/leads');
  assert.equal(leadsUrl('slots'), '/api/slots');
  assert.equal(leadsUrl('slots', 'date=2026-11-18'), '/api/slots?date=2026-11-18');
});

test('адрес прослойки нормализуется: пробелы по краям и хвостовые слэши убираются', () => {
  assert.deepEqual(parseLeadsEndpoint('https://leads.example.workers.dev'), { base: 'https://leads.example.workers.dev', error: null });
  assert.equal(parseLeadsEndpoint('  https://leads.example.workers.dev/  ').base, 'https://leads.example.workers.dev');
  assert.equal(parseLeadsEndpoint('https://leads.example.workers.dev///').base, 'https://leads.example.workers.dev');
  assert.equal(parseLeadsEndpoint('https://example.com/leads').base, 'https://example.com/leads');
});

test('адреса ресурсов в режиме прослойки', () => {
  const base = 'https://leads.example.workers.dev';
  assert.equal(buildLeadsUrl(base, 'leads'), `${base}/leads`);
  assert.equal(buildLeadsUrl(base, 'slots'), `${base}/slots`);
  assert.equal(buildLeadsUrl(base, 'slots', 'date=2026-11-18'), `${base}/slots?date=2026-11-18`);
  /* без базы тот же вызов уходит на свой сервер — поведение не меняется */
  assert.equal(buildLeadsUrl('', 'leads'), '/api/leads');
  assert.equal(buildLeadsUrl('', 'slots', 'date=2026-11-18'), '/api/slots?date=2026-11-18');
});

test('http://, пробелы внутри, мусор и адрес без хоста отвергаются', () => {
  const cases = [
    'http://leads.example.workers.dev',
    'HTTP://leads.example.workers.dev',
    'https://leads example.workers.dev',
    'https://',
    'leads.example.workers.dev',
    'ftp://leads.example.workers.dev',
    'https://leads.example.workers.dev/?x=1',
    'https://leads.example.workers.dev/#leads',
    'https://leads.example.workers.dev/a b',
  ];
  for (const raw of cases) {
    const info = parseLeadsEndpoint(raw);
    assert.equal(info.base, '', `должен быть отвергнут: «${raw}»`);
    assert.ok(info.error, `нет текста ошибки для «${raw}»`);
  }
  assert.match(String(parseLeadsEndpoint('http://x.dev').error), /https:\/\//);
});

test('Retry-After разбирается и в секундах, и датой', () => {
  assert.equal(retryAfterSeconds('30'), 30);
  assert.equal(retryAfterSeconds(' 7 '), 7);
  assert.equal(retryAfterSeconds(null), null);
  assert.equal(retryAfterSeconds('скоро'), null);
  const date = new Date(Date.now() + 45_000).toUTCString();
  const sec = retryAfterSeconds(date);
  assert.ok(sec !== null && sec >= 40 && sec <= 46, `дата → секунды, получено ${sec}`);
});

test('таймаут ожидания — 12 секунд', () => {
  assert.equal(LEADS_TIMEOUT_MS, 12_000);
});

test('тело заявки мастера не изменилось: bookingSchema принимает те же поля', async () => {
  const { runMigrations } = await import('../scripts/migrate.ts');
  const { runSeed } = await import('../scripts/seed.ts');
  runMigrations(); runSeed();
  const { bookingSchema, toErrorFields } = await import('../src/server/validation.ts');
  const { allServiceSlugs } = await import('../src/server/services.ts');
  const svc = allServiceSlugs()[0] ?? 'diagnostika';
  const date = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const payload = {
    name: 'Иван', phone: '8 (951) 826-98-39', contact_method: 'call',
    car: { brand: 'Лада', model: 'Vesta', year: 2019, vin: null, mileage: 45000 },
    services: [svc], preferred: { date, slot: '10:00', asap: false },
    photos: [], consent: true, consent_version: '2026-01',
    page: 'appointment', idempotency_key: '8f1c2f3a-4b5d-4c6e-8f70-112233445566',
    honeypot: '', form_started_at: Date.now() - 10_000,
  };
  const parsed = bookingSchema.parse(payload);
  assert.equal(parsed.phone, '+79518269839');
  assert.equal(parsed.car.year, 2019);
  assert.deepEqual(parsed.services, [svc]);
  assert.deepEqual(parsed.photos, []);
  assert.equal(parsed.consent, true);
  assert.equal(parsed.page, 'appointment');

  /* испорченное тело → 400 с ошибками по полям (прослойка отдаёт их так же) */
  const broken = bookingSchema.safeParse({ ...payload, name: '', phone: '123', consent: false, services: [] });
  assert.equal(broken.success, false);
  const fields = toErrorFields(broken.error).fields;
  for (const key of ['name', 'phone', 'consent', 'services']) {
    assert.ok(key in fields, `нет ошибки поля ${key}: ${JSON.stringify(fields)}`);
  }
});

test('тело сообщения из формы контактов не изменилось: messageSchema', async () => {
  const { messageSchema, toErrorFields } = await import('../src/server/validation.ts');
  const payload = {
    name: 'Пётр', phone: '+7 951 826-58-47', contact_method: 'call',
    message: 'Нужна заправка кондиционера, когда можно приехать?',
    consent: true, consent_version: '2026-01', page: 'contacts',
    idempotency_key: '0b0d1e2f-3a4b-4c5d-9e6f-708192a3b4c5',
    honeypot: '', form_started_at: Date.now() - 6000,
  };
  const parsed = messageSchema.parse(payload);
  assert.equal(parsed.phone, '+79518265847');
  assert.equal(parsed.contact_method, 'call');
  assert.equal(parsed.page, 'contacts');

  const broken = messageSchema.safeParse({ ...payload, message: 'мало', consent: false });
  assert.equal(broken.success, false);
  const fields = toErrorFields(broken.error).fields;
  assert.ok('message' in fields && 'consent' in fields, JSON.stringify(fields));
});
