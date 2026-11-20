import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
// @ts-ignore статический модуль
import { buildCard, formatDayMonth, mountLiveReviews, pickNew, plural, reviewKey, updateSummary } from '../src/client/reviews-live.ts';

const NOW = new Date('2026-11-20T12:00:00Z');

function page(html: string): Document {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document as unknown as Document;
}

const CARD = (author: string, text: string, rating = 5) => `
  <article class="rev-card rev-card--site">
    <span class="rev-stars" role="img" aria-label="Оценка ${rating} из 5"><svg class="is-on"></svg></span>
    <div class="rev-text"><p>${text}</p></div>
    <div class="rev-who"><span class="rev-ava">?</span><span><b>${author}</b><span>Сайт · 20 ноября</span></span></div>
  </article>`;

const SUMMARY = `
  <div class="rev-summary">
    <div class="rev-summary-num"><b>5,0</b><small>из 5</small></div>
    <div class="rev-summary-body"><p class="rev-summary-line">2 отзыва на сайте · средняя оценка 5,0</p></div>
  </div>`;

const live = (over: Record<string, unknown> = {}) => ({
  id: 'rlive-1',
  author: 'Ольга В.',
  text: 'Меняли тормозные колодки, всё показали и объяснили заранее, спасибо большое.',
  rating: 5,
  publishedAt: '2026-11-20T10:00:00Z',
  ...over,
});

describe('живые отзывы: чистые функции', () => {
  it('1. дата без года, если год текущий; с годом — если старый', () => {
    assert.equal(formatDayMonth('2026-11-20T10:00:00Z', NOW), '20 ноября');
    assert.equal(formatDayMonth('2025-03-04T10:00:00Z', NOW), '4 марта 2025');
    assert.equal(formatDayMonth('не дата', NOW), 'не дата');
  });

  it('2. ключ для отсечения дублей не зависит от регистра и лишних пробелов', () => {
    const a = reviewKey({ author: ' Ольга  В. ', text: 'Всё  хорошо,\nспасибо', rating: 5 });
    const b = reviewKey({ author: 'ольга в.', text: 'всё хорошо, спасибо', rating: 5 });
    assert.equal(a, b);
    assert.notEqual(a, reviewKey({ author: 'Ольга В.', text: 'Всё хорошо, спасибо', rating: 4 }));
  });

  it('3. pickNew пропускает то, что уже на странице, и уважает лимит', () => {
    const existing = new Set([reviewKey({ author: 'Михаил', text: 'Текст один', rating: 5 })]);
    const items = [
      live({ id: '1', author: 'Михаил', text: 'Текст один' }),
      live({ id: '2', author: 'Анна', text: 'Текст два, достаточно длинный для карточки.' }),
      live({ id: '3', author: 'Илья', text: 'Текст три, тоже достаточно длинный для карточки.' }),
    ];
    assert.deepEqual(pickNew(items, existing).map((r) => r.id), ['2', '3']);
    assert.deepEqual(pickNew(items, existing, 1).map((r) => r.id), ['2']);
  });

  it('4. склонение счётчика', () => {
    assert.equal(plural(1, 'отзыв', 'отзыва', 'отзывов'), 'отзыв');
    assert.equal(plural(3, 'отзыв', 'отзыва', 'отзывов'), 'отзыва');
    assert.equal(plural(11, 'отзыв', 'отзыва', 'отзывов'), 'отзывов');
    assert.equal(plural(21, 'отзыв', 'отзыва', 'отзывов'), 'отзыв');
  });

  it('5. карточка повторяет разметку страницы: звёзды, текст, имя, дата', () => {
    const doc = page('<div class="rev-grid"></div>');
    const card = buildCard(live({ rating: 4 }), doc);
    assert.equal(card.className, 'rev-card rev-card--site');
    assert.equal(card.querySelectorAll('.rev-stars svg').length, 5);
    assert.equal(card.querySelectorAll('.rev-stars svg.is-on').length, 4);
    assert.equal(card.querySelector('.rev-stars')?.getAttribute('aria-label'), 'Оценка 4 из 5');
    assert.equal(card.querySelector('.rev-text p')?.textContent, live().text);
    assert.equal(card.querySelector('.rev-who b')?.textContent, 'Ольга В.');
    assert.match(card.querySelector('.rev-who span span')?.textContent ?? '', /Сайт · 20 ноября/);
  });

  it('6. плашка пересчитывает количество и среднюю оценку', () => {
    const doc = page(`${SUMMARY}<div class="rev-grid">${CARD('Михаил', 'Первый отзыв, хороший.', 5)}${CARD('Анна', 'Второй отзыв, тоже хороший.', 4)}</div>`);
    updateSummary(doc, doc.querySelector('.rev-grid')!);
    const line = doc.querySelector('.rev-summary-line')?.textContent ?? '';
    assert.match(line, /2 отзыва на сайте · средняя оценка 4,5/);
    assert.equal(doc.querySelector('.rev-summary-num b')?.textContent, '4,5');
  });
});

describe('живые отзывы: подключение к странице', () => {
  it('7. новый отзыв встаёт первым, заглушка «отзывов нет» исчезает', async () => {
    const doc = page(`${SUMMARY}<div class="rev-grid">${CARD('Михаил', 'Первый отзыв, хороший.', 5)}</div><div data-reviews-empty><p>Пока нет</p></div>`);
    const calls: string[] = [];
    const added = await mountLiveReviews(doc, {
      base: 'https://relay.test',
      fetcher: async (url) => {
        calls.push(url);
        return { ok: true, status: 200, json: async () => ({ items: [live()] }) } as unknown as Response;
      },
    });
    assert.equal(added, 1);
    assert.equal(calls[0], 'https://relay.test/reviews');
    const grid = doc.querySelector('.rev-grid')!;
    assert.equal(grid.children.length, 2);
    assert.equal(grid.firstElementChild?.querySelector('.rev-who b')?.textContent, 'Ольга В.');
    assert.equal(doc.querySelector('[data-reviews-empty]'), null);
  });

  it('8. дубли не появляются: тот же отзыв уже в статике', async () => {
    const doc = page(`<div class="rev-grid">${CARD('Ольга В.', live().text)}</div>`);
    const added = await mountLiveReviews(doc, {
      base: 'https://relay.test',
      fetcher: async () => ({ ok: true, status: 200, json: async () => ({ items: [live()] }) } as unknown as Response),
    });
    assert.equal(added, 0);
    assert.equal(doc.querySelectorAll('.rev-card--site').length, 1);
  });

  it('9. сеть подвела или ответ не 200 — страница не меняется', async () => {
    const html = `<div class="rev-grid">${CARD('Михаил', 'Первый отзыв, хороший.')}</div>`;
    const failed = page(html);
    assert.equal(await mountLiveReviews(failed, { base: 'https://relay.test', fetcher: async () => ({ ok: false, status: 500 } as unknown as Response) }), 0);
    const broken = page(html);
    assert.equal(await mountLiveReviews(broken, { base: 'https://relay.test', fetcher: async () => { throw new Error('нет сети'); } }), 0);
    assert.equal(broken.querySelectorAll('.rev-card--site').length, 1);
  });

  it('10. без адреса прослойки запросов нет', async () => {
    const doc = page('<div class="rev-grid"></div>');
    let called = 0;
    const added = await mountLiveReviews(doc, { base: '', fetcher: async () => { called += 1; return { ok: true } as Response; } });
    assert.equal(added, 0);
    assert.equal(called, 0);
  });

  it('11. после отправки формы запрос идёт мимо кэша', async () => {
    const doc = page(`<div class="rev-grid">${CARD('Михаил', 'Первый отзыв, хороший.')}</div>`);
    const calls: string[] = [];
    await mountLiveReviews(doc, {
      base: 'https://relay.test',
      refresh: true,
      fetcher: async (url) => {
        calls.push(url);
        return { ok: true, status: 200, json: async () => ({ items: [] }) } as unknown as Response;
      },
    });
    assert.match(calls[0], /^https:\/\/relay\.test\/reviews\?t=\d+$/);
  });
});
