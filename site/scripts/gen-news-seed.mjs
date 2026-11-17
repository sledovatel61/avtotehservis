/* Статьи раздела «Полезное» по Voyah Free в site/src/server/seed-data.ts (массив "news").

   Исторически (круг 69) скрипт брал три файла из content/r69/a9. В круге 75 добавлены
   четыре статьи из content/r75/a9, часть из них — с готовой обложкой (cover_static).
   Теперь список общий и задаётся таблицей ARTICLES: каталог + файл.

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

/* Список статей: каталог в content/ + имя файла. Порядок — как в сиде.
   cover_static в frontmatter необязателен: если поле не задано, в записи его нет. */
const ARTICLES = [
  { dir: 'r69/a9', file: '01-to-voyah-free-reglament.md' },
  { dir: 'r69/a9', file: '02-maslo-voyah-free.md' },
  { dir: 'r69/a9', file: '03-voyah-free-bolezni.md' },
  { dir: 'r75/a9', file: '01-obnovleniya-voyah-free.md' },
  { dir: 'r75/a9', file: '02-svyaz-voyah-free.md' },
  { dir: 'r75/a9', file: '03-prilozhenie-voyah-free.md' },
  { dir: 'r75/a9', file: '04-ekran-i-media-voyah-free.md' },
  { dir: 'r77/a9', file: '01-reglament-raznye-cifry.md' },
  { dir: 'r77/a9', file: '02-momenty-i-obemy.md' },
  { dir: 'r77/a9', file: '03-kondicioner-voyah-free.md' },
];

const REQUIRED = ['slug', 'category', 'title', 'excerpt', 'seo_description', 'published_at'];
const OPTIONAL = ['cover_static'];

function parseArticle(file) {
  const raw = readFileSync(file, 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('нет frontmatter: ' + file);
  /* Значения берём как есть, но снимаем обрамляющие кавычки: часть frontmatter
     пишет title/excerpt в кавычках (в них двоеточия), часть — без. Иначе кавычки
     уезжают в <title> и meta description страницы. */
  const unquote = (v) => {
    const t = v.trim();
    if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t.at(-1) === t[0]) {
      return t.slice(1, -1).replace(/\\(["'\\])/g, '$1');
    }
    return t;
  };
  const fm = Object.fromEntries(
    m[1].split('\n').map((l) => l.match(/^([a-z_]+):\s*(.*)$/)).filter(Boolean).map((x) => [x[1], unquote(x[2])]),
  );
  for (const key of REQUIRED) {
    if (!fm[key]) throw new Error(`${file}: нет поля ${key}`);
  }
  if (!['sezonnoe', 'sovety', 'servis'].includes(fm.category)) throw new Error(`${file}: категория «${fm.category}» вне списка`);
  const row = {};
  for (const key of [...REQUIRED, ...OPTIONAL]) {
    if (fm[key]) row[key] = fm[key];
  }
  row.body_md = m[2].trim();
  return row;
}

const ours = ARTICLES.map((a) => parseArticle(join(ROOT, 'content', a.dir, a.file)));

const slugs = new Set();
for (const n of ours) {
  if (slugs.has(n.slug)) throw new Error('дубль слага в списке: ' + n.slug);
  slugs.add(n.slug);
}

const text = readFileSync(SEED, 'utf8');
const marker = '"news": ';
const at = text.indexOf(marker);
if (at < 0) throw new Error('в seed-data.ts нет ключа "news"');
const tail = text.lastIndexOf('\n} as const;');
const head = text.slice(0, at + marker.length);
const prev = JSON.parse(text.slice(at + marker.length, tail));
const kept = prev.filter((n) => !slugs.has(n.slug));
const added = ours.filter((n) => !prev.some((p) => p.slug === n.slug)).map((n) => n.slug);
const news = [...kept, ...ours];

writeFileSync(SEED, head + JSON.stringify(news, null, 1) + text.slice(tail));

console.log(`news: ${prev.length} → ${news.length} статей`);
if (added.length) console.log('добавлено:', added.join(', '));
for (const n of news) {
  console.log(`  ${n.slug.padEnd(30)} ${n.category.padEnd(9)} ${String(n.body_md.length).padStart(6)} зн  ${n.published_at}  ${n.cover_static ?? '—'}`);
}
