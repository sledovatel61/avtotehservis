/** Наполнение: услуги (каталог + чипы формы), кейсы, статьи, настройки (марки, подписи чипов).
 *  БЕЗ демо-заявок и демо-отзывов (требование задания §5). Идемпотентно: все upsert-ы по slug.
 *  Круг 26: добавлены price_from (миграция 002), обновление кейсов по slug (раньше DO NOTHING),
 *  сид пяти статей A9 и предпроверка ссылок кейсов перед удалением слагов миграцией 002. */
import { db } from '../src/server/db.ts';
import { runMigrations } from './migrate.ts';
import { setSetting } from '../src/server/settings.ts';
import { SEED } from '../src/server/seed-data.ts';

/* Слаги, которые миграция 002 удаляет из services. Кейсы на них переназначает сид ниже;
   leads.services_json — TEXT без FK, исторические заявки не ломаются (задание №30 §2.1). */
const REMOVED_SLUGS = ['shinomontazh-gruz', 'pravka-diskov', 'hodovaya-tormoza', 'elektrika', 'remont-shin',
  'porezy-gryzhi', 'vulkanizaciya', 'hranenie-shin', 'razval-shozhdenie', 'rulevye-reyki', 'dvigatel', 'akpp-mkpp', 'stekla', 'kondicionery'];

export function runSeed(): void {
  const dbx = db();
  /* Предпроверка до миграции: кто ссылается на удаляемые слаги. Кейсы переназначаются
     этим же прогоном (upCase DO UPDATE), лиды оставляем исторически. */
  const before = runMigrations();
  if (before.includes('002_service_price.sql')) {
    console.log('Миграция 002 применена: колонка price_from добавлена, удалённые слаги вычищены.');
  }
  const dangling = (dbx.prepare(`SELECT slug, service_slug FROM cases WHERE service_slug IN (${REMOVED_SLUGS.map(() => '?').join(',')})`).all(...REMOVED_SLUGS) as { slug: string; service_slug: string }[]);
  if (dangling.length) console.log(`Кейсы на удаляемых услугах (переназначаются сидом): ${dangling.map((d) => `${d.slug}→${d.service_slug}`).join(', ')}`);

  const upSvc = dbx.prepare(`INSERT INTO services(slug,title,short,description,icon,grp,tag,sort,hidden,chip,seo_title,seo_description,price_from)
    VALUES(@slug,@title,@short,@description,@icon,@grp,@tag,@sort,@hidden,@chip,@seo_title,@seo_description,@price_from)
    ON CONFLICT(slug) DO UPDATE SET title=excluded.title, short=excluded.short, description=excluded.description,
      icon=excluded.icon, grp=excluded.grp, tag=excluded.tag, hidden=excluded.hidden, chip=excluded.chip,
      seo_title=excluded.seo_title, seo_description=excluded.seo_description, price_from=excluded.price_from`);
  // published_at со сдвигом по sort: при ORDER BY published_at DESC сеянные кейсы-заглушки
  // стоят в утверждённом порядке 1..6, а любой новый кейс владельца оказывается выше.
  // Круг 26: DO UPDATE — тексты кейсов заменены проектом A7 (05-cases.md), слаги и картинки те же.
  const upCase = dbx.prepare(`INSERT INTO cases(slug,title,description,service_slug,cover_static,status,published_at,sort)
    VALUES(@slug,@title,@description,@service_slug,@cover_static,'published',datetime('now','-' || (@sort - 1) || ' minutes'),@sort)
    ON CONFLICT(slug) DO UPDATE SET title=excluded.title, description=excluded.description,
      service_slug=excluded.service_slug, cover_static=excluded.cover_static, status='published', sort=excluded.sort`);
  /* в схеме news нет колонки seo_description: meta description статьи = excerpt (a9 §5.7) */
  const upNews = dbx.prepare(`INSERT INTO news(slug,title,excerpt,body_md,category,cover_static,status,published_at)
    VALUES(@slug,@title,@excerpt,@body_md,@category,@cover_static,'published',@published_at)
    ON CONFLICT(slug) DO UPDATE SET title=excluded.title, excerpt=excluded.excerpt, body_md=excluded.body_md,
      category=excluded.category, cover_static=excluded.cover_static, status='published',
      published_at=excluded.published_at`);
  const tx = dbx.transaction(() => {
    for (const s of SEED.services) upSvc.run(s);
    for (const c of SEED.cases) upCase.run(c);
    for (const n of SEED.news) upNews.run({ slug: n.slug, title: n.title, excerpt: n.excerpt, body_md: n.body_md, category: n.category, cover_static: n.cover_static, published_at: n.published_at });
    setSetting('brands', SEED.brands);
    setSetting('chip_labels', SEED.chip_labels);
  });
  tx();
}

const isMain = process.argv[1] && process.argv[1].endsWith('seed.ts');
if (isMain) {
  runSeed();
  const n = (q: string) => (db().prepare(q).get() as { c: number }).c;
  console.log(`Сид завершён: услуг ${n('SELECT COUNT(*) c FROM services')} (в каталоге ${n('SELECT COUNT(*) c FROM services WHERE hidden=0')}), кейсов-заглушек ${n('SELECT COUNT(*) c FROM cases')}, статей ${n('SELECT COUNT(*) c FROM news')}.`);
  console.log('Отзывов намеренно нет: пустое состояние + добавление через админку.');
}
