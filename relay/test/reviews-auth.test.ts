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
    /* Настоящий GitHub знает три вида ключей: classic (ghp_), fine-grained
       (github_pat_) и служебные (gho_/ghu_/ghs_). Всё остальное — 401. */
    if (!/^Bearer (ghp_|github_pat_|gho_|ghu_|ghs_)/.test(auth)) {
      return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 });
    }
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

/* Состояние мок-сервера сбрасываем перед каждым тестом: иначе упавший тест
   оставит github='read' и посыплет следующие. */
test.beforeEach(() => { github = 'push'; });

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

const moderate = (
  e: Env,
  id: string,
  headers: Record<string, string>,
  action = 'delete',
  extra: Record<string, unknown> = {},
) =>
  worker.fetch(new Request('https://relay.test/reviews/moderate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ id, action, ...extra }),
  }), e);

/** Скрыть/показать/удалить по id с ключом GitHub по умолчанию. */
const act = (e: Env, id: string, action: string, headers: Record<string, string> = { authorization: `Bearer ${PAT}` }) =>
  moderate(e, id, headers, action);

const PAT = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

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

/* ------------------------------------------------------------------ *
 *  Fine-grained ключи GitHub (github_pat_…)
 *
 *  У владельца в /manage/ лежит именно такой ключ. Права на репозиторий
 *  проверяются ответом api.github.com, поэтому форма строки не важна —
 *  важно, что он проходит и получает 200, а не 403.
 * ------------------------------------------------------------------ */

test('fine-grained ключ github_pat_ с правом записи пускает к модерации', async () => {
  calls = [];
  const e = env();
  const id = await publish(e);

  const res = await act(e, id, 'hide', { authorization: `Bearer ${PAT}` });
  assert.equal(res.status, 200, 'fine-grained токен не должен получать 403');
  assert.deepEqual(await res.json(), { ok: true });

  const gh = calls.filter((c) => c.url.includes('api.github.com'));
  assert.equal(gh.length, 1, 'ключ проверен у GitHub');
  assert.equal(gh[0].auth, `Bearer ${PAT}`, 'ключ ушёл как есть, без обрезки по префиксу');
});

test('github_pat_ открывает и список для мастерской', async () => {
  const e = env();
  await publish(e);
  const res = await worker.fetch(new Request('https://relay.test/reviews/inbox', {
    headers: { authorization: `Bearer ${PAT}` },
  }), e);
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { total: number }).total, 1);
});

test('github_pat_ без права записи — 403; мусор с похожим префиксом — 403', async () => {
  const e = env();
  const id = await publish(e);

  /* Ключ не тот же, что в предыдущем тесте: проверенные ключи помнятся пять
     минут, и по кэшу этот запрос прошёл бы без вопроса к GitHub. */
  const noWrite = `${PAT}_nowrite`;
  github = 'read';
  assert.equal((await act(e, id, 'delete', { authorization: `Bearer ${noWrite}` })).status, 403);
  github = 'push';

  /* Ключ, который только притворяется ключом GitHub: 401 от API → 403. */
  const fake = await act(e, id, 'delete', { authorization: 'Bearer pat_1234567890abcdef' });
  assert.equal(fake.status, 403, 'форма префикса не заменяет проверку у GitHub');
  assert.equal(await listAlive(e), 1, 'отзыв на месте');
});

/* ------------------------------------------------------------------ *
 *  action: 'edit' — правка отзыва из единого редактора /manage/#reviews
 * ------------------------------------------------------------------ */

test('edit правит отзыв на месте с ключом GitHub', async () => {
  calls = [];
  const e = env();
  const id = await publish(e);

  const res = await moderate(e, id, { authorization: `Bearer ${PAT}` }, 'edit', {
    author: 'Ольга В.',
    text: 'Уточняю отзыв: колодки поменяли за час, цена совпала с той, что назвали заранее.',
    rating: 4,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  const inbox = await worker.fetch(new Request('https://relay.test/reviews/inbox', {
    headers: { authorization: `Bearer ${PAT}` },
  }), e);
  const item = ((await inbox.json()) as { items: { id: string; author: string; rating: number; text: string; status: string }[] })
    .items.find((x) => x.id === id);
  assert.ok(item);
  assert.equal(item.author, 'Ольга В.');
  assert.equal(item.rating, 4);
  assert.match(item.text, /Уточняю отзыв/);
  assert.equal(item.status, 'published', 'статус остался прежним');
});

test('edit с неверными полями — 400 validation, отзыв не меняется', async () => {
  const e = env();
  const id = await publish(e);

  const shortText = await moderate(e, id, { authorization: `Bearer ${PAT}` }, 'edit', {
    author: 'Ольга В.', text: 'коротко', rating: 5,
  });
  assert.equal(shortText.status, 400);
  const body = (await shortText.json()) as { error: string; fields: Record<string, string> };
  assert.equal(body.error, 'validation');
  assert.equal(body.fields.text, 'too_short');

  const badRating = await moderate(e, id, { authorization: `Bearer ${PAT}` }, 'edit', {
    author: 'Ольга В.', text: 'Достаточно длинный текст для проверки правки отзыва', rating: 9,
  });
  assert.equal(badRating.status, 400);
  assert.equal(((await badRating.json()) as { fields: Record<string, string> }).fields.rating, 'out_of_range');

  assert.equal(await listAlive(e), 1);
});

/* ------------------------------------------------------------------ *
 *  Идемпотентность: старые отзывы из файла не роняют админку в 404
 * ------------------------------------------------------------------ */

test('hide/publish/delete/edit по отзыву, которого нет в KV, — 200 noop', async () => {
  const e = env();
  const ghost = 'file-review-2019-07';

  for (const action of ['hide', 'publish', 'delete']) {
    const res = await act(e, ghost, action);
    assert.equal(res.status, 200, action);
    assert.deepEqual(await res.json(), { ok: true, noop: true }, action);
  }

  const edited = await moderate(e, ghost, { authorization: `Bearer ${PAT}` }, 'edit', {
    author: 'Старый отзыв', text: 'Такой отзыв лежит в файле сайта, а в облаке его никогда не было.', rating: 5,
  });
  assert.equal(edited.status, 200);
  assert.deepEqual(await edited.json(), { ok: true, noop: true });
});

test('повторное удаление уже удалённого отзыва — 200 noop, первый раз 200 ok', async () => {
  const e = env();
  const id = await publish(e);

  const first = await act(e, id, 'delete');
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { ok: true });

  const second = await act(e, id, 'delete');
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { ok: true, noop: true });
  assert.equal(await listAlive(e), 0);
});

test('обход кэша: ?t= отдаёт no-store, без него — минуту', async () => {
  const e = env();
  await publish(e);

  const warm = await worker.fetch(new Request('https://relay.test/reviews'), e);
  assert.equal(warm.headers.get('cache-control'), 'public, max-age=60');

  const fresh = await worker.fetch(new Request('https://relay.test/reviews?t=1732012345'), e);
  assert.equal(fresh.status, 200);
  assert.equal(fresh.headers.get('cache-control'), 'no-store');
});
