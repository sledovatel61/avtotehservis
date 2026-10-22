import { db } from './db.ts';

export interface CaseRow {
  id: number; slug: string; title: string; description: string | null; service_slug: string | null;
  cover_media_id: string | null; cover_static: string | null; status: string; published_at: string | null; sort: number;
}
export interface ReviewRow {
  id: number; author: string; text: string; rating: number | null; source: string | null;
  source_url: string | null; published_at: string | null; status: string;
}
export interface NewsRow {
  id: number; slug: string; title: string; excerpt: string | null; body_md: string; category: string;
  cover_media_id: string | null; cover_static: string | null; status: string; published_at: string | null;
}

export function listPublishedCases(limit = 12): CaseRow[] {
  // Новые кейсы выше старых (M1 ревью): свежая публикация сразу попадает на главную и «О компании».
  return db().prepare(`SELECT * FROM cases WHERE status='published' ORDER BY published_at DESC, sort DESC LIMIT ?`).all(limit) as CaseRow[];
}
export function getCase(slug: string): CaseRow | undefined {
  return db().prepare(`SELECT * FROM cases WHERE slug=? AND status='published'`).get(slug) as CaseRow | undefined;
}
export function listPublishedReviews(limit = 12): ReviewRow[] {
  return db().prepare(`SELECT * FROM reviews WHERE status='published' ORDER BY published_at DESC LIMIT ?`).all(limit) as ReviewRow[];
}
export const NEWS_CATEGORIES = [
  { slug: 'sezonnoe', title: 'Сезонное' },
  { slug: 'sovety', title: 'Советы' },
  { slug: 'servis', title: 'Сервис' },
] as const;

export function catTitle(slug: string): string {
  return NEWS_CATEGORIES.find((c) => c.slug === slug)?.title ?? slug;
}
export function newsCategoryCounts(): Record<string, number> {
  const rows = db().prepare(`SELECT category, COUNT(*) AS c FROM news WHERE status='published' GROUP BY category`).all() as { category: string; c: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.category] = r.c;
  return out;
}
export function newsTotal(): number {
  return (db().prepare(`SELECT COUNT(*) AS c FROM news WHERE status='published'`).get() as { c: number }).c;
}

export function listNews(opts: { category?: string | null; page?: number; per?: number } = {}): { items: NewsRow[]; total: number; pages: number } {
  const per = opts.per ?? 6;
  const page = Math.max(1, opts.page ?? 1);
  const where = opts.category ? `status='published' AND category=?` : `status='published'`;
  const params: unknown[] = opts.category ? [opts.category] : [];
  const total = (db().prepare(`SELECT COUNT(*) AS c FROM news WHERE ${where}`).get(...params) as { c: number }).c;
  const items = db().prepare(`SELECT * FROM news WHERE ${where} ORDER BY published_at DESC LIMIT ? OFFSET ?`)
    .all(...params, per, (page - 1) * per) as NewsRow[];
  return { items, total, pages: Math.max(1, Math.ceil(total / per)) };
}
export function getNews(slug: string): NewsRow | undefined {
  return db().prepare(`SELECT * FROM news WHERE slug=? AND status='published'`).get(slug) as NewsRow | undefined;
}
export function otherNews(slug: string, limit = 3): NewsRow[] {
  return db().prepare(`SELECT * FROM news WHERE slug != ? AND status='published' ORDER BY published_at DESC LIMIT ?`).all(slug, limit) as NewsRow[];
}
/** Обложка целиком: src, крупный вариант, srcset и alt (из media.alt, если владелец заполнил). */
export interface CoverInfo { src: string; lg: string; srcset: string | null; alt: string }
export function coverInfo(row: { cover_media_id: string | null; cover_static: string | null }, fallbackSrc: string, title: string, staticAlt?: string): CoverInfo {
  if (row.cover_media_id) {
    const m = db().prepare('SELECT kind, id, poster_path, alt FROM media WHERE id=?').get(row.cover_media_id) as
      { kind: string; id: string; poster_path: string | null; alt: string | null } | undefined;
    if (m) {
      if (m.kind === 'video') {
        const poster = `/media/${m.poster_path ?? (m.id + '/poster.jpg')}`;
        return { src: poster, lg: poster, srcset: null, alt: m.alt || `${title} — видео` };
      }
      return {
        src: `/media/${m.id}/v960.webp`,
        lg: `/media/${m.id}/v1600.webp`,
        srcset: `/media/${m.id}/v480.webp 480w, /media/${m.id}/v960.webp 960w, /media/${m.id}/v1600.webp 1600w`,
        // minor-1 ревью round4: у реального фото без подписи — нейтральный alt,
        // фраза «появится после съёмки» остаётся только у статичных заглушек.
        alt: m.alt || `${title} — фото`,
      };
    }
  }
  const src = row.cover_static ?? fallbackSrc;
  return { src, lg: src, srcset: null, alt: staticAlt ?? `${title} — фото появится после съёмки` };
}

