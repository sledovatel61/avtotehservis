/* Живые отзывы на /otzyvy (круг 96).
 *
 * Зачем: отзыв публикуется сразу, но сайт — статика на GitHub Pages. Страница
 * собирается с теми отзывами, что лежат в репозитории (`content/reviews.json`),
 * а свежие забираются из прослойки `GET /reviews` при открытии страницы.
 *
 * Правила:
 *   • без прослойки (демо-сборка) ничего не делаем — показываем статику;
 *   • если запрос не удался, страница остаётся как была: ни ошибок, ни пустоты;
 *   • дубли отсекаем по id и по отпечатку «имя|текст|оценка»: те же отзывы уже есть в статике;
 *   • отзывы, которые есть в файле, но скрыты владельцем (`status: "hidden"`), НИКОГДА
 *     не добавляются из прослойки: их id и ключи приходят в `data-known-ids`/`data-known-keys`;
 *   • порядок — новые сверху, как в статике.
 *
 * Разметку карточки повторяем ровно ту, что у серверной версии: классы
 * `rev-card rev-card--site`, звёзды, текст, подпись. Иначе стили «поплывут».
 */
import { LEADS_BASE, leadsFetch } from '../shared/leads-endpoint.ts';

interface LiveReview {
  id: string;
  author: string;
  text: string;
  rating: number;
  publishedAt: string;
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «20 ноября», а если год не текущий — «20 ноября 2025». Как на серверной части. */
export function formatDayMonth(iso: string, now: Date = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return iso ?? '';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return iso;
  const base = `${day} ${MONTHS_GEN[month - 1]}`;
  return year === now.getFullYear() ? base : `${base} ${year}`;
}

/** Ключ для отсечения дублей: статика и прослойка описывают один и тот же отзыв. */
export function reviewKey(r: { author: string; text: string; rating: number }): string {
  const squeeze = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  return `${squeeze(r.author)}|${squeeze(r.text)}|${r.rating}`;
}

/**
 * Короткий отпечаток ключа (FNV-1a, 32 бита, hex).
 *
 * Зачем не сам ключ: список известных ключей уезжает в HTML страницы, а среди отзывов
 * есть скрытые владельцем — с матом. Текст скрытого отзыва не должен светиться даже
 * в исходнике страницы, поэтому в `data-known-keys` лежат отпечатки, а не тексты.
 */
export function keyHash(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Отпечаток ключа отзыва — то, что сравниваем в `pickNew`. */
export function reviewKeyHash(r: { author: string; text: string; rating: number }): string {
  return keyHash(reviewKey(r));
}

/**
 * Отбирает отзывы, которых ещё нет на странице.
 *
 * Отсекаем по ДВУМ признакам: `id` и ключу «автор|текст|оценка». Одного ключа мало:
 * отзыв, скрытый в `content/reviews.json` (`status: "hidden"`), не рендерится в статику,
 * и без проверки id воркер снова подтягивал его из кэша `GET /reviews` — скрытый
 * матерный отзыв «воскресал» на сайте. Список известных id сервер отдаёт в
 * `data-known-ids` (см. `knownFromContainer`), включая скрытые записи.
 */
export function pickNew(
  live: LiveReview[],
  existingKeys: Set<string>,
  limit = 50,
  existingIds: Set<string> = new Set(),
): LiveReview[] {
  const out: LiveReview[] = [];
  const seen = new Set(existingKeys);
  const seenIds = new Set(existingIds);
  for (const item of live) {
    if (!item || typeof item.text !== 'string') continue;
    if (item.id && seenIds.has(item.id)) continue;
    const key = reviewKeyHash(item);
    if (seen.has(key)) continue;
    seen.add(key);
    if (item.id) seenIds.add(item.id);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Данные для серверной разметки: id и ключи ВСЕХ отзывов файла, включая скрытые.
 * Страницы кладут их на контейнер (`data-known-ids` / `data-known-keys`), чтобы
 * клиент знал про скрытые записи, которых физически нет в HTML.
 */
export function knownAttrs(
  items: { id: string; author: string; text: string; rating: number }[],
): { ids: string; keys: string } {
  return {
    ids: JSON.stringify(items.map((r) => r.id)),
    keys: JSON.stringify(items.map((r) => reviewKeyHash(r))),
  };
}

/** Читает JSON-массив из data-атрибута; старый формат (через перевод строки) тоже понимаем. */
function readList(container: Element, attr: string): string[] {
  const raw = (container.getAttribute(attr) ?? '').trim();
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string' && v !== '');
  } catch { /* не JSON — разберём как список строк */ }
  return raw.split(/\n+/).map((v) => v.trim()).filter(Boolean);
}

/** id и ключи известных отзывов: из data-атрибутов контейнера + с уже отрисованных карточек. */
export function knownFromContainer(container: Element): { ids: Set<string>; keys: Set<string> } {
  const ids = new Set<string>(readList(container, 'data-known-ids'));
  const keys = new Set<string>(readList(container, 'data-known-keys'));
  for (const card of Array.from(container.querySelectorAll('.rev-card'))) {
    const id = card.getAttribute('data-review-id');
    if (id) ids.add(id);
  }
  return { ids, keys };
}

function starRow(doc: Document, rating: number): HTMLElement {
  const row = doc.createElement('span');
  row.className = 'rev-stars';
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', `Оценка ${rating} из 5`);
  for (let i = 0; i < 5; i += 1) {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    if (i < rating) svg.setAttribute('class', 'is-on');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z');
    svg.append(path);
    row.append(svg);
  }
  return row;
}

/** Склонение для счётчика: «1 отзыв / 2 отзыва / 6 отзывов». */
export function plural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
}

/** Пересчитывает плашку «N отзывов на сайте · средняя оценка X» по карточкам. */
export function updateSummary(doc: Document, grid: Element): void {
  const ratings: number[] = [];
  for (const stars of Array.from(grid.querySelectorAll('.rev-card--site .rev-stars'))) {
    const found = /Оценка (\d)/.exec(stars.getAttribute('aria-label') ?? '');
    if (found) ratings.push(Number(found[1]));
  }
  if (!ratings.length) return;
  const avg = (ratings.reduce((sum, n) => sum + n, 0) / ratings.length).toFixed(1).replace('.', ',');
  const line = doc.querySelector('.rev-summary-line');
  if (line) line.textContent = `${ratings.length} ${plural(ratings.length, 'отзыв', 'отзыва', 'отзывов')} на сайте · средняя оценка ${avg}`;
  const big = doc.querySelector('.rev-summary-num b');
  if (big) big.textContent = avg;
}

/** Карточка отзыва — та же структура, что в серверной разметке. */
export function buildCard(item: LiveReview, doc: Document = document): HTMLElement {
  const card = doc.createElement('article');
  card.className = 'rev-card rev-card--site';
  card.dataset.reviewLive = item.id;
  /* id отзыва виден в разметке: по нему статика и живые отзывы не дублируют друг друга,
     даже если текст в воркере и в файле отличается пробелами. */
  card.dataset.reviewId = item.id;

  card.append(starRow(doc, item.rating));

  const text = doc.createElement('div');
  text.className = 'rev-text';
  const p = doc.createElement('p');
  p.textContent = item.text;
  text.append(p);
  card.append(text);

  const who = doc.createElement('div');
  who.className = 'rev-who';

  const ava = doc.createElement('span');
  ava.className = 'rev-ava';
  ava.setAttribute('aria-hidden', 'true');
  ava.textContent = (item.author || '?').slice(0, 1);

  const box = doc.createElement('span');
  const name = doc.createElement('b');
  name.textContent = item.author;
  const meta = doc.createElement('span');
  meta.textContent = `Сайт · ${formatDayMonth(item.publishedAt)}`;
  box.append(name, meta);

  who.append(ava, box);
  card.append(who);
  return card;
}

/** Ключи уже показанных отзывов: по ним отсекаем дубли из прослойки. */
function existingKeys(container: Element): Set<string> {
  const keys = new Set<string>();
  for (const card of Array.from(container.querySelectorAll('.rev-card'))) {
    const author = card.querySelector('.rev-who b')?.textContent ?? '';
    const text = card.querySelector('.rev-text p')?.textContent ?? '';
    const label = card.querySelector('.rev-stars')?.getAttribute('aria-label') ?? '';
    const rating = Number((/Оценка (\d)/.exec(label) ?? [])[1] ?? 0);
    if (author || text) keys.add(reviewKeyHash({ author, text, rating }));
  }
  return keys;
}

/** Забирает свежие отзывы из прослойки. Пусто и при любой сетевой ошибке. */
async function fetchLive(
  base: string,
  options: { fetcher?: (url: string) => Promise<Response>; refresh?: boolean },
): Promise<LiveReview[]> {
  try {
    const fetcher = options.fetcher ?? ((url: string) => leadsFetch(url, { method: 'GET' }));
    /* После отправки формы ответ мог осесть в кэше на минуту — тогда нового
       отзыва не видно. Параметр в адресе обходит кэш только для этого запроса. */
    const url = options.refresh ? `${base}/reviews?t=${Date.now()}` : `${base}/reviews`;
    const res = await fetcher(url);
    if (!res.ok) return [];
    const payload = (await res.json()) as { items?: LiveReview[] };
    return Array.isArray(payload.items) ? payload.items : [];
  } catch {
    return [];
  }
}

/** Подключает живые отзывы на странице. Возвращает число добавленных карточек. */
export async function mountLiveReviews(
  doc: Document = document,
  options: { base?: string; fetcher?: (url: string) => Promise<Response>; limit?: number; refresh?: boolean } = {},
): Promise<number> {
  const base = options.base ?? LEADS_BASE;
  if (!base) return 0;
  const grid = doc.querySelector<HTMLElement>('.rev-grid');
  if (!grid) return 0;

  const known = knownFromContainer(grid);
  const existing = existingKeys(grid);
  for (const key of known.keys) existing.add(key);
  const items = await fetchLive(base, options);
  if (!items.length) return 0;
  const fresh = pickNew(items, existing, options.limit ?? 50, known.ids);
  if (!fresh.length) return 0;

  /* Новые сверху: вставляем перед первой карточкой, сохраняя порядок списка. */
  const anchor = grid.firstElementChild;
  for (const item of fresh) {
    const card = buildCard(item, doc);
    if (!anchor) grid.append(card);
    else grid.insertBefore(card, anchor);
  }
  grid.dataset.reviewsLive = String(fresh.length);
  /* Живой отзыв появился — заглушка «пока отзывов нет» больше не правда. */
  doc.querySelector('[data-reviews-empty]')?.remove();
  updateSummary(doc, grid);
  return fresh.length;
}


/**
 * Пересчитывает плашки на главной. В статике лежат 6 карточек из 9 отзывов файла,
 * поэтому «базу» (сколько всего отзывов и их сумма баллов) запоминаем при первом
 * заходе, а дальше прибавляем к ней только живые отзывы. Иначе плашка показывала бы
 * 6 или 8 вместо настоящего числа — на /otzyvy было бы другое.
 */
export function updateHomeRates(doc: Document, track: Element): void {
  const box = doc.querySelector<HTMLElement>('[data-reviews-rates]');
  const avgEl = doc.querySelector<HTMLElement>('[data-reviews-avg]');
  const countEl = doc.querySelector<HTMLElement>('[data-reviews-count]');
  if (!box || !avgEl || !countEl) return;

  if (box.dataset.baseCount === undefined) {
    const shown = Number((avgEl.textContent ?? '').replace(',', '.'));
    box.dataset.baseCount = countEl.textContent ?? '0';
    box.dataset.baseSum = String((Number.isFinite(shown) ? shown : 0) * Number(box.dataset.baseCount));
  }
  let count = Number(box.dataset.baseCount);
  let sum = Number(box.dataset.baseSum);

  for (const card of Array.from(track.querySelectorAll('.rev-card[data-live-review]'))) {
    const found = /Оценка (\d)/.exec(card.querySelector('.rev-stars')?.getAttribute('aria-label') ?? '');
    if (!found) continue;
    count += 1;
    sum += Number(found[1]);
  }
  if (!count) return;
  avgEl.textContent = (sum / count).toFixed(1).replace('.', ',');
  countEl.textContent = String(count);
}

/**
 * Главная: свежие отзывы сверху в карусели. Карточек в статике шесть, поэтому
 * новые с сайта не теряются — они встают первыми, а карусель просто удлиняется.
 */
export async function mountHomeReviews(
  doc: Document = document,
  options: { base?: string; fetcher?: (url: string) => Promise<Response>; limit?: number; refresh?: boolean } = {},
): Promise<number> {
  const base = options.base ?? LEADS_BASE;
  if (!base) return 0;
  const track = doc.querySelector<HTMLElement>('[data-home-reviews-track]');
  if (!track) return 0;

  const known = knownFromContainer(track);
  const existing = existingKeys(track);
  for (const key of known.keys) existing.add(key);
  const items = await fetchLive(base, options);
  if (!items.length) return 0;
  const fresh = pickNew(items, existing, options.limit ?? 6, known.ids);
  if (!fresh.length) return 0;

  const placeholder = track.querySelector('.rev-card--yandex');
  placeholder?.remove();
  const anchor = track.firstElementChild;
  for (const item of fresh) {
    const card = buildCard(item, doc);
    card.dataset.liveReview = '1';
    if (!anchor) track.append(card);
    else track.insertBefore(card, anchor);
  }
  updateHomeRates(doc, track);
  /* Карусель пересчитывает, сколько всего карточек, при каждом render —
     после добавления вызываем его, чтобы стрелки знали про новые отзывы. */
  const carousel = doc.querySelector('[data-carousel]') as (HTMLElement & { __carousel?: { render(animate?: boolean): void } }) | null;
  carousel?.__carousel?.render(false);
  return fresh.length;
}

if (typeof document !== 'undefined' && document.querySelector('.rev-grid')) {
  void mountLiveReviews(document);
  /* После отправки форма обновляет список — см. `review-form.ts` (событие ниже). */
  document.addEventListener('review:published', () => {
    void mountLiveReviews(document, { refresh: true });
  });
}

if (typeof document !== 'undefined' && document.querySelector('[data-home-reviews-track]')) {
  void mountHomeReviews(document);
  document.addEventListener('review:published', () => {
    void mountHomeReviews(document, { refresh: true });
  });
}
