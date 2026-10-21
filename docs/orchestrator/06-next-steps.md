# Следующие шаги после MVP

## Деплой

1. **Vercel:** `vercel --prod` — env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, RESEND_API_KEY, EMAIL_TO, ADMIN_PASS
2. **Домен:** зарегистрировать portovaya439.ru (REG.RU ~199₽/год) → NS → Vercel
3. **Почта:** настроить SPF/DKIM для Resend (или Yandex 360 для домена)
4. **Telegram:** создать @portovaya439_bot, добавить в группу мастеров, получить chat_id via getUpdates
5. **Метрика:** создать счётчик Яндекс.Метрика 123456, цели: quiz_start, quiz_finish, click_phone

## Контент

- Снять 12 реальных кейсов (iPhone 15Pro, 3 фото до/процесс/после + 15с видео)
- Собрать 6 отзывов с Яндекс (скопировать с разрешения)
- Сделать фото бокса (герой) — заменить Unsplash

## Админка Pro

- Подключить Decap CMS + Cloudinary для drag-n-drop
- Добавить авторизацию через Telegram Login

## SEO

- Разместить на Яндекс Справочник + 2ГИС ссылку на сайт
- Статьи: «Ремонт АКПП Ростов», «Грузовой шиномонтаж Западный» — блог на /blog (Astro Content Collections)

## Масштаб

- Добавить онлайн-оплату (ЮKassa) для предоплаты диагностики
- Интеграция с 1С:Автосервис / Wilgood CRM
- PWA — добавить в «Домой» на Android

