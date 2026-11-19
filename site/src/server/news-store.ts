/**
 * Чтение статей раздела «Полезное» из `site/content/news.json`
 * (круг 89, задание `prompts/130-task-r89-news-store.md`).
 *
 * Правила:
 *   • Кэш в памяти процесса с проверкой `mtime` (один `statSync` на обращение).
 *   • Переменная окружения `NEWS_FILE` переопределяет путь к файлу (для тестов).
 *   • `fillPrices` подставляет актуальные цены из прайса в `title`, `excerpt`, `body_md`.
 *   • Битый JSON или невалидная запись логируются в `console.warn` и не роняют сайт.
 */

import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPrices, fillPrices } from './prices-store.ts';
import {
  EMPTY_NEWS_DOC,
  NEWS_CATEGORIES,
  NEWS_CATEGORY_SLUGS,
  catTitle,
  draftItems,
  parseNewsDocSoft,
  publishedItems,
  type NewsCategorySlug,
  type NewsCover,
  type NewsDoc,
  type NewsItem,
} from '../shared/news-schema.ts';

export interface CoverInfo {
  src: string;
  lg: string;
  srcset: string | null;
  alt: string;
}

/** Описательные alt для статических иллюстраций в `/img/vy-art-*.webp` и `/img/vy-*.webp`. */
export const STATIC_COVER_ALT: Record<string, string> = {
  '/img/vy-art-to-lift-1600.webp':
    'Иллюстрация: кроссовер на двухстоечном подъёмнике в освещённом боксе автосервиса',
  '/img/vy-art-ac-manifold-1600.webp':
    'Иллюстрация: манометрический коллектор для заправки и проверки автокондиционера крупным планом',
  '/img/vy-art-timing-belt-1600.webp':
    'Иллюстрация: зубчатый ремень ГРМ на шкивах и натяжном ролике двигателя',
  '/img/vy-art-wheel-align-1600.webp':
    'Иллюстрация: переднее колесо автомобиля с закреплённой мишенью стенда сход-развала',
  '/img/vy-art-Winter-prep-1600.webp':
    'Иллюстрация: зимнее колесо с протектором на подъёмнике рядом с тестером АКБ и канистрой',
  '/img/vy-art-fluids-bench-1600.webp':
    'Иллюстрация: моторное масло, тормозная жидкость и антифриз на верстаке механика',
  '/img/vy-art-reglament-1600.webp':
    'Иллюстрация: сервисный чек-лист и две канистры масел на верстаке напротив силуэта Voyah Free',
  '/img/vy-art-momenty-1600.webp':
    'Иллюстрация: динамометрический ключ со шкалой в ньютон-метрах и торцевые головки на верстаке',
  '/img/vy-art-dorest-1600.webp':
    'Иллюстрация: два силуэта редукторов Voyah Free дореста и рестайла рядом с мерными ёмкостями',
  '/img/vy-art-osmotr-1600.webp':
    'Иллюстрация: кроссовер на подъёмнике, инспекционный фонарь, толщиномер и диагностический планшет',
  '/img/vy-art-antifriz-1600.webp':
    'Иллюстрация: контур охлаждения удлинителя хода, рефрактометр и канистра антифриза',
  '/img/vy-art-kondicioner-1600.webp':
    'Иллюстрация: весы заправочной станции кондиционера и манометрический коллектор у подкапотного пространства',
  '/img/vy-art-shinomo-1600.webp':
    'Иллюстрация: тяжёлое колесо гибридного кроссовера, резиновая проставка под домкрат и динамометрический ключ на 160 Н·м',
  '/img/vy-art-pnevmo-1600.webp':
    'Иллюстрация: пневмостойка подвески с резиновым баллоном и датчиком высоты кузова',
  '/img/vy-art-tormoza-1600.webp':
    'Иллюстрация: вентилируемый тормозной диск, суппорт и тестер влажности тормозной жидкости',
  '/img/vy-case-lift-1600.webp':
    'Иллюстрация: тёмно-синий кроссовер Voyah Free на двухстоечном подъёмнике со снятыми колёсами при обслуживании подвески и тормозов',
  '/img/vy-case-diag-1600.webp':
    'Иллюстрация: диагностический планшет со схемой электронных блоков гибридного кроссовера рядом с подкапотным пространством',
  '/img/vy-case-to-1600.webp':
    'Иллюстрация: канистра моторного масла, масляный и воздушный фильтры и динамометрический ключ на верстаке перед постом ТО',
  '/img/vy-case-wheel-1600.webp':
    'Иллюстрация: кроссовер Voyah Free на четырёхстоечном стенде 3D сход-развала с мишенями на всех колёсах',
};

export {
  NEWS_CATEGORIES,
  NEWS_CATEGORY_SLUGS,
  catTitle,
  draftItems,
  publishedItems,
  type NewsCategorySlug,
  type NewsCover,
  type NewsDoc,
  type NewsItem,
};

export interface NewsDiagnostics {
  count: number;
  published: number;
  draft: number;
  errors: string[];
  updated_at: string;
  path: string;
}

/** Путь к `site/content/news.json` с поддержкой переопределения через `NEWS_FILE`. */
export function newsFilePath(): string {
  const env = process.env.NEWS_FILE;
  if (env && env.trim() !== '') return resolve(env.trim());
  const fromCwd = join(process.cwd(), 'content', 'news.json');
  try {
    statSync(fromCwd);
    return fromCwd;
  } catch {
    return fileURLToPath(new URL('../../content/news.json', import.meta.url));
  }
}

interface CacheEntry {
  path: string;
  mtimeMs: number;
  size: number;
  doc: NewsDoc;
  errors: string[];
}

let cache: CacheEntry | null = null;

/** Сброс кэша (для тестов, меняющих `NEWS_FILE` или содержимое файла в одном процессе). */
export function resetNewsCache(): void {
  cache = null;
}

/** Чтение документа `news.json` с мягкой валидацией и кэшем по `mtime`. */
export function readNewsDoc(): { doc: NewsDoc; errors: string[]; fromCache: boolean } {
  const path = newsFilePath();
  let mtimeMs = 0;
  let size = 0;
  try {
    const st = statSync(path);
    mtimeMs = st.mtimeMs;
    size = st.size;
  } catch (err) {
    const msg = `Файл статей не найден или недоступен (${path}): ${err instanceof Error ? err.message : String(err)}`;
    console.warn(`[news] ${msg}`);
    cache = { path, mtimeMs: 0, size: 0, doc: { ...EMPTY_NEWS_DOC, items: [] }, errors: [msg] };
    return { doc: cache.doc, errors: cache.errors, fromCache: false };
  }

  if (cache && cache.path === path && cache.mtimeMs === mtimeMs && cache.size === size) {
    return { doc: cache.doc, errors: cache.errors, fromCache: true };
  }

  let rawText = '';
  try {
    rawText = readFileSync(path, 'utf8');
  } catch (err) {
    const msg = `Не удалось прочитать ${path}: ${err instanceof Error ? err.message : String(err)}`;
    console.warn(`[news] ${msg}`);
    cache = { path, mtimeMs, size, doc: { ...EMPTY_NEWS_DOC, items: [] }, errors: [msg] };
    return { doc: cache.doc, errors: cache.errors, fromCache: false };
  }

  const { doc, errors } = parseNewsDocSoft(rawText);
  if (errors.length > 0) {
    console.warn(
      `[news] ${path}: обнаружено ошибок схемы — ${errors.length}\n  ${errors.slice(0, 10).join('\n  ')}`,
    );
  }

  cache = { path, mtimeMs, size, doc, errors };
  return { doc, errors, fromCache: false };
}

function mapNewsItem(item: NewsItem): NewsItem {
  const prices = getPrices();
  return {
    ...item,
    title: fillPrices(item.title ?? '', prices),
    seo_title: item.seo_title ? fillPrices(item.seo_title, prices) : null,
    excerpt: fillPrices(item.excerpt ?? '', prices),
    body_md: fillPrices(item.body_md ?? '', prices),
  };
}

/** Все опубликованные статьи в порядке `published_at` desc, `slug` asc, с подставленными ценами. */
function allPublishedNews(): NewsItem[] {
  const { doc } = readNewsDoc();
  return publishedItems(doc).map(mapNewsItem);
}

/** Список опубликованных статей с фильтром по категории и пагинацией. */
export function listNews(
  opts: { category?: string | null; page?: number; per?: number } = {},
): { items: NewsItem[]; total: number; pages: number } {
  const per = Math.max(1, opts.per ?? 6);
  const page = Math.max(1, opts.page ?? 1);
  const all = allPublishedNews();
  const filtered = opts.category ? all.filter((n) => n.category === opts.category) : all;
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / per));
  const offset = (page - 1) * per;
  const items = filtered.slice(offset, offset + per);
  return { items, total, pages };
}

/** Опубликованная статья по `slug` (черновики возвращают `undefined`). */
export function getNews(slug: string): NewsItem | undefined {
  return allPublishedNews().find((n) => n.slug === slug);
}

/** Другие опубликованные статьи (кроме `slug`), до `limit` штук. */
export function otherNews(slug: string, limit = 3): NewsItem[] {
  return allPublishedNews()
    .filter((n) => n.slug !== slug)
    .slice(0, Math.max(0, limit));
}

/** Число опубликованных статей по категориям. */
export function newsCategoryCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of allPublishedNews()) {
    out[item.category] = (out[item.category] ?? 0) + 1;
  }
  return out;
}

/** Общее число опубликованных статей. */
export function newsTotal(): number {
  return allPublishedNews().length;
}

/** Число страниц пагинации в заданной категории (для `sitemap.xml`). */
export function newsCategoryPages(category: string, per = 6): number {
  const count = newsCategoryCounts()[category] ?? 0;
  if (!count) return 0;
  return Math.ceil(count / Math.max(1, per));
}

/**
 * Сборка данных обложки статьи без обращения к SQLite `media`:
 * - если задан `item.cover` → `/media/news/<slug>/<base>-960.<ext>`, `srcset` 480/960/1600, `lg` = 1600, `alt = cover.alt`;
 * - иначе `item.cover_static`;
 * - иначе `fallbackSrc`.
 */
export function coverInfo(
  item: { slug?: string; cover?: NewsCover | null; cover_static?: string | null },
  fallbackSrc: string,
  title: string,
  staticAlt?: string,
): CoverInfo {
  if (item.cover && item.slug) {
    const ext = item.cover.ext ?? 'webp';
    const prefix = `/media/news/${item.slug}/${item.cover.base}`;
    return {
      src: `${prefix}-960.${ext}`,
      lg: `${prefix}-1600.${ext}`,
      srcset: `${prefix}-480.${ext} 480w, ${prefix}-960.${ext} 960w, ${prefix}-1600.${ext} 1600w`,
      alt: item.cover.alt || `${title} — фото`,
    };
  }
  const src = item.cover_static ?? fallbackSrc;
  return {
    src,
    lg: src,
    srcset: null,
    alt: staticAlt ?? STATIC_COVER_ALT[src] ?? title,
  };
}

/** Диагностика состояния файла статей. */
export function newsDiagnostics(): NewsDiagnostics {
  const { doc, errors } = readNewsDoc();
  return {
    count: doc.items.length,
    published: publishedItems(doc).length,
    draft: draftItems(doc).length,
    errors,
    updated_at: doc.updated_at,
    path: newsFilePath(),
  };
}
