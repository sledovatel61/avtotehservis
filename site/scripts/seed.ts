/** Наполнение: услуги (каталог + чипы формы), кейсы-заглушки, настройки (марки, подписи чипов).
 *  БЕЗ демо-заявок, демо-отзывов и демо-новостей (требование задания §5). Идемпотентно. */
import { db } from '../src/server/db.ts';
import { runMigrations } from './migrate.ts';
import { setSetting } from '../src/server/settings.ts';
import { SEED } from '../src/server/seed-data.ts';

export function runSeed(): void {
  runMigrations();
  const dbx = db();
  const upSvc = dbx.prepare(`INSERT INTO services(slug,title,short,description,icon,grp,tag,sort,hidden,chip,seo_title,seo_description)
    VALUES(@slug,@title,@short,@description,@icon,@grp,@tag,@sort,@hidden,@chip,@seo_title,@seo_description)
    ON CONFLICT(slug) DO UPDATE SET title=excluded.title, short=excluded.short, description=excluded.description,
      icon=excluded.icon, grp=excluded.grp, tag=excluded.tag, hidden=excluded.hidden, chip=excluded.chip,
      seo_title=excluded.seo_title, seo_description=excluded.seo_description`);
  // published_at со сдвигом по sort: при ORDER BY published_at DESC сеянные кейсы-заглушки
  // стоят в утверждённом порядке 1..6, а любой новый кейс владельца оказывается выше.
  const upCase = dbx.prepare(`INSERT INTO cases(slug,title,description,service_slug,cover_static,status,published_at,sort)
    VALUES(@slug,@title,@description,@service_slug,@cover_static,'published',datetime('now','-' || (@sort - 1) || ' minutes'),@sort)
    ON CONFLICT(slug) DO NOTHING`);
  const tx = dbx.transaction(() => {
    for (const s of SEED.services) upSvc.run(s);
    for (const c of SEED.cases) upCase.run(c);
    setSetting('brands', SEED.brands);
    setSetting('chip_labels', SEED.chip_labels);
  });
  tx();
}

const isMain = process.argv[1] && process.argv[1].endsWith('seed.ts');
if (isMain) {
  runSeed();
  const n = (q: string) => (db().prepare(q).get() as { c: number }).c;
  console.log(`Сид завершён: услуг ${n('SELECT COUNT(*) c FROM services')} (в каталоге ${n('SELECT COUNT(*) c FROM services WHERE hidden=0')}), кейсов-заглушек ${n('SELECT COUNT(*) c FROM cases')}.`);
  console.log('Новостей и отзывов намеренно нет: пустые состояния + добавление через админку.');
}
