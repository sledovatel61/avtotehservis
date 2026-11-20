/**
 * Чтение отзывов из файла `site/content/reviews.json` (круг 87, задание №113).
 *
 * Правила:
 *   • сайт не падает никогда: нет файла, пусто, битый JSON → `[]` и ошибки в диагностике;
 *   • кэш на процесс + проверка `mtime` (файл читается один раз, пока не изменился);
 *   • `REVIEWS_FILE` переопределяет путь к файлу (для тестов и предпросмотра);
 *   • `listPublishedSiteReviews()` учитывает `PUBLIC_DEMO_REVIEWS === '1'`.
 */
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMPTY_REVIEWS_FILE,
  parseReviewsFile,
  publishedReviews,
  reviewsStats,
  type ReviewsFile,
  type ReviewsStats,
  type SiteReview,
  type ReviewSource,
  type ReviewStatus,
} from '../shared/reviews-schema.ts';

export {
  EMPTY_REVIEWS_FILE,
  parseReviewsFile,
  publishedReviews,
  reviewsStats,
  type ReviewsFile,
  type ReviewsStats,
  type SiteReview,
  type ReviewSource,
  type ReviewStatus,
};

export interface ReviewsDiagnostics {
  /** Всего валидных записей в файле. */
  count: number;
  /** Опубликованных записей (`status === 'published'`). */
  published: number;
  /** Скрытых записей (`status === 'hidden'`). */
  hidden: number;
  /** Демо-примеров (`demo === true`). */
  demoCount: number;
  /** Причины, по которым записи или файл были отброшены. */
  errors: string[];
  updated_at: string;
  /** Фактический путь к файлу. */
  path: string;
}

export function reviewsFilePath(): string {
  const env = process.env.REVIEWS_FILE?.trim();
  if (env) return resolve(env);
  const fromCwd = join(process.cwd(), 'content', 'reviews.json');
  try {
    statSync(fromCwd);
    return fromCwd;
  } catch {
    return fileURLToPath(new URL('../../content/reviews.json', import.meta.url));
  }
}

interface CacheEntry {
  path: string;
  mtimeMs: number;
  size: number;
  file: ReviewsFile;
  errors: string[];
}

let cache: CacheEntry | null = null;

/** Сбросить кэш (для тестов при смене `REVIEWS_FILE`). */
export function resetReviewsCache(): void {
  cache = null;
}

export const clearReviewsCache = resetReviewsCache;

/** Прочитать и разобрать `reviews.json` с кэшированием по `mtime`. Никогда не бросает. */
export function readReviewsFile(): { file: ReviewsFile; errors: string[]; fromCache: boolean } {
  const path = reviewsFilePath();
  let mtimeMs = 0;
  let size = 0;
  try {
    const st = statSync(path);
    mtimeMs = st.mtimeMs;
    size = st.size;
  } catch {
    cache = {
      path,
      mtimeMs: 0,
      size: 0,
      file: { updated_at: '', items: [] },
      errors: [`Файл отзывов не найден: ${path}`],
    };
    return { file: cache.file, errors: cache.errors, fromCache: false };
  }

  if (cache && cache.path === path && cache.mtimeMs === mtimeMs && cache.size === size) {
    return { file: cache.file, errors: cache.errors, fromCache: true };
  }

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[reviews] не удалось прочитать ${path}: ${msg}`);
    cache = {
      path,
      mtimeMs,
      size,
      file: { updated_at: '', items: [] },
      errors: [`Не удалось прочитать файл отзывов: ${msg}`],
    };
    return { file: cache.file, errors: cache.errors, fromCache: false };
  }

  if (!text.trim()) {
    cache = {
      path,
      mtimeMs,
      size,
      file: { updated_at: '', items: [] },
      errors: ['Файл отзывов пуст'],
    };
    return { file: cache.file, errors: cache.errors, fromCache: false };
  }

  const { file, errors } = parseReviewsFile(text);
  if (errors.length > 0) {
    console.warn(
      `[reviews] ${path}: проблем при чтении — ${errors.length}\n  ${errors.slice(0, 10).join('\n  ')}`,
    );
  }
  cache = { path, mtimeMs, size, file, errors };
  return { file, errors, fromCache: false };
}

/**
 * Опубликованные отзывы для витрины с учётом `PUBLIC_DEMO_REVIEWS`
 * (`'1'` — демо попадают в выдачу, иначе нет).
 */
export function listPublishedSiteReviews(
  options?: { includeDemo?: boolean; limit?: number },
): SiteReview[] {
  const { file } = readReviewsFile();
  const includeDemo =
    options?.includeDemo !== undefined
      ? Boolean(options.includeDemo)
      : process.env.PUBLIC_DEMO_REVIEWS === '1';
  const list = publishedReviews(file, { includeDemo });
  return options?.limit && options.limit > 0 ? list.slice(0, options.limit) : list;
}

/** Диагностика хранилища отзывов для гейтов, админки и отчётов. */
export function reviewsDiagnostics(): ReviewsDiagnostics {
  const path = reviewsFilePath();
  const { file, errors } = readReviewsFile();
  const items = file.items;
  const published = items.filter((r) => r.status === 'published').length;
  const hidden = items.filter((r) => r.status === 'hidden').length;
  const demoCount = items.filter((r) => r.demo).length;
  return {
    count: items.length,
    published,
    hidden,
    demoCount,
    errors: [...errors],
    updated_at: file.updated_at,
    path,
  };
}
