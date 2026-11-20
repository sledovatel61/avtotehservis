/* Круг 88: разбор ошибок формы отзыва.
 *
 * Воркер `POST /reviews` отвечает ПЛОСКО (`{error:'validation',
 * fields:{text:'too_short'}}`), заявки — ВЛОЖЕННО (`{error:{code,message,
 * fields}}`). Здесь проверяем, что форма понимает оба формата, переводит коды
 * полей в русские тексты и показывает отдельные сообщения для `consent_version`,
 * `origin`, `too_large`, `delivery_failed` и `rate_limit`.
 *
 * Перед запуском нужен `npm run build` — тест поднимает собранный сервер
 * (иначе `fetch failed`; это штатное поведение, а не дефект).
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { JSDOM } from 'jsdom';

const SITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = mkdtempSync(join(tmpdir(), 'ats-r88-'));
const DATA = join(TMP, 'data');
const REVIEWS_PATH = join(TMP, 'reviews.json');
const RELAY = 'https://relay.test';

/* Адрес прослойки нужен до первого импорта клиента: LEADS_BASE читается на старте. */
process.env.PUBLIC_LEADS_ENDPOINT = RELAY;

const realFetch = globalThis.fetch;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

let srv: ChildProcess | null = null;
let BASE = '';
let PAGE_HTML = '';

before(async () => {
  mkdirSync(DATA, { recursive: true });
  writeFileSync(REVIEWS_PATH, JSON.stringify({
    version: 1,
    updated_at: '2026-11-10',
    items: [{
      id: 'r-2026-11-10-001',
      author: 'Иван П.',
      text: 'Приезжал на плановое ТО и замену масла, всё сделали аккуратно и без задержек.',
      rating: 5,
      source: 'site',
      source_url: null,
      published_at: '2026-11-10',
      status: 'published',
      demo: false,
    }],
  }));
  process.env.DATA_DIR = DATA;
  const { runMigrations } = await import('../scripts/migrate.ts');
  const { runSeed } = await import('../scripts/seed.ts');
  runMigrations();
  runSeed();

  const port = await freePort();
  BASE = `http://127.0.0.1:${port}`;
  srv = spawn(process.execPath, [join(SITE_ROOT, 'dist/server/entry.mjs')], {
    cwd: SITE_ROOT,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: DATA,
      REVIEWS_FILE: REVIEWS_PATH,
      PUBLIC_DEMO_REVIEWS: '1',
      PUBLIC_LEADS_ENDPOINT: RELAY,
      SESSION_SECRET: 'r88',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stderr?.on('data', (d) => { if (process.env.TEST_DEBUG) console.error('[r88-srv]', String(d)); });

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      const r = await realFetch(`${BASE}/otzyvy`);
      if (r.ok) { PAGE_HTML = await r.text(); break; }
    } catch { /* сервер ещё поднимается */ }
    await sleep(250);
  }
  assert.ok(PAGE_HTML.includes('id="rev-form"'), 'страница /otzyvy отдалась собранным сервером (сначала npm run build)');
});

after(() => { srv?.kill('SIGKILL'); });

/* ---------- ответы воркера ---------- */
interface Reply { status: number; body: unknown; headers?: Record<string, string> }
let reply: Reply = { status: 201, body: { ok: true, status: 'published' } };
let calls: { url: string; body: Record<string, unknown> | null }[] = [];

function installFetch(): void {
  calls = [];
  globalThis.fetch = ((u: unknown, init?: RequestInit) => {
    const url = String(u);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const headers = { 'content-type': 'application/json', ...(reply.headers ?? {}) };
    const body = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
    return Promise.resolve(new Response(body, { status: reply.status, headers }));
  }) as typeof fetch;
}

async function mount(): Promise<{ doc: Document; win: JSDOM['window'] }> {
  const dom = new JSDOM(PAGE_HTML, { url: 'http://localhost/otzyvy', pretendToBeVisual: true });
  const win = dom.window;
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = win;
  g.document = win.document;
  for (const key of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLFormElement', 'Element', 'Node', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent']) {
    g[key] = (win as unknown as Record<string, unknown>)[key];
  }
  g.localStorage = win.localStorage;
  try {
    Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
  } catch { /* node-navigator остаётся, onLine = true */ }
  installFetch();
  await import('../src/client/review-form.ts?e=' + Math.random());
  return { doc: win.document, win };
}

const $ = (doc: Document, sel: string): HTMLElement | null => doc.querySelector(sel) as HTMLElement | null;
/** Текст ошибки рядом с полем: `.err` — сосед поля внутри `.field`/`.consent-row`. */
const errIn = (doc: Document, sel: string): string => {
  const field = $(doc, sel)?.closest('.field, .consent-row');
  return (field?.querySelector('.err')?.textContent ?? '').trim();
};
const statusText = (doc: Document): string => ($(doc, '#rev-status')?.textContent ?? '').trim();

/** Заполняет форму заведомо валидными данными (клиентская валидация проходит). */
function fillValid(doc: Document): void {
  const win = doc.defaultView as unknown as { Event: typeof Event };
  const name = $(doc, '#rev-name') as HTMLInputElement;
  name.value = 'Павел И.';
  name.dispatchEvent(new win.Event('input', { bubbles: true }));
  const rating = doc.querySelector('#rev-rating-5') as HTMLInputElement;
  rating.checked = true;
  rating.dispatchEvent(new win.Event('change', { bubbles: true }));
  const text = $(doc, '#rev-text') as HTMLTextAreaElement;
  text.value = 'Меняли масло и фильтры, всё сделали быстро и показали старые детали.';
  text.dispatchEvent(new win.Event('input', { bubbles: true }));
  const consent = $(doc, '#rev-consent') as HTMLInputElement;
  consent.checked = true;
  consent.dispatchEvent(new win.Event('change', { bubbles: true }));
}

function send(doc: Document): void {
  const form = $(doc, '#rev-form') as HTMLFormElement;
  form.requestSubmit();
}

async function waitFor(check: () => boolean, what: string, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(10);
  }
  throw new Error(`не дождались: ${what}`);
}

/** Общий сценарий: заполнить, отправить, дождаться реакции на ответ воркера. */
async function submitWith(settings: Reply): Promise<Document> {
  reply = settings;
  const { doc } = await mount();
  fillValid(doc);
  send(doc);
  const done = () => ($(doc, '#rev-done')?.hasAttribute('hidden') === false);
  const failed = () => ($(doc, '#rev-status')?.getAttribute('data-state') === 'error');
  const fieldErr = () => doc.querySelectorAll('.err.is-on').length > 0;
  await waitFor(() => done() || failed() || fieldErr(), 'ответ формы');
  await sleep(30); // даём доехать остальным обработчикам того же тика
  return doc;
}

describe('ошибки формы отзыва: плоский формат воркера', () => {
  test('1. 400 validation/text=too_short → русский текст под полем, фокус на нём', async () => {
    const doc = await submitWith({ status: 400, body: { error: 'validation', fields: { text: 'too_short' } } });
    assert.equal(errIn(doc, '#rev-text'), 'Текст — от 20 знаков: что делали и как приняли');
    assert.equal(($(doc, '#rev-text'))?.getAttribute('aria-invalid'), 'true');
    assert.equal(doc.activeElement, $(doc, '#rev-text'), 'фокус на поле с ошибкой');
    assert.equal($(doc, '#rev-done')?.hasAttribute('hidden'), true, 'успеха не показываем');
  });

  test('2. 400 link_not_allowed → текст про ссылки в отзыве', async () => {
    const doc = await submitWith({ status: 400, body: { error: 'link_not_allowed', fields: { text: 'link_not_allowed' } } });
    assert.equal(errIn(doc, '#rev-text'), 'Ссылки в отзыве не нужны — уберите http, www, t.me');
  });

  test('3. 400 validation/author=too_long → «до 40 символов» под именем', async () => {
    const doc = await submitWith({ status: 400, body: { error: 'validation', fields: { author: 'too_long' } } });
    assert.equal(errIn(doc, '#rev-name'), 'Имя — до 40 символов');
    assert.equal(($(doc, '#rev-name'))?.getAttribute('aria-invalid'), 'true');
    assert.equal(($(doc, '#rev-text'))?.getAttribute('aria-invalid'), null, 'текст не подсвечен');
  });

  test('4. 400 consent_version → просьба обновить страницу, без подсветки полей', async () => {
    const doc = await submitWith({ status: 400, body: { error: 'consent_version' } });
    assert.match(statusText(doc), /Документ согласия обновился\. Обновите страницу и подтвердите согласие ещё раз\./);
    assert.equal(doc.querySelectorAll('.err.is-on').length, 0, 'ни одно поле не подсвечено');
  });

  test('5. 403 origin → почта и телефон в сообщении', async () => {
    const doc = await submitWith({ status: 403, body: { error: 'origin' } });
    const t = statusText(doc);
    assert.match(t, /Отправка с этого адреса недоступна/);
    assert.match(t, /[a-z0-9._-]+@[a-z0-9.-]+/i, 'есть почта');
    assert.match(t, /\+7[\s(]*\d/, 'есть телефон');
    assert.equal(doc.querySelectorAll('.err.is-on').length, 0);
  });

  test('6. 413 too_large → «слишком длинный»', async () => {
    const doc = await submitWith({ status: 413, body: { error: 'too_large' } });
    assert.match(statusText(doc), /Отзыв слишком длинный — сократите до 1500 знаков\./);
  });

  test('7. 503 delivery_failed → «попробуйте через минуту» и телефон', async () => {
    const doc = await submitWith({ status: 503, body: { error: 'delivery_failed' } });
    const t = statusText(doc);
    assert.match(t, /Не получилось передать отзыв\. Попробуйте через минуту/);
    assert.match(t, /\+7[\s(]*\d/, 'телефон на месте');
  });

  test('8. 429 с retryAfter в теле и без заголовка → секунды из тела', async () => {
    const doc = await submitWith({ status: 429, body: { error: 'rate_limit', retryAfter: 120 } });
    assert.match(statusText(doc), /Слишком часто\. Попробуйте через 120 с\./);
  });
});

describe('ошибки формы отзыва: вложенный формат и успех', () => {
  test('9. вложенный {error:{code,fields}} → тот же русский текст', async () => {
    const doc = await submitWith({ status: 400, body: { error: { code: 'validation', fields: { text: 'too_short' } } } });
    assert.equal(errIn(doc, '#rev-text'), 'Текст — от 20 знаков: что делали и как приняли');
  });

  test('10. 201 → благодарность, поля очищены, запрос ушёл в прослойку', async () => {
    const doc = await submitWith({ status: 201, body: { ok: true, status: 'published' } });
    assert.equal($(doc, '#rev-done')?.hasAttribute('hidden'), false);
    assert.match($(doc, '#rev-done')?.textContent ?? '', /Спасибо! Отзыв опубликован/);
    assert.equal(($(doc, '#rev-name') as HTMLInputElement).value, '');
    assert.equal(($(doc, '#rev-text') as HTMLTextAreaElement).value, '');
    assert.equal(($(doc, '#rev-consent') as HTMLInputElement).checked, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${RELAY}/reviews`);
    assert.equal((calls[0].body as Record<string, unknown>).page, '/otzyvy');
    assert.equal(doc.querySelectorAll('.err.is-on').length, 0);
  });
});
