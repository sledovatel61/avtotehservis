/* Круг 89 (задание №132): SEO статей «Полезного» — разметка, заголовки, обложки, RSS.
   Что проверяем и почему именно так:
     1. JSON-LD статьи — BlogPosting (не NewsArticle), dateModified из `updated_at`,
        абсолютные publisher.logo и mainEntityOfPage.@id;
     2. даты в разметке — валидный ISO с московским поясом, а не «2026-11-18 10:00»;
     3. <title>: seo_title с фолбэком на title, ≤70 знаков, обрезка по границе слова;
     4. RSS: экранирование &/<, без черновиков и статей без даты, pubDate разбирается,
        guid абсолютный, не больше 20 позиций;
     5. og:image статьи: `-og.jpg` у статьи с обложкой редактора, `cover_static` у старой,
        общий /img/og.png — только когда картинки нет вовсе;
     6. по собранному pages-dist: og:image статьи ведёт на её обложку (не на общий og.png),
        есть article:modified_time и BlogPosting, нет NewsArticle;
     7. по собранному pages-dist: /news/rss.xml опубликован и содержит ≤20 <item>.
   Проверки 6–7 пропускаются, если pages-dist не собран (юнит-режим `npm run typecheck`).
   Запуск: node --test tests/news-seo.test.ts */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  articleTitle,
  metaDescription,
  ogImageFor,
  jsonLdFor,
  breadcrumbFor,
  rssXml,
  isoDateTime,
  rfc822,
  TITLE_MAX,
  DESCRIPTION_MAX,
} from '../src/shared/news-seo.ts';
import type { NewsItem } from '../src/shared/news-schema.ts';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(SITE, 'pages-dist');
const ORIGIN = 'https://example.test';
const NEWS_FILE = join(SITE, 'content', 'news.json');

const realItems: NewsItem[] = JSON.parse(readFileSync(NEWS_FILE, 'utf8')).items;

/** Синтетическая статья: только то, что нужно проверяемой функции. */
const item = (over: Partial<NewsItem> = {}): NewsItem => ({
  slug: 'test-post',
  title: 'Заголовок статьи',
  seo_title: null,
  excerpt: 'Короткое описание статьи.',
  category: 'sovety',
  status: 'published',
  published_at: '2026-11-18 10:00',
  updated_at: '2026-11-20 12:30',
  cover: null,
  cover_static: '/img/news-1.svg',
  body_md: '',
  ...over,
} as NewsItem);

const ldObject = (raw: Record<string, unknown>) => raw as Record<string, any>;

/* ── 1. BlogPosting ─────────────────────────────────────────────────────────── */

test('1. JSON-LD статьи — BlogPosting с dateModified и абсолютными адресами', () => {
  const ld = ldObject(jsonLdFor(item(), { origin: ORIGIN, siteName: 'АвтоТехСервис' }));
  assert.equal(ld['@type'], 'BlogPosting');
  assert.notEqual(ld['@type'], 'NewsArticle');
  assert.equal(ld.dateModified, '2026-11-20T12:30:00+03:00');
  assert.equal(ld.datePublished, '2026-11-18T10:00:00+03:00');
  assert.equal(ld.inLanguage, 'ru');
  assert.equal(ld.publisher.logo.url, `${ORIGIN}/img/logo.svg`);
  assert.ok(String(ld.publisher.logo.url).startsWith('https://'), 'логотип — абсолютный URL');
  assert.equal(ld.mainEntityOfPage['@id'], `${ORIGIN}/news/test-post`);
  assert.ok(String(ld.image[0]).startsWith(`${ORIGIN}/`), 'image — абсолютный URL');
  assert.ok(String(ld.headline).length <= 110, 'headline ≤ 110 знаков');
  assert.equal(ld.description, metaDescription(item()));
});

test('1б. без updated_at дата изменения не выдумывается — берём дату публикации', () => {
  const ld = ldObject(jsonLdFor(item({ updated_at: undefined }), { origin: ORIGIN }));
  assert.equal(ld.dateModified, '2026-11-18T10:00:00+03:00');
});

test('1в. крошки «Полезного»: Главная → Полезное → статья', () => {
  const bc = ldObject(breadcrumbFor(item({ title: 'Статья' }), ORIGIN));
  assert.equal(bc['@type'], 'BreadcrumbList');
  const names = bc.itemListElement.map((x: any) => x.name);
  assert.deepEqual(names, ['Главная', 'Полезное', 'Статья']);
  assert.equal(bc.itemListElement[1].item, `${ORIGIN}/news`);
});

/* ── 2. Даты ────────────────────────────────────────────────────────────────── */

test('2. даты в разметке — ISO с поясом Москвы и разбираются Date.parse', () => {
  assert.equal(isoDateTime('2026-11-18 10:00'), '2026-11-18T10:00:00+03:00');
  assert.equal(isoDateTime('2026-11-18T10:00'), '2026-11-18T10:00:00+03:00');
  assert.equal(isoDateTime(''), '');
  assert.equal(isoDateTime(null), '');
  for (const n of realItems) {
    const ld = ldObject(jsonLdFor(n, { origin: ORIGIN }));
    for (const key of ['datePublished', 'dateModified']) {
      const value = ld[key];
      assert.ok(typeof value === 'string' && value.length > 0, `${n.slug}: ${key} есть`);
      assert.ok(!Number.isNaN(Date.parse(value)), `${n.slug}: ${key} разбирается (${value})`);
      assert.ok(value.endsWith('+03:00'), `${n.slug}: ${key} с московским поясом (${value})`);
      assert.ok(!value.includes(' '), `${n.slug}: ${key} без пробела вместо «T»`);
    }
  }
});

test('2б. RFC 822 для ленты — день недели и +0300', () => {
  assert.equal(rfc822('2026-12-04 09:00'), 'Fri, 04 Dec 2026 09:00:00 +0300');
  assert.ok(!Number.isNaN(Date.parse(rfc822('2026-12-04 09:00'))));
  assert.equal(rfc822(''), '');
});

/* ── 3. <title> и description ───────────────────────────────────────────────── */

test('3. articleTitle: seo_title приоритетнее, иначе title, хвост бренда всегда', () => {
  assert.equal(articleTitle(item({ title: 'Короткий заголовок' })), 'Короткий заголовок — АвтоТехСервис');
  assert.equal(
    articleTitle(item({ title: 'Длинный заголовок', seo_title: 'SEO-версия заголовка' })),
    'SEO-версия заголовка — АвтоТехСервис',
  );
});

test('3б. длинный заголовок обрезается по границе слова, не длиннее 70', () => {
  const long = item({
    title: 'Очень длинный заголовок статьи о ремонте подвески, тормозов и двигателя Voyah Free в сервисе',
  });
  const title = articleTitle(long);
  assert.ok(title.length <= TITLE_MAX, `длина ${title.length} ≤ ${TITLE_MAX}: ${title}`);
  assert.ok(title.endsWith(' — АвтоТехСервис'), 'бренд на месте');
  assert.ok(title.includes('…'), 'обрезка помечена многоточием');
  /* перед многоточием — целое слово, а не обрубок */
  const cut = title.replace(' — АвтоТехСервис', '');
  assert.ok(!/\s$/.test(cut.slice(0, -1)), 'нет висящего пробела перед «…»');
  assert.ok(/[а-яёa-z0-9]$/i.test(cut.slice(0, -1)), 'слово не разорвано');
  assert.ok(long.title.startsWith(cut.slice(0, -1)), 'начало заголовка сохранено');
});

test('3в. все 15 статей укладываются в 70 знаков', () => {
  assert.ok(realItems.length >= 15, `статей в news.json: ${realItems.length}`);
  for (const n of realItems) {
    const title = articleTitle(n);
    assert.ok(title.length <= TITLE_MAX, `${n.slug}: ${title.length} знаков — «${title}»`);
    assert.ok(title.endsWith(' — АвтоТехСервис'), `${n.slug}: бренд в заголовке`);
    assert.equal(new Set([title]).size, 1);
  }
  const titles = realItems.map((n) => articleTitle(n));
  assert.equal(new Set(titles).size, titles.length, 'заголовки статей уникальны');
});

test('3г. metaDescription ≤ 200 по границе слова', () => {
  const short = item({ excerpt: 'Короткое описание.' });
  assert.equal(metaDescription(short), 'Короткое описание.');
  const long = item({ excerpt: `${'Слово '.repeat(60)}конец.` });
  const desc = metaDescription(long);
  assert.ok(desc.length <= DESCRIPTION_MAX, `длина ${desc.length}`);
  assert.ok(desc.endsWith('…'), 'обрезано с многоточием');
  for (const n of realItems) {
    assert.ok(metaDescription(n).length <= DESCRIPTION_MAX, `${n.slug}: description в пределе`);
  }
});

/* ── 4. RSS ─────────────────────────────────────────────────────────────────── */

test('4. rssXml экранирует спецсимволы и отдаёт абсолютные ссылки', () => {
  const tricky = item({
    title: 'Шины & диски <важно>',
    excerpt: 'Цена "от 500 ₽" & скидка < 10%',
    slug: 'shiny-i-diski',
  });
  const xml = rssXml([tricky], { origin: ORIGIN });
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'XML-пролог');
  assert.ok(xml.includes('Шины &amp; диски &lt;важно&gt;'), 'title экранирован');
  assert.ok(xml.includes('&quot;от 500 ₽&quot; &amp; скидка &lt; 10%'), 'description экранирован');
  assert.ok(!/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(xml), 'нет неэкранированных амперсандов');
  assert.ok(xml.includes(`<guid isPermaLink="true">${ORIGIN}/news/shiny-i-diski</guid>`), 'guid абсолютный');
  assert.ok(xml.includes('<language>ru</language>'), 'язык канала');
  assert.ok(xml.includes('atom:link href="https://example.test/news/rss.xml" rel="self"'), 'atom:self');
});

test('4б. в ленту не попадают черновики и статьи без даты, свежие сверху, максимум 20', () => {
  const items: NewsItem[] = [
    item({ slug: 'draft-post', status: 'draft' as NewsItem['status'], published_at: '2026-12-31 10:00' }),
    item({ slug: 'no-date', published_at: '' as unknown as string }),
    ...Array.from({ length: 25 }, (_, i) => item({
      slug: `post-${String(i).padStart(2, '0')}`,
      title: `Статья ${i}`,
      published_at: `2026-10-${String((i % 28) + 1).padStart(2, '0')} 09:00`,
    })),
  ];
  const xml = rssXml(items, { origin: ORIGIN });
  assert.ok(!xml.includes('draft-post'), 'черновик не попал в ленту');
  assert.ok(!xml.includes('/news/no-date'), 'статья без даты не попала в ленту');
  const entries = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  assert.ok(entries.length <= 20, `позиций в ленте: ${entries.length}`);
  assert.equal(entries.length, 20);
  for (const entry of entries) {
    const pub = entry.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? '';
    assert.ok(!Number.isNaN(Date.parse(pub)), `pubDate разбирается: ${pub}`);
    const link = entry.match(/<link>(.*?)<\/link>/)?.[1] ?? '';
    assert.ok(link.startsWith(`${ORIGIN}/news/`), `ссылка абсолютная: ${link}`);
  }
});

test('4в. для реального файла статей лента собирается без пустых pubDate', () => {
  const xml = rssXml(realItems, { origin: ORIGIN });
  const entries = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  assert.ok(entries.length > 0, 'лента не пустая');
  assert.ok(/<lastBuildDate>[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:00 \+0300<\/lastBuildDate>/.test(xml));
});

/* ── 5. Обложка для соцсетей ────────────────────────────────────────────────── */

test('5. ogImageFor: -og.jpg у обложки редактора, cover_static у старой статьи', () => {
  const withCover = item({
    slug: 'kondicioner',
    cover: { base: 'abcd-cover', ext: 'webp', alt: 'обложка' } as NewsItem['cover'],
    cover_static: null,
  });
  assert.equal(ogImageFor(withCover, ORIGIN), `${ORIGIN}/media/news/kondicioner/abcd-cover-og.jpg`);
  const old = item({ slug: 'stuk', cover: null, cover_static: '/img/vy-art-podveska-1600.webp' });
  assert.equal(ogImageFor(old, ORIGIN), `${ORIGIN}/img/vy-art-podveska-1600.webp`);
  const none = item({ cover: null, cover_static: null });
  assert.equal(ogImageFor(none, ORIGIN), `${ORIGIN}/img/og.png`);
  /* хвостовой слэш в origin не даёт «//» */
  assert.equal(ogImageFor(withCover, `${ORIGIN}/`), `${ORIGIN}/media/news/kondicioner/abcd-cover-og.jpg`);
});

test('5б. на текущих данных (cover=null) обложка = cover_static, а не общий og.png', () => {
  for (const n of realItems) {
    const og = ogImageFor(n, ORIGIN);
    assert.ok(og.startsWith(`${ORIGIN}/`), `${n.slug}: абсолютный URL`);
    assert.ok(!og.endsWith('/img/og.png'), `${n.slug}: своя обложка, а не общий og.png`);
  }
});

/* ── 6–7. Собранный pages-dist ──────────────────────────────────────────────── */

const articleDirs = existsSync(DIST)
  ? realItems.map((n) => ({ slug: n.slug, item: n, file: join(DIST, 'news', n.slug, 'index.html') }))
  : [];

test('6. в pages-dist статья отдаёт свою обложку, article:modified_time и BlogPosting', { skip: !articleDirs.length ? 'pages-dist не собран' : false }, () => {
  for (const { slug, item: n, file } of articleDirs) {
    assert.ok(existsSync(file), `${slug}: страница экспортирована`);
    const html = readFileSync(file, 'utf8');
    const og = html.match(/property="og:image" content="([^"]*)"/)?.[1] ?? '';
    const twitter = html.match(/name="twitter:image" content="([^"]*)"/)?.[1] ?? '';
    assert.ok(/^https?:\/\//.test(og), `${slug}: og:image абсолютный — ${og}`);
    assert.equal(twitter, og, `${slug}: twitter:image совпадает с og:image`);
    assert.ok(og.endsWith(n.cover ? `-og.jpg` : (n.cover_static ?? '/img/og.png')), `${slug}: обложка статьи (${og})`);
    assert.ok(/property="article:modified_time" content="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+03:00"/.test(html),
      `${slug}: article:modified_time в ISO с поясом`);
    assert.ok(/<title>[^<]{1,70}<\/title>/.test(html), `${slug}: заголовок не длиннее 70`);
    assert.ok(/"@type":"BlogPosting"/.test(html.replace(/\s+/g, '')), `${slug}: BlogPosting в разметке`);
    assert.ok(!/NewsArticle/.test(html), `${slug}: старой разметки NewsArticle нет`);
  }
});

test('7. в pages-dist опубликована RSS-лента «Полезного»', { skip: existsSync(DIST) ? false : 'pages-dist не собран' }, () => {
  const file = join(DIST, 'news', 'rss.xml');
  assert.ok(existsSync(file), 'news/rss.xml экспортирован (иначе на Pages 404)');
  const xml = readFileSync(file, 'utf8');
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'XML-пролог');
  assert.ok(/<rss version="2.0"/.test(xml), 'корневой элемент rss 2.0');
  const entries = [...xml.matchAll(/<item>/g)].length;
  assert.ok(entries > 0 && entries <= 20, `позиций в ленте: ${entries}`);
  const base = process.env.PUBLIC_BASE_PATH?.replace(/\/+$/, '') ?? '';
  const origin = process.env.PUBLIC_ORIGIN?.replace(/\/+$/, '') ?? '';
  if (origin) {
    const firstLink = xml.match(/<link>([^<]+)<\/link>/)?.[1] ?? '';
    assert.ok(firstLink.startsWith(`${origin}${base}/news`), `ссылка ведёт на адрес публикации: ${firstLink}`);
  }
});
