#!/usr/bin/env node
/**
 * Гейт аналитики и согласия на cookies (круг 89, задание `prompts/133`, §5).
 *
 * Почему гейт вообще нужен: счётчики Метрики и GA4 разрешены только после согласия,
 * а соблазн «вставить готовый сниппет в Base.astro» огромен — именно так появляется
 * обработка данных без согласия и ложь в политике. Гейт держит три вещи:
 *
 *   1. **Счётчиков нет в разметке.** Без `PUBLIC_YM_ID`/`PUBLIC_GA_ID` в собранных
 *      страницах не должно быть `mc.yandex`, `ym(`, `gtag`, `googletagmanager`,
 *      `google-analytics`: скрипты создаёт `client/consent.ts` в рантайме.
 *   2. **С ID — только data-атрибуты.** На `/`, `/otzyvy`, `/news` и статье есть
 *      `data-ym="<id>"`/`data-ga="<id>"`, но статического `<script src="mc.yandex…">`
 *      в HTML по-прежнему нет. Иначе consent обходится.
 *   3. **Баннер и политика.** `data-consent` есть на всех публичных страницах;
 *      на `/privacy` — якорь `id="cookies"`, слово «Метрика», «Google Analytics»,
 *      `ats_consent` и нет прежней фразы «Отдельный баннер о cookies поэтому не показывается».
 *
 * Запуск:
 *   node scripts/check-analytics.mjs                 — проверка собранного pages-dist
 *   node scripts/check-analytics.mjs --self-test     — проверка самой проверки на фикстурах
 *   node scripts/check-analytics.mjs --ym=123 --ga=G-1 — как будто ID заданы сборкой
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIST = join(HERE, '../pages-dist');

/** Подстроки, которых не должно быть в HTML: это признаки вставленного счётчика. */
const COUNTER_MARKERS = ['mc.yandex', 'ym(', 'gtag', 'googletagmanager', 'google-analytics'];

/** Страницы, на которых data-атрибуты счётчиков обязательны при заданном ID. */
const ID_PAGES = ['index.html', 'otzyvy/index.html', 'news/index.html'];

/** Прежняя формулировка §6 политики — она противоречит подключённой аналитике. */
const OLD_POLICY_PHRASE = 'Отдельный баннер о cookies поэтому не показывается';

const walkHtml = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walkHtml(p);
    return e.name.endsWith('.html') ? [p] : [];
  });

const rel = (dist, file) => file.slice(dist.length + 1).split('\\').join('/');

/**
 * Проверяет артефакт и возвращает список проблем (пустой массив — всё хорошо).
 * @param {string} dist
 * @param {{ym?: string, ga?: string}} [ids]
 * @returns {string[]}
 */
export function analyticsProblems(dist, ids = {}) {
  const problems = [];
  if (!existsSync(dist)) return [`нет собранных страниц: ${dist} (сначала npm run build:pages)`];

  /* `/manage/` — отдельная статика мастерской (своего Base там нет, и баннер ей не нужен),
     а три файла старых адресов услуг — meta-refresh-заглушки: тоже не страницы сайта. */
  const pages = walkHtml(dist).filter((file) => {
    const name = rel(dist, file);
    if (name.startsWith('manage/') || name.startsWith('admin/')) return false;
    return !readFileSync(file, 'utf8').includes('http-equiv="refresh"');
  });
  if (pages.length < 5) problems.push(`в ${dist} слишком мало публичных страниц: ${pages.length}`);

  const ym = (ids.ym ?? '').trim();
  const ga = (ids.ga ?? '').trim();

  for (const file of pages) {
    const name = rel(dist, file);
    const html = readFileSync(file, 'utf8');

    /* 1. В разметке не должно быть счётчиков — ни при пустых ID, ни при заданных. */
    for (const marker of COUNTER_MARKERS) {
      if (html.includes(marker)) {
        problems.push(`${name}: в HTML есть «${marker}» — счётчик вставлен статически, согласие обходится`);
      }
    }

    /* 2. Баннер согласия — на каждой публичной странице. */
    if (!html.includes('data-consent')) {
      problems.push(`${name}: нет панели согласия (data-consent)`);
    }

    /* 3. С заданным ID — data-атрибуты для consent.ts. */
    if (ym && !html.includes(`data-ym="${ym}"`)) {
      problems.push(`${name}: нет data-ym="${ym}" на <html>`);
    }
    if (ga && !html.includes(`data-ga="${ga}"`)) {
      problems.push(`${name}: нет data-ga="${ga}" на <html>`);
    }
  }

  /* 4. Политика: §6 переписана, якорь для ссылки из баннера на месте. */
  const privacy = join(dist, 'privacy', 'index.html');
  if (!existsSync(privacy)) {
    problems.push('нет собранной страницы политики privacy/index.html');
  } else {
    const html = readFileSync(privacy, 'utf8');
    if (!html.includes('id="cookies"')) problems.push('privacy: нет якоря id="cookies" (на него ссылается баннер)');
    if (!html.includes('Метрика')) problems.push('privacy: §6 не упоминает Метрику');
    if (!html.includes('Google Analytics')) problems.push('privacy: §6 не упоминает Google Analytics');
    if (!html.includes('ats_consent')) problems.push('privacy: §6 не описывает cookie ats_consent');
    if (html.includes(OLD_POLICY_PHRASE)) {
      problems.push('privacy: осталась прежняя фраза «Отдельный баннер о cookies поэтому не показывается» — она противоречит счётчикам');
    }
  }

  return problems;
}

/** Обязательные для ID страницы существуют (иначе проверка «есть data-ym» бессмысленна). */
function checkIdPages(dist, ids, problems) {
  if (!(ids.ym || ids.ga)) return;
  for (const page of ID_PAGES) {
    if (!existsSync(join(dist, page))) problems.push(`нет собранной страницы ${page}`);
  }
  const newsDir = join(dist, 'news');
  const article = existsSync(newsDir)
    ? walkHtml(newsDir).find((f) => rel(newsDir, f).split('/').length >= 2 && !rel(newsDir, f).startsWith('page/') && !rel(newsDir, f).startsWith('cat/'))
    : undefined;
  if (!article) problems.push('нет ни одной собранной статьи /news/<slug>/index.html');
}

/* ── self-test: проверяем, что гейт ловит нарушения и не ругается на корректный артефакт ── */

function makeFixture(root, { banner = true, counter = false, privacy = true, ym = '', ga = '' } = {}) {
  const html = (body) => `<!doctype html><html lang="ru" data-ym="${ym}" data-ga="${ga}" data-policy-version="2026-11-21"><head><title>t</title></head><body>${body}</body></html>`;
  const bannerMarkup = banner ? '<div class="cookie-panel" data-consent hidden role="region" aria-label="Согласие на cookies">Cookies</div>' : '';
  const counterMarkup = counter ? '<script src="https://mc.yandex.ru/metrika/tag.js"></script>' : '';
  for (const dir of ['', 'otzyvy', 'news', 'news/test-article', 'privacy']) {
    mkdirSync(join(root, dir), { recursive: true });
    const text = dir === 'privacy' && privacy
      ? `${bannerMarkup}<h2 id="cookies">6. Cookies и аналитика</h2><p>Яндекс.Метрика и Google Analytics, cookie ats_consent</p>`
      : `${bannerMarkup}${counterMarkup}<p>страница</p>`;
    writeFileSync(join(root, dir, 'index.html'), html(text));
  }
  return root;
}

function selfTest() {
  const base = mkdtempSync(join(tmpdir(), 'ats-analytics-'));
  let fail = 0;
  const expect = (label, problems, wantEmpty) => {
    const ok = wantEmpty ? problems.length === 0 : problems.length > 0;
    if (ok) console.log(`  ok   ${label}`);
    else {
      fail = 1;
      console.error(`FAIL ${label}: ${problems.length ? problems.join(' | ') : 'нарушений не найдено, а должны быть'}`);
    }
  };
  try {
    expect('корректный артефакт без ID — чисто', analyticsProblems(makeFixture(join(base, 'good')), {}), true);
    expect('счётчик в разметке — ловится', analyticsProblems(makeFixture(join(base, 'counter'), { counter: true }), {}), false);
    expect('нет баннера — ловится', analyticsProblems(makeFixture(join(base, 'nobanner'), { banner: false }), {}), false);
    expect('старая редакция §6 — ловится', analyticsProblems(makeFixture(join(base, 'oldpolicy'), { privacy: false }), {}), false);
    expect('ID в data-атрибутах без тега — чисто', analyticsProblems(makeFixture(join(base, 'withid'), { ym: 'test123' }), { ym: 'test123' }), true);
    expect('ID задан, а data-ym нет — ловится', analyticsProblems(makeFixture(join(base, 'noid')), { ym: 'test123' }), false);
    expect('ID задан и тег в разметке — ловится', analyticsProblems(makeFixture(join(base, 'idcounter'), { counter: true, ym: 'test123' }), { ym: 'test123' }), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  console.log(fail ? '\nself-test: FAIL' : '\nself-test: PASS (7/7)');
  return fail;
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) process.exit(selfTest());

const argValue = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
};
const distArg = args.find((a) => a.startsWith('--pages-dist='));
const dist = distArg ? resolve(distArg.slice('--pages-dist='.length)) : DEFAULT_DIST;
const ids = {
  ym: argValue('ym') || (process.env.PUBLIC_YM_ID ?? ''),
  ga: argValue('ga') || (process.env.PUBLIC_GA_ID ?? ''),
};

const problems = analyticsProblems(dist, ids);
checkIdPages(dist, ids, problems);
if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  process.exit(1);
}
const idLabel = [ids.ym ? `ym=${ids.ym}` : '', ids.ga ? `ga=${ids.ga}` : ''].filter(Boolean).join(' ') || 'без ID';
console.log(`PASS: счётчиков в разметке нет, баннер согласия и §6 политики на месте (${idLabel})`);
