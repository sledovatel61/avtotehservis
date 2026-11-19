/**
 * Чтение кейсов из файла `site/content/cases.json` (круг 79, задание №82).
 *
 * Файл — единственный источник правды для новых кейсов; пишет его админка, читает сайт.
 * Правила, ради которых модуль такой осторожный:
 *   • **страницы не падают**: нет файла, битый JSON, битая запись — отдаём то, что цело;
 *   • **кэш на процесс + проверка mtime**: файл читается один раз на рендер-процесс,
 *     а не на каждый вызов из каждого компонента;
 *   • **`CASES_FILE`** подменяет путь — этим пользуются тесты и предпросмотр, чтобы
 *     не трогать боевой файл;
 *   • пусто → `listPublishedSiteCases()` вернёт `[]`, и сайт рисует прежний вид на
 *     сид-кейсах и иллюстрациях `CASE_COVERS` (обязательная обратная совместимость).
 */
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMPTY_CASES_FILE,
  parseCasesFile,
  publishedCases,
  type CasesFile,
  type SiteCase,
} from '../shared/cases-schema.ts';

export interface CasesDiagnostics {
  /** Сколько опубликованных кейсов видит сайт. */
  count: number;
  /** Причины, по которым записи отброшены (пусто — файл чистый). */
  errors: string[];
  updated_at: string;
  /** Откуда читали — полезно в отчётах и в админке. */
  path: string;
}

/**
 * Где лежит файл. В собранном сервере `import.meta.url` указывает в `dist/server/…`,
 * поэтому основной путь — от рабочего каталога (сервер всегда стартует из `site/`,
 * так же как `db.ts` ищет `data/`). Запасной — от модуля, для запуска из другого cwd.
 */
export function casesFilePath(): string {
  const env = process.env.CASES_FILE;
  if (env) return resolve(env);
  const fromCwd = join(process.cwd(), 'content', 'cases.json');
  try {
    statSync(fromCwd);
    return fromCwd;
  } catch {
    return fileURLToPath(new URL('../../content/cases.json', import.meta.url));
  }
}

interface CacheEntry {
  path: string;
  mtimeMs: number;
  size: number;
  file: CasesFile;
  errors: string[];
}

let cache: CacheEntry | null = null;

/** Сбросить кэш (тесты меняют `CASES_FILE` в одном процессе). */
export function resetCasesCache(): void {
  cache = null;
}

/** Файл кейсов «как есть»: без фильтра по статусу, с диагностикой. */
export function readCasesFile(): { file: CasesFile; errors: string[] } {
  const path = casesFilePath();
  let mtimeMs = 0;
  let size = 0;
  try {
    const st = statSync(path);
    mtimeMs = st.mtimeMs;
    size = st.size;
  } catch {
    /* файла нет — это нормальное состояние до первого кейса */
    cache = { path, mtimeMs: 0, size: 0, file: { ...EMPTY_CASES_FILE }, errors: [] };
    return { file: cache.file, errors: cache.errors };
  }
  if (cache && cache.path === path && cache.mtimeMs === mtimeMs && cache.size === size) {
    return { file: cache.file, errors: cache.errors };
  }
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    console.warn(`[cases] не удалось прочитать ${path}: ${(e as Error).message}`);
    cache = { path, mtimeMs, size, file: { ...EMPTY_CASES_FILE }, errors: [] };
    return { file: cache.file, errors: cache.errors };
  }
  if (!text.trim()) {
    cache = { path, mtimeMs, size, file: { ...EMPTY_CASES_FILE }, errors: [] };
    return { file: cache.file, errors: cache.errors };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    console.warn(`[cases] битый JSON в ${path}: ${(e as Error).message}`);
    cache = { path, mtimeMs, size, file: { ...EMPTY_CASES_FILE }, errors: [`JSON не разобран: ${(e as Error).message}`] };
    return { file: cache.file, errors: cache.errors };
  }
  const { file, errors } = parseCasesFile(raw);
  if (errors.length) console.warn(`[cases] ${path}: отброшено записей/полей — ${errors.length}\n  ${errors.slice(0, 10).join('\n  ')}`);
  cache = { path, mtimeMs, size, file, errors };
  return { file, errors };
}

/** Опубликованные кейсы для витрины: порядок `sort` → свежесть, с ограничением. */
export function listPublishedSiteCases(limit = 6): SiteCase[] {
  const { file } = readCasesFile();
  const list = publishedCases(file);
  return limit > 0 ? list.slice(0, limit) : list;
}

/** Один опубликованный кейс по слагу. Черновик сюда не попадает никогда. */
export function getPublishedSiteCase(slug: string): SiteCase | undefined {
  return listPublishedSiteCases(0).find((c) => c.slug === slug);
}

/** Для `sitemap.xml`: адреса и даты опубликованных кейсов. */
export function listSiteCaseSlugs(): { slug: string; published_at: string }[] {
  return listPublishedSiteCases(0).map((c) => ({ slug: c.slug, published_at: c.published_at }));
}

/** Диагностика для админки и отчётов. */
export function casesDiagnostics(): CasesDiagnostics {
  const { file, errors } = readCasesFile();
  return { count: publishedCases(file).length, errors, updated_at: file.updated_at, path: casesFilePath() };
}
