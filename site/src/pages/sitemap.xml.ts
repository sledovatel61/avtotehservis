import type { APIRoute } from 'astro';
import { listCatalogServices } from '../server/services.ts';
import { listNews, NEWS_CATEGORIES, newsCategoryPages } from '../server/news-store.ts';
import { listSiteCaseSlugs } from '../server/cases-store.ts';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export const GET: APIRoute = ({ site }) => {
  const base = (site?.href ?? 'http://localhost:4321/').replace(/\/$/, '');
  const statics = ['/', '/about', '/services', '/prices', '/garantii', '/appointment', '/news', '/contacts', '/otzyvy', '/voyah-free', '/privacy', '/consent'];
  const urls: { loc: string; lastmod?: string }[] = statics.map((p) => ({ loc: base + p }));
  try {
    for (const s of listCatalogServices()) urls.push({ loc: `${base}/services/${s.slug}` });
  } catch { /* БД не мигрирована — отдаём только статику */ }
  /* Круг 89: статьи «Полезного» и их пагинация читаются из site/content/news.json (не зависят от БД). */
  try {
    for (const n of listNews({ per: 500 }).items) {
      const lastmod = (n.updated_at ? n.updated_at.slice(0, 10) : (n.published_at ?? '')).slice(0, 10) || undefined;
      urls.push({ loc: `${base}/news/${n.slug}`, lastmod });
    }
    /* Страницы листинга «Полезного» — реальные пути, а не query: статический экспорт
       рендерит ровно то, что перечислено в sitemap. */
    const per = 6;
    const newsPages = listNews({ per }).pages;
    for (let i = 2; i <= newsPages; i++) urls.push({ loc: `${base}/news/page/${i}` });
    for (const { slug } of NEWS_CATEGORIES) {
      const catPages = newsCategoryPages(slug, per);
      if (!catPages) continue;
      const categoryBase = `${base}/news/cat/${slug}`;
      urls.push({ loc: categoryBase });
      for (let i = 2; i <= catPages; i++) urls.push({ loc: `${categoryBase}/page/${i}` });
    }
  } catch { /* файл статей битый — базовый /news уже в statics */ }
  /* Задание 79-2: раздел «Наши работы». Файл работ не зависит от БД, поэтому отдельным
     try — падение базы не должно выкидывать работы из карты сайта.
     Сам листинг /raboty в карте есть всегда: статический экспорт рендерит ровно то, что
     перечислено в sitemap, и без этой строки честная пустая страница «работ пока нет»
     не попала бы в собранный сайт (а ссылку на раздел люди копируют руками).
     Страницы пагинации и сами работы — только когда они реально существуют. */
  try {
    const works = listSiteCaseSlugs();
    urls.push({ loc: `${base}/raboty` });
    const per = 24;
    for (let i = 2; i <= Math.ceil(works.length / per); i++) urls.push({ loc: `${base}/raboty/page/${i}` });
    for (const w of works) urls.push({ loc: `${base}/raboty/${w.slug}`, lastmod: w.published_at || undefined });
  } catch { /* файл работ битый — листинг всё равно нужен */ urls.push({ loc: `${base}/raboty` }); }
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${esc(u.lastmod.slice(0, 10))}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
