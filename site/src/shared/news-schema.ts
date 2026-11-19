/**
 * Статьи раздела «Полезное» — контракт файла `site/content/news.json`
 * (круг 89, задание `prompts/130-task-r89-news-store.md`, бриф `prompts/129-r89-brief.md` §3).
 *
 * Модуль чистый: без `node:fs` и без обращений к БД, чтобы его импортировали
 * сервер (`server/news-store.ts`), страницы, гейт (`scripts/check-news.mjs`) и тесты.
 */

export const NEWS_CATEGORIES = [
  { slug: 'sezonnoe', title: 'Сезонное' },
  { slug: 'sovety', title: 'Советы' },
  { slug: 'servis', title: 'Сервис' },
] as const;

export type NewsCategorySlug = (typeof NEWS_CATEGORIES)[number]['slug'];

export const NEWS_CATEGORY_SLUGS: readonly NewsCategorySlug[] = NEWS_CATEGORIES.map((c) => c.slug);

export function catTitle(slug: string): string {
  return NEWS_CATEGORIES.find((c) => c.slug === slug)?.title ?? slug;
}

export type NewsStatus = 'published' | 'draft';
export type NewsCoverExt = 'webp' | 'jpg';

export interface NewsCover {
  /** `^[a-z0-9]{4,12}-cover$` */
  base: string;
  /** Ширина 1600-варианта */
  w: number;
  /** Высота 1600-варианта */
  h: number;
  /** `'webp' | 'jpg'` */
  ext: NewsCoverExt;
  /** Подпись к обложке: 3–160 символов, обязательна */
  alt: string;
}

export interface NewsItem {
  /** `^[a-z0-9-]{3,80}$`, уникален */
  slug: string;
  title: string;
  /** `null` или строка ≤ 60 знаков */
  seo_title: string | null;
  /** Описание для карточки и meta description, ≤ 300 знаков */
  excerpt: string;
  category: NewsCategorySlug;
  /** Markdown, 200–40000 знаков */
  body_md: string;
  cover: NewsCover | null;
  cover_static: string | null;
  status: NewsStatus;
  /** `YYYY-MM-DD HH:MM` (обязательна для `published`, может быть `null` для `draft`) */
  published_at: string | null;
  /** `YYYY-MM-DD HH:MM` */
  updated_at: string;
  /** Поле совместимости со старой разметкой (в файле не хранится) */
  cover_media_id?: string | null;
}

export interface NewsDoc {
  version: number;
  updated_at: string;
  items: NewsItem[];
}

export const NEWS_SLUG_RE = /^[a-z0-9-]{3,80}$/;
export const NEWS_COVER_BASE_RE = /^[a-z0-9]{4,12}-cover$/;
export const NEWS_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

export const NEWS_LIMITS = Object.freeze({
  title: [2, 160] as const,
  seoTitleMax: 60,
  excerpt: [1, 300] as const,
  bodyMd: [200, 40000] as const,
  alt: [3, 160] as const,
});

export const EMPTY_NEWS_DOC: NewsDoc = {
  version: 1,
  updated_at: '',
  items: [],
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Проверка реальной календарной даты и времени формата `YYYY-MM-DD HH:MM`. */
export function isRealNewsDateTime(s: string): boolean {
  if (!NEWS_DATETIME_RE.test(s)) return false;
  const [datePart, timePart] = s.split(' ');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function validateNewsCover(raw: unknown, where: string): NewsCover {
  if (!isObj(raw)) {
    throw new Error(`${where}: ожидался объект обложки { base, w, h, ext, alt }`);
  }
  const base = typeof raw.base === 'string' ? raw.base.trim() : '';
  if (!NEWS_COVER_BASE_RE.test(base)) {
    throw new Error(
      `${where}.base: «${String(raw.base ?? '')}» — ожидался формат ^[a-z0-9]{4,12}-cover$`,
    );
  }
  const ext = raw.ext;
  if (ext !== 'webp' && ext !== 'jpg') {
    throw new Error(`${where}.ext: «${String(ext ?? '')}» — допустимо webp или jpg`);
  }
  const w = Number(raw.w);
  const h = Number(raw.h);
  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
    throw new Error(
      `${where}: размеры ${String(raw.w ?? '—')}×${String(raw.h ?? '—')} — нужны положительные числа`,
    );
  }
  const alt = typeof raw.alt === 'string' ? raw.alt.trim() : '';
  if (alt.length < NEWS_LIMITS.alt[0] || alt.length > NEWS_LIMITS.alt[1]) {
    throw new Error(
      `${where}.alt: длина ${alt.length}, нужно от ${NEWS_LIMITS.alt[0]} до ${NEWS_LIMITS.alt[1]} символов`,
    );
  }
  return { base, w, h, ext, alt };
}

/**
 * Проверяет одну статью по правилам §3 брифа и возвращает нормализованный `NewsItem`.
 * При первом нарушении бросает `Error` с понятным русским текстом.
 */
export function validateNewsItem(raw: unknown, where = 'item'): NewsItem {
  if (!isObj(raw)) {
    throw new Error(`${where}: запись статьи должна быть объектом`);
  }

  const slug = typeof raw.slug === 'string' ? raw.slug.trim() : '';
  if (!NEWS_SLUG_RE.test(slug)) {
    throw new Error(
      `${where}.slug: «${String(raw.slug ?? '')}» — нужен формат ^[a-z0-9-]{3,80}$`,
    );
  }

  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (title.length < NEWS_LIMITS.title[0] || title.length > NEWS_LIMITS.title[1]) {
    throw new Error(
      `${where}.title (${slug}): длина ${title.length}, нужно от ${NEWS_LIMITS.title[0]} до ${NEWS_LIMITS.title[1]} символов`,
    );
  }

  let seoTitle: string | null = null;
  if (raw.seo_title !== null && raw.seo_title !== undefined) {
    if (typeof raw.seo_title !== 'string') {
      throw new Error(`${where}.seo_title (${slug}): ожидалась строка или null`);
    }
    const trimmedSeo = raw.seo_title.trim();
    if (trimmedSeo.length > NEWS_LIMITS.seoTitleMax) {
      throw new Error(
        `${where}.seo_title (${slug}): длина ${trimmedSeo.length}, максимум ${NEWS_LIMITS.seoTitleMax} символов`,
      );
    }
    seoTitle = trimmedSeo || null;
  }

  const excerpt = typeof raw.excerpt === 'string' ? raw.excerpt.trim() : '';
  if (excerpt.length < NEWS_LIMITS.excerpt[0] || excerpt.length > NEWS_LIMITS.excerpt[1]) {
    throw new Error(
      `${where}.excerpt (${slug}): длина ${excerpt.length}, нужно от ${NEWS_LIMITS.excerpt[0]} до ${NEWS_LIMITS.excerpt[1]} символов`,
    );
  }

  const category = typeof raw.category === 'string' ? raw.category.trim() : '';
  if (!(NEWS_CATEGORY_SLUGS as readonly string[]).includes(category)) {
    throw new Error(
      `${where}.category (${slug}): неизвестная категория «${String(raw.category ?? '')}» (допустимо: ${NEWS_CATEGORY_SLUGS.join(', ')})`,
    );
  }

  const bodyMd = typeof raw.body_md === 'string' ? raw.body_md.trim() : '';
  if (bodyMd.length < NEWS_LIMITS.bodyMd[0] || bodyMd.length > NEWS_LIMITS.bodyMd[1]) {
    throw new Error(
      `${where}.body_md (${slug}): длина ${bodyMd.length}, нужно от ${NEWS_LIMITS.bodyMd[0]} до ${NEWS_LIMITS.bodyMd[1]} символов`,
    );
  }

  let cover: NewsCover | null = null;
  if (raw.cover !== null && raw.cover !== undefined) {
    cover = validateNewsCover(raw.cover, `${where}.cover (${slug})`);
  }

  let coverStatic: string | null = null;
  if (raw.cover_static !== null && raw.cover_static !== undefined && raw.cover_static !== '') {
    if (typeof raw.cover_static !== 'string') {
      throw new Error(`${where}.cover_static (${slug}): ожидалась строка пути или null`);
    }
    const trimmedStatic = raw.cover_static.trim();
    if (trimmedStatic && !trimmedStatic.startsWith('/')) {
      throw new Error(
        `${where}.cover_static (${slug}): путь «${trimmedStatic}» должен начинаться с «/»`,
      );
    }
    coverStatic = trimmedStatic || null;
  }

  if (cover !== null && coverStatic !== null) {
    throw new Error(
      `${where} (${slug}): поля cover и cover_static взаимоисключающие — укажите только одно из них`,
    );
  }

  const status = raw.status;
  if (status !== 'published' && status !== 'draft') {
    throw new Error(
      `${where}.status (${slug}): «${String(status ?? '')}» — допустимо published или draft`,
    );
  }

  let publishedAt: string | null = null;
  if (raw.published_at !== null && raw.published_at !== undefined && raw.published_at !== '') {
    if (typeof raw.published_at !== 'string') {
      throw new Error(`${where}.published_at (${slug}): ожидалась строка YYYY-MM-DD HH:MM`);
    }
    const trimmedPub = raw.published_at.trim();
    if (!isRealNewsDateTime(trimmedPub)) {
      throw new Error(
        `${where}.published_at (${slug}): «${trimmedPub}» — нужна реальная дата формата YYYY-MM-DD HH:MM`,
      );
    }
    publishedAt = trimmedPub;
  } else if (status === 'published') {
    throw new Error(
      `${where}.published_at (${slug}): для опубликованной статьи (status: "published") обязательна дата published_at`,
    );
  }

  let updatedAt = publishedAt ?? '';
  if (raw.updated_at !== null && raw.updated_at !== undefined && raw.updated_at !== '') {
    if (typeof raw.updated_at !== 'string') {
      throw new Error(`${where}.updated_at (${slug}): ожидалась строка YYYY-MM-DD HH:MM`);
    }
    const trimmedUpd = raw.updated_at.trim();
    if (!isRealNewsDateTime(trimmedUpd)) {
      throw new Error(
        `${where}.updated_at (${slug}): «${trimmedUpd}» — нужна реальная дата формата YYYY-MM-DD HH:MM`,
      );
    }
    updatedAt = trimmedUpd;
  }

  return {
    slug,
    title,
    seo_title: seoTitle,
    excerpt,
    category: category as NewsCategorySlug,
    body_md: typeof raw.body_md === 'string' ? raw.body_md : bodyMd,
    cover,
    cover_static: coverStatic,
    status,
    published_at: publishedAt,
    updated_at: updatedAt,
  };
}

/**
 * Строгий разбор документа `news.json`: бросает `Error` с понятным русским текстом
 * на первом нарушении схемы или дубле `slug`.
 */
export function parseNewsDoc(raw: unknown): NewsDoc {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new Error('news.json: пустой файл');
    }
    try {
      data = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(
        `news.json: JSON не разобран — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (!isObj(data)) {
    throw new Error('news.json: корень документа должен быть объектом { version, updated_at, items }');
  }

  const version = data.version === undefined ? 1 : Number(data.version);
  if (version !== 1) {
    throw new Error(`news.json: неподдерживаемая версия схемы version=${String(data.version)} (ожидалась 1)`);
  }

  const updatedAt = typeof data.updated_at === 'string' ? data.updated_at.trim() : '';
  if (!Array.isArray(data.items)) {
    throw new Error('news.json: поле items должно быть массивом статей');
  }

  const items: NewsItem[] = [];
  const seenSlugs = new Set<string>();

  data.items.forEach((entry, index) => {
    const item = validateNewsItem(entry, `items[${index}]`);
    if (seenSlugs.has(item.slug)) {
      throw new Error(`items[${index}].slug: дубль slug «${item.slug}»`);
    }
    seenSlugs.add(item.slug);
    items.push(item);
  });

  return {
    version: 1,
    updated_at: updatedAt,
    items,
  };
}

/**
 * Мягкий разбор `news.json` для рантайма сайта (`news-store.ts`):
 * никогда не бросает исключений; битый файл или битая запись логируются в `errors`
 * и пропускаются, остальные валидные записи возвращаются.
 */
export function parseNewsDocSoft(raw: unknown): { doc: NewsDoc; errors: string[] } {
  const errors: string[] = [];
  let data: unknown = raw;

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) {
      return { doc: { ...EMPTY_NEWS_DOC, items: [] }, errors: ['news.json: пустой файл'] };
    }
    try {
      data = JSON.parse(trimmed);
    } catch (err) {
      return {
        doc: { ...EMPTY_NEWS_DOC, items: [] },
        errors: [`news.json: JSON не разобран — ${err instanceof Error ? err.message : String(err)}`],
      };
    }
  }

  if (!isObj(data)) {
    return {
      doc: { ...EMPTY_NEWS_DOC, items: [] },
      errors: ['news.json: корень документа должен быть объектом { version, updated_at, items }'],
    };
  }

  const version = Number.isFinite(Number(data.version)) ? Number(data.version) : 1;
  const updatedAt = typeof data.updated_at === 'string' ? data.updated_at.trim() : '';
  if (!Array.isArray(data.items)) {
    return {
      doc: { version, updated_at: updatedAt, items: [] },
      errors: ['news.json: поле items должно быть массивом статей'],
    };
  }

  const items: NewsItem[] = [];
  const seenSlugs = new Set<string>();

  data.items.forEach((entry, index) => {
    try {
      const item = validateNewsItem(entry, `items[${index}]`);
      if (seenSlugs.has(item.slug)) {
        errors.push(`items[${index}].slug: дубль slug «${item.slug}» — запись пропущена`);
        return;
      }
      seenSlugs.add(item.slug);
      items.push(item);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  });

  return {
    doc: { version, updated_at: updatedAt, items },
    errors,
  };
}

/**
 * Опубликованные статьи (`status === 'published'`), отсортированные
 * по `published_at` по убыванию, при равенстве — по `slug` по возрастанию.
 */
export function publishedItems(doc: NewsDoc | NewsItem[]): NewsItem[] {
  const list = Array.isArray(doc) ? doc : (doc?.items ?? []);
  return list
    .filter((item) => item.status === 'published')
    .sort((a, b) => {
      const pa = a.published_at ?? '';
      const pb = b.published_at ?? '';
      if (pa !== pb) return pa < pb ? 1 : -1;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
}

/** Черновики (`status === 'draft'`), отсортированные по дате обновления/публикации desc, затем `slug` asc. */
export function draftItems(doc: NewsDoc | NewsItem[]): NewsItem[] {
  const list = Array.isArray(doc) ? doc : (doc?.items ?? []);
  return list
    .filter((item) => item.status === 'draft')
    .sort((a, b) => {
      const da = a.updated_at || a.published_at || '';
      const db = b.updated_at || b.published_at || '';
      if (da !== db) return da < db ? 1 : -1;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
}
