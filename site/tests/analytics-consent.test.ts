/* Круг 89 (задание №133): согласие на cookies, аналитика только после согласия.
   Проверяем ровно то, что обещает политика:
     1. разбор сохранённого выбора: мусор/пусто/чужая версия → «не спрашивали»;
     2. аналитика грузится только при выборе «все» И заданном ID счётчика;
     3. CSP получает домены счётчиков только по факту ID, иначе строка прежняя;
     4. по собранному pages-dist: в HTML нет ни одного счётчика (он появляется лишь
        в рантайме после согласия), баннер есть на всех публичных страницах;
     5. политика §6 переписана: якорь #cookies, «Метрика», «Google Analytics»,
        cookie ats_consent, старой фразы «Отдельный баннер … не показывается» нет;
     6. policy_version ≠ consent_version, consent_version не менялся (заявки живут).
   Проверки 4–5 пропускаются, если pages-dist не собран.
   Запуск: node --test tests/analytics-consent.test.ts */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import {
  POLICY_VERSION,
  CONSENT_COOKIE,
  CONSENT_STORAGE_KEY,
  analyticsAllowed,
  consentState,
  counterHosts,
  cspWithAnalytics,
} from '../src/client/consent.ts';
import { DEFAULTS } from '../src/server/settings.ts';
import { track } from '../src/client/lib.ts';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(SITE, 'pages-dist');
const walkHtml = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walkHtml(join(dir, e.name)) : (e.name.endsWith('.html') ? [join(dir, e.name)] : [])));
/* `/manage/` — отдельная статика мастерской, три файла старых услуг — meta-refresh-заглушки:
   Base у них нет, баннеру там не место. Остальное — публичные страницы сайта. */
const pages = existsSync(DIST)
  ? walkHtml(DIST).filter((file) => {
    const name = file.slice(DIST.length + 1);
    if (name.startsWith('manage/') || name.startsWith('admin/')) return false;
    return !readFileSync(file, 'utf8').includes('http-equiv="refresh"');
  })
  : [];
const skip = pages.length === 0 ? 'pages-dist не собран' : false;

/* ── 1. Разбор выбора ──────────────────────────────────────────────────────── */

test('1. consentState: мусор, пусто и чужая версия → unknown', () => {
  assert.equal(consentState(''), 'unknown');
  assert.equal(consentState(null), 'unknown');
  assert.equal(consentState(undefined), 'unknown');
  assert.equal(consentState('не json'), 'unknown');
  assert.equal(consentState('{}'), 'unknown');
  assert.equal(consentState('{"choice":"maybe","version":"2026-11-21"}'), 'unknown');
  assert.equal(consentState({ choice: 'all' }), 'unknown', 'без версии выбор не засчитываем');
  assert.equal(consentState('{"choice":"all","version":"2020-01-01"}'), 'unknown', 'чужая версия → переспросим');
  assert.equal(consentState('{"choice":"all","version":"2026-11-21"}'), 'all');
  assert.equal(consentState('{"choice":"necessary","version":"2026-11-21"}'), 'necessary');
  assert.equal(consentState({ choice: 'necessary', version: POLICY_VERSION }), 'necessary');
});

test('1б. выбор хранится под ожидаемыми ключами (v1 и cookie)', () => {
  assert.equal(CONSENT_STORAGE_KEY, 'ats_consent_v1');
  assert.equal(CONSENT_COOKIE, 'ats_consent');
});

/* ── 2. Разрешение на загрузку ─────────────────────────────────────────────── */

test('2. analyticsAllowed: только «все» и только при заданном ID', () => {
  assert.equal(analyticsAllowed('all', { ym: '1' }), true);
  assert.equal(analyticsAllowed('all', { ga: 'G-1' }), true);
  assert.equal(analyticsAllowed('all', { ym: '1', ga: 'G-1' }), true);
  assert.equal(analyticsAllowed('necessary', { ym: '1', ga: 'G-1' }), false);
  assert.equal(analyticsAllowed('unknown', { ym: '1' }), false);
  assert.equal(analyticsAllowed('all', {}), false, 'нет ID — нечего грузить');
  assert.equal(analyticsAllowed('all', { ym: '  ' }), false, 'пробелы — это пусто');
});

/* ── 3. Хосты для CSP ──────────────────────────────────────────────────────── */

test('3. counterHosts: домены появляются только по своим ID', () => {
  const none = counterHosts({});
  assert.deepEqual(none, { script: [], img: [], connect: [] });

  const ym = counterHosts({ ym: '123' });
  assert.deepEqual(ym.script, ['https://mc.yandex.ru']);
  assert.deepEqual(ym.img, ['https://mc.yandex.ru']);
  assert.deepEqual(ym.connect, ['https://mc.yandex.ru', 'https://mc.webvisor.org']);
  assert.ok(!ym.script.some((h) => h.includes('google')), 'GA не подключён — его доменов нет');

  const ga = counterHosts({ ga: 'G-1' });
  assert.deepEqual(ga.script, ['https://www.googletagmanager.com']);
  assert.deepEqual(ga.img, ['https://www.google-analytics.com', 'https://www.googletagmanager.com']);
  assert.ok(ga.connect.includes('https://*.analytics.google.com'), 'поддомены GA в connect-src');
  assert.ok(!ga.connect.some((h) => h.includes('yandex')), 'Метрики нет — её доменов нет');

  const both = counterHosts({ ym: '123', ga: 'G-1' });
  assert.ok(both.script.includes('https://mc.yandex.ru') && both.script.includes('https://www.googletagmanager.com'));
  assert.equal(new Set(both.connect).size, both.connect.length, 'дублей нет');
});

/* ── 4. CSP ────────────────────────────────────────────────────────────────── */

const BASE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];

test('4. cspWithAnalytics: без ID строка не меняется, с ID — расширяется точечно', () => {
  const strict = cspWithAnalytics(BASE_CSP, counterHosts({}));
  assert.equal(strict, BASE_CSP.join('; '), 'без ID политика побайтово прежняя');
  assert.ok(!strict.includes('mc.yandex') && !strict.includes('google'), 'чужих доменов нет');

  const withYm = cspWithAnalytics(BASE_CSP, counterHosts({ ym: '123' }));
  assert.ok(withYm.includes("script-src 'self' https://mc.yandex.ru"), `script-src: ${withYm}`);
  assert.ok(withYm.includes("connect-src 'self' https://mc.yandex.ru https://mc.webvisor.org"));
  assert.ok(withYm.includes("img-src 'self' data: https://mc.yandex.ru"));
  assert.ok(!withYm.includes('googletagmanager'), 'GA не задан — его домена нет');
  assert.ok(withYm.includes("default-src 'self'") && withYm.includes("object-src 'none'"), 'прочие директивы целы');

  const withGa = cspWithAnalytics(BASE_CSP, counterHosts({ ga: 'G-1' }));
  assert.ok(withGa.includes('https://www.googletagmanager.com'), 'script-src GA');
  assert.ok(withGa.includes('https://www.google-analytics.com'), 'img/connect GA');
});

/* ── 5. Артефакт: в разметке нет счётчиков, баннер есть ────────────────────── */

test('5. в pages-dist нет статических счётчиков и есть панель согласия', { skip }, () => {
  for (const file of pages) {
    const name = file.slice(DIST.length + 1);
    const html = readFileSync(file, 'utf8');
    for (const marker of ['mc.yandex', 'googletagmanager', 'google-analytics', 'gtag(']) {
      assert.ok(!html.includes(marker), `${name}: в HTML нет «${marker}» — счётчик только после согласия`);
    }
    assert.ok(html.includes('data-consent'), `${name}: панель согласия на месте`);
    assert.ok(html.includes('data-policy-version='), `${name}: версия политики в <html>`);
  }
});

test('6. баннер: две кнопки, отзыв, ссылка на политику и aria', { skip }, () => {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  assert.ok(/role="region"[^>]*aria-label="Согласие на cookies"/.test(html), 'role=region с подписью');
  assert.ok(html.includes('data-consent-accept'), 'кнопка «Принять все»');
  assert.ok(html.includes('data-consent-necessary'), 'кнопка «Только необходимые»');
  assert.ok(html.includes('data-consent-revoke'), 'кнопка отзыва согласия');
  assert.ok(html.includes('/privacy#cookies'), 'ссылка «Подробнее — в политике» на якорь §6');
  assert.ok(/data-consent[^>]*hidden/.test(html), 'до решения панель скрыта (нет мигания и автофокуса)');
});

/* ── 7. Политика §6 ────────────────────────────────────────────────────────── */

test('7. политика: §6 переписана под Метрику и GA4', { skip }, () => {
  const html = readFileSync(join(DIST, 'privacy', 'index.html'), 'utf8');
  assert.ok(html.includes('id="cookies"'), 'якорь #cookies');
  for (const phrase of ['Яндекс.Метрика', 'Google Analytics', 'ats_consent', 'anonymize_ip', '152-ФЗ']) {
    assert.ok(html.includes(phrase), `§6 упоминает «${phrase}»`);
  }
  assert.ok(html.includes('Настройки cookies'), 'сказано, как изменить выбор');
  assert.ok(!html.includes('Отдельный баннер о cookies поэтому не показывается'),
    'прежней фразы «баннер не показывается» нет');
  assert.ok(!html.includes('Сторонние системы аналитики, счётчики, рекламные пиксели и социальные виджеты на сайте не применяются'),
    'прежнего утверждения «аналитики нет» тоже нет');
  assert.ok(html.includes('Черновик формы записи сохраняется'), 'абзац про localStorage-черновик сохранён');
});

test('7б. версия политики напечатана в шапке документа', { skip }, () => {
  const html = readFileSync(join(DIST, 'privacy', 'index.html'), 'utf8');
  assert.ok(html.includes(`Версия ${DEFAULTS.policy_version}`), `в лиде — policy_version ${DEFAULTS.policy_version}`);
});

/* ── 8. Версии ─────────────────────────────────────────────────────────────── */

test('8. policy_version ≠ consent_version; согласие формы не тронуто', () => {
  assert.equal(DEFAULTS.policy_version, '2026-11-21');
  assert.equal(POLICY_VERSION, DEFAULTS.policy_version, 'константа клиента совпадает с настройками');
  assert.equal(DEFAULTS.consent_version, '2026-11-20', 'consent_version сверяется с relay/wrangler.toml — не меняем');
  assert.notEqual(DEFAULTS.policy_version, DEFAULTS.consent_version, 'это разные сущности');
});

test('9. события сайта уходят целью в Метрику только после согласия и загрузки счётчика', () => {
  /* Круг 100: `track()` теперь дублирует событие целью Метрики (reachGoal), иначе в
     отчёте «Цели» были бы только визиты. До согласия наружу не уходит ничего. */
  const goals: unknown[][] = [];
  const doc = new JSDOM('<!doctype html><html data-ym="12345678"><body></body></html>').window.document;
  const win = doc.defaultView as unknown as { ym?: (...args: unknown[]) => void };
  win.ym = (...args: unknown[]) => goals.push(args);
  const g = globalThis as unknown as { document?: Document; window?: unknown };
  const prevDoc = g.document, prevWin = g.window;
  g.document = doc as unknown as Document;
  g.window = doc.defaultView;

  try {
    /* согласия ещё нет (флага загрузки нет) — цель не отправляем */
    track('cform_success');
    assert.equal(goals.length, 0, 'до согласия цель не уходит');

    doc.documentElement.dataset.ymLoaded = '1';
    track('cform_success');
    assert.deepEqual(goals[0], ['12345678', 'reachGoal', 'cform_success']);
    assert.equal(goals.length, 1);

    /* счётчика на странице нет (сборка без PUBLIC_YM_ID) — тоже молчим */
    delete doc.documentElement.dataset.ym;
    track('call_click');
    assert.equal(goals.length, 1, 'без номера счётчика цель не уходит');
  } finally {
    g.document = prevDoc;
    g.window = prevWin;
  }
});
