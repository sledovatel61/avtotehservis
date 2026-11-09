/* Круг 26 (задание №30): тест «нет вранья» по собранному HTML (pages-dist, после build:pages).
   Владелец 05.11.2026 снял с сайта направления, которых сервис не ведёт, и запретил
   выдумывать рейтинги. Проверки по всем экспортированным страницам:
     L1. нигде нет слов-маркеров снятых направлений: «грузов», «прокатк», «развал-схожден»,
         «сход-развал», «правка дисков»;
     L2. главная: отзывы только Яндекс — aria-label «Отзывы об АвтоТехСервис на Яндекс.Картах»,
         в ld+json нет AggregateRating/Review, цифры рейтинга 4,5 и 182 не публикуются;
     L3. /services: 7 карточек с ценой «от N ₽» (.svc-price), карточек ровно 7;
     L4. /prices: H1 «Прайс на работы», 6 якорей групп, 5 сносок;
     L5. /garantii: ровно 7 пунктов;
     L6. /about: B2B-секции «Паркам и коммерческому транспорту» нет, блок «Сертификаты» есть;
     L7. /appointment: 11 чипов услуг + чип «Не знаю» (chip--dk) отдельно.
   Запуск: node --test tests/content.test.ts (входит в npm test, после build:pages). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(SITE, 'pages-dist');

const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : (e.name.endsWith('.html') ? [join(dir, e.name)] : [])));

const pages = existsSync(DIST) ? walk(DIST) : [];
const read = (rel: string) => readFileSync(join(DIST, rel), 'utf8');
const stripTags = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ');

test('L0 pages-dist собран (build:pages прошёл до тестов)', () => {
  assert.ok(pages.length >= 10, `страниц в pages-dist: ${pages.length}`);
});

test('L1 нет вранья: снятые направления не упоминаются ни на одной странице', () => {
  /* «ремонт шин» и «автоэлектрик*» добавлены в круг 26 после ревью: 404-страница перечисляла
     направления, снятые владельцем (remont-shin → balansirovka, elektrika → diagnostika),
     и тест этого не видел. Голое «электрика» не баним: оно законно живёт в статье про
     кондиционер («виноват агрегат, датчик давления или электрика»). «ходовая» тоже не баним —
     это словосочетание «диагностика ходовой», действующая услуга. */
  const BANNED = ['грузов', 'прокатк', 'развал-схожден', 'сход-развал', 'правка дисков', 'ремонт шин', 'автоэлектрик'];
  for (const p of pages) {
    const text = stripTags(readFileSync(p, 'utf8')).toLowerCase();
    for (const b of BANNED) {
      assert.ok(!text.includes(b), `${p.replace(DIST, '')}: найдено «${b}»`);
    }
  }
});

test('L2 главная: отзывы только Яндекс, без выдуманных рейтингов', () => {
  const html = read('index.html');
  assert.ok(html.includes('Отзывы об АвтоТехСервис на Яндекс.Картах'), 'aria-label яндексовской ссылки');
  assert.ok(!html.includes('AggregateRating'), 'нет AggregateRating');
  assert.ok(!/"@type"\s*:\s*"Review"/.test(html), 'нет Review в ld+json');
  const text = stripTags(html);
  assert.ok(!text.includes('4,5'), 'цифра рейтинга 4,5 не публикуется');
  assert.ok(!text.includes('182'), 'число отзывов 182 не публикуется');
});

test('L3 /services: 7 карточек, у каждой цена «от»', () => {
  const html = read(join('services', 'index.html'));
  const cards = (html.match(/class="svc-card/g) || []).length;
  const prices = (html.match(/class="svc-price"/g) || []).length;
  assert.equal(cards, 7, 'карточек услуг 7');
  assert.equal(prices, 7, 'цен «от N ₽» 7');
});

test('L4 /prices: заголовок, 6 якорей, 5 сносок', () => {
  const html = read(join('prices', 'index.html'));
  assert.ok(html.includes('Прайс на работы'), 'H1 «Прайс на работы»');
  for (const id of ['to', 'tormoza', 'podveska', 'grm', 'diagnostika', 'shiny']) {
    assert.ok(html.includes(`id="${id}"`), `якорь #${id}`);
  }
  const foot = html.match(/<div class="price-foot">([\s\S]*?)<\/div>/);
  assert.ok(foot && (foot[1].match(/<li>/g) || []).length === 5, '5 сносок в .price-foot');
});

test('L5 /garantii: ровно 7 пунктов', () => {
  const html = read(join('garantii', 'index.html'));
  const items = (html.match(/class="gar-item"/g) || []).length;
  assert.equal(items, 7, 'пунктов гарантий 7');
});

test('L6 /about: B2B убран, сертификаты на месте', () => {
  const html = read(join('about', 'index.html'));
  assert.ok(!html.includes('Паркам и коммерческому транспорту'), 'B2B-секции нет');
  assert.ok(html.includes('ab-cert-h'), 'блок «Сертификаты» есть');
  for (const k of ['lynxauto', 'sufix', 'korson', 'ngn']) {
    assert.ok(html.includes(`cert-${k}-720.webp`), `иллюстрация cert-${k}`);
  }
});

test('L7 /appointment: 11 чипов услуг + «Не знаю»', () => {
  const html = read(join('appointment', 'index.html'));
  const chips = (html.match(/<input type="checkbox" name="svc" value=/g) || []).length;
  assert.equal(chips, 11, 'чипов услуг 11');
  assert.ok(html.includes('chip--dk'), 'чип «Не знаю» на месте');
  assert.ok(!html.includes('value="shinomontazh-gruz"'), 'грузового чипа нет');
});
