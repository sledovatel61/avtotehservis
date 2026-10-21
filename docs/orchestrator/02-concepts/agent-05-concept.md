# Концепция Агент 05 — Admin & Integrations | Просто как Telegram

## Выбор админки: сравнение

| Вариант | Плюсы | Минусы | Оценка |
|---------|-------|--------|--------|
| **Decap CMS (Git-based)** | Бесплатно, UI норм, версионность | Нужен GitHub OAuth, не для бабушки | 7/10 |
| **Кастом /admin + JSON/SQLite** | 1 файл, Basic Auth, 0 зависимостей, с телефона | Нет drag-sort | **9/10 MVP** |
| **Notion API** | Удобно | Платно, медленно | 6/10 |
| **Google Sheets** | Знакомо | Глючит API, лимиты | 6/10 |
| **Telegram-бот админка** | Супер просто | Нет галереи красивой | 8/10 |

**MVP:** Кастом `/admin` на Astro API + `data/*.json` (или Turso SQLite). Логин `admin` / пароль из env. CRUD: галерея, отзывы, прайс, лиды (read-only). Загрузка фото → S3/Timeweb (или base64 JSON для MVP).

**Pro:** Decap + Cloudinary + Supabase.

## Схема данных

```json
GalleryItem { id:"granta-gorm-2025-10", title:"LADA Granta — замена ГРМ", category:"engine", images:["/uploads/granta1.avif"], videoUrl:"https://youtu.be/...", price:"8 500₽", duration:"4 часа", date:"2025-10-12", featured:true }
Review { id:"rev-182", name:"Иван К.", avatar:"", text:"Быстро...", rating:5, source:"yandex", date:"2025-09-20", approved:true }
Lead { id:"lead-20251021-0912", brand:"Renault Logan", model:"Logan", year:2019, vin:"X7L...", faults:["тормоза","ходовая"], description:"Скрип...", photos:["..."], name:"Иван", phone:"+79289065700", messenger:"whatsapp", createdAt:"2025-10-21T09:12:00Z", utm:{source:"yandex", campaign:"..."} }
```

## Flow заявки

```
[Quiz.tsx] --POST JSON--> /api/lead
  -> Zod: phone regex +7, vin optional 17, faults min 1, name 2-40 chars
  -> honeypot field `_trap` + Turnstile token verify (если включён)
  -> rateLimit: 5/min IP (memory LRU)
  -> save to Turso: INSERT INTO leads ...
  -> parallel:
       sendEmail via Resend: to info@portovaya439.ru, cc manager, template HTML
       sendTelegram: fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {chat_id, text HTML, reply_markup inline_keyboard [Позвонить, WhatsApp]})
       if photos -> sendMediaGroup
  -> return {ok:true, id}
  -> on error: retry 2x, log
```

### Email шаблон

Subject: Новая заявка #{{id}} — {{brand}} — {{faults}}  
HTML: таблица с данными, ссылка на админку, UTM.

### Telegram Bot

1. Создать @BotFather → /newbot → `portovaya439_bot` → token.
2. Узнать chat_id: добавить бота в канал/группу, `getUpdates`.
3. Форматирование: `parse_mode: HTML`, `<b>`, `<code>`, `<a href="tel:+...">`.
4. Кнопки: `InlineKeyboard: [[{text:"📞 Позвонить", url:"tel:+792..."}],[{text:"💬 WhatsApp", url:"https://wa.me/792..."}]]`

Пример кода:

```ts
await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
 method:'POST', headers:{'Content-Type':'application/json'},
 body: JSON.stringify({ chat_id: CHAT_ID, text: `🔧 <b>Новая заявка</b>\n<b>Авто:</b> ${lead.brand} ${lead.year}\n<b>VIN:</b> ${lead.vin}\n<b>Неисправности:</b> ${lead.faults.join(', ')}\n<b>Клиент:</b> ${lead.name} ${lead.phone}`, parse_mode:'HTML', reply_markup:{inline_keyboard:[[{text:'Позвонить', url:`tel:${lead.phone}`}]]} })
})
```

### Безопасность

- VIN regex `^[A-HJ-NPR-Z0-9]{17}$`, trim uppercase
- Файлы: max 5×10MB, mime image/*, virus: ClamAV опционально
- ENV на Vercel/Beget, не в git
- Логи без телефонов в открытом виде (маскировать)

### Инструкция «Добавить фото за 90 сек с телефона»

1. Открыть `portovaya439.ru/admin` → логин
2. Нажать «+ Кейс» → выбрать категорию → загрузить 3 фото (сжатие автоматом) → ввести цену/срок → «Сохранить»
3. Готово, на сайте через 30с (ISR).

### Хостинг MVP

- **Vercel Hobby $0** + Turso free + Resend free (100 писем/д) + Telegram free = $0.
- **Beget/Timeweb** PHP: загрузить `dist/` + `api/lead.php` (альтернатива если клиент хочет РФ-хостинг) — 149₽/мес.

### Домены

- portovaya439.ru
- ats-rostov.ru
- avtotehservis61.ru

Оценка: 9/10 — самый практичный.
