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
 * Доступ к модерации:
 *   GET  /reviews            — публичный список (только `published`), CORS открыт;
 *   GET  /reviews/inbox      — всё, включая скрытые; заголовок `x-inbox-key`;
 *   POST /reviews/moderate   — `x-inbox-key` + { id, action: 'hide'|'publish'|'delete' }.
 *
 * Без секрета `REVIEWS_INBOX_KEY` модерация отвечает 404: «дверь» без пароля
 * недопустима. Публичный список при этом работает всегда.
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
  REVIEWS_INBOX_KEY?: string;
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

/** Скрыть, вернуть на сайт или удалить отзыв. */
export async function moderateReview(
  store: LiveStore,
  id: string,
  action: 'hide' | 'publish' | 'delete',
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
 * Обработчик адресов отзывов. Возвращает `null`, если адрес не наш —
 * тогда `index.ts` отдаст общий 404.
 */
export async function handleLiveReviews(
  req: Request,
  url: URL,
  env: LiveEnv,
  store: LiveStore,
): Promise<Response | null> {
  const { pathname } = url;

  /* Публичный список: его читает страница /otzyvy. Кэш на минуту, чтобы форма
     и обновление страницы не дёргали KV на каждый показ. */
  if (pathname === '/reviews') {
    if (req.method !== 'GET') return json({ error: 'not_found' }, 404);
    const items = await listPublished(store);
    return json({ items, total: items.length }, 200, { 'cache-control': 'public, max-age=60' });
  }

  const isInbox = pathname === '/reviews/inbox';
  const isModerate = pathname === '/reviews/moderate';
  if (!isInbox && !isModerate) return null;

  const secret = (env.REVIEWS_INBOX_KEY ?? '').trim();
  if (!secret) return json({ error: 'not_found' }, 404);
  if (!sameKey(moderationKeyOf(req, url), secret)) return json({ error: 'forbidden' }, 403);

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
  const record = (body ?? {}) as { id?: unknown; action?: unknown };
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const action = record.action;
  if (!id) return json({ error: 'bad_id' }, 400);
  if (action !== 'hide' && action !== 'publish' && action !== 'delete') {
    return json({ error: 'bad_action' }, 400);
  }
  const ok = await moderateReview(store, id, action);
  console.log('[reviews] moderate', id, action, ok);
  return json({ ok }, ok ? 200 : 404);
}

/** Что показать в `/health`: включена ли модерация отзывов. */
export function liveReviewsHealth(env: LiveEnv): { reviewsInbox: boolean } {
  return { reviewsInbox: Boolean((env.REVIEWS_INBOX_KEY ?? '').trim()) };
}
