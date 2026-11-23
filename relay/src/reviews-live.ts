/**
 * Живые отзывы: отзыв с сайта публикуется сразу.
 *
 * Как это работает:
 *   1. Человек отправил отзыв — воркер кладёт его в KV со статусом `published`
 *      ДО отправки в Telegram (если Telegram упадёт, отзыв всё равно на сайте).
 *   2. Страница `/otzyvy` забирает список с `GET /reviews` и показывает сразу.
 *   3. Владельцу приходит сообщение в Telegram и письмо — это не «модерация»,
 *      а уведомление: если в отзыве спам или мат, его можно скрыть или удалить
 *      одной кнопкой в `/manage/` → «Отзывы».
 *
 * Почему без предварительной проверки: ручная публикация каждого отзыва — это
 * работа на каждый отзыв. Владелец должен реагировать только на плохое.
 *
 * Доступ к модерации — тем же ключом GitHub, которым владелец входит в /manage/:
 *   GET  /reviews            — публичный список (только `published`), CORS открыт;
 *   GET  /reviews/inbox      — всё, включая скрытые;
 *   POST /reviews/moderate   — { id, action: 'hide'|'publish'|'delete' }
 *                              или { id, action:'edit', author, text, rating, status? }.
 *
 * Модерация идемпотентна: если отзыва с таким id в хранилище уже нет (например,
 * это старый отзыв из файла сайта), отвечаем `200 { ok:true, noop:true }`, а не
 * 404. Иначе единый список в /manage/#reviews ломался бы на первой же строке,
 * которую нечего менять в облаке.
 *
 * Второй адрес и второй код не нужны: воркер проверяет `Authorization: Bearer
 * <ключ GitHub>` запросом к api.github.com и пускает только того, у кого есть
 * право записи в репозиторий сайта. Ключ никуда не сохраняется: он уходит в
 * GitHub и живёт в памяти изолята не дольше пяти минут (только отпечаток).
 *
 * Старый способ — заголовок `x-inbox-key: <REVIEWS_INBOX_KEY>` — оставлен для
 * проверки руками через curl, когда ключа GitHub под рукой нет.
 *
 * Приватность: в логах только id и длина текста. Текст лежит в KV Cloudflare —
 * та же инфраструктура, что уже принимает отзывы.
 */

/** Сколько живёт отзыв в хранилище. */
export const REVIEW_TTL_SEC = 180 * 24 * 3600;
/** Сколько отзывов храним максимум (старые вытесняются). */
export const REVIEW_MAX = 300;

const INDEX_KEY = 'rlive:index';
const itemKey = (id: string) => `rlive:item:${id}`;

export interface LiveEnv {
  /** Старый код модерации. Необязателен: основной вход — ключ GitHub. */
  REVIEWS_INBOX_KEY?: string;
  /** Репозиторий, доступ к которому проверяем. По умолчанию — сайт сервиса. */
  GITHUB_REPO?: string;
}

/** Куда идём проверять ключ GitHub. */
const DEFAULT_GITHUB_REPO = 'sledovatel61/avtotehservis';
/** Сколько помним, что ключ уже проверен (только отпечаток, не сам ключ). */
const GITHUB_OK_TTL_MS = 5 * 60_000;

/** Отпечатки проверенных ключей: живут в памяти изолята, на диск не попадают. */
const verifiedTokens = new Map<string, number>();

const githubFingerprint = async (token: string): Promise<string> => {
  const data = new TextEncoder().encode(token);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Пускать ли этого человека к модерации. Ответы:
 *   `ok`        — ключ GitHub с правом записи в репозиторий (или старый код);
 *   `forbidden` — ключа нет или он не наш;
 *   `unavailable` — GitHub не ответил, поэтому решать не берёмся.
 */
async function authoriseModeration(
  req: Request,
  url: URL,
  env: LiveEnv,
  fetcher: typeof fetch,
): Promise<'ok' | 'forbidden' | 'unavailable'> {
  const secret = (env.REVIEWS_INBOX_KEY ?? '').trim();
  if (secret && sameKey(moderationKeyOf(req, url), secret)) return 'ok';

  /* Ключ берём как есть, без проверки префикса: у GitHub три вида ключей —
     `ghp_…` (classic), `github_pat_…` (fine-grained) и `gho_/ghu_/ghs_…`.
     Решает не форма строки, а ответ `api.github.com/repos/<repo>`: он отдаёт
     `permissions` для ЭТОГО репозитория, и `push: true` там означает ровно
     «Contents: Read and write» у fine-grained токена. Поэтому токен с правом
     записи проходит независимо от префикса, а мусор отсекается ответом 401. */
  const bearer = /^Bearer\s+(.+)$/i.exec((req.headers.get('authorization') ?? '').trim());
  const token = bearer?.[1]?.trim() ?? '';
  if (!token) return 'forbidden';

  try {
    const print = await githubFingerprint(token);
    const until = verifiedTokens.get(print) ?? 0;
    if (until > Date.now()) return 'ok';

    const repo = (env.GITHUB_REPO ?? DEFAULT_GITHUB_REPO).replace(/^\/+|\/+$/g, '');
    const res = await fetcher(`https://api.github.com/repos/${repo}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'ats-rostov-reviews',
      },
    });
    if (!res.ok) return 'forbidden';
    const data = (await res.json()) as { permissions?: { push?: boolean; admin?: boolean; maintain?: boolean } };
    const canPush = Boolean(data.permissions?.push || data.permissions?.admin || data.permissions?.maintain);
    if (!canPush) return 'forbidden';
    verifiedTokens.set(print, Date.now() + GITHUB_OK_TTL_MS);
    return 'ok';
  } catch {
    return 'unavailable';
  }
}

export interface LiveStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSec: number): Promise<void>;
  delete?(key: string): Promise<void>;
}

export type ReviewStatus = 'published' | 'hidden';

export interface LiveReview {
  id: string;
  createdAt: string;
  author: string;
  text: string;
  rating: number;
  status: ReviewStatus;
}

/** Отзыв в том виде, в каком его видит посетитель сайта. */
export interface PublicReview {
  id: string;
  author: string;
  text: string;
  rating: number;
  publishedAt: string;
}

const json = (data: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    },
  });

/** Сравнение кода без раннего выхода: длина и символы проверяются целиком. */
function sameKey(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Код доступа из заголовка или (для проверки руками) из `?key=`. */
export function moderationKeyOf(req: Request, url: URL): string {
  return (req.headers.get('x-inbox-key') ?? url.searchParams.get('key') ?? '').trim();
}

async function readIndex(store: LiveStore): Promise<string[]> {
  const raw = await store.get(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIndex(store: LiveStore, ids: string[]): Promise<void> {
  await store.put(INDEX_KEY, JSON.stringify(ids.slice(0, REVIEW_MAX)), REVIEW_TTL_SEC);
}

async function readItem(store: LiveStore, id: string): Promise<LiveReview | null> {
  const raw = await store.get(itemKey(id));
  if (!raw) return null;
  try {
    const item = JSON.parse(raw) as LiveReview;
    if (!item || typeof item.id !== 'string') return null;
    return {
      id: item.id,
      createdAt: item.createdAt,
      author: item.author,
      text: item.text,
      rating: item.rating,
      status: item.status === 'hidden' ? 'hidden' : 'published',
    };
  } catch {
    return null;
  }
}

/**
 * Сохранить отзыв и сразу опубликовать. Ошибки глотаем: если KV недоступен,
 * отзыв всё равно должен уйти в Telegram — уведомление важнее идеальности.
 */
export async function publishReview(
  store: LiveStore,
  review: { author: string; text: string; rating: number },
  id: string,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    const item: LiveReview = {
      id,
      createdAt: now.toISOString(),
      author: review.author,
      text: review.text,
      rating: review.rating,
      status: 'published',
    };
    await store.put(itemKey(id), JSON.stringify(item), REVIEW_TTL_SEC);
    const ids = await readIndex(store);
    await writeIndex(store, [id, ...ids.filter((x) => x !== id)]);
    return true;
  } catch {
    return false;
  }
}

/** Опубликованные отзывы: новые сверху. */
export async function listPublished(store: LiveStore, limit = 100): Promise<PublicReview[]> {
  const ids = await readIndex(store);
  const out: PublicReview[] = [];
  for (const id of ids) {
    if (out.length >= limit) break;
    const item = await readItem(store, id);
    if (!item || item.status !== 'published') continue;
    out.push({
      id: item.id,
      author: item.author,
      text: item.text,
      rating: item.rating,
      publishedAt: item.createdAt,
    });
  }
  return out;
}

/** Все отзывы, включая скрытые, — для модерации. */
export async function listAll(store: LiveStore, limit = 100): Promise<LiveReview[]> {
  const ids = await readIndex(store);
  const out: LiveReview[] = [];
  for (const id of ids) {
    if (out.length >= limit) break;
    const item = await readItem(store, id);
    if (item) out.push(item);
  }
  return out;
}

export type ModerateAction = 'hide' | 'publish' | 'delete';

/** Поля, которые можно поправить в опубликованном отзыве. */
export interface ReviewEdit {
  author: string;
  text: string;
  rating: number;
  status?: ReviewStatus;
}

/**
 * Скрыть, вернуть на сайт, удалить или поправить отзыв.
 *
 * Возвращает `false`, если записи с таким id в хранилище нет. Это не ошибка:
 * в едином списке /manage/#reviews лежат и отзывы из файла сайта, которых в KV
 * никогда не было. Вызывающий отвечает на такое `200 { ok:true, noop:true }`,
 * чтобы синхронизация списка проходила целиком и идемпотентно.
 */
export async function moderateReview(
  store: LiveStore,
  id: string,
  action: ModerateAction,
): Promise<boolean> {
  const item = await readItem(store, id);
  if (!item) return false;
  if (action === 'delete') {
    if (store.delete) await store.delete(itemKey(id));
    else await store.put(itemKey(id), 'null', 1);
    const ids = await readIndex(store);
    await writeIndex(store, ids.filter((x) => x !== id));
    return true;
  }
  await store.put(itemKey(id), JSON.stringify({ ...item, status: action === 'hide' ? 'hidden' : 'published' }), REVIEW_TTL_SEC);
  return true;
}

/**
 * Поправить отзыв на месте: имя, текст, оценка и (необязательно) статус.
 * `createdAt` не трогаем — дата публикации остаётся прежней, иначе отзыв
 * прыгал бы наверх списка после каждой правки.
 */
export async function editReview(
  store: LiveStore,
  id: string,
  patch: ReviewEdit,
): Promise<boolean> {
  const item = await readItem(store, id);
  if (!item) return false;
  const next: LiveReview = {
    ...item,
    author: patch.author,
    text: patch.text,
    rating: patch.rating,
    status: patch.status ?? item.status,
  };
  await store.put(itemKey(id), JSON.stringify(next), REVIEW_TTL_SEC);
  return true;
}

/** Проверка правки: те же границы, что у формы на сайте. */
export function validateEdit(record: Record<string, unknown>):
  | { ok: true; value: ReviewEdit }
  | { ok: false; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const author = typeof record.author === 'string' ? record.author.trim() : '';
  const text = typeof record.text === 'string' ? record.text.trim() : '';
  const rawRating = record.rating;

  if (author.length < 2) fields.author = 'too_short';
  else if (author.length > 40) fields.author = 'too_long';

  if (text.length < 20) fields.text = 'too_short';
  else if (text.length > 1500) fields.text = 'too_long';

  const rating = typeof rawRating === 'number' && Number.isInteger(rawRating) ? rawRating : NaN;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) fields.rating = 'out_of_range';

  const statusRaw = record.status;
  let status: ReviewStatus | undefined;
  if (statusRaw !== undefined && statusRaw !== null) {
    if (statusRaw !== 'published' && statusRaw !== 'hidden') fields.status = 'out_of_range';
    else status = statusRaw;
  }

  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, value: { author, text, rating, ...(status ? { status } : {}) } };
}

/**
 * Обработчик адресов отзывов. Возвращает `null`, если адрес не наш —
 * тогда `index.ts` отдаст общий 404.
 */
export async function handleLiveReviews(
  req: Request,
  url: URL,
  env: LiveEnv,
  store: LiveStore,
  deps: { fetchGithub?: typeof fetch } = {},
): Promise<Response | null> {
  const { pathname } = url;

  /* Публичный список: его читает страница /otzyvy. Кэш на минуту, чтобы форма
     и обновление страницы не дёргали KV на каждый показ. */
  if (pathname === '/reviews') {
    if (req.method !== 'GET') return json({ error: 'not_found' }, 404);
    const items = await listPublished(store);
    /* `?t=<метка>` — обход кэша: после модерации или отправки отзыва сайт
       просит свежий список и должен увидеть изменения сразу, а не через минуту.
       Без параметра оставляем минуту кэша, чтобы каждый показ страницы не
       дёргал KV. */
    const bust = url.searchParams.has('t');
    return json({ items, total: items.length }, 200, {
      'cache-control': bust ? 'no-store' : 'public, max-age=60',
    });
  }

  const isInbox = pathname === '/reviews/inbox';
  const isModerate = pathname === '/reviews/moderate';
  if (!isInbox && !isModerate) return null;

  /* Один вход на всю мастерскую: ключ GitHub из /manage/. Второго кода нет. */
  const access = await authoriseModeration(req, url, env, deps.fetchGithub ?? fetch);
  if (access === 'unavailable') return json({ error: 'auth_unavailable' }, 503);
  if (access === 'forbidden') return json({ error: 'forbidden' }, 403);

  if (isInbox) {
    if (req.method !== 'GET') return json({ error: 'not_found' }, 404);
    const items = await listAll(store);
    return json({ items, total: items.length });
  }

  if (req.method !== 'POST') return json({ error: 'not_found' }, 404);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const record = (body ?? {}) as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const action = record.action;
  if (!id) return json({ error: 'bad_id' }, 400);
  if (action !== 'hide' && action !== 'publish' && action !== 'delete' && action !== 'edit') {
    return json({ error: 'bad_action' }, 400);
  }

  if (action === 'edit') {
    const parsed = validateEdit(record);
    if (!parsed.ok) return json({ error: 'validation', fields: parsed.fields }, 400);
    const ok = await editReview(store, id, parsed.value);
    console.log('[reviews] moderate', id, action, parsed.value.text.length, ok);
    /* Записи нет — например, правят отзыв из файла сайта. Админка не должна
       падать в 404: отвечаем «менять нечего», и список синхронизируется дальше. */
    return json(ok ? { ok } : { ok: true, noop: true });
  }

  const ok = await moderateReview(store, id, action);
  console.log('[reviews] moderate', id, action, ok);
  return json(ok ? { ok } : { ok: true, noop: true });
}

/** Что показать в `/health`: включена ли модерация отзывов. */
export function liveReviewsHealth(env: LiveEnv): { reviewsInbox: boolean; reviewsModeration: 'github' } {
  return {
    /* Старый код модерации — необязательный запасной вход. */
    reviewsInbox: Boolean((env.REVIEWS_INBOX_KEY ?? '').trim()),
    /* Основной вход всегда один: ключ GitHub из /manage/. */
    reviewsModeration: 'github',
  };
}
