/* Круг 69: три статьи по Voyah Free в site/src/server/seed-data.ts (массив "news").
   Источник текста — content/r69/a9/*.md, вставка в сид — по слагу.

   Почему отдельный скрипт, а не gen-seed-data.mjs: тот пересобирает файл целиком из
   content/merged-r26 и затирает правки, сделанные в сиде после генерации (например,
   статью про кондиционер и позиции услуг) — проверено, диф получается на 300+ строк.
   Здесь трогается только секция "news" и только записи с нашими слагами: остальные
   статьи остаются байт в байт как в файле.

   Запуск: node scripts/gen-news-seed.mjs
   Идемпотентно: повторный запуск без изменений в md даёт тот же файл. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const SEED = join(ROOT, 'site', 'src', 'server', 'seed-data.ts');
const R69 = join(ROOT, 'content', 'r69', 'a9');

const ART69 = ['01-to-voyah-free-reglament.md', '02-maslo-voyah-free.md', '03-voyah-free-bolezni.md'];

function parseArticle(file) {
  const raw = readFileSync(file, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('нет frontmatter: ' + file);
  const fm = Object.fromEntries(
    m[1].split('\n').map((l) => l.match(/^([a-z_]+):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], x[2]]),
  );
  for (const key of ['slug', 'category', 'title', 'excerpt', 'seo_description', 'published_at', 'cover_static']) {
    if (!fm[key]) throw new Error(`${file}: нет поля ${key}`);
  }
  if (!['sezonnoe', 'sovety', 'servis'].includes(fm.category)) throw new Error(`${file}: категория «${fm.category}» вне списка`);
  return {
    slug: fm.slug,
    category: fm.category,
    title: fm.title,
    excerpt: fm.excerpt,
    seo_description: fm.seo_description,
    published_at: fm.published_at,
    cover_static: fm.cover_static,
    body_md: m[2].trim(),
  };
}

const ours = ART69.map((f) => parseArticle(join(R69, f)));

const text = readFileSync(SEED, 'utf8');
const marker = '"news": ';
const at = text.indexOf(marker);
if (at < 0) throw new Error('в seed-data.ts нет ключа "news"');
const head = text.slice(0, at + marker.length);
const tail = text.slice(text.lastIndexOf('\n} as const;'));
const prev = JSON.parse(text.slice(at + marker.length, text.lastIndexOf('\n} as const;')));
const ourSlugs = new Set(ours.map((n) => n.slug));
const kept = prev.filter((n) => !ourSlugs.has(n.slug));
const added = ours.filter((n) => !prev.some((p) => p.slug === n.slug)).map((n) => n.slug);
const news = [...kept, ...ours];

writeFileSync(SEED, head + JSON.stringify(news, null, 1) + tail);

console.log(`news: ${prev.length} → ${news.length} статей`);
if (added.length) console.log('добавлено:', added.join(', '));
for (const n of news) {
  console.log(`  ${n.slug.padEnd(26)} ${n.category.padEnd(9)} ${String(n.body_md.length).padStart(6)} зн  ${n.published_at}  ${n.cover_static}`);
}
