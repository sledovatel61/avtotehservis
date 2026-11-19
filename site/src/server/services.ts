import { db } from './db.ts';
import { getPrices, fillPrices } from './prices-store.ts';

export interface Service {
  slug: string; title: string; short: string | null; description: string | null;
  icon: string | null; grp: string | null; tag: string | null; sort: number; hidden: number; chip: number;
  seo_title: string | null; seo_description: string | null; price_from: string | null;
}

function mapServiceRow(row: Service): Service {
  const prices = getPrices();
  return {
    ...row,
    short: row.short ? fillPrices(row.short, prices) : row.short,
    description: row.description ? fillPrices(row.description, prices) : row.description,
    seo_title: row.seo_title ? fillPrices(row.seo_title, prices) : row.seo_title,
    seo_description: row.seo_description ? fillPrices(row.seo_description, prices) : row.seo_description,
    price_from: row.price_from ? fillPrices(row.price_from, prices) : row.price_from,
  };
}

export function listCatalogServices(): Service[] {
  return (db().prepare('SELECT * FROM services WHERE hidden=0 ORDER BY sort').all() as Service[]).map(mapServiceRow);
}
export function getService(slug: string): Service | undefined {
  const row = db().prepare('SELECT * FROM services WHERE slug=? AND hidden=0').get(slug) as Service | undefined;
  return row ? mapServiceRow(row) : undefined;
}
/** Главный экран: первыми — представители групп «Колёса», «Ремонт и ТО»,
    «Диагностика», чтобы бейджи трёх карточек не дублировались (круг 12, п.8.1). */
export function listHomeServices(): Service[] {
  const all = (db().prepare('SELECT * FROM services WHERE hidden=0 ORDER BY sort').all() as Service[]).map(mapServiceRow);
  const reps = ['shinomontazh', 'to-maslo', 'diagnostika'];
  const head = reps.map((slug) => all.find((s) => s.slug === slug)).filter((s): s is Service => !!s);
  return [...head, ...all.filter((s) => !reps.includes(s.slug))];
}
export function listChipServices(): Service[] {
  return (db().prepare('SELECT * FROM services WHERE chip=1 ORDER BY grp, sort').all() as Service[]).map(mapServiceRow);
}
/** Whitelist slug-ов услуг для валидации заявок (все услуги, включая скрытые чип-позиции). */
export function allServiceSlugs(): string[] {
  return (db().prepare('SELECT slug FROM services').all() as { slug: string }[]).map((r) => r.slug);
}
export function otherServices(slug: string, limit = 3): Service[] {
  return (db().prepare('SELECT * FROM services WHERE hidden=0 AND slug != ? ORDER BY sort LIMIT ?').all(slug, limit) as Service[]).map(mapServiceRow);
}
