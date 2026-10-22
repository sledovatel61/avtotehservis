import { db } from './db.ts';

const MAP: Record<string, string> = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',
  н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',
  ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',
};

export function slugify(s: string): string {
  return s.toLowerCase()
    .split('').map((ch) => (ch in MAP ? MAP[ch] : ch)).join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'bez-nazvaniya';
}

export function uniqueSlug(base: string, table: 'cases' | 'news', excludeId?: number): string {
  let slug = slugify(base);
  let n = 2;
  for (;;) {
    const row = (excludeId
      ? db().prepare(`SELECT id FROM ${table} WHERE slug=? AND id != ?`).get(slug, excludeId)
      : db().prepare(`SELECT id FROM ${table} WHERE slug=?`).get(slug)) as { id: number } | undefined;
    if (!row) return slug;
    slug = `${slugify(base)}-${n++}`;
  }
}
