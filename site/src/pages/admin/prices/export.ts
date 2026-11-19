/**
 * Отдача файла цен: «Скачать файл цен» в /admin/prices.
 *
 * Зачем: сайт живёт на GitHub Pages, серверной админки там нет. Мастер правит цены
 * здесь, а передать результат публикации иначе как файлом — нечем.
 *
 * Защита та же, что у остальных разделов: без активной сессии — 302 на вход (middleware
 * тоже это проверяет, но здесь проверка дублируется: маршрут отдаёт данные, а не HTML).
 * `no-store` обязателен: иначе браузер покажет старую копию, и мастер увезёт не те цены.
 */
import type { APIRoute } from 'astro';
import { readFileSync } from 'node:fs';
import { sessionFromContext } from '../../../server/admin-auth.ts';
import { pricesPath, PricesError } from '../../../server/prices-admin-store.ts';

export const GET: APIRoute = async (ctx) => {
  if (!sessionFromContext(ctx)) return ctx.redirect('/admin/login', 302);

  let body: string;
  try {
    /* Отдаём именно файл, а не пересобранный объект: мастер скачивает то, что лежит на
       сервере, байт в байт, и при публикации не появляется «почти такого же» файла. */
    body = readFileSync(pricesPath(), 'utf8');
  } catch (e) {
    const message = e instanceof PricesError ? e.message : 'Файл цен не найден';
    return new Response(message, {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  /* Проверяем, что скачиваемое читается: битый файл лучше не отдавать молча. */
  try {
    JSON.parse(body);
  } catch {
    return new Response('Файл цен повреждён — скачивание остановлено, сообщите разработчику.', {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': 'attachment; filename=prices.json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
};
