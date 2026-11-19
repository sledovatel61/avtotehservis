/**
 * Кейсы «до / после» — контракт файла `site/content/cases.json` (круг 79, задание №82).
 *
 * Модуль намеренно **чистый**: никаких Node API и обращений к диску. Его импортируют
 * и сервер (чтение файла в `server/cases-store.ts`), и страницы (разметка), и тесты.
 * Поэтому здесь только типы, проверка формы и сборка адресов картинок.
 *
 * Файл пишет админка (Агент 7), читает сайт. Если файла нет или список пуст — сайт
 * работает как раньше: сид-кейсы и иллюстрации `CASE_COVERS` (обратная совместимость).
 */

export type PhotoExt = 'webp' | 'jpg';
export type CaseMode = 'single' | 'before_after';
export type CaseStatus = 'draft' | 'published';

/** Кадр конкретной работы. `base` — имя набора вариантов в `/media/cases/<slug>/`. */
export interface SitePhoto {
  /** `^[a-z0-9]{4,12}-(before|after|single)$` */
  base: string;
  /** Подпись; обязательна, 3–160 символов — её читает скринридер. */
  alt: string;
  /** Ширина варианта 1600 (остальные пропорциональны). */
  w: number;
  h: number;
  /** По умолчанию `webp`. */
  ext?: PhotoExt;
}

export interface SiteCase {
  slug: string;
  title: string;
  description: string;
  service_slug: string | null;
  mode: CaseMode;
  status: CaseStatus;
  /** `YYYY-MM-DD` — дата работы. */
  published_at: string;
  /** Меньше — выше; при равенстве выше свежее. */
  sort: number;
  cover: SitePhoto | null;
  before: SitePhoto[];
  after: SitePhoto[];
  photos: SitePhoto[];
}

export interface CasesFile {
  version: number;
  updated_at: string;
  cases: SiteCase[];
}

export interface ParseResult {
  file: CasesFile;
  errors: string[];
}

/** Ширины вариантов одного кадра. Все варианты одной пропорции. */
export const PHOTO_WIDTHS = [480, 960, 1600] as const;

export const CASE_SLUG_RE = /^[a-z0-9-]{3,60}$/;
export const PHOTO_BASE_RE = /^[a-z0-9]{4,12}-(before|after|single)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TITLE_MIN = 5;
const TITLE_MAX = 90;
const DESC_MAX = 200;
const ALT_MIN = 3;
const ALT_MAX = 160;

export const EMPTY_CASES_FILE: CasesFile = { version: 1, updated_at: '', cases: [] };

/** Адрес одного варианта кадра: `/media/cases/<slug>/<base>-<width>.<ext>`. */
export function photoPath(slug: string, photo: SitePhoto, width: number): string {
  return `/media/cases/${slug}/${photo.base}-${width}.${photo.ext ?? 'webp'}`;
}

/** `srcset` из трёх вариантов: `"…-480.webp 480w, …-960.webp 960w, …-1600.webp 1600w"`. */
export function photoSrcset(slug: string, photo: SitePhoto): string {
  return PHOTO_WIDTHS.map((w) => `${photoPath(slug, photo, w)} ${w}w`).join(', ');
}

/**
 * Обложка кейса: явная `cover`, иначе первый кадр «как стало», иначе первый из общей
 * галереи, иначе «как было». Пусто — значит показывать нечего (кейс без кадров).
 */
export function caseCover(c: SiteCase): SitePhoto | null {
  return c.cover ?? c.after[0] ?? c.photos[0] ?? c.before[0] ?? null;
}

/** Порядок витрины: `sort` по возрастанию, при равенстве — свежее выше. */
export function orderCases(cases: SiteCase[]): SiteCase[] {
  return [...cases].sort((a, b) => {
    if (a.sort !== b.sort) return a.sort - b.sort;
    return a.published_at < b.published_at ? 1 : a.published_at > b.published_at ? -1 : 0;
  });
}

/* ------------------------------- проверка ------------------------------- */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function photo(raw: unknown, where: string, errors: string[]): SitePhoto | null {
  if (!isObj(raw)) { errors.push(`${where}: не объект`); return null; }
  const base = typeof raw.base === 'string' ? raw.base.trim() : '';
  if (!PHOTO_BASE_RE.test(base)) {
    errors.push(`${where}.base: «${String(raw.base ?? '')}» — нужно ^[a-z0-9]{4,12}-(before|after|single)$`);
    return null;
  }
  const alt = typeof raw.alt === 'string' ? raw.alt.trim() : '';
  if (alt.length < ALT_MIN || alt.length > ALT_MAX) {
    errors.push(`${where}.alt: ${alt ? `длина ${alt.length}, нужно ${ALT_MIN}–${ALT_MAX}` : 'пустая подпись'}`);
    return null;
  }
  const w = Number(raw.w);
  const h = Number(raw.h);
  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
    errors.push(`${where}: размеры ${String(raw.w ?? '—')}×${String(raw.h ?? '—')} — нужны числа больше нуля`);
    return null;
  }
  const extRaw = raw.ext === undefined || raw.ext === null ? 'webp' : raw.ext;
  if (extRaw !== 'webp' && extRaw !== 'jpg') {
    errors.push(`${where}.ext: «${String(extRaw)}» — допустимо webp или jpg`);
    return null;
  }
  return { base, alt, w, h, ext: extRaw };
}

function photoList(raw: unknown, where: string, errors: string[]): SitePhoto[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) { errors.push(`${where}: ожидался массив`); return []; }
  const out: SitePhoto[] = [];
  raw.forEach((p, i) => {
    const parsed = photo(p, `${where}[${i}]`, errors);
    if (parsed) out.push(parsed);
  });
  return out;
}

function siteCase(raw: unknown, index: number, errors: string[]): SiteCase | null {
  const at = `cases[${index}]`;
  if (!isObj(raw)) { errors.push(`${at}: не объект`); return null; }
  const bad: string[] = [];
  const slug = typeof raw.slug === 'string' ? raw.slug.trim() : '';
  if (!CASE_SLUG_RE.test(slug)) bad.push(`slug: «${slug}» — нужно ${String(CASE_SLUG_RE)}`);
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (title.length < TITLE_MIN || title.length > TITLE_MAX) bad.push(`title: длина ${title.length}, нужно ${TITLE_MIN}–${TITLE_MAX}`);
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  if (description.length > DESC_MAX) bad.push(`description: длина ${description.length}, нужно 0–${DESC_MAX}`);
  const mode = raw.mode;
  if (mode !== 'single' && mode !== 'before_after') bad.push(`mode: «${String(mode)}» — нужно single или before_after`);
  const status = raw.status;
  if (status !== 'draft' && status !== 'published') bad.push(`status: «${String(status)}» — нужно draft или published`);
  const publishedAt = typeof raw.published_at === 'string' ? raw.published_at.trim() : '';
  if (!DATE_RE.test(publishedAt)) bad.push(`published_at: «${publishedAt}» — нужно YYYY-MM-DD`);
  const sort = Number(raw.sort);
  if (!Number.isFinite(sort)) bad.push(`sort: «${String(raw.sort)}» — нужно число`);
  let serviceSlug: string | null = null;
  if (raw.service_slug !== undefined && raw.service_slug !== null) {
    if (typeof raw.service_slug !== 'string') bad.push('service_slug: нужна строка или null');
    else serviceSlug = raw.service_slug.trim() || null;
  }
  let cover: SitePhoto | null = null;
  if (raw.cover !== undefined && raw.cover !== null) cover = photo(raw.cover, `${at}.cover`, errors);
  const before = photoList(raw.before, `${at}.before`, errors);
  const after = photoList(raw.after, `${at}.after`, errors);
  const photos = photoList(raw.photos, `${at}.photos`, errors);
  if (bad.length) {
    for (const b of bad) errors.push(`${at}.${b}`);
    return null;
  }
  return {
    slug,
    title,
    description,
    service_slug: serviceSlug,
    mode: mode as CaseMode,
    status: status as CaseStatus,
    published_at: publishedAt,
    sort,
    cover,
    before,
    after,
    photos,
  };
}

/**
 * Разбор файла кейсов. **Никогда не бросает**: битые записи отбрасываются, причина
 * складывается в `errors` (`cases[3].before[0].alt: пустая подпись`). Ошибка в одном
 * кадре не убивает кейс — кадр просто не показывается; ошибка в кейсе не убивает файл.
 */
export function parseCasesFile(raw: unknown): ParseResult {
  const errors: string[] = [];
  if (raw === undefined || raw === null) return { file: { ...EMPTY_CASES_FILE }, errors };
  if (!isObj(raw)) {
    errors.push('корень файла: ожидался объект { version, updated_at, cases }');
    return { file: { ...EMPTY_CASES_FILE }, errors };
  }
  const version = Number.isFinite(Number(raw.version)) ? Number(raw.version) : 1;
  const updatedAt = typeof raw.updated_at === 'string' ? raw.updated_at : '';
  if (!Array.isArray(raw.cases)) {
    if (raw.cases !== undefined && raw.cases !== null) errors.push('cases: ожидался массив');
    return { file: { version, updated_at: updatedAt, cases: [] }, errors };
  }
  const cases: SiteCase[] = [];
  const seen = new Set<string>();
  raw.cases.forEach((c, i) => {
    const parsed = siteCase(c, i, errors);
    if (!parsed) return;
    if (seen.has(parsed.slug)) {
      errors.push(`cases[${i}].slug: «${parsed.slug}» уже есть выше — запись отброшена`);
      return;
    }
    seen.add(parsed.slug);
    cases.push(parsed);
  });
  return { file: { version, updated_at: updatedAt, cases }, errors };
}

/** Опубликованные, в порядке витрины. */
export function publishedCases(file: CasesFile): SiteCase[] {
  return orderCases(file.cases.filter((c) => c.status === 'published'));
}
