/**
 * Отзывы клиентов — контракт файла `site/content/reviews.json` (круг 87, задание №113).
 *
 * Модуль намеренно чистый: никаких Node API и обращений к диску. Его импортируют
 * сервер (`server/reviews-store.ts`), страница `/otzyvy` (Агент 5), гейт
 * (`scripts/check-reviews.mjs`) и тесты (`tests/reviews-data.test.ts`).
 */

export const REVIEW_SOURCES = ['site', 'yandex', '2gis', 'demo'] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

export const REVIEW_STATUSES = ['published', 'hidden'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_LIMITS = Object.freeze({
  author: [2, 40] as const,
  text: [20, 1500] as const,
  rating: [1, 5] as const,
  id: [2, 64] as const,
});

export const REVIEW_ID_RE = /^r-\d{4}-\d{2}-\d{2}-\d{3}$/;
const SAFE_ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface SiteReview {
  /** `r-YYYY-MM-DD-NNN`, стабильный, уникальный */
  id: string;
  /** 2–40 знаков, например «Павел И.» */
  author: string;
  /** 20–1500 знаков */
  text: string;
  /** Целое 1–5 */
  rating: number;
  source: ReviewSource;
  source_url: string | null;
  /** `YYYY-MM-DD` */
  published_at: string;
  status: ReviewStatus;
  demo: boolean;
}

export interface ReviewsFile {
  updated_at: string;
  items: SiteReview[];
}

export interface ReviewsParseResult {
  file: ReviewsFile;
  errors: string[];
}

export interface ReviewsStats {
  count: number;
  average: number | null;
  byRating: { 1: number; 2: number; 3: number; 4: number; 5: number };
}

export const EMPTY_REVIEWS_FILE: ReviewsFile = { updated_at: '', items: [] };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function isRealCalendarDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function parseSingleReview(raw: unknown, index: number, errors: string[]): SiteReview | null {
  const at = `items[${index}]`;
  if (!isObj(raw)) {
    errors.push(`${at}: запись должна быть объектом`);
    return null;
  }

  const bad: string[] = [];

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id || !SAFE_ID_RE.test(id)) {
    bad.push(`id: «${String(raw.id ?? '')}» — нужен непустой идентификатор (например, r-YYYY-MM-DD-NNN)`);
  }

  const author = typeof raw.author === 'string' ? raw.author.trim() : '';
  if (author.length < REVIEW_LIMITS.author[0] || author.length > REVIEW_LIMITS.author[1]) {
    bad.push(
      `author: длина ${author.length}, нужно ${REVIEW_LIMITS.author[0]}–${REVIEW_LIMITS.author[1]} знаков`,
    );
  }

  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (text.length < REVIEW_LIMITS.text[0] || text.length > REVIEW_LIMITS.text[1]) {
    bad.push(
      `text: длина ${text.length}, нужно ${REVIEW_LIMITS.text[0]}–${REVIEW_LIMITS.text[1]} знаков`,
    );
  }

  const rating = raw.rating;
  if (
    typeof rating !== 'number' ||
    !Number.isInteger(rating) ||
    rating < REVIEW_LIMITS.rating[0] ||
    rating > REVIEW_LIMITS.rating[1]
  ) {
    bad.push(`rating: «${String(rating)}» — нужно целое число от 1 до 5`);
  }

  const source = raw.source;
  if (
    typeof source !== 'string' ||
    !(REVIEW_SOURCES as readonly string[]).includes(source)
  ) {
    bad.push(`source: «${String(source)}» — допустимо ${REVIEW_SOURCES.join(' | ')}`);
  }

  let sourceUrl: string | null = null;
  if (raw.source_url !== undefined && raw.source_url !== null && raw.source_url !== '') {
    if (typeof raw.source_url !== 'string') {
      bad.push('source_url: нужна строка или null');
    } else {
      const trimmedUrl = raw.source_url.trim();
      if (trimmedUrl && !/^https?:\/\/\S+$/i.test(trimmedUrl)) {
        bad.push(`source_url: «${trimmedUrl}» — нужна ссылка http(s):// или null`);
      } else {
        sourceUrl = trimmedUrl || null;
      }
    }
  }

  const publishedAt = typeof raw.published_at === 'string' ? raw.published_at.trim() : '';
  if (!isRealCalendarDate(publishedAt)) {
    bad.push(`published_at: «${String(raw.published_at ?? '')}» — нужна реальная дата YYYY-MM-DD`);
  }

  const status = raw.status;
  if (
    typeof status !== 'string' ||
    !(REVIEW_STATUSES as readonly string[]).includes(status)
  ) {
    bad.push(`status: «${String(status)}» — допустимо ${REVIEW_STATUSES.join(' | ')}`);
  }

  let demo = false;
  if (typeof raw.demo === 'boolean') {
    demo = raw.demo;
  } else if (raw.demo === undefined) {
    demo = source === 'demo';
  } else {
    bad.push(`demo: «${String(raw.demo)}» — ожидался boolean`);
  }

  if (bad.length > 0) {
    for (const msg of bad) errors.push(`${at}.${msg}`);
    return null;
  }

  return {
    id,
    author,
    text,
    rating: rating as number,
    source: source as ReviewSource,
    source_url: sourceUrl,
    published_at: publishedAt,
    status: status as ReviewStatus,
    demo,
  };
}

/**
 * Разбор файла отзывов с мягкой валидацией:
 * - битый JSON (если передана строка) или не-объект → пустой файл + одна ошибка, без исключения;
 * - битая запись отбрасывается с сообщением, остальные читаются;
 * - дубли `id` → остаётся первый, второй отбрасывается с ошибкой.
 */
export function parseReviewsFile(json: unknown): ReviewsParseResult {
  const errors: string[] = [];
  let raw: unknown = json;

  if (typeof json === 'string') {
    const trimmed = json.trim();
    if (!trimmed) {
      return {
        file: { updated_at: '', items: [] },
        errors: ['JSON не разобран: пустой файл'],
      };
    }
    try {
      raw = JSON.parse(trimmed);
    } catch (err) {
      return {
        file: { updated_at: '', items: [] },
        errors: [`JSON не разобран: ${err instanceof Error ? err.message : String(err)}`],
      };
    }
  }

  if (!isObj(raw)) {
    return {
      file: { updated_at: '', items: [] },
      errors: ['корень файла: ожидался объект { updated_at, items }'],
    };
  }

  const updatedAt = typeof raw.updated_at === 'string' ? raw.updated_at.trim() : '';
  if (!Array.isArray(raw.items)) {
    return {
      file: { updated_at: updatedAt, items: [] },
      errors: ['items: ожидался массив'],
    };
  }

  const items: SiteReview[] = [];
  const seenIds = new Set<string>();

  raw.items.forEach((entry, index) => {
    const parsed = parseSingleReview(entry, index, errors);
    if (!parsed) return;
    if (seenIds.has(parsed.id)) {
      errors.push(`items[${index}].id: дубль «${parsed.id}» — запись отброшена`);
      return;
    }
    seenIds.add(parsed.id);
    items.push(parsed);
  });

  return {
    file: { updated_at: updatedAt, items },
    errors,
  };
}

/** Сортировка отзывов: новые выше (`published_at` desc), при равенстве дат — по `id` desc. */
export function orderReviews(items: SiteReview[]): SiteReview[] {
  return [...items].sort((a, b) => {
    if (a.published_at !== b.published_at) {
      return a.published_at < b.published_at ? 1 : -1;
    }
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

/**
 * Опубликованные отзывы с фильтром демо-записей и сортировкой
 * (`published_at` desc, при равенстве — по `id` desc).
 */
export function publishedReviews(
  file: ReviewsFile | SiteReview[],
  options: { includeDemo?: boolean } = {},
): SiteReview[] {
  const includeDemo = Boolean(options?.includeDemo);
  const sourceItems = Array.isArray(file) ? file : (file?.items ?? []);
  const filtered = sourceItems.filter(
    (item) => item.status === 'published' && (includeDemo || !item.demo),
  );
  return orderReviews(filtered);
}

/**
 * Сводная статистика по списку отзывов:
 * - `count` — общее число отзывов в выборке;
 * - `average` — среднее арифметическое с одним знаком после запятой (`null` при пустом списке);
 * - `byRating` — распределение по оценкам 1..5.
 */
export function reviewsStats(items: SiteReview[] | ReviewsFile): ReviewsStats {
  const list = Array.isArray(items) ? items : (items?.items ?? []);
  const byRating: { 1: number; 2: number; 3: number; 4: number; 5: number } = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
  };
  let sum = 0;
  let count = 0;
  for (const item of list) {
    const r = item.rating;
    if (r === 1 || r === 2 || r === 3 || r === 4 || r === 5) {
      byRating[r] += 1;
      sum += r;
      count += 1;
    }
  }
  const average = count > 0 ? Math.round((sum / count) * 10) / 10 : null;
  return { count, average, byRating };
}

/** Следующий свободный идентификатор `r-YYYY-MM-DD-NNN` на заданную дату. */
export function nextReviewId(items: SiteReview[], date: string): string {
  const prefix = `r-${date}-`;
  let maxNum = 0;
  for (const item of items) {
    if (item.id.startsWith(prefix)) {
      const tail = Number(item.id.slice(prefix.length));
      if (Number.isInteger(tail) && tail > maxNum) maxNum = tail;
    }
  }
  return `${prefix}${String(maxNum + 1).padStart(3, '0')}`;
}
