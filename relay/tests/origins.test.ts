/**
 * Тесты списка источников и заголовков CORS после переезда на `ats-rostov.ru`.
 *
 * Главное здесь — первая же проверка: дефолтного списка в коде больше нет.
 * До круга 88 `allowedOrigins({})` возвращал хардкод `DEFAULT_ORIGINS`, и после
 * переезда форма с нового домена получала бы 403, даже если `wrangler.toml`
 * забыли обновить.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { type Env } from '../src/index.ts';
import { allowedOrigins, originAllowed } from '../src/origins.ts';

const SITE = 'https://ats-rostov.ru';
const WWW = 'https://www.ats-rostov.ru';
const PREVIEW = 'https://sledovatel61.github.io';
const LOCAL = 'http://localhost:4321';

const PROD_LIST = `${SITE},${WWW},${PREVIEW},${LOCAL},http://127.0.0.1:4321`;

/* Сеть подменена: Telegram и почта — просто счётчики вызовов. */
let calls = 0;
globalThis.fetch = (async (): Promise<Response> => {
  calls++;
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}) as typeof fetch;

function env(over: Partial<Env> = {}): Env {
  return {
    BOT_TOKEN: '123:TEST',
    TELEGRAM_CHAT_ID: '-1001234567890',
    TELEGRAM_API_BASE: 'https://tg.test',
    ALLOWED_ORIGINS: PROD_LIST,
    SITE_NAME: 'АвтоТехСервис',
    CONSENT_VERSION: '2026-11-20',
    ...over,
  };
}

const req = (origin?: string): Request => new Request('https://relay.test/reviews', {
  method: 'POST',
  ...(origin === undefined ? {} : { headers: { origin } }),
});

const reviewBody = (): Record<string, unknown> => ({
  author: 'Павел И.',
  text: 'Менял масло и колодки, всё сделали быстро и аккуратно',
  rating: 5,
  consent: true,
  consentVersion: '2026-11-20',
  honeypot: '',
  page: '/otzyvy',
});

let ipSeq = 0;
async function post(
  body: unknown,
  opts: { env?: Env; origin?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'cf-connecting-ip': `192.0.2.${++ipSeq}`,
  };
  const origin = opts.origin === undefined ? SITE : opts.origin;
  if (origin !== null) headers.origin = origin;
  return worker.fetch(new Request('https://relay.test/reviews', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }), opts.env ?? env());
}

test.beforeEach(() => { calls = 0; });

/* 1. Список из трёх адресов: свои проходят, чужой — нет. */
test('список из трёх адресов: каждый разрешён, чужой — нет', () => {
  const e = { ALLOWED_ORIGINS: 'https://a.ru,https://b.ru,https://c.ru' };
  assert.deepEqual(allowedOrigins(e), ['https://a.ru', 'https://b.ru', 'https://c.ru']);
  for (const o of ['https://a.ru', 'https://b.ru', 'https://c.ru']) {
    assert.equal(originAllowed(req(o), e), true, o);
  }
  assert.equal(originAllowed(req('https://d.ru'), e), false, 'чужой источник');
  assert.equal(originAllowed(req('https://a.ru.evil.com'), e), false, 'похожий, но чужой домен');
});

/* 2. Главная проверка круга: без ALLOWED_ORIGINS превью больше не разрешено. */
test('ALLOWED_ORIGINS не задан → превью-адрес не разрешён (хардкода нет)', () => {
  assert.deepEqual(allowedOrigins({}), [], 'дефолтного списка нет');
  assert.equal(originAllowed(req(PREVIEW), {}), false, 'https://sledovatel61.github.io больше не проходит сам собой');
  assert.equal(originAllowed(req(SITE), {}), false, 'боевой домен тоже только из конфига');
  assert.equal(originAllowed(req(LOCAL), {}), false);
});

/* 3. Пустые значения — тоже «никого». */
test("ALLOWED_ORIGINS = '' и ' , ' → не разрешено ничего", () => {
  for (const value of ['', ' ', ' , ', ',,', '  ,  ,  ']) {
    const e = { ALLOWED_ORIGINS: value };
    assert.deepEqual(allowedOrigins(e), [], `«${value}» — пустой список`);
    assert.equal(originAllowed(req(SITE), e), false, `«${value}» — отказ`);
  }
});

/* 4. Пробелы вокруг адресов не мешают. */
test('пробелы вокруг адресов обрезаются', () => {
  const e = { ALLOWED_ORIGINS: ' https://a.ru , https://b.ru ' };
  assert.deepEqual(allowedOrigins(e), ['https://a.ru', 'https://b.ru']);
  assert.equal(originAllowed(req('https://a.ru'), e), true);
  assert.equal(originAllowed(req('https://b.ru'), e), true);
  /* Сравниваем уже обрезанные значения из конфига: пробелы в самом заголовке
     Origin срезает рантайм, и это не наша забота. */
  assert.deepEqual(allowedOrigins({ ALLOWED_ORIGINS: '  ' }), []);
});

/* 5. Сравнение точное: другая схема — другой источник. */
test('http://ats-rostov.ru при списке с https://ats-rostov.ru → отказ', () => {
  const e = { ALLOWED_ORIGINS: SITE };
  assert.equal(originAllowed(req(SITE), e), true);
  assert.equal(originAllowed(req('http://ats-rostov.ru'), e), false, 'схема важна');
  assert.equal(originAllowed(req('https://ats-rostov.ru:8443'), e), false, 'порт важен');
  assert.equal(originAllowed(req('https://ATS-ROSTOV.RU'), e), false, 'регистр не нормализуем');
});

/* 6. Без Origin — отказ (это не запрос из браузера). */
test('Origin отсутствует → отказ', () => {
  assert.equal(originAllowed(req(), env()), false);
  assert.equal(originAllowed(new Request('https://relay.test/reviews', {
    method: 'POST',
    headers: { origin: '' },
  }), env()), false);
});

/* 7. Сквозная проверка через воркер: домен проходит, доставка замокана. */
test('POST /reviews с Origin: https://ats-rostov.ru → 201', async () => {
  const r = await post(reviewBody());
  assert.equal(r.status, 201);
  assert.equal(r.headers.get('access-control-allow-origin'), SITE, 'CORS отвечает тем же origin');
  const j = await r.json() as { ok: boolean; status: string; id: string };
  assert.equal(j.ok, true);
  assert.equal(j.status, 'pending');
  assert.ok(j.id);
  assert.equal(calls, 1, 'Telegram вызван один раз');

  const www = await post(reviewBody());
  assert.equal(www.status, 201, 'www-домен тоже в списке');
  assert.equal(www.headers.get('access-control-allow-origin'), SITE);

  /* После переезда старый адрес редиректит — его Origin браузер сохраняет. */
  const preview = await post(reviewBody(), { origin: PREVIEW });
  assert.equal(preview.status, 201, 'превью оставлено в списке на время переезда');

  const alien = await post(reviewBody(), { origin: 'https://ats-rostov.ru.evil.com' });
  assert.equal(alien.status, 403);
  assert.deepEqual(await alien.json(), { error: 'origin' });
});

/* 8. OPTIONS отдаёт expose-headers, иначе Retry-After не виден из JS. */
test('OPTIONS /reviews → 204 и access-control-expose-headers: retry-after', async () => {
  const r = await worker.fetch(new Request('https://relay.test/reviews', {
    method: 'OPTIONS',
    headers: { origin: SITE },
  }), env());
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), SITE);
  assert.equal(r.headers.get('access-control-expose-headers'), 'retry-after');
  assert.match(r.headers.get('access-control-allow-methods') ?? '', /POST/);
});

/* 9. Пустой список ломает приём честно: 403 на уровне эндпоинта и `null` в CORS. */
test('пустой ALLOWED_ORIGINS: 403 и allow-origin = null (fail-closed)', async () => {
  const e = env({ ALLOWED_ORIGINS: '' });

  const r = await post(reviewBody(), { env: e });
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { error: 'origin' });
  assert.equal(r.headers.get('access-control-allow-origin'), 'null');
  assert.equal(r.headers.get('access-control-expose-headers'), 'retry-after');
  assert.equal(calls, 0, 'ничего никуда не отправлено');

  /* Не задано вовсе — то же самое. */
  const bare = await post(reviewBody(), { env: env({ ALLOWED_ORIGINS: undefined }) });
  assert.equal(bare.status, 403);

  /* И заголовки CORS для «никого» не подставляют чужой адрес. */
  const opt = await worker.fetch(new Request('https://relay.test/reviews', {
    method: 'OPTIONS',
    headers: { origin: SITE },
  }), e);
  assert.equal(opt.status, 204, 'preflight отвечаем, но без разрешения');
  assert.equal(opt.headers.get('access-control-allow-origin'), 'null');
});
