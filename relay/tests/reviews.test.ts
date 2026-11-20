/**
 * Тесты приёма отзывов `POST /reviews`.
 *
 * Сеть подменена: Telegram и почта — это просто записи в массиве `calls`.
 * Настоящих запросов наружу нет ни одного.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { hashIp, type Env } from '../src/index.ts';
import { validateReview, looksLikeLink } from '../src/validate.ts';
import { composeReviewTelegram } from '../src/telegram.ts';
import { composeReviewEmail } from '../src/email.ts';
import { originAllowed } from '../src/origins.ts';

const ORIGIN = 'https://sledovatel61.github.io';

interface Call { url: string; body: Record<string, unknown> }
let calls: Call[] = [];
let tgStatus = 200;
let mailStatus = 200;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  const raw = init?.body;
  const body = raw ? JSON.parse(String(raw)) as Record<string, unknown> : {};
  calls.push({ url, body });
  const status = /\/sendMessage|\/sendPhoto/.test(url) ? tgStatus : mailStatus;
  return new Response(JSON.stringify({ ok: status === 200 }), { status });
}) as typeof fetch;

function env(over: Partial<Env> = {}): Env {
  return {
    BOT_TOKEN: '123:TEST',
    TELEGRAM_CHAT_ID: '-1001234567890',
    TELEGRAM_API_BASE: 'https://tg.test',
    ALLOWED_ORIGINS: 'https://sledovatel61.github.io,http://localhost:4321',
    SITE_NAME: 'АвтоТехСервис',
    SITE_ADDRESS: 'Ростов-на-Дону, ул. Портовая, 439',
    CONSENT_VERSION: '2026-11-20',
    ...over,
  };
}

/* Лимит и идемпотентность живут в памяти изолята и общие на весь файл,
   поэтому каждый тест получает свой «адрес» и свой текст. */
let ipSeq = 0;
const nextIp = (): string => `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
let textSeq = 0;
const uniqueText = (base = 'Записался на шиномонтаж, всё сделали быстро и аккуратно'): string =>
  `${base} (${++textSeq})`;

let ip = nextIp();

interface ReviewOver {
  author?: unknown;
  text?: unknown;
  rating?: unknown;
  consent?: unknown;
  consentVersion?: unknown;
  honeypot?: unknown;
  page?: unknown;
}

const review = (over: ReviewOver = {}): Record<string, unknown> => ({
  author: 'Павел И.',
  text: uniqueText(),
  rating: 5,
  consent: true,
  consentVersion: '2026-11-20',
  honeypot: '',
  page: '/otzyvy',
  ...over,
});

async function post(
  body: unknown,
  opts: { env?: Env; origin?: string | null; ip?: string; raw?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'cf-connecting-ip': opts.ip ?? ip,
  };
  const origin = opts.origin === undefined ? ORIGIN : opts.origin;
  if (origin !== null) headers.origin = origin;
  return worker.fetch(new Request('https://relay.test/reviews', {
    method: 'POST',
    headers,
    body: opts.raw ?? JSON.stringify(body),
  }), opts.env ?? env());
}

const tgCalls = (): Call[] => calls.filter((c) => /\/sendMessage|\/sendPhoto/.test(c.url));
const mailCalls = (): Call[] => calls.filter((c) => /brevo|resend/.test(c.url));

test.beforeEach(() => {
  calls = [];
  tgStatus = 200;
  mailStatus = 200;
  ip = nextIp();
});

/* ---------------------------------------------------------------- *
 *  1. Успешный путь
 * ---------------------------------------------------------------- */

test('валидный отзыв: 201 published, Telegram вызван один раз с тем же текстом', async () => {
  const text = uniqueText('Менял масло и колодки, мастер объяснил всё по делу');
  const body = review({ text });

  const r = await post(body);
  assert.equal(r.status, 201);
  const j = await r.json() as { ok: boolean; status: string; id: string };
  assert.equal(j.ok, true);
  assert.equal(j.status, 'published');
  assert.match(j.id, /^[0-9a-f-]{36}$/);

  const tg = tgCalls();
  assert.equal(tg.length, 1, 'ровно одно сообщение в группу');
  const sent = String(tg[0].body.text);
  assert.ok(sent.includes('Новый отзыв с сайта (на модерации)'), 'заголовок про модерацию');
  assert.ok(sent.includes(text), 'текст отзыва в сообщении');
  assert.ok(sent.includes('Оценка: <b>5/5</b>'), 'оценка видна');
  assert.ok(sent.includes('Павел И.'), 'имя видно');
  assert.ok(sent.includes('Опубликовать: админка → Отзывы'), 'подсказка, где публиковать');
  assert.deepEqual(tg[0].body.link_preview_options, { is_disabled: true });
  assert.equal(tg[0].body.parse_mode, 'HTML');

  /* Почта не настроена — вызовов быть не должно. */
  assert.equal(mailCalls().length, 0);
});

test('повтор того же отзыва не дублирует уведомление, ответ всё равно 201', async () => {
  const body = review({ text: uniqueText('Дважды нажал «Отправить», извините') });
  const first = await post(body);
  const second = await post(body);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const a = await first.json() as { id: string };
  const b = await second.json() as { id: string };
  assert.equal(a.id, b.id, 'тот же id — тот же отзыв');
  assert.equal(tgCalls().length, 1, 'уведомление ушло один раз');
});

/* ---------------------------------------------------------------- *
 *  2–5. Валидация
 * ---------------------------------------------------------------- */

test('rating 0 и 6 отклоняются, отсутствие rating — тоже', async () => {
  for (const rating of [0, 6, -1, 2.5, '5', null, undefined]) {
    const r = await post(review({ rating, text: uniqueText() }));
    assert.equal(r.status, 400, `rating=${String(rating)} должен отклоняться`);
    const j = await r.json() as { error: string; fields: Record<string, string> };
    assert.equal(j.error, 'validation');
    assert.ok(j.fields.rating, `поле rating в ошибках при rating=${String(rating)}`);
  }
  assert.equal(tgCalls().length, 0, 'ничего не отправлено');
});

test('границы текста: 19 → 400, 20 → 201, 1501 → 400', async () => {
  const short = await post(review({ text: 'я'.repeat(19) }));
  assert.equal(short.status, 400);
  assert.equal((await short.json() as { fields: Record<string, string> }).fields.text, 'too_short');

  const exact = await post(review({ text: `${'я'.repeat(19)}${++textSeq}`.slice(0, 20) }));
  assert.equal(exact.status, 201, 'ровно 20 знаков принимается');

  const long = await post(review({ text: 'я'.repeat(1501) }));
  assert.equal(long.status, 400);
  assert.equal((await long.json() as { fields: Record<string, string> }).fields.text, 'too_long');
});

test('границы имени и вырезание угловых скобок', async () => {
  const one = await post(review({ author: 'Я', text: uniqueText() }));
  assert.equal(one.status, 400);

  const long = await post(review({ author: 'Я'.repeat(41), text: uniqueText() }));
  assert.equal(long.status, 400);

  const tags = await post(review({ author: '<b>Павел</b>', text: uniqueText() }));
  assert.equal(tags.status, 201);
  const sent = String(tgCalls()[0].body.text);
  assert.ok(sent.includes('<b>bПавел/b</b>') || sent.includes('bПавел/b'), 'скобки вырезаны, разметка не пролезла');
});

test('consent:false → 400, consent не boolean → 400', async () => {
  for (const consent of [false, 'true', 1, undefined]) {
    const r = await post(review({ consent, text: uniqueText() }));
    assert.equal(r.status, 400, `consent=${String(consent)}`);
    const j = await r.json() as { error: string; fields: Record<string, string> };
    assert.equal(j.error, 'validation');
    assert.ok(j.fields.consent);
  }
  assert.equal(tgCalls().length, 0);
});

test('чужая версия согласия → 400 consent_version', async () => {
  const r = await post(review({ consentVersion: '2025-01-01', text: uniqueText() }));
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'consent_version' });
  assert.equal(tgCalls().length, 0);
});

/* ---------------------------------------------------------------- *
 *  6–8. Ловушка, ссылки, Origin
 * ---------------------------------------------------------------- */

test('honeypot: 201 и ноль вызовов Telegram и почты', async () => {
  const r = await post(review({ honeypot: 'http://spam.example', text: uniqueText() }), {
    env: env({ BREVO_API_KEY: 'brevo-test' }),
  });
  assert.equal(r.status, 201);
  const j = await r.json() as { ok: boolean; status: string; id: string };
  assert.equal(j.ok, true);
  assert.equal(j.status, 'published');
  assert.ok(j.id, 'ловушка отвечает так же, как приём — по ответу её не отличить');
  assert.equal(calls.length, 0, 'ни одного сетевого вызова');
});

test('ссылки в тексте и в имени → 400 link_not_allowed', async () => {
  const inText = await post(review({ text: uniqueText('Заходите на https://example.com — там скидки') }));
  assert.equal(inText.status, 400);
  const j = await inText.json() as { error: string; fields: Record<string, string> };
  assert.equal(j.error, 'link_not_allowed');
  assert.equal(j.fields.text, 'link_not_allowed');

  const www = await post(review({ text: uniqueText('Пишите мне www.example.ru, отвечу') }));
  assert.equal(www.status, 400);
  assert.equal((await www.json() as { error: string }).error, 'link_not_allowed');

  const tg = await post(review({ text: uniqueText('Мой телеграм t.me/somebody, пишите') }));
  assert.equal(tg.status, 400);
  assert.equal((await tg.json() as { error: string }).error, 'link_not_allowed');

  const inAuthor = await post(review({ author: 'Павел www.site.ru', text: uniqueText() }));
  assert.equal(inAuthor.status, 400);
  assert.equal((await inAuthor.json() as { error: string }).error, 'link_not_allowed');

  assert.equal(tgCalls().length, 0, 'со ссылкой ничего не отправляем');
});

test('чужой Origin → 403, без Origin → 403, OPTIONS → 204 с CORS', async () => {
  const alien = await post(review({ text: uniqueText() }), { origin: 'https://evil.example' });
  assert.equal(alien.status, 403);
  assert.deepEqual(await alien.json(), { error: 'origin' });

  const none = await post(review({ text: uniqueText() }), { origin: null });
  assert.equal(none.status, 403, 'запрос без Origin — не с сайта');

  const local = await post(review({ text: uniqueText() }), { origin: 'http://localhost:4321' });
  assert.equal(local.status, 201, 'localhost из ALLOWED_ORIGINS пускаем');

  const opt = await worker.fetch(new Request('https://relay.test/reviews', {
    method: 'OPTIONS',
    headers: { origin: ORIGIN },
  }), env());
  assert.equal(opt.status, 204);
  assert.equal(opt.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(opt.headers.get('access-control-allow-methods') ?? '', /POST/);

  assert.equal(tgCalls().length, 1, 'единственное сообщение — от запроса с localhost');
});

/* ---------------------------------------------------------------- *
 *  9. Лимит
 * ---------------------------------------------------------------- */

test('четвёртый отзыв за 10 минут с одного IP → 429 retryAfter:60', async () => {
  for (let i = 0; i < 3; i++) {
    const ok = await post(review({ text: uniqueText() }));
    assert.equal(ok.status, 201, `отзыв №${i + 1} должен пройти`);
  }
  const over = await post(review({ text: uniqueText() }));
  assert.equal(over.status, 429);
  const j = await over.json() as { error: string; retryAfter: number };
  assert.equal(j.error, 'rate_limit');
  assert.equal(j.retryAfter, 60);
  assert.equal(over.headers.get('retry-after'), '60');

  /* Лимит считается по адресу, а не по всему воркеру. */
  const other = await post(review({ text: uniqueText() }), { ip: nextIp() });
  assert.equal(other.status, 201);

  assert.equal(tgCalls().length, 4, 'в группу ушли 4 отзыва: три и один с другого адреса');
});

/* ---------------------------------------------------------------- *
 *  10. Доставка: частичный сбой и полный отказ
 * ---------------------------------------------------------------- */

test('Telegram упал, почта прошла → 201; упали оба — отзыв всё равно на сайте', async () => {
  const mailEnv = env({ BREVO_API_KEY: 'brevo-test' });

  tgStatus = 500;
  const partial = await post(review({ text: uniqueText('Почта дошла, телеграм лежал') }), { env: mailEnv });
  assert.equal(partial.status, 201);
  assert.equal(mailCalls().length, 1, 'письмо ушло');
  assert.equal(mailCalls()[0].body.subject, 'Новый отзыв на сайте — АвтоТехСервис');
  const mail = mailCalls()[0].body as { textContent?: string; htmlContent?: string; attachment?: unknown };
  assert.match(String(mail.textContent), /Почта дошла, телеграм лежал/);
  assert.equal(mail.attachment, undefined, 'вложений у отзыва нет');

  calls = [];
  mailStatus = 500;
  const down = await post(review({ text: uniqueText('Оба канала лежали') }), { env: mailEnv });
  /* Отзыв уже сохранён и опубликован: 503 показал бы человеку ошибку и он
     отправил бы второй раз. Ошибка остаётся только там, где не сохранено ничего. */
  assert.equal(down.status, 201);
  assert.equal(((await down.json()) as { status?: string }).status, 'published');

  calls = [];
  mailStatus = 200;
  const noChannels = await post(review({ text: uniqueText('Ничего не настроено') }), {
    env: env({ BOT_TOKEN: undefined, TELEGRAM_CHAT_ID: undefined }),
  });
  assert.equal(noChannels.status, 201, 'отзыв сохранён — значит, он опубликован, даже без уведомлений');
});

/* ---------------------------------------------------------------- *
 *  11. Размер тела
 * ---------------------------------------------------------------- */

test('тело больше 8 КБ → 413, даже если валидация прошла бы', async () => {
  const big = JSON.stringify(review({ text: 'я'.repeat(8200) }));
  assert.ok(new TextEncoder().encode(big).length > 8 * 1024);
  const r = await post(null, { raw: big });
  assert.equal(r.status, 413);
  assert.deepEqual(await r.json(), { error: 'too_large' });

  /* Тот же размер, но без content-length: поток режется счётчиком. */
  const stream = new Request('https://relay.test/reviews', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': nextIp(), 'transfer-encoding': 'chunked' },
    body: big,
  });
  assert.equal((await worker.fetch(stream, env())).status, 413);

  assert.equal(calls.length, 0, 'тело не поехало никуда');
});

/* ---------------------------------------------------------------- *
 *  Битые запросы и /health
 * ---------------------------------------------------------------- */

test('битый JSON → 400 validation, не объект → 400', async () => {
  const bad = await post(null, { raw: '{"text":' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json() as { error: string }).error, 'validation');

  const arr = await post([review()]);
  assert.equal(arr.status, 400);
});

test('/health: reviews:true, reviewsKv по наличию KV, старые поля на месте', async () => {
  const r = await worker.fetch(new Request('https://relay.test/health'), env());
  assert.equal(r.status, 200);
  const j = await r.json() as Record<string, unknown>;
  assert.equal(j.reviews, true);
  assert.equal(j.reviewsKv, false);
  assert.equal(j.telegram, true);
  assert.equal(j.consentVersion, '2026-11-20');
  assert.equal(j.service, 'ats-leads');

  const fakeKv = {
    get: async (): Promise<string | null> => null,
    put: async (): Promise<void> => {},
  };
  const withKv = await worker.fetch(new Request('https://relay.test/health'), env({ ATS_KV: fakeKv }));
  assert.equal((await withKv.json() as { reviewsKv: boolean }).reviewsKv, true);

  /* С включённым KV приём работает так же, а не 500. */
  const viaKv = await post(review({ text: uniqueText('Отзыв при включённом KV') }), { env: env({ ATS_KV: fakeKv }) });
  assert.equal(viaKv.status, 201);
});

/* ---------------------------------------------------------------- *
 *  Чистые функции
 * ---------------------------------------------------------------- */

test('validateReview: повторы строк и дефолт страницы', () => {
  const repeated = validateReview({
    author: 'Павел',
    text: ['Купите у нас', 'Купите у нас', 'Купите у нас', 'Купите у нас'].join('\n'),
    rating: 5,
    consent: true,
    consentVersion: '2026-11-20',
  });
  assert.equal(repeated.ok, false);
  if (!repeated.ok) assert.equal(repeated.fields.text, 'repeated_lines');

  const three = validateReview({
    author: 'Павел',
    text: ['Купите у нас', 'Купите у нас', 'Купите у нас', 'И ещё разок сходите'].join('\n'),
    rating: 5,
    consent: true,
    consentVersion: '2026-11-20',
  });
  assert.equal(three.ok, true, 'три одинаковые строки подряд — ещё допустимо');

  const noPage = validateReview({
    author: 'Павел', text: 'Всё хорошо, спасибо большое за работу', rating: 4,
    consent: true, consentVersion: '2026-11-20',
  });
  assert.equal(noPage.ok, true);
  if (noPage.ok) assert.equal(noPage.value.page, '/otzyvy');
});

test('оценка звёзд и экранирование в сообщении, письмо без вложений', () => {
  const payload = {
    author: 'Павел И.', text: 'Всё <b>хорошо</b>, спасибо', rating: 4 as const,
    consent: true as const, consentVersion: '2026-11-20', honeypot: '', page: '/otzyvy',
  };
  const tg = composeReviewTelegram(payload, { siteName: 'АвтоТехСервис', at: new Date('2026-11-19T09:15:00Z') });
  assert.ok(tg.includes('<b>4/5</b> ⭐⭐⭐⭐'), 'четыре звезды на четвёрку');
  assert.ok(tg.includes('Всё &lt;b&gt;хорошо&lt;/b&gt;, спасибо'), 'HTML экранирован');
  assert.ok(!/<b>хорошо<\/b>/.test(tg), 'разметка из текста не работает');

  const mail = composeReviewEmail(payload, { siteName: 'АвтоТехСервис', at: new Date('2026-11-19T09:15:00Z') });
  assert.equal(mail.subject, 'Новый отзыв на сайте — АвтоТехСервис');
  assert.ok(mail.text.includes('Павел И.'));
  assert.ok(mail.html.includes('4/5'));
});

test('ссылки распознаются, а обычный текст — нет', () => {
  for (const link of [
    'https://example.com', 'http://example.com', 'www.example.ru',
    't.me/somebody', 'example.com/price', 'магазин.рф',
  ]) {
    assert.equal(looksLikeLink(`Заходите на ${link} за скидкой`), true, link);
  }
  for (const plain of [
    'Масло менял сам, 5 тыс. км назад', 'Цена 2.5 тыс. руб., всё честно',
    'Приехал к 9:00, взяли без очереди', 'Спасибо, всё отлично!',
  ]) {
    assert.equal(looksLikeLink(plain), false, plain);
  }
});

test('originAllowed не пускает пустой Origin и не расширяет список', () => {
  const e = { ALLOWED_ORIGINS: 'https://sledovatel61.github.io' };
  const mk = (origin?: string): Request => new Request('https://relay.test/reviews', {
    method: 'POST',
    ...(origin === undefined ? {} : { headers: { origin } }),
  });
  assert.equal(originAllowed(mk('https://sledovatel61.github.io'), e), true);
  assert.equal(originAllowed(mk('http://localhost:4321'), e), false, 'список не расширяется сам');
  assert.equal(originAllowed(mk(), e), false);
  /* Дефолтного списка больше нет: без ALLOWED_ORIGINS не разрешён никто
     (fail-closed), иначе после переезда хардкод пускал бы старый адрес. */
  assert.equal(originAllowed(mk('https://sledovatel61.github.io'), {}), false, 'без конфига — отказ');
});

test('hashIp одинаков для одного адреса и разный для разных, без самого адреса', async () => {
  const a = await hashIp('203.0.113.7');
  const b = await hashIp('203.0.113.7');
  const c = await hashIp('203.0.113.8');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.ok(!a.includes('203'));
});
