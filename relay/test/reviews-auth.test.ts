import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { type Env } from '../src/index.ts';

/* Один вход на всю мастерскую: ключ GitHub. Второго кода нет.
   Здесь проверяем именно эту развилку — какие ключи пускают к модерации. */

interface Call { url: string; auth: string }
let calls: Call[] = [];
let github: 'push' | 'read' | 'bad' | 'down' = 'push';

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  const headers = new Headers(init?.headers ?? {});
  const auth = headers.get('authorization') ?? '';
  calls.push({ url, auth });
  if (url.includes('api.github.com')) {
    if (github === 'down') throw new Error('github down');
    if (github === 'bad') return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 });
    /* Настоящий GitHub отвечает 401 на всё, что не похоже на его ключ. */
    if (!/^Bearer ghp_/.test(auth)) return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 });
    const permissions = github === 'read' ? { push: false, admin: false } : { push: true, admin: false };
    return new Response(JSON.stringify({ full_name: 'sledovatel61/avtotehservis', permissions }), { status: 200 });
  }
  /* Telegram и почта: отвечаем «принято», чтобы отзыв точно опубликовался. */
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}) as typeof fetch;

function makeKv() {
  const map = new Map<string, string>();
  return {
    get: async (k: string) => map.get(k) ?? null,
    put: async (k: string, v: string) => { map.set(k, v); },
    delete: async (k: string) => { map.delete(k); },
  };
}

function env(over: Partial<Env> = {}): Env {
  return {
    BOT_TOKEN: '123:TEST',
    TELEGRAM_CHAT_ID: '-1001234567890',
    TELEGRAM_API_BASE: 'https://tg.test',
    ALLOWED_ORIGINS: 'https://ats-rostov.ru',
    CONSENT_VERSION: '2026-11-20',
    ATS_KV: makeKv() as unknown as NonNullable<Env['ATS_KV']>,
    ...over,
  };
}

const review = (over: Record<string, unknown> = {}) => ({
  author: 'Ольга В.',
  text: 'Меняли тормозные колодки, всё показали и объяснили заранее, спасибо большое.',
  rating: 5,
  consent: true,
  consentVersion: '2026-11-20',
  honeypot: '',
  page: '/otzyvy',
  ...over,
});

async function publish(e: Env): Promise<string> {
  const res = await worker.fetch(new Request('https://relay.test/reviews', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://ats-rostov.ru' },
    body: JSON.stringify(review()),
  }), e);
  assert.equal(res.status, 201);
  return ((await res.json()) as { id: string }).id;
}

const moderate = (e: Env, id: string, headers: Record<string, string>, action = 'delete') =>
  worker.fetch(new Request('https://relay.test/reviews/moderate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ id, action }),
  }), e);

const listAlive = async (e: Env): Promise<number> => {
  const res = await worker.fetch(new Request('https://relay.test/reviews'), e);
  return ((await res.json()) as { total: number }).total;
};

test('ключ GitHub с правом записи пускает к модерации без второго кода', async () => {
  calls = [];
  const e = env();
  const id = await publish(e);
  const res = await moderate(e, id, { authorization: 'Bearer ghp_test_token' });
  assert.equal(res.status, 200);
  assert.equal(await listAlive(e), 0, 'отзыв удалён тем же ключом, что и вход в мастерскую');
  assert.ok(calls.some((c) => c.url === 'https://api.github.com/repos/sledovatel61/avtotehservis'), 'ключ проверен у GitHub');
});

test('проверенный ключ не дёргает GitHub на каждый клик: пять минут помним', async () => {
  calls = [];
  const e = env();
  const id = await publish(e);
  await moderate(e, id, { authorization: 'Bearer ghp_cached_token' }, 'hide');
  const before = calls.filter((c) => c.url.includes('api.github.com')).length;
  await moderate(e, id, { authorization: 'Bearer ghp_cached_token' }, 'publish');
  const after = calls.filter((c) => c.url.includes('api.github.com')).length;
  assert.equal(before, 1);
  assert.equal(after, 1, 'второй запрос обошёлся без GitHub');
});

test('ключ без права записи и мусорный ключ — 403, отзыв на месте', async () => {
  const e = env();
  const id = await publish(e);

  github = 'read';
  assert.equal((await moderate(e, id, { authorization: 'Bearer ghp_only_read' })).status, 403);
  github = 'bad';
  assert.equal((await moderate(e, id, { authorization: 'Bearer ghp_wrong' })).status, 403);
  github = 'push';
  assert.equal((await moderate(e, id, { authorization: 'Bearer not-a-github-token' })).status, 403);
  assert.equal(await listAlive(e), 1);
});

test('GitHub недоступен — 503, а не «нет доступа»: это разные вещи', async () => {
  const e = env();
  const id = await publish(e);
  github = 'down';
  const res = await moderate(e, id, { authorization: 'Bearer ghp_unknown_state' });
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as { error?: string }).error, 'auth_unavailable');
  github = 'push';
});

test('старый код x-inbox-key продолжает работать как запасной вход', async () => {
  const e = env({ REVIEWS_INBOX_KEY: 'legacy-code-123' });
  const id = await publish(e);
  assert.equal((await moderate(e, id, { 'x-inbox-key': 'legacy-code-123' })).status, 200);
});

test('без всякого ключа к модерации не пускают', async () => {
  const e = env();
  const id = await publish(e);
  assert.equal((await moderate(e, id, {})).status, 403);
  assert.equal(await listAlive(e), 1);
});

test('список для мастерской тоже открывается ключом GitHub', async () => {
  const e = env();
  await publish(e);
  const res = await worker.fetch(new Request('https://relay.test/reviews/inbox', {
    headers: { authorization: 'Bearer ghp_inbox_token' },
  }), e);
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { total: number }).total, 1);
});

test('health говорит, что модерация открывается ключом GitHub', async () => {
  const res = await worker.fetch(new Request('https://relay.test/health'), env());
  const body = (await res.json()) as { reviewsModeration?: string; reviews?: boolean };
  assert.equal(body.reviews, true);
  assert.equal(body.reviewsModeration, 'github');
});
