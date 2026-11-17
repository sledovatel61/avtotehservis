import type { APIRoute } from 'astro';
import { listCatalogServices } from '../server/services.ts';
import { listNews, NEWS_CATEGORIES, newsCategoryCounts } from '../server/content.ts';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const GET: APIRoute = ({ site }) => {
  const base = (site?.href ?? 'http://localhost:4321/').replace(/\/$/, '');
  const statics = ['/', '/about', '/services', '/prices', '/garantii', '/appointment', '/news', '/contacts', '/voyah-free', '/privacy'];
  const urls: { loc: string; lastmod?: string }[] = statics.map((p) => ({ loc: base + p }));
  try {
    for (const s of listCatalogServices()) urls.push({ loc: `${base}/services/${s.slug}` });
    for (const n of listNews({ per: 500 }).items) urls.push({ loc: `${base}/news/${n.slug}`, lastmod: n.published_at ?? undefined });
    /* Страницы листинга «Полезного» — реальные пути, а не query: статический экспорт
       рендерит ровно то, что перечислено в sitemap. */
    const per = 6;
    const newsPages = listNews({ per }).pages;
    for (let i = 2; i <= newsPages; i++) urls.push({ loc: `${base}/news/page/${i}` });
    const counts = newsCategoryCounts();
    for (const { slug } of NEWS_CATEGORIES) {
      const count = counts[slug] ?? 0;
      if (!count) continue;
      const categoryBase = `${base}/news/cat/${slug}`;
      urls.push({ loc: categoryBase });
      for (let i = 2; i <= Math.ceil(count / per); i++) urls.push({ loc: `${categoryBase}/page/${i}` });
    }
  } catch { /* БД не мигрирована — отдаём только статику */ }
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${esc(u.lastmod.slice(0, 10))}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
