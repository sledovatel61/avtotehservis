/* Страница /otzyvy и форма отзыва (круг 87).
   Часть 1 — клиент формы на jsdom-фикстуре с той же разметкой, что в отзывы.astro:
   валидация, ответы прослойки (201/400/429/503), honeypot, сохранение введённого.
   Часть 2 — реальный рендер страницы: демо-чип «пример» и дословная фраза
   про Яндекс.Карты в пустом состоянии (сервер Astro + reviews.json из tmp). */
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
const TMP = mkdtempSync(join(tmpdir(), 'ats-rev-'));

/* Прослойка нужна до первого импорта клиента: LEADS_BASE читается на старте модуля. */
process.env.PUBLIC_LEADS_ENDPOINT = 'https://relay.test';

const PHRASE = 'Читайте отзывы на Яндекс.Картах — там же оценки и схема проезда.';

const FIXTURE = `<!doctype html><html lang="ru"><body>
<form class="rev-form" id="rev-form" novalidate data-consent-version="2026-11-20" data-phone="+7 (951) 826-98-39">
  <p class="rev-unavailable" id="rev-unavailable" hidden>Отправка отзывов сейчас недоступна.</p>
  <div class="fields">
    <div class="field">
      <label for="rev-name">Имя</label>
      <input class="input" type="text" id="rev-name" name="author" autocomplete="name" maxlength="40">
      <span class="hint" id="rev-name-hint">Как к вам обращаться.</span>
      <span class="err" role="alert"></span>
    </div>
  </div>
  <fieldset class="field rev-stars-field">
    <legend>Оценка</legend>
    <div class="rev-star-row">
      <span class="rev-star"><input type="radio" id="rev-rating-5" name="rating" value="5" aria-label="5 звёзд из 5"><label for="rev-rating-5" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg></label></span>
      <span class="rev-star"><input type="radio" id="rev-rating-4" name="rating" value="4" aria-label="4 звезды из 5"><label for="rev-rating-4" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg></label></span>
      <span class="rev-star"><input type="radio" id="rev-rating-3" name="rating" value="3" aria-label="3 звезды из 5"><label for="rev-rating-3" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg></label></span>
      <span class="rev-star"><input type="radio" id="rev-rating-2" name="rating" value="2" aria-label="2 звезды из 5"><label for="rev-rating-2" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg></label></span>
      <span class="rev-star"><input type="radio" id="rev-rating-1" name="rating" value="1" aria-label="1 звезда из 5"><label for="rev-rating-1" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg></label></span>
    </div>
    <span class="hint">По умолчанию не выбрано.</span>
    <span class="err" role="alert"></span>
  </fieldset>
  <div class="field">
    <label for="rev-text">Отзыв</label>
    <textarea id="rev-text" name="text" rows="6" minlength="20" maxlength="1500"></textarea>
    <span class="rev-counter" id="rev-count">0 / 1500</span>
    <span class="err" role="alert"></span>
  </div>
  <div class="field u-sr"><label>Служебное поле<input id="rev-hp" name="rev_hp" type="text" tabindex="-1" autocomplete="off"></label></div>
  <div class="consent-row">
    <input type="checkbox" id="rev-consent">
    <div class="u-flex1">
      <label for="rev-consent">Даю согласие на обработку персональных данных</label>
      <span class="err" role="alert"></span>
    </div>
  </div>
  <button class="btn" type="submit" id="rev-send">Отправить отзыв</button>
  <p class="rev-status" id="rev-status" role="status" aria-live="polite"></p>
  <p class="rev-done" id="rev-done" role="status" aria-live="polite" hidden></p>
</form>
</body></html>`;

type Call = { url: string; body: Record<string, unknown> | null };
let calls: Call[] = [];
let reply: (url: string, init: RequestInit) => Response = () => json(201, { ok: true, status: 'pending' });
const realFetch = globalThis.fetch;

function json(code: number, payload: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status: code,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function installFetch(): void {
  calls = [];
  globalThis.fetch = ((u: unknown, init?: RequestInit) => {
    const url = String(u);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    return Promise.resolve(reply(url, init ?? {}));
  }) as typeof fetch;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, what = 'условие', ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(10);
  }
  throw new Error(`не дождались: ${what}`);
}

async function mount(html = FIXTURE): Promise<{ dom: JSDOM; doc: Document }> {
  const dom = new JSDOM(html, { url: 'http://localhost/otzyvy', pretendToBeVisual: true });
  const win = dom.window as unknown as Window & typeof globalThis;
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = win;
  g.document = win.document;
  for (const key of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLFormElement', 'Element', 'Node', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent']) {
    g[key] = (win as unknown as Record<string, unknown>)[key];
  }
  g.localStorage = win.localStorage;
  try {
    Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
  } catch { /* остаётся node-navigator, onLine=true */ }
  installFetch();
  await import('../src/client/review-form.ts?t=' + Math.random());
  return { dom, doc: win.document };
}

const $ = (doc: Document, sel: string): HTMLElement | null => doc.querySelector(sel) as HTMLElement | null;

function fill(doc: Document, opts: { name?: string; text?: string; rating?: string; consent?: boolean; honeypot?: string } = {}): void {
  const name = $(doc, '#rev-name') as HTMLInputElement;
  const text = $(doc, '#rev-text') as HTMLTextAreaElement;
  name.value = opts.name ?? 'Павел И.';
  name.dispatchEvent(new (ev(doc))('input', { bubbles: true }));
  text.value = opts.text ?? 'Меняли масло и фильтры, всё сделали быстро и показали старые детали.';
  text.dispatchEvent(new (ev(doc))('input', { bubbles: true }));
  if (opts.rating !== '') {
    const r = doc.querySelector(`#rev-rating-${opts.rating ?? '5'}`) as HTMLInputElement;
    r.checked = true;
    r.dispatchEvent(new (ev(doc))('change', { bubbles: true }));
  }
  const consent = $(doc, '#rev-consent') as HTMLInputElement;
  consent.checked = opts.consent ?? true;
  consent.dispatchEvent(new (ev(doc))('change', { bubbles: true }));
  if (opts.honeypot) ($(doc, '#rev-hp') as HTMLInputElement).value = opts.honeypot;
}

/** Конструктор Event из окна jsdom (в типах lib.dom у Window его нет). */
function ev(doc: Document): typeof Event {
  return (doc.defaultView as unknown as { Event: typeof Event }).Event;
}

function send(doc: Document): void {
  const form = $(doc, '#rev-form') as HTMLFormElement;
  if (typeof form.requestSubmit === 'function') form.requestSubmit();
  else form.dispatchEvent(new (ev(doc))('submit', { bubbles: true, cancelable: true }));
}

const errText = (doc: Document, scope: string): string =>
  ($(doc, `${scope} .err`)?.textContent ?? '').trim();

after(() => { globalThis.fetch = realFetch; });

describe('форма отзыва /otzyvy', () => {
  test('1. пустая отправка: ошибки у обязательных полей, запроса нет', async () => {
    const { doc } = await mount();
    send(doc);
    await waitFor(() => errText(doc, '.field') !== '', 'ошибка в поле имени');
    assert.equal(calls.length, 0, 'без валидных данных запрос не уходит');
    assert.match(errText(doc, '.field'), /Имя/);
    assert.equal(($(doc, '#rev-name'))?.getAttribute('aria-invalid'), 'true');
    assert.equal(($(doc, '#rev-done'))?.hasAttribute('hidden'), true);
  });

  test('2. текст 19 знаков — ошибка и нет запроса; 20 знаков — запрос уходит', async () => {
    const { doc } = await mount();
    const short = 'а'.repeat(19);
    fill(doc, { text: short }); // ровно 19 знаков — на один меньше минимума
    send(doc);
    await waitFor(() => /минимум 20 знаков/.test(doc.body.textContent ?? ''), 'ошибка длины');
    assert.equal(calls.length, 0, 'короткий отзыв не отправляется');

    const { doc: doc2 } = await mount();
    const exact = 'а'.repeat(20); // ровно минимум — проходит
    fill(doc2, { text: exact });
    send(doc2);
    await waitFor(() => calls.length === 1, 'запрос отзыва');
    assert.equal(calls[0].url, 'https://relay.test/reviews');
    assert.equal((calls[0].body as Record<string, unknown>).text, exact);
  });

  test('3. оценка не выбрана — ошибка «поставьте оценку», а не подставленная пятёрка', async () => {
    const { doc } = await mount();
    const radios = Array.from(doc.querySelectorAll('input[name="rating"]')) as HTMLInputElement[];
    assert.equal(radios.length, 5);
    assert.equal(radios.filter((r) => r.checked).length, 0, 'по умолчанию ничего не отмечено');
    assert.equal(radios[0].getAttribute('aria-checked'), 'false');
    fill(doc, { rating: '' });
    send(doc);
    await waitFor(() => /оценк/i.test(doc.body.textContent ?? ''), 'ошибка оценки');
    assert.equal(calls.length, 0);
    assert.equal(radios.filter((r) => r.checked).length, 0, 'оценку не проставили за пользователя');
  });

  test('4. без согласия на обработку ПД — ошибка, запроса нет', async () => {
    const { doc } = await mount();
    fill(doc, { consent: false });
    send(doc);
    await waitFor(() => /согласи/i.test(($(doc, '.consent-row .err')?.textContent ?? '')), 'ошибка согласия');
    assert.equal(calls.length, 0);
    assert.equal($(doc, '.consent-row')?.classList.contains('is-bad'), true);
  });

  test('5. успех: «Отзыв опубликован», поля очищены, кнопка снова активна', async () => {
    reply = () => json(201, { ok: true, status: 'pending' });
    const { doc } = await mount();
    fill(doc);
    send(doc);
    await waitFor(() => ($(doc, '#rev-done')?.hasAttribute('hidden') === false), 'успех');
    assert.match($(doc, '#rev-done')?.textContent ?? '', /Спасибо! Отзыв опубликован\./);
    assert.equal(($(doc, '#rev-name') as HTMLInputElement).value, '');
    assert.equal(($(doc, '#rev-text') as HTMLTextAreaElement).value, '');
    assert.equal(($(doc, '#rev-consent') as HTMLInputElement).checked, false);
    const btn = $(doc, '#rev-send') as HTMLButtonElement;
    assert.equal(btn.disabled, false);
    assert.equal(btn.getAttribute('aria-busy'), 'false');
    assert.equal(calls.length, 1);
    const body = calls[0].body as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ['author', 'consent', 'consentVersion', 'honeypot', 'page', 'rating', 'text']);
    assert.equal(body.page, '/otzyvy');
    assert.equal(body.consentVersion, '2026-11-20');
    assert.equal(body.rating, 5);
    assert.equal(body.consent, true);
  });

  test('6. 429 и 503: понятные тексты, введённое не теряется', async () => {
    reply = () => json(429, { error: 'rate' }, { 'retry-after': '120' });
    const { doc } = await mount();
    fill(doc);
    send(doc);
    await waitFor(() => ($(doc, '#rev-status')?.getAttribute('data-state') === 'error'), '429');
    assert.match($(doc, '#rev-status')?.textContent ?? '', /Слишком часто\. Попробуйте через/);
    assert.match(($(doc, '#rev-name') as HTMLInputElement).value, /Павел/, 'имя сохранилось');
    assert.match(($(doc, '#rev-text') as HTMLTextAreaElement).value, /Меняли масло/);

    reply = () => new Response('bad gateway', { status: 503 });
    const { doc: doc2 } = await mount();
    fill(doc2);
    send(doc2);
    await waitFor(() => ($(doc2, '#rev-status')?.getAttribute('data-state') === 'error'), '503');
    assert.match($(doc2, '#rev-status')?.textContent ?? '', /Не удалось отправить, попробуйте позже/);
    assert.match($(doc2, '#rev-status')?.textContent ?? '', /\+7 \(951\) 826-98-39/);
    assert.match(($(doc2, '#rev-text') as HTMLTextAreaElement).value, /Меняли масло/, 'текст сохранился');
  });

  test('7. honeypot заполнен — успех без запроса', async () => {
    reply = () => json(201, { ok: true, status: 'pending' });
    const { doc } = await mount();
    fill(doc, { honeypot: 'bot-bot' });
    send(doc);
    await waitFor(() => ($(doc, '#rev-done')?.hasAttribute('hidden') === false), 'успех бота');
    assert.equal(calls.length, 0, 'запрос с заполненной ловушкой не уходит');
    assert.match($(doc, '#rev-done')?.textContent ?? '', /Отзыв опубликован/);
  });

  test('8. ссылка в тексте отзыва — предупреждение до отправки', async () => {
    const { doc } = await mount();
    fill(doc, { text: 'Всё хорошо, но вот мой сайт http://example.com — зацените.' });
    send(doc);
    await waitFor(() => /ссылк/i.test(doc.body.textContent ?? ''), 'предупреждение о ссылке');
    assert.equal(calls.length, 0);
  });
});

/* ---------- реальный рендер страницы ---------- */
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

const DATA = join(TMP, 'data');
const REVIEWS_PATH = join(TMP, 'reviews.json');
let srv: ChildProcess | null = null;
let BASE = '';

function reviewItem(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'r-2026-11-10-001',
    author: 'Иван П.',
    text: 'Приезжал на плановое ТО и замену масла, всё сделали аккуратно и без задержек.',
    rating: 5,
    source: 'site',
    source_url: null,
    published_at: '2026-11-10',
    status: 'published',
    demo: false,
    ...over,
  };
}

function writeReviews(items: Record<string, unknown>[]): void {
  writeFileSync(REVIEWS_PATH, JSON.stringify({ version: 1, updated_at: '2026-11-10', items }, null, 2));
}

before(async () => {
  mkdirSync(DATA, { recursive: true });
  writeReviews([reviewItem({})]);
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
      PUBLIC_LEADS_ENDPOINT: '',
      SESSION_SECRET: 'rev-test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stderr?.on('data', (d) => { if (process.env.TEST_DEBUG) console.error('[rev-srv]', String(d)); });
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try { const r = await realFetch(`${BASE}/api/health`); if (r.ok) break; } catch { /* ждём */ }
    await sleep(250);
  }
});

after(() => { srv?.kill('SIGKILL'); });

describe('страница /otzyvy', () => {
  test('9. демо-отзыв помечен чипом «пример», обычный — нет', async () => {
    writeReviews([
      reviewItem({ id: 'r-2026-11-10-001', author: 'Иван П.', demo: false, source: 'site' }),
      reviewItem({ id: 'r-2026-11-11-001', author: 'Демо Клиент', demo: true, source: 'demo', rating: 4 }),
    ]);
    /* globalThis.fetch подменён стабом формы — страницу тянем реальным fetch */
    const html = await (await realFetch(`${BASE}/otzyvy`)).text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const cards = Array.from(doc.querySelectorAll('.rev-card--site')) as HTMLElement[];
    const byAuthor = new Map<string, HTMLElement>();
    for (const c of cards) byAuthor.set((c.querySelector('.rev-who b')?.textContent ?? '').trim(), c);
    const demo = byAuthor.get('Демо Клиент');
    const real = byAuthor.get('Иван П.');
    assert.ok(demo, 'демо-отзыв отрендерен');
    assert.ok(real, 'обычный отзыв отрендерен');
    assert.equal((demo!.querySelector('.rev-demo')?.textContent ?? '').trim(), 'пример');
    assert.equal(real!.querySelector('.rev-demo'), null, 'у обычного отзыва чипа нет');
    assert.match(doc.body.textContent ?? '', /Отзывы с пометкой «пример» — образец оформления/);
  });

  test('10. пустое состояние — дословная фраза про Яндекс.Карты и форма ниже', async () => {
    writeReviews([]);
    /* globalThis.fetch подменён стабом формы — страницу тянем реальным fetch */
    const html = await (await realFetch(`${BASE}/otzyvy`)).text();
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const empty = doc.querySelector('.rev-empty');
    assert.ok(empty, 'блок пустого состояния есть');
    assert.ok((empty!.textContent ?? '').includes(PHRASE), 'фраза дословно в пустом состоянии');
    assert.equal(doc.querySelectorAll('.rev-card--site .rev-demo').length, 0);
    const form = doc.querySelector('#rev-form');
    assert.ok(form, 'форма есть на странице');
    assert.ok((doc.body.textContent ?? '').indexOf(PHRASE) < (doc.body.textContent ?? '').indexOf('Оставить отзыв'), 'форма ниже пустого состояния');
    assert.equal(doc.querySelector('#rev-rating-5')?.getAttribute('type'), 'radio');
    assert.ok(doc.querySelector('#rev-hp')?.getAttribute('tabindex') === '-1', 'honeypot вне табуляции');
    assert.ok(doc.querySelector('#rev-hp')?.getAttribute('autocomplete') === 'off');
    assert.ok((doc.querySelector('#rev-form')?.getAttribute('data-consent-version') ?? '').length > 0, 'версия согласия в разметке формы');
  });
});
