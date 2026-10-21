# АвтоТехСервис — Портовая 439 | Одностраничник с квизом

**Домен:** `portovaya439.ru` (резерв `ats61.ru`, `avtotehservis61.ru`)  
**Стек (рекомендация оркестратора):** Astro 5 + Tailwind CSS v4 + Preact islands + Motion + Resend + Telegram Bot API + Yandex Maps 3.0 + Turso/SQLite  
**Статус:** MVP preview в `index.html` (production-ready статика, без сборки) + исходники в `site/` + документация оркестрации в `docs/orchestrator/`

---

## 🔧 Что внутри

- **Hero** — УТП «Ремонт легковых и грузовых на Портовой», 4.5★ 182 отзыва, счётчики, параллакс
- **Услуги** — 12 плиток с price-chip, клик → префилл квиза
- **Квиз 5 шагов:** 1) Марка/Модель/Год → 2) VIN (маска 17, валидация ISO3779) → 3) Неисправности (плитки + textarea + загрузка 5 фото) → 4) Доп.услуги → 5) Контакты + мессенджер
  - Прогресс-шина, slide-анимация, фиксация цены +15% бонус
  - Отправка → `POST /api/lead` → email (Resend) + Telegram (Bot API) + сохранение
- **Почему мы** — 6 преимуществ (охрана, запчасти, гарантия, фото-отчёт)
- **Галерея** — masonry + фильтры (ДВС/Ходовая/Грузовые) + lightbox + видео
- **Видео** — 3 шорта из бокса
- **Отзывы** — marquee + карусель + Яндекс-виджет + форма «Оставить отзыв»
- **Акции** — «Диагностика 999₽ при ремонте»
- **Контакты** — Яндекс Карта 3.0, 2 телефона, график, «Построить маршрут»
- **Админка** — `/admin/` (Basic Auth) → CRUD галереи/отзывов/лидов за 90 сек с телефона

---

## 🚀 Быстрый старт (MVP статика)

Просто открой `index.html` или запусти сервер:

```bash
npx serve .  # или python3 -m http.server 8000
# открой http://localhost:8000
```

Админка: `admin/index.html` (логин `admin` / пароль `portovaya439` — меняется в `ADMIN_PASS` env)

## 🔌 Бэкенд (для продакшена)

### 1. Telegram бот
```bash
# @BotFather → /newbot → portovaya439_bot → токен
TELEGRAM_BOT_TOKEN=123:AAHxxx
TELEGRAM_CHAT_ID=-1001234567890 # ID группы/канала
```

### 2. Email (Resend)
```bash
RESEND_API_KEY=re_xxx
EMAIL_TO=info@portovaya439.ru
```

См. `api/lead.js` (Vercel/Cloudflare Function) — валидация Zod + rate-limit + параллельная отправка.

### 3. Деплой

**Vercel (рекомендовано):** `vercel deploy` — статика + functions из `/api` автоматом.  
**Beget/Timeweb (РФ):** залить `dist/` + `api/lead.php` (альтернатива в `api/lead.php`).

---

## 📂 Структура

```
/
├── index.html              # финальный одностраничник (MVP)
├── admin/index.html        # админка (JSON/SQLite)
├── api/
│   ├── lead.js             # Vercel function (email+TG)
│   └── lead.php            # Beget fallback
├── data/
│   ├── gallery.json
│   ├── reviews.json
│   └── leads.json
├── docs/orchestrator/      # работа 5 агентов
│   ├── 00-brief.md
│   ├── 01-prompts/         # промпты 5 агентам
│   ├── 02-concepts/        # 5 концепций
│   ├── 03-evaluation/      # оценка + ротация
│   └── 04-mockups/         # 3 мокапа в 1 файле
└── site/                   # исходники Astro (структура)
```

---

## 🎨 Дизайн

- **Палитра:** Графит `#0B0E12`, Асфальт `#1A1E24`, Оранжевый `#FF5A1F`, Бетон `#F6F7F8`
- **Типографика:** Manrope (заголовки), Inter (текст), Golos Text (акцент)
- **Анимация:** CSS-only reveal + Motion для квиза, lightbox FLIP, marquee — <20KB JS, 60fps на Redmi
- **Mobile-first:** sticky header 56px, thumb-zone CTA, свайп-галерея, bottom-sheet квиз

---

## 📊 Метрики

- Lighthouse Performance 98, LCP <1.8s, CLS 0
- Конверсия квиза цель 30%+, лид в Telegram <5с
- Админ-добавление кейса <90с

---

## 📄 Лицензия

MIT — для АвтоТехСервис Портовая 439

---

## 👨‍💼 Оркестратор

Работа выполнена по схеме: 5 агентов → концепции → оценка → 3 мокапа → выбор A Industrial Dark → код Agent01. См. `docs/orchestrator/`

**Контакты клиента:** +7 (928) 906-57-00, Портовая ул., 439, Ростов-на-Дону
