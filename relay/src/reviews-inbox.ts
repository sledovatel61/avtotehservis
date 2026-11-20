/**
 * «Входящие» отзывов: запасная копия каждого принятого отзыва.
 *
 * Зачем. Отзыв с сайта уходил только в Telegram и на почту — в самом воркере
 * он не хранился. Если сообщение в группе удалят (или почта не дойдёт), отзыв
 * исчезал навсегда, и владельцу нечего было публиковать. Теперь каждый
 * принятый отзыв кладётся в KV и живёт там 180 дней — независимо от Telegram.
 *
 * Доступ:
 *   GET  /reviews/inbox            заголовок `x-inbox-key: <код>`
 *                                  → { items:[{id,createdAt,author,text,rating}], total }
 *   POST /reviews/inbox/done       `x-inbox-key` + JSON { id }
 *                                  → { ok:true } — отзыв опубликован, из списка уходит
 *
 * Без секрета `REVIEWS_INBOX_KEY` оба адреса отвечают 404: включённая по
 * умолчанию «дверь в отзывы» без пароля недопустима.
 *
 * Приватность: в логах только id и длина текста. Сам текст отзыва лежит в KV
 * (Cloudflare) — это та же инфраструктура, что уже принимает отзывы, но теперь
 * копия остаётся и после отправки в Telegram.
 */

/** Сколько живёт копия отзыва в «входящих». */
export const INBOX_TTL_SEC = 180 * 24 * 3600;
/** Сколько отзывов храним максимум (старые вытесняются). */
export const INBOX_MAX = 200;

const INDEX_KEY = 'rinbox:index';
const itemKey = (id: string) => `rinbox:item:${id}`;

export interface InboxEnv {
  REVIEWS_INBOX_KEY?: string;
}

export interface InboxStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSec: number): Promise<void>;
}

export interface InboxReview {
  id: string;
  createdAt: string;
  author: string;
  text: string;
  rating: number;
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/** Сравнение кода без раннего выхода: длина и символы проверяются целиком. */
function sameKey(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Код доступа из заголовка или (для проверки руками) из `?key=`. */
export function inboxKeyOf(req: Request, url: URL): string {
  return (req.headers.get('x-inbox-key') ?? url.searchParams.get('key') ?? '').trim();
}

async function readIndex(store: InboxStore): Promise<string[]> {
  const raw = await store.get(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function writeIndex(store: InboxStore, ids: string[]): Promise<void> {
  await store.put(INDEX_KEY, JSON.stringify(ids.slice(0, INBOX_MAX)), INBOX_TTL_SEC);
}

/**
 * Положить принятый отзыв в «входящие». Ошибки глотаем: если KV недоступен,
 * отзыв всё равно должен уйти в Telegram — диагностика важнее идеальности.
 */
export async function saveToInbox(
  store: InboxStore,
  review: { author: string; text: string; rating: number },
  id: string,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    const item: InboxReview = {
      id,
      createdAt: now.toISOString(),
      author: review.author,
      text: review.text,
      rating: review.rating,
    };
    await store.put(itemKey(id), JSON.stringify(item), INBOX_TTL_SEC);
    const ids = await readIndex(store);
    await writeIndex(store, [id, ...ids.filter((x) => x !== id)]);
    return true;
  } catch {
    return false;
  }
}

/** Список отзывов из «входящих»: новые сверху, без уже опубликованных. */
export async function readInbox(store: InboxStore, limit = 50): Promise<InboxReview[]> {
  const ids = await readIndex(store);
  const out: InboxReview[] = [];
  for (const id of ids) {
    if (out.length >= limit) break;
    const raw = await store.get(itemKey(id));
    if (!raw) continue;
    try {
      const item = JSON.parse(raw) as InboxReview & { done?: boolean };
      if (item.done) continue;
      out.push({
        id: item.id,
        createdAt: item.createdAt,
        author: item.author,
        text: item.text,
        rating: item.rating,
      });
    } catch {
      /* битую запись пропускаем: одна испорченная не должна прятать остальные */
    }
  }
  return out;
}

/**
 * Пометить отзыв опубликованным. Физически не удаляем: если владелец ошибся,
 * запись ещё 180 дней лежит и находится поиском по id — но в списке не мешает.
 */
export async function markInboxDone(store: InboxStore, id: string): Promise<boolean> {
  const raw = await store.get(itemKey(id));
  if (!raw) return false;
  try {
    const item = JSON.parse(raw) as InboxReview;
    await store.put(itemKey(id), JSON.stringify({ ...item, done: true }), INBOX_TTL_SEC);
    const ids = await readIndex(store);
    await writeIndex(store, ids.filter((x) => x !== id));
    return true;
  } catch {
    return false;
  }
}

/**
 * Обработчик `/reviews/inbox` и `/reviews/inbox/done`.
 * Возвращает `null`, если адрес не наш — тогда `index.ts` отдаст общий 404.
 */
export async function handleInbox(
  req: Request,
  url: URL,
  env: InboxEnv,
  store: InboxStore,
): Promise<Response | null> {
  const isList = url.pathname === '/reviews/inbox';
  const isDone = url.pathname === '/reviews/inbox/done';
  if (!isList && !isDone) return null;
  if (!isList && req.method !== 'POST') return json({ error: 'not_found' }, 404);

  /* Нет секрета — нет и адреса: иначе список отзывов открыт всему интернету. */
  const secret = (env.REVIEWS_INBOX_KEY ?? '').trim();
  if (!secret) return json({ error: 'not_found' }, 404);
  if (!sameKey(inboxKeyOf(req, url), secret)) return json({ error: 'forbidden' }, 403);

  if (isList) {
    if (req.method !== 'GET') return json({ error: 'not_found' }, 404);
    const items = await readInbox(store);
    return json({ items, total: items.length });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const id = typeof (body as { id?: unknown })?.id === 'string' ? (body as { id: string }).id.trim() : '';
  if (!id) return json({ error: 'bad_id' }, 400);
  const ok = await markInboxDone(store, id);
  console.log('[reviews] inbox done', id, ok);
  return json({ ok }, ok ? 200 : 404);
}

/** Что показать в `/health`: включён ли запасной журнал отзывов. */
export function inboxHealth(env: InboxEnv): { reviewsInbox: boolean } {
  return { reviewsInbox: Boolean((env.REVIEWS_INBOX_KEY ?? '').trim()) };
}
