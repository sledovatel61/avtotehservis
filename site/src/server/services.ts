import { db } from './db.ts';

export interface Service {
  slug: string; title: string; short: string | null; description: string | null;
  icon: string | null; grp: string | null; tag: string | null; sort: number; hidden: number; chip: number;
  seo_title: string | null; seo_description: string | null;
}

export function listCatalogServices(): Service[] {
  return db().prepare('SELECT * FROM services WHERE hidden=0 ORDER BY sort').all() as Service[];
}
export function getService(slug: string): Service | undefined {
  return db().prepare('SELECT * FROM services WHERE slug=? AND hidden=0').get(slug) as Service | undefined;
}
/** Главный экран: первыми — представители групп «Колёса», «Ремонт и ТО»,
    «Диагностика», чтобы бейджи трёх карточек не дублировались (круг 12, п.8.1). */
export function listHomeServices(): Service[] {
  const all = db().prepare('SELECT * FROM services WHERE hidden=0 ORDER BY sort').all() as Service[];
  const reps = ['shinomontazh', 'to-maslo', 'elektrika'];
  const head = reps.map((slug) => all.find((s) => s.slug === slug)).filter((s): s is Service => !!s);
  return [...head, ...all.filter((s) => !reps.includes(s.slug))];
}
export function listChipServices(): Service[] {
  return db().prepare('SELECT * FROM services WHERE chip=1 ORDER BY grp, sort').all() as Service[];
}
/** Whitelist slug-ов услуг для валидации заявок (все услуги, включая скрытые чип-позиции). */
export function allServiceSlugs(): string[] {
  return (db().prepare('SELECT slug FROM services').all() as { slug: string }[]).map((r) => r.slug);
}
export function otherServices(slug: string, limit = 3): Service[] {
  return db().prepare('SELECT * FROM services WHERE hidden=0 AND slug != ? ORDER BY sort LIMIT ?').all(slug, limit) as Service[];
}
