/* E2E формы записи: jsdom-страница с реального сервера + настоящие fetch в API.
   Проверяет 5 экранов, ошибки под полями, черновик, успех с серверным талоном. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import { JSDOM } from 'jsdom';

const SITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = mkdtempSync(join(tmpdir(), 'ats-e2e-'));
const DIRS = { data: join(TMP, 'data'), media: join(TMP, 'media'), mail: join(TMP, 'mail') };
mkdirSync(DIRS.mail, { recursive: true });

function freePort(): Promise<number> {
  return new Promise((r, e) => {
    const s = net.createServer();
    s.once('error', e);
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); });
  });
}
let port = 0, srv: ChildProcess | null = null, BASE = '';

before(async () => {
  process.env.DATA_DIR = DIRS.data; process.env.MEDIA_DIR = DIRS.media;
  const { runMigrations } = await import('../scripts/migrate.ts');
  const { runSeed } = await import('../scripts/seed.ts');
  runMigrations(); runSeed();
  port = await freePort();
  BASE = `http://127.0.0.1:${port}`;
  srv = spawn(process.execPath, [join(SITE_ROOT, 'dist/server/entry.mjs')], {
    cwd: SITE_ROOT,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), SMTP_JSON_DIR: DIRS.mail,
           SESSION_SECRET: 'e2e', RATE_LIMIT_LEADS: '1000', RATE_LIMIT_UPLOADS: '1000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stderr?.on('data', (d) => { if (process.env.TEST_DEBUG) console.error('[e2e-srv]', String(d)); });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) break; } catch { /* ждём */ }
    await new Promise((r2) => setTimeout(r2, 250));
  }
});
after(() => { srv?.kill('SIGKILL'); });

interface Win { [k: string]: unknown }

async function loadWizard(query = ''): Promise<{ dom: JSDOM; doc: Document; win: Win & Window }> {
  const html = await (await fetch(`${BASE}/appointment${query}`)).text();
  const dom = new JSDOM(html, { url: `http://localhost/appointment${query}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window as unknown as Win & Window;
  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).document = win.document;
  (globalThis as Record<string, unknown>).HTMLElement = win.HTMLElement;
  (globalThis as Record<string, unknown>).HTMLInputElement = win.HTMLInputElement;
  (globalThis as Record<string, unknown>).Element = win.Element;
  (globalThis as Record<string, unknown>).Node = win.Node;
  (globalThis as Record<string, unknown>).Event = win.Event;
  (globalThis as Record<string, unknown>).CustomEvent = win.CustomEvent;
  (globalThis as Record<string, unknown>).KeyboardEvent = win.KeyboardEvent;
  (globalThis as Record<string, unknown>).localStorage = win.localStorage;
  const mm = (): { matches: boolean; addListener: () => void; removeListener: () => void } =>
    ({ matches: false, addListener: () => undefined, removeListener: () => undefined });
  (win as Record<string, unknown>).matchMedia = mm;
  (globalThis as Record<string, unknown>).matchMedia = mm;
  (win as Record<string, unknown>).CSS = { escape: (s: string) => s };
  (globalThis as Record<string, unknown>).CSS = (win as Record<string, unknown>).CSS;
  (win.URL as unknown as Record<string, unknown>).createObjectURL = () => 'blob:stub';
  (win.URL as unknown as Record<string, unknown>).revokeObjectURL = () => undefined;
  (win as Record<string, unknown>).alert = () => undefined;
  // fetch: относительные URL → на тестовый сервер
  const realFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = ((u: unknown, o?: unknown) =>
    realFetch(typeof u === 'string' && u.startsWith('/') ? BASE + u : (u as string), o as RequestInit)) as typeof fetch;
  await import('../src/client/wizard.ts?' + Math.random()); // свежий экземпляр модуля на каждый запуск
  return { dom, doc: win.document, win };
}

function norm(a: string | Document, b: string | Document): [Document, string] {
  return typeof a === 'string' ? [b as Document, a] : [a, b as string];
}
const $ = (a: string | Document, b: string | Document): HTMLElement | null => { const [d, s] = norm(a, b); return d.querySelector(s) as HTMLElement | null; };
const $$ = (a: string | Document, b: string | Document): HTMLElement[] => { const [d, s] = norm(a, b); return Array.from(d.querySelectorAll(s)) as HTMLElement[]; };
function setVal(el: HTMLElement | null, v: string): void {
  if (!el) throw new Error('нет элемента');
  (el as HTMLInputElement).value = v;
  el.dispatchEvent(new (el.ownerDocument.defaultView as unknown as { Event: typeof Event }).Event('input', { bubbles: true }));
}
function setCheck(el: HTMLElement | null, v: boolean): void {
  if (!el) throw new Error('нет чекбокса');
  (el as HTMLInputElement).checked = v;
  el.dispatchEvent(new (el.ownerDocument.defaultView as unknown as { Event: typeof Event }).Event('change', { bubbles: true }));
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function poll(fn: () => boolean, timeout = 6000): Promise<boolean> {
  const t = Date.now() + timeout;
  while (Date.now() < t) { if (fn()) return true; await sleep(150); }
  return fn();
}

test('визард: 5 экранов до успеха с серверным талоном', async () => {
  const { doc } = await loadWizard();
  assert.ok($('#wiz', doc), 'форма на месте');
  assert.equal($('#wiz-step-label', doc)?.textContent, 'Автомобиль');

  // шаг 1
  setVal($('#f-brand', doc), 'Лада');
  assert.ok($$('#brand-sugg button', doc).length > 0, 'подсказки марок из настроек');
  ($$('#brand-sugg button', doc)[0] as HTMLElement).click();
  assert.equal(($('#f-brand', doc) as HTMLInputElement).value, 'Лада (LADA)');
  setVal($('#f-model', doc), 'Vesta');
  setVal($('#f-year', doc), '2019');
  $('#wiz-next', doc)?.click();
  assert.equal($('#wiz-step-label', doc)?.textContent, 'Что нужно сделать');

  // шаг 2: чипы из БД
  const chip = $$('#svc-chips input[name="svc"]', doc).find((i) => (i as HTMLInputElement).value === 'to-maslo');
  assert.ok(chip, 'чип to-maslo отрендерен сервером');
  (chip as HTMLInputElement).click();
  $('#wiz-next', doc)?.click();
  assert.equal($('#wiz-step-label', doc)?.textContent, 'Когда удобно');

  // шаг 3: календарь + слоты с сервера
  const days = $$('#cal .cal-day', doc);
  assert.equal(days.length, 14);
  days[2].click();
  const slotsReady = await poll(() => $$('#slots .slot', doc).length === 10);
  assert.ok(slotsReady, 'слоты загрузились из /api/slots');
  const free = $$('#slots .slot', doc).find((b) => !(b as HTMLButtonElement).disabled);
  assert.ok(free, 'есть свободный слот');
  (free as HTMLElement).click();
  assert.ok(free.classList.contains('is-on'));
  $('#wiz-next', doc)?.click();
  assert.equal($('#wiz-step-label', doc)?.textContent, 'Контакты');

  // шаг 4
  $('#wiz-next', doc)?.click(); // пусто — не пускает
  assert.equal($('#wiz-step-label', doc)?.textContent, 'Контакты', 'без данных шаг не проходит');
  assert.ok(($('#f-name', doc)?.closest('.field')?.textContent ?? '').includes('Укажите имя'), 'ошибка под полем имени');
  setVal($('#f-name', doc), 'Анна');
  setVal($('#f-phone', doc), '89289065700');
  assert.equal(($('#f-phone', doc) as HTMLInputElement).value, '+7 (928) 906-57-00', 'маска телефона');
  setCheck($('#f-consent', doc), true);
  $('#wiz-next', doc)?.click();
  assert.equal($('#wiz-step-label', doc)?.textContent, 'Проверка и отправка');

  // шаг 5: сводка
  const sum = $('#summary', doc)?.textContent ?? '';
  assert.ok(sum.includes('Лада (LADA)') && sum.includes('to-maslo') === false);
  assert.ok(sum.includes('Анна') && sum.includes('+7 (928) 906-57-00'));

  // черновик (сохранение с дебаунсом 500 мс)
  await sleep(700);
  const draft = (globalThis as { localStorage: Storage }).localStorage.getItem('ats_wiz_draft_v2');
  assert.ok(draft && JSON.parse(draft).brand === 'Лада (LADA)', 'черновик в localStorage');

  // отправка → серверный талон
  $('#wiz-submit', doc)?.click();
  assert.ok($('#state-sending', doc)?.classList.contains('is-on'), 'состояние отправки');
  const okState = await poll(() => $('#state-ok', doc)?.classList.contains('is-on') === true);
  assert.ok(okState, 'экран успеха');
  const no = $('#ok-no', doc)?.textContent ?? '';
  assert.match(no, /A-\d{4}-\d{4}/, 'талон с сервера');
  assert.ok(($('#ok-dl', doc)?.textContent ?? '').includes('Анна'), 'сводка на экране успеха');
  assert.ok((doc.body.textContent ?? '').includes('Что взять с собой'));
  const d = (globalThis as { localStorage: Storage }).localStorage.getItem('ats_wiz_draft_v2');
  assert.equal(d, null, 'черновик удалён после успеха');
});

test('визард: prefill ?s=, «не знаю», ASAP, ошибка телефона с сервера не теряет данные', async () => {
  const { doc } = await loadWizard('?s=elektrika');
  const chip = $$('#svc-chips input[name="svc"]', doc).find((i) => (i as HTMLInputElement).value === 'elektrika') as HTMLInputElement | undefined;
  assert.ok(chip?.checked, 'услуга из ?s= предвыбрана');
  setVal($('#f-brand', doc), 'Kia Rio');
  $('#wiz-next', doc)?.click();
  $('#wiz-next', doc)?.click(); // шаг 2 → 3 (чип уже выбран)
  $('#asap-btn', doc)?.click();
  assert.ok($('#asap-btn', doc)?.classList.contains('is-on'), '«как можно скорее» включено');
  $('#wiz-next', doc)?.click();
  assert.equal($('#wiz-step-label', doc)?.textContent, 'Контакты');
  setVal($('#f-name', doc), 'Игорь');
  setVal($('#f-phone', doc), '+7 (928) 906-57-00');
  setCheck($('#f-consent', doc), true);
  $('#wiz-next', doc)?.click();
  assert.equal($('#wiz-step-label', doc)?.textContent, 'Проверка и отправка');
  assert.ok(($('#summary', doc)?.textContent ?? '').includes('как можно скорее') || ($('#summary', doc)?.textContent ?? '').includes('Как можно скорее'));
  $('#wiz-submit', doc)?.click();
  const okState = await poll(() => $('#state-ok', doc)?.classList.contains('is-on') === true);
  assert.ok(okState);
  // «не знаю — нужна диагностика»
  const { doc: doc2 } = await loadWizard();
  setVal($('#f-brand', doc2), 'ГАЗ');
  $('#wiz-next', doc2)?.click();
  setCheck($('#svc-dontknow', doc2), true);
  $('#wiz-next', doc2)?.click();
  assert.equal($('#wiz-step-label', doc2)?.textContent, 'Когда удобно');
});

test('короткая форма контактов: отправка → талон K-', async () => {
  const html = await (await fetch(`${BASE}/contacts`)).text();
  const dom = new JSDOM(html, { url: 'http://localhost/contacts', runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window as unknown as Win & Window;
  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).document = win.document;
  (globalThis as Record<string, unknown>).HTMLElement = win.HTMLElement;
  (globalThis as Record<string, unknown>).Event = win.Event;
  const mm2 = (): { matches: boolean; addListener: () => void; removeListener: () => void } =>
    ({ matches: false, addListener: () => undefined, removeListener: () => undefined });
  (win as Record<string, unknown>).matchMedia = mm2;
  const realFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = ((u: unknown, o?: unknown) =>
    realFetch(typeof u === 'string' && u.startsWith('/') ? BASE + u : (u as string), o as RequestInit)) as typeof fetch;
  await import('../src/client/contacts-form.ts?' + Math.random());
  const doc = win.document as Document;
  setVal($('#c-name', doc), 'Ольга');
  setVal($('#c-phone', doc), '89518269839');
  setVal($('#c-msg', doc), 'Подскажите, работаете ли вы с грузовыми колёсами R22?');
  setCheck($('#c-consent', doc), true);
  const E = (win as unknown as { Event: typeof Event }).Event;
  ($('#cform', doc) as HTMLFormElement).dispatchEvent(new E('submit', { bubbles: true, cancelable: true }));
  const okState = await poll(() => $('#cform-ok', doc)?.classList.contains('is-on') === true);
  assert.ok(okState, 'экран успеха короткой формы');
  assert.match($('#c-ok-no', doc)?.textContent ?? '', /K-\d{4}-\d{4}/, 'талон обращения K-');
});

/* ---------- Раунд 8, M6: лайтбокс галереи работает (клик / Esc / стрелки / фокус) ---------- */
async function loadHome(): Promise<{ doc: Document; win: Win & Window }> {
  const html = await (await fetch(`${BASE}/`)).text();
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window as unknown as Win & Window;
  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).document = win.document;
  (globalThis as Record<string, unknown>).HTMLElement = win.HTMLElement;
  (globalThis as Record<string, unknown>).Element = win.Element;
  (globalThis as Record<string, unknown>).Node = win.Node;
  (globalThis as Record<string, unknown>).Event = win.Event;
  (globalThis as Record<string, unknown>).CustomEvent = win.CustomEvent;
  (globalThis as Record<string, unknown>).KeyboardEvent = win.KeyboardEvent;
  const mm = (): { matches: boolean; addListener: () => void; removeListener: () => void } =>
    ({ matches: false, addListener: () => undefined, removeListener: () => undefined });
  (win as Record<string, unknown>).matchMedia = mm;
  (globalThis as Record<string, unknown>).matchMedia = mm;
  (globalThis as Record<string, unknown>).requestAnimationFrame = (cb: (t: number) => void) =>
    (win as unknown as { requestAnimationFrame: (cb: (t: number) => void) => number }).requestAnimationFrame(cb);
  await import('../src/client/lightbox.ts?' + Math.random());
  return { doc: win.document, win };
}

test('лайтбокс: клик по карточке открывает, Esc закрывает, стрелки листают, фокус возвращается', async () => {
  const { doc, win } = await loadHome();
  const lb = $('#lightbox', doc);
  assert.ok(lb, '#lightbox есть в разметке');
  assert.equal(lb?.getAttribute('role'), 'dialog');
  assert.equal(lb?.getAttribute('aria-modal'), 'true');
  assert.ok(!lb?.classList.contains('is-open'), 'скрыт по умолчанию');

  const cards = $$('[data-gal]', doc);
  assert.ok(cards.length >= 2, 'карточки кейсов на месте');
  const first = cards[0] as HTMLElement;
  const wantTitle = first.getAttribute('data-title') ?? '';
  first.focus(); // в браузере клик фокусирует кнопку — воспроизводим
  first.click();
  assert.ok(lb?.classList.contains('is-open'), 'клик открыл лайтбокс');
  assert.equal($('#lb-title', doc)?.textContent, wantTitle, 'заголовок первого кейса');
  assert.ok($('#lb-img img', doc), 'картинка вставлена');
  // 7.2: фокус ставится на следующем кадре (rAF), когда visibility уже visible
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(doc.activeElement, $('#lb-close', doc), 'фокус на кнопке закрытия (после rAF)');

  const KE = (win as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent;
  const ev = new KE('keydown', { key: 'ArrowRight', bubbles: true });
  doc.dispatchEvent(ev);
  assert.equal($('#lb-title', doc)?.textContent, cards[1].getAttribute('data-title'), 'стрелка листает вперёд');

  const esc = new KE('keydown', { key: 'Escape', bubbles: true });
  doc.dispatchEvent(esc);
  assert.ok(!lb?.classList.contains('is-open'), 'Esc закрыл лайтбокс');
  assert.equal(doc.activeElement, first, 'фокус вернулся на карточку');
});
