/**
 * SEO-обвязка статей «Полезного» (круг 89, задание `prompts/132-task-r89-news-seo.md`).
 *
 * Модуль намеренно чистый: без `node:fs`, без БД и без Astro. Его импортируют
 * страница статьи (`pages/news/[slug].astro`), RSS-эндпоинт (`pages/news/rss.xml.ts`)
 * и тесты (`tests/news-seo.test.ts`), поэтому все функции — детерминированные.
 *
 * Правила, которые здесь зашиты:
 *   • даты в разметке — ISO с часовым поясом сервиса (Москва, +03:00), а не
 *     «2026-11-18 10:00» из файла;
 *   • `<title>` не длиннее 70 знаков вместе с « — АвтоТехСервис», обрезка по границе слова;
 *   • `og:image` статьи — её собственный `-og.jpg` (или `cover_static` у старых статей),
 *     общий `/img/og.png` — только когда картинки нет вовсе;
 *   • в RSS попадают только опубликованные статьи с датой, 20 последних.
 */
import { catTitle, type NewsItem } from './news-schema.ts';

export const SITE_NAME = 'АвтоТехСервис';
/** Хвост заголовка страницы: «<заголовок> — АвтоТехСервис». */
export const TITLE_SUFFIX = ` — ${SITE_NAME}`;
/** Предел `<title>` по заданию: 70 знаков вместе с хвостом. */
export const TITLE_MAX = 70;
/** Предел meta description. */
export const DESCRIPTION_MAX = 200;
/** Сколько статей отдаём в ленте. */
export const RSS_ITEMS_MAX = 20;
/** Часовой пояс сервиса — Москва. */
export const MSK_OFFSET = '+03:00';

const MONTHS_RFC = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_RFC = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Строка файла `YYYY-MM-DD HH:MM` → ISO `YYYY-MM-DDTHH:MM:00+03:00`. */
export function isoDateTime(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  const plain = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/);
  if (plain) return `${plain[1]}T${plain[2]}:${plain[3] ?? '00'}${MSK_OFFSET}`;
  /* Уже ISO с поясом или Z — отдаём как есть, но проверяем разбор. */
  return Number.isNaN(Date.parse(raw)) ? '' : raw;
}

/** Обрезка по границе слова: не рвём слово, добавляем многоточие. */
export function truncateWords(text: string, max: number): string {
  const value = text.trim().replace(/\s+/g, ' ');
  if (max <= 0) return '';
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  const base = (space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:.—-]+$/, '');
  return `${base}…`;
}

/** meta description: `excerpt` (или заголовок) не длиннее 200 знаков по границе слова. */
export function metaDescription(item: Pick<NewsItem, 'excerpt' | 'title'>): string {
  const text = (item.excerpt || item.title || '').trim();
  return text.length <= DESCRIPTION_MAX ? text : truncateWords(text, DESCRIPTION_MAX);
}

/**
 * `<title>` статьи: `seo_title`, иначе `title`; вместе с « — АвтоТехСервис» не длиннее 70.
 * Хвост сохраняем всегда: он и есть бренд в выдаче, обрезаем только саму тему.
 */
export function articleTitle(item: Pick<NewsItem, 'title' | 'seo_title'>): string {
  const base = (item.seo_title ?? '').trim() || (item.title ?? '').trim();
  const full = base + TITLE_SUFFIX;
  if (full.length <= TITLE_MAX) return full;
  const room = TITLE_MAX - TITLE_SUFFIX.length;
  return truncateWords(base, room) + TITLE_SUFFIX;
}

/**
 * Абсолютный адрес картинки для соцсетей и JSON-LD.
 *   • есть обложка из редактора → её `-og.jpg` 1200×630 (рядом с webp-вариантами);
 *   • старая статья (`cover_static`) → как есть, с абсолютным URL;
 *   • нет ничего → общий `/img/og.png`.
 */
export function ogImageFor(
  item: Pick<NewsItem, 'slug' | 'cover' | 'cover_static'>,
  origin: string,
): string {
  const base = origin.replace(/\/+$/, '');
  if (item.cover) return `${base}/media/news/${item.slug}/${item.cover.base}-og.jpg`;
  if (item.cover_static) return `${base}${item.cover_static}`;
  return `${base}/img/og.png`;
}

export interface JsonLdOptions {
  origin: string;
  siteName?: string;
  logoPath?: string;
}

/** JSON-LD статьи: `BlogPosting` (раздел вечнозелёный, это статьи, а не новости). */
export function jsonLdFor(
  item: NewsItem,
  opts: JsonLdOptions,
): Record<string, unknown> {
  const origin = opts.origin.replace(/\/+$/, '');
  const siteName = opts.siteName ?? SITE_NAME;
  const published = isoDateTime(item.published_at);
  const modified = isoDateTime(item.updated_at) || published;
  const url = `${origin}/news/${item.slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: truncateWords(item.title, 110),
    description: metaDescription(item),
    image: [ogImageFor(item, origin)],
    ...(published ? { datePublished: published } : {}),
    ...(modified ? { dateModified: modified } : {}),
    inLanguage: 'ru',
    author: { '@type': 'Organization', name: siteName, url: `${origin}/` },
    publisher: {
      '@type': 'Organization',
      name: siteName,
      logo: { '@type': 'ImageObject', url: `${origin}${opts.logoPath ?? '/img/logo.svg'}` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  };
}

/** `BreadcrumbList` раздела «Полезное»: «Главная» → «Полезное» → статья. */
export function breadcrumbFor(
  item: Pick<NewsItem, 'title' | 'seo_title'>,
  origin: string,
): Record<string, unknown> {
  const base = origin.replace(/\/+$/, '');
  const name = (item.seo_title ?? '').trim() || item.title;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Главная', item: `${base}/` },
      { '@type': 'ListItem', position: 2, name: 'Полезное', item: `${base}/news` },
      { '@type': 'ListItem', position: 3, name },
    ],
  };
}

/** XML-экранирование текста и атрибутов. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** RFC 822 для `pubDate`/`lastBuildDate` ленты: `Thu, 04 Dec 2026 09:00:00 +0300`. */
export function rfc822(value: string | null | undefined): string {
  const iso = isoDateTime(value);
  if (!iso) return '';
  const shifted = new Date(iso);
  if (Number.isNaN(shifted.getTime())) return '';
  /* Даты в файле — московские; смещение фиксировано, чтобы результат не зависел от TZ машины. */
  const msk = new Date(shifted.getTime() + 3 * 3600 * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${DAYS_RFC[msk.getUTCDay()]}, ${pad(msk.getUTCDate())} ${MONTHS_RFC[msk.getUTCMonth()]} `
    + `${msk.getUTCFullYear()} ${pad(msk.getUTCHours())}:${pad(msk.getUTCMinutes())}:00 +0300`;
}

export interface RssOptions {
  origin: string;
  siteName?: string;
  /** Свежая `updated_at` раздела — для `lastBuildDate`. */
  updatedAt?: string | null;
  limit?: number;
}

/**
 * RSS 2.0 «Полезного». В ленту попадают только опубликованные статьи с датой,
 * свежие сверху, не больше 20.
 */
export function rssXml(items: NewsItem[], opts: RssOptions): string {
  const origin = opts.origin.replace(/\/+$/, '');
  const siteName = opts.siteName ?? SITE_NAME;
  const limit = opts.limit ?? RSS_ITEMS_MAX;
  const published = items
    .filter((i) => i.status === 'published' && (i.published_at ?? '').trim() !== '')
    .sort((a, b) => (a.published_at ?? '') < (b.published_at ?? '') ? 1 : -1)
    .slice(0, limit);

  const newest = published.reduce<string>((acc, i) => {
    const upd = i.updated_at || i.published_at || '';
    return upd > acc ? upd : acc;
  }, opts.updatedAt ?? '');
  const lastBuild = rfc822(newest) || rfc822(new Date().toISOString());

  const channelTitle = `${siteName}: Полезное — статьи о ремонте и обслуживании`;
  const feedUrl = `${origin}/news/rss.xml`;
  const listUrl = `${origin}/news`;
  const description = 'Разбираем, когда менять расходники, откуда стук в подвеске и как готовить машину к сезону. С ценами по прайсу сервиса.';

  const entries = published.map((item) => {
    const url = `${origin}/news/${item.slug}`;
    return [
      '    <item>',
      `      <title>${xmlEscape(item.title)}</title>`,
      `      <link>${xmlEscape(url)}</link>`,
      `      <guid isPermaLink="true">${xmlEscape(url)}</guid>`,
      `      <pubDate>${rfc822(item.published_at)}</pubDate>`,
      `      <category>${xmlEscape(catTitle(item.category))}</category>`,
      `      <description>${xmlEscape(item.excerpt)}</description>`,
      '    </item>',
    ].join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${xmlEscape(channelTitle)}</title>`,
    `    <link>${xmlEscape(listUrl)}</link>`,
    `    <description>${xmlEscape(description)}</description>`,
    '    <language>ru</language>',
    `    <lastBuildDate>${lastBuild}</lastBuildDate>`,
    `    <atom:link href="${xmlEscape(feedUrl)}" rel="self" type="application/rss+xml"/>`,
    ...entries,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}
