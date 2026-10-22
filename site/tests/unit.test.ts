import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'ats-unit-'));
process.env.DATA_DIR = join(TMP, 'data');
process.env.MEDIA_DIR = join(TMP, 'media');

const { normalizePhone, bookingSchema, messageSchema, toErrorFields, UUID_RE } = await import('../src/server/validation.ts');
const { ddmm, generateTicket } = await import('../src/server/tickets.ts');
const { mdToHtml } = await import('../src/server/markdown.ts');
const { maskPhone, BACKOFF_MIN, MAX_ATTEMPTS } = await import('../src/server/outbox.ts');
const { detectImage } = await import('../src/server/media.ts');
const { runMigrations } = await import('../scripts/migrate.ts');
const { db, closeDb } = await import('../src/server/db.ts');
const { SLOT_TIMES, isValidSlotDate, getSlots, moscowNow } = await import('../src/server/slots.ts');
const { hashPassword, verifyPassword } = await import('../src/server/auth.ts');
const { limitFromEnv } = await import('../src/server/ratelimit.ts');

test('телефон: все формы → +7XXXXXXXXXX', () => {
  for (const raw of ['+7 (928) 906-57-00', '89289065700', '79289065700', '9289065700', '+7-928-906-57-00', '8 (928) 906 57 00']) {
    assert.equal(normalizePhone(raw), '+79289065700', raw);
  }
  for (const bad of ['', '123', '+1 555 000 0000', '99999999999999', 'абвгдежзиклм']) {
    assert.equal(normalizePhone(bad), null, bad);
  }
});

test('bookingSchema: год 1980–2026', () => {
  const base = {
    name: 'Иван', phone: '+79289065700', contact_method: 'call',
    car: { brand: 'Лада', model: null, year: 2019, vin: null, mileage: null },
    services: ['shinomontazh'], preferred: { date: null, slot: null, asap: true },
    photos: [], consent: true, consent_version: '2026-10-21', page: 'appointment',
    idempotency_key: crypto.randomUUID(), honeypot: '', form_started_at: Date.now() - 60000,
  };
  runMigrations();
  db().prepare(`INSERT OR IGNORE INTO services(slug,title,grp,sort,hidden,chip) VALUES('shinomontazh','Шиномонтаж','Колёса',1,0,1)`).run();
  assert.ok(bookingSchema.safeParse(base).success);
  assert.ok(!bookingSchema.safeParse({ ...base, car: { ...base.car, year: 1975 } }).success);
  assert.ok(!bookingSchema.safeParse({ ...base, car: { ...base.car, year: 2027 } }).success);
  assert.ok(bookingSchema.safeParse({ ...base, car: { ...base.car, year: 1980 } }).success);
  assert.ok(bookingSchema.safeParse({ ...base, car: { ...base.car, year: 2026 } }).success);
});

test('валидация: сообщения об ошибках — всегда по-русски (minor-1)', () => {
  const base = {
    name: 'Иван', phone: '+79289065700', contact_method: 'call',
    car: { brand: 'Лада', model: null, year: 2019, vin: null, mileage: null },
    services: ['shinomontazh'], preferred: { date: null, slot: null, asap: true },
    photos: [], consent: true, consent_version: '2026-10-21', page: 'appointment',
    idempotency_key: crypto.randomUUID(), honeypot: '', form_started_at: Date.now() - 60000,
  };
  const bad = bookingSchema.safeParse({
    ...base,
    name: 'N'.repeat(200),                                  // too_big у строки
    contact_method: 'sms',                                   // неверный enum
    car: { ...base.car, year: 3000, mileage: -5, brand: 'Б'.repeat(200) },
  });
  assert.equal(bad.success, false);
  if (bad.success) return;
  const { fields } = toErrorFields(bad.error);
  const msgs = Object.values(fields);
  assert.ok(msgs.length >= 4, `ошибок несколько: ${JSON.stringify(fields)}`);
  for (const m of msgs) {
    assert.ok(/[а-яА-ЯёЁ]/.test(m), `сообщение по-русски: ${m}`);
    assert.ok(!/Too big|Too small|Invalid|expected/i.test(m), `без английских дефолтов zod: ${m}`);
  }
});

test('bookingSchema: VIN без I/O/Q, 17 символов', () => {
  const base = {
    name: 'Иван', phone: '89289065700', contact_method: 'call',
    car: { brand: 'Kia', model: 'Rio', year: 2020, vin: 'XTWKIA12345678901'.slice(0, 17), mileage: 84000 },
    services: ['shinomontazh'], preferred: { date: null, slot: null, asap: true },
    consent: true, consent_version: '2026-10-21', page: 'appointment', idempotency_key: crypto.randomUUID(),
  };
  assert.ok(bookingSchema.safeParse({ ...base, car: { ...base.car, vin: 'XTWA1234567890123' } }).success);
  const bad = bookingSchema.safeParse({ ...base, car: { ...base.car, vin: 'IOQ12345678901234' } });
  assert.ok(!bad.success);
  const fields = toErrorFields((bad as { error: import('zod').ZodError }).error).fields;
  assert.ok(fields['car.vin']);
});

test('bookingSchema: пробег 0–2 000 000, услуги whitelist, согласие', () => {
  const base = {
    name: 'Иван', phone: '89289065700', contact_method: 'call',
    car: { brand: 'Kia', model: null, year: null, vin: null, mileage: 2000000 },
    services: ['shinomontazh'], preferred: { date: null, slot: null, asap: true },
    consent: true, consent_version: '2026-10-21', page: 'appointment', idempotency_key: crypto.randomUUID(),
  };
  assert.ok(bookingSchema.safeParse(base).success);
  assert.ok(!bookingSchema.safeParse({ ...base, car: { ...base.car, mileage: 2000001 } }).success);
  assert.ok(!bookingSchema.safeParse({ ...base, services: [] }).success);
  assert.ok(!bookingSchema.safeParse({ ...base, services: ['vzlom-sayta'] }).success);
  assert.ok(bookingSchema.safeParse({ ...base, services: ['diagnostika'] }).success);
  assert.ok(!bookingSchema.safeParse({ ...base, consent: false }).success);
  assert.ok(!bookingSchema.safeParse({ ...base, preferred: { date: null, slot: null, asap: false } }).success);
});

test('messageSchema: короткая форма', () => {
  const base = {
    name: 'Мария', phone: '+7 951 826-98-39', message: 'Подскажите по замене масла',
    consent: true, consent_version: '2026-10-21', page: 'contacts', idempotency_key: crypto.randomUUID(),
  };
  const ok = messageSchema.safeParse(base);
  assert.ok(ok.success);
  if (ok.success) assert.equal(ok.data.phone, '+79518269839');
  assert.ok(!messageSchema.safeParse({ ...base, message: 'коротко' }).success);
});

test('uuid v4 формат', () => {
  assert.ok(UUID_RE.test(crypto.randomUUID()));
  assert.ok(!UUID_RE.test('не-uuid'));
});

test('тикет: A-DDMM-XXXX, уникальность, DMMМ по Москве', () => {
  const d = ddmm();
  assert.match(d, /^\d{4}$/);
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const t = generateTicket(db(), 'booking');
    assert.match(t, /^A-\d{4}-\d{4}$/);
    seen.add(t);
  }
  assert.ok(seen.size > 250);
  assert.match(generateTicket(db(), 'message'), /^K-\d{4}-\d{4}$/);
});

test('слоты: 10 штук 09:00–18:00, даты в пределах 14 дней', () => {
  assert.equal(SLOT_TIMES.length, 10);
  assert.equal(SLOT_TIMES[0], '09:00');
  assert.equal(SLOT_TIMES[9], '18:00');
  const now = moscowNow();
  assert.ok(isValidSlotDate(now.date));
  const d14 = new Date(now.date + 'T12:00:00Z'); d14.setUTCDate(d14.getUTCDate() + 13);
  assert.ok(isValidSlotDate(d14.toISOString().slice(0, 10)));
  const d15 = new Date(now.date + 'T12:00:00Z'); d15.setUTCDate(d15.getUTCDate() + 14);
  assert.ok(!isValidSlotDate(d15.toISOString().slice(0, 10)));
  assert.ok(!isValidSlotDate('2020-01-01'));
  assert.ok(!isValidSlotDate('не дата'));
  const slots = getSlots(now.date);
  assert.equal(slots.length, 10);
  assert.ok(slots.every((s) => typeof s.available === 'boolean'));
});

test('markdown: экранирует HTML, ссылки только безопасные', () => {
  const html = mdToHtml('# Заголовок\n\nТекст с **жирным** и *курсивом* и <script>alert(1)</script>\n\n- пункт 1\n- пункт 2\n\n[сайт](https://example.com) и [злой](javascript:alert(1))');
  assert.ok(html.includes('<h2>Заголовок</h2>'));
  assert.ok(html.includes('<strong>жирным</strong>'));
  assert.ok(html.includes('<em>курсивом</em>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('<ul>') && html.includes('<li>пункт 1</li>'));
  assert.ok(html.includes('<a href="https://example.com"'));
  assert.ok(!html.includes('javascript:alert'));
});

test('маскировка телефона в логах', () => {
  const m = maskPhone('ошибка при доставке для +79289065700 и +7 (928) 906-57-00');
  assert.ok(!m.includes('9065700'));
  assert.ok(!m.includes('906-57-00'));
});

test('бэкофф outbox: 1/5/30 мин, 2 ч, 6 ч, максимум 8 попыток', () => {
  assert.deepEqual(BACKOFF_MIN, [1, 5, 30, 120, 360, 360, 360]);
  assert.equal(MAX_ATTEMPTS, 8);
});

test('сигнатуры файлов: JPEG/PNG/WebP/AVIF, SVG — отклоняется', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(4)]);
  const avif = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypavif'), Buffer.alloc(4)]);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert.equal(detectImage(jpeg), 'jpeg');
  assert.equal(detectImage(png), 'png');
  assert.equal(detectImage(webp), 'webp');
  assert.equal(detectImage(avif), 'avif');
  assert.equal(detectImage(svg), null);
});

test('scrypt: хеш и проверка пароля', async () => {
  const h = await hashPassword('длинный-пароль-123');
  assert.ok(h.startsWith('scrypt$'));
  assert.ok(await verifyPassword('длинный-пароль-123', h));
  assert.ok(!(await verifyPassword('неверный', h)));
  assert.ok(!(await verifyPassword('длинный-пароль-123', 'мусор')));
});

closeDb();

test('limitFromEnv: пустая строка/пробелы/0/мусор/отрицательное → дефолт, число → число (блокер ревью round5)', () => {
  // Ровно то, что делает systemd EnvironmentFile со строкой `RATE_LIMIT_LEADS=` из .env.example:
  // пустая строка. Number('') === 0 → лимит 0 → всё блокировалось.
  const keys = ['RL_T_UNDEF', 'RL_T_EMPTY', 'RL_T_SPACE', 'RL_T_ZERO', 'RL_T_JUNK', 'RL_T_NEG', 'RL_T_OK', 'RL_T_FLOAT'];
  for (const k of keys) delete process.env[k];
  process.env.RL_T_EMPTY = '';
  process.env.RL_T_SPACE = '   ';
  process.env.RL_T_ZERO = '0';
  process.env.RL_T_JUNK = 'abc';
  process.env.RL_T_NEG = '-3';
  process.env.RL_T_OK = '7';
  process.env.RL_T_FLOAT = '2.5';
  assert.equal(limitFromEnv('RL_T_UNDEF', 5), 5, 'переменная не задана → дефолт');
  assert.equal(limitFromEnv('RL_T_EMPTY', 5), 5, "пустая строка ('' из EnvironmentFile) → дефолт");
  assert.equal(limitFromEnv('RL_T_SPACE', 5), 5, 'пробелы → дефолт');
  assert.equal(limitFromEnv('RL_T_ZERO', 5), 5, 'ноль → дефолт (лимит 0 блокирует всё)');
  assert.equal(limitFromEnv('RL_T_JUNK', 5), 5, 'мусор → дефолт');
  assert.equal(limitFromEnv('RL_T_NEG', 5), 5, 'отрицательное → дефолт');
  assert.equal(limitFromEnv('RL_T_OK', 5), 7, 'валидное число применяется');
  assert.equal(limitFromEnv('RL_T_FLOAT', 5), 2.5, 'дробное положительное применяется как есть');
  for (const k of keys) delete process.env[k];
});

test('seed:demo помечает записи, seed:demo:clear удаляет только помеченное (этап 6, §2.3)', async () => {
  runMigrations();
  const { runSeedDemo, clearSeedDemo, DEMO_NEWS, DEMO_REVIEWS } = await import('../scripts/seed-demo.ts');
  const cnt = (q: string): number => (db().prepare(q).get() as { c: number }).c;
  // Реальные (не демо) записи — clear их трогать не должен.
  db().prepare(`INSERT INTO reviews(author,text,rating,source,status) VALUES('Настоящий Клиент','Реальный текст отзыва',5,'Яндекс Карты','published')`).run();
  db().prepare(`INSERT INTO news(slug,title,excerpt,body_md,category,status,published_at) VALUES('nastoyashchaya-novost','Настоящая новость','x','текст','sovety','published',datetime('now'))`).run();
  runSeedDemo();
  runSeedDemo(); // идемпотентно: второй запуск не удваивает набор
  assert.equal(cnt(`SELECT COUNT(*) c FROM reviews WHERE source='demo'`), DEMO_REVIEWS.length, 'демо-отзывы помечены source=demo');
  assert.equal(cnt(`SELECT COUNT(*) c FROM news WHERE slug LIKE 'demo-%'`), DEMO_NEWS.length, 'демо-новости помечены slug demo-*');
  assert.equal(cnt(`SELECT COUNT(*) c FROM reviews WHERE status='published'`), DEMO_REVIEWS.length + 1, 'без дублей после повторного запуска');
  const res = clearSeedDemo();
  assert.equal(res.news, DEMO_NEWS.length);
  assert.equal(res.reviews, DEMO_REVIEWS.length);
  assert.equal(cnt(`SELECT COUNT(*) c FROM reviews WHERE source='demo'`), 0, 'демо-отзывы удалены');
  assert.equal(cnt(`SELECT COUNT(*) c FROM news WHERE slug LIKE 'demo-%'`), 0, 'демо-новости удалены');
  assert.equal(cnt(`SELECT COUNT(*) c FROM reviews WHERE source='Яндекс Карты'`), 1, 'реальный отзыв не тронут');
  assert.equal(cnt(`SELECT COUNT(*) c FROM news WHERE slug='nastoyashchaya-novost'`), 1, 'реальная новость не тронута');
  db().prepare(`DELETE FROM reviews WHERE author='Настоящий Клиент'`).run();
  db().prepare(`DELETE FROM news WHERE slug='nastoyashchaya-novost'`).run();
});
