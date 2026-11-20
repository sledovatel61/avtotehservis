/**
 * RSS 2.0 раздела «Полезное» — `/news/rss.xml` (круг 89, задание 132, §5).
 *
 * Источник — `site/content/news.json` через `news-store`: черновики и статьи без
 * даты в ленту не попадают, свежие сверху, максимум 20. Сборка статики забирает
 * этот адрес отдельно (`scripts/export-pages.mjs`), потому что в sitemap его нет.
 */
import type { APIRoute } from 'astro';
import { listNews, readNewsDoc } from '../../server/news-store.ts';
import type { NewsItem } from '../../shared/news-schema.ts';
import { rssXml } from '../../shared/news-seo.ts';

export const GET: APIRoute = ({ site }) => {
  const origin = (site?.href ?? 'http://localhost:4321/').replace(/\/+$/, '');
  let items: NewsItem[] = [];
  let updatedAt: string | null = null;
  try {
    items = listNews({ per: 200 }).items;
    updatedAt = readNewsDoc().doc.updated_at ?? null;
  } catch { /* битый файл статей — отдаём пустую, но валидную ленту */ }
  const xml = rssXml(items, { origin, updatedAt });
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      /* Лента меняется вместе со статьями; кэш короткий, чтобы правка была видна в тот же день. */
      'Cache-Control': 'public, max-age=1800',
    },
  });
};
