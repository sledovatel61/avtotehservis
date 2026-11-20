/* Живые отзывы на /otzyvy (круг 96).
 *
 * Зачем: отзыв публикуется сразу, но сайт — статика на GitHub Pages. Страница
 * собирается с теми отзывами, что лежат в репозитории (`content/reviews.json`),
 * а свежие забираются из прослойки `GET /reviews` при открытии страницы.
 *
 * Правила:
 *   • без прослойки (демо-сборка) ничего не делаем — показываем статику;
 *   • если запрос не удался, страница остаётся как была: ни ошибок, ни пустоты;
 *   • дубли отсекаем по имени+тексту+оценке: те же отзывы уже могут быть в статике;
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

/** Отбирает отзывы, которых ещё нет на странице. */
export function pickNew(live: LiveReview[], existingKeys: Set<string>, limit = 50): LiveReview[] {
  const out: LiveReview[] = [];
  const seen = new Set(existingKeys);
  for (const item of live) {
    if (!item || typeof item.text !== 'string') continue;
    const key = reviewKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
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

/** Подключает живые отзывы на странице. Возвращает число добавленных карточек. */
export async function mountLiveReviews(
  doc: Document = document,
  options: { base?: string; fetcher?: (url: string) => Promise<Response>; limit?: number; refresh?: boolean } = {},
): Promise<number> {
  const base = options.base ?? LEADS_BASE;
  if (!base) return 0;
  const grid = doc.querySelector<HTMLElement>('.rev-grid');
  if (!grid) return 0;

  const existing = new Set<string>();
  for (const card of Array.from(grid.querySelectorAll('.rev-card--site'))) {
    const author = card.querySelector('.rev-who b')?.textContent ?? '';
    const text = card.querySelector('.rev-text p')?.textContent ?? '';
    const label = card.querySelector('.rev-stars')?.getAttribute('aria-label') ?? '';
    const rating = Number((/Оценка (\d)/.exec(label) ?? [])[1] ?? 0);
    existing.add(reviewKey({ author, text, rating }));
  }

  try {
    const fetcher = options.fetcher ?? ((url: string) => leadsFetch(url, { method: 'GET' }));
    /* После отправки формы ответ мог осесть в кэше на минуту — тогда нового
       отзыва не видно. Параметр в адресе обходит кэш только для этого запроса. */
    const url = options.refresh ? `${base}/reviews?t=${Date.now()}` : `${base}/reviews`;
    const res = await fetcher(url);
    if (!res.ok) return 0;
    const payload = (await res.json()) as { items?: LiveReview[] };
    const items = Array.isArray(payload.items) ? payload.items : [];
    const fresh = pickNew(items, existing, options.limit ?? 50);
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
  } catch {
    /* Сеть подвела — страница остаётся со статикой. Это не ошибка для посетителя. */
    return 0;
  }
}

if (typeof document !== 'undefined' && document.querySelector('.rev-grid')) {
  void mountLiveReviews(document);
  /* После отправки форма обновляет список — см. `review-form.ts` (событие ниже). */
  document.addEventListener('review:published', () => {
    void mountLiveReviews(document, { refresh: true });
  });
}
