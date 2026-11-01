/** Демо-контент для показа заказчику: новости и отзывы (этап 6, §2.3).
 *
 *  ОТДЕЛЬНАЯ команда — НЕ часть `npm run seed` (прод-сид остаётся без демо):
 *    npm run seed:demo         — добавить демо-записи
 *    npm run seed:demo:clear   — удалить ТОЛЬКО помеченные демо-записи
 *
 *  Пометки, чтобы демо можно было найти и удалить одним запросом:
 *    reviews.source = 'demo';  news.slug LIKE 'demo-%'.
 *  Фото — только SVG-заглушки из репозитория (public/img), без выдачи за реальные
 *  работы сервиса. Идемпотентно: повторный запуск пересоздаёт тот же набор.
 *
 *  ВНИМАНИЕ: демо-отзывы — ВЫМЫШЛЕННЫЕ люди. Их нельзя оставлять на боевом
 *  сайте: перед запуском выполните seed:demo:clear (см. предупреждение в README
 *  и docs/13-launch-checklist.md §6). */
import { db } from '../src/server/db.ts';
import { runMigrations } from './migrate.ts';

interface DemoNews { slug: string; title: string; excerpt: string; body_md: string; category: 'sezonnoe' | 'sovety' | 'servis'; cover_static: string; age: number }
interface DemoReview { author: string; text: string; rating: number; age: number }

export const DEMO_NEWS: DemoNews[] = [
  {
    slug: 'demo-sezonnoe-pereobuvanie',
    title: 'Демо: Сезонная «переобувка» — как пройти без очереди',
    excerpt: 'Демонстрационная новость-заглушка: так карточка выглядит с настоящим текстом и фото.',
    body_md: 'Это **демонстрационный** материал-заглушка — он показывает, как будет выглядеть новость после заполнения владельцем.\n\nКоротко о смысле настоящих записей: заранее запишитесь на удобное время через форму на сайте, приезжайте к назначенному часу — и работы займут около часа. Здесь владелец расскажет про свой порядок сезонной смены колёс.\n\nФотографии — заглушки из репозитория; замените их реальными снимками сервиса через админку (раздел «Новости»).',
    category: 'sezonnoe',
    cover_static: '/img/hero-1.svg',
    age: 5,
  },
  {
    slug: 'demo-diagnostika-pered-dalney-poezdkoy',
    title: 'Демо: Диагностика перед дальней поездкой — чек-лист',
    excerpt: 'Демонстрационная новость-заглушка: структура, заголовки и списки выглядят как в настоящем материале.',
    body_md: 'Демонстрационный материал-заглушка.\n\nВ настоящей новости владелец разместит чек-лист, например:\n\n- давление и износ протектора;\n- уровень масла и технических жидкостей;\n- тормозные колодки и диски;\n- свет и сигнальные лампы.\n\nЗамените этот текст реальным через админку и снимите новость с публикации, когда она устареет.',
    category: 'sovety',
    cover_static: '/img/hero-2.svg',
    age: 3,
  },
  {
    slug: 'demo-zapis-bez-zvonka',
    title: 'Демо: Запись на сайте работает — заявка уходит в Telegram и на почту',
    excerpt: 'Демонстрационная новость-заглушка для проверки разделов «Новости» и «Новость».',
    body_md: 'Демонстрационный материал-заглушка.\n\nНастоящий текст здесь напишет владелец: например, о новом оборудовании, изменении графика или акции. Markdown поддерживается (заголовки, списки, ссылки); сырой HTML экранируется санитайзером.',
    category: 'servis',
    cover_static: '/img/hero-3.svg',
    age: 1,
  },
];

export const DEMO_REVIEWS: DemoReview[] = [
  {
    author: 'Иван К. (демо)',
    text: 'Демо-отзыв (вымышленный): так карточка выглядит с настоящим текстом. Приехал на порез боковины — сделали за час, показали заплатку изнутри, цена как в смете.',
    rating: 5,
    age: 4,
  },
  {
    author: 'Сергей М. (демо)',
    text: 'Демо-отзыв (вымышленный): сезонная переобувка по записи — без очереди, колёса помыли и упаковали. Перед заменой согласовали стоимость.',
    rating: 4,
    age: 2,
  },
  {
    author: 'Анна П. (демо)',
    text: 'Демо-отзыв (вымышленный): диагностика подвески — всё по делу, лишнего не навязывали, ремонт сделали в тот же день.',
    rating: 5,
    age: 3,
  },
];

/** Удалить ТОЛЬКО помеченные демо-записи (реальные отзывы/новости не трогаем). */
export function clearSeedDemo(): { news: number; reviews: number } {
  const dbx = db();
  const news = dbx.prepare(`DELETE FROM news WHERE slug LIKE 'demo-%'`).run().changes;
  const reviews = dbx.prepare(`DELETE FROM reviews WHERE source='demo'`).run().changes;
  return { news, reviews };
}

/** Демо-набор: сначала чистим ранее помеченное (идемпотентность), затем вставляем. */
export function runSeedDemo(): void {
  runMigrations();
  const dbx = db();
  const insNews = dbx.prepare(`INSERT INTO news(slug,title,excerpt,body_md,category,cover_static,status,published_at)
    VALUES(@slug,@title,@excerpt,@body_md,@category,@cover_static,'published',datetime('now','-' || @age || ' minutes'))`);
  const insReview = dbx.prepare(`INSERT INTO reviews(author,text,rating,source,published_at,status)
    VALUES(@author,@text,@rating,'demo',datetime('now','-' || @age || ' minutes'),'published')`);
  const tx = dbx.transaction(() => {
    clearSeedDemo();
    for (const n of DEMO_NEWS) insNews.run(n);
    for (const r of DEMO_REVIEWS) insReview.run(r);
  });
  tx();
}

const isMain = process.argv[1] && process.argv[1].endsWith('seed-demo.ts');
if (isMain) {
  if (process.argv[2] === 'clear') {
    const res = clearSeedDemo();
    console.log(`Удалено демо-записей: новостей ${res.news}, отзывов ${res.reviews} (только помеченные: news.slug 'demo-%', reviews.source 'demo').`);
  } else {
    runSeedDemo();
    console.log(`Демо-сид: новостей ${DEMO_NEWS.length}, отзывов ${DEMO_REVIEWS.length} (помечены: slug 'demo-*', source 'demo').`);
    console.log('ВНИМАНИЕ: демо-отзывы — вымышленные люди. Перед боевым запуском удалите: npm run seed:demo:clear');
  }
}
