/* Круг 26 (задание №30): тест «нет вранья» по собранному HTML (pages-dist, после build:pages).
   Владелец 05.11.2026 снял с сайта направления, которых сервис не ведёт, и запретил
   выдумывать рейтинги. Проверки по всем экспортированным страницам:
     L1. нигде нет слов-маркеров снятых направлений: «грузов», «прокатк», «развал-схожден»,
         «сход-развал», «правка дисков»;
     L2. главная: отзывы только Яндекс — aria-label «Отзывы об АвтоТехСервис на Яндекс.Картах»,
         в ld+json нет AggregateRating/Review, цифры рейтинга 4,5 и 182 не публикуются;
     L3. /services: 8 карточек с ценой «от N ₽» (.svc-price), карточек ровно 8 (круг 27);
     L4. /prices: H1 «Прайс на работы», 8 якорей групп, строки кондиционеров и сварки, 5 сносок;
     L5. /garantii: ровно 7 пунктов;
     L6. /about: B2B-секции «Паркам и коммерческому транспорту» нет, блок «Сертификаты» есть;
     L7. /appointment: 12 чипов услуг + чип «Не знаю» (chip--dk) отдельно;
     L8. круг 27: ни на одной странице нет служебного префикса «(поле `description`)»,
         logo.svg/favicon.svg без задвоенного </svg> и без старого кружка-прицела,
         og.png имеет геометрию 1200×630.
   Запуск: node --test tests/content.test.ts (входит в npm test, после build:pages). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

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

test('L3 /services: 8 карточек, у каждой цена «от»', () => {
  const html = read(join('services', 'index.html'));
  const cards = (html.match(/class="svc-card/g) || []).length;
  const prices = (html.match(/class="svc-price"/g) || []).length;
  assert.equal(cards, 8, 'карточек услуг 8');
  assert.equal(prices, 8, 'цен «от N ₽» 8');
  assert.ok(html.includes('/services/svarka'), 'карточка сварочных работ на месте');
});

test('L4 /prices: заголовок, 8 якорей, кондиционеры и сварка, 5 сносок', () => {
  const html = read(join('prices', 'index.html'));
  assert.ok(html.includes('Прайс на работы'), 'H1 «Прайс на работы»');
  for (const id of ['to', 'tormoza', 'podveska', 'grm', 'diagnostika', 'kondicioner', 'svarka', 'shiny']) {
    assert.ok(html.includes(`id="${id}"`), `якорь #${id}`);
  }
  /* круг 27: подтверждённые владельцем цены с записок 09.11.2026 */
  for (const s of ['Заправка автокондиционера', '2000 ₽', 'Поиск утечки', 'от 500 ₽',
    'Замена компрессора кондиционера', 'от 2500 ₽', 'Замена трубок высокого давления', 'от 1500 ₽',
    'Сварочные работы', 'от 1500 ₽ за место']) {
    assert.ok(html.includes(s), `строка прайса «${s}»`);
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

test('L7 /appointment: 12 чипов услуг + «Не знаю»', () => {
  const html = read(join('appointment', 'index.html'));
  const chips = (html.match(/<input type="checkbox" name="svc" value=/g) || []).length;
  assert.equal(chips, 12, 'чипов услуг 12');
  assert.ok(html.includes('chip--dk'), 'чип «Не знаю» на месте');
  assert.ok(!html.includes('value="shinomontazh-gruz"'), 'грузового чипа нет');
});

test('L8 круг 27: нет служебного «(поле description)», чистая иконка и og.png 1200×630', async () => {
  /* (а) служебный префикс парсера не должен доезжать до страниц /services/<slug> */
  for (const f of pages) {
    const html = readFileSync(f, 'utf8');
    assert.ok(!html.includes('(поле `'), `служебный префикс в ${f}`);
  }
  /* (б) логотип и фавикон: валидный svg без старого кружка-прицела */
  for (const f of ['img/logo.svg', 'favicon.svg']) {
    const svg = readFileSync(join(SITE, 'public', f), 'utf8');
    assert.equal((svg.match(/<\/svg>/g) || []).length, 1, `${f}: ровно одно закрытие </svg>`);
    assert.ok(!svg.includes('r="19"'), `${f}: старого кружка-прицела (r="19") нет`);
    assert.ok(!svg.includes('r="12.5"'), `${f}: старого кружка-прицела (r="12.5") нет`);
    assert.ok(/viewBox="0 0 (72 44|64 64)"/.test(svg), `${f}: геометрия бейджа`);
  }
  /* (в) карточка превью — 1200×630 */
  const meta = await sharp(join(SITE, 'public', 'img', 'og.png')).metadata();
  assert.equal(meta.width, 1200, 'og.png ширина 1200');
  assert.equal(meta.height, 630, 'og.png высота 630');
});
