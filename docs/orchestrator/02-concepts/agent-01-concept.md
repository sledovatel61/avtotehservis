# Концепция Агент 01 — TechLead | Astro 5 + Tailwind v4

**Вердикт стека:** Astro 5 + Tailwind CSS v4 + TypeScript + islands (Preact) — TOP 2025-2026 для лендов. Lighthouse 100/100 без шаманства. Next.js — оверхед (80KB JS минимум), нужен только если сразу делаем CRM. Tilda/WordPress — отпадают: нет нормальной интеграции Telegram + VIN-валидации.

## Архитектура

```
[Client: Astro SSG] --POST /api/lead--> [Vercel/Cloudflare Function]
                                          ├─> Zod validate + rate-limit (Upstash)
                                          ├─> Resend email (HTML)
                                          ├─> Telegram Bot API sendMessage + sendMediaGroup
                                          └─> Turso/SQLite или JSON append -> /data/leads.json

[Admin /admin] -> Basic Auth (env ADMIN_PASS) -> CRUD /data/gallery.json + /data/reviews.json
                 -> Decap CMS альтернатива: /admin-decap с GitHub OAuth (для продвинутых)

[Gallery] -> Cloudinary / S3 (Timeweb S3) + локальный fallback public/uploads
```

### Почему Astro?
- **0 KB JS по умолчанию**, island только для квиза (`<Quiz client:load>`). Остальное — чистый HTML/CSS.
- **Vite 5 + Tailwind v4 Oxide** — сборка <1.5s, CSS-first config без `tailwind.config.js`.
- **Content Collections** — типизированные `gallery` и `reviews` из Markdown/JSON, удобно для админки.
- **API routes** `src/pages/api/lead.ts` — edge-ready.
- Поддержка View Transitions API для плавных переходов квиза.

### Стек детально

| Слой | Технология | Версия | Зачем |
|------|-----------|--------|-------|
| Framework | Astro | 5.x | SSG + islands |
| UI islands | Preact (или React 19) | 19 | Квиз, галерея lightbox |
| Style | Tailwind CSS v4 | 4.x | @theme в global.css, no config |
| Anim | Motion (Framer) | 12 | только для квиза/reveal |
| Forms | React Hook Form + Zod | +4 | валидация VIN 17 chars |
| Email | Resend | latest | DKIM, template |
| TG | node-fetch → Bot API | — | дублирование |
| Map | Yandex Maps API 3.0 | 3.0 | карта |
| DB | Turso (libSQL) / JSON | — | лиды |
| Deploy | Vercel (или Cloudflare Workers) | — | edge |
| Analytics | Yandex Metrika + Plausible | — | цели |

### Папки

```
src/
  components/ Hero.astro, Quiz.tsx, Gallery.astro, Reviews.astro
  content.config.ts  // collections
  pages/ index.astro, api/lead.ts, admin/index.astro
  styles/global.css  // @import 'tailwindcss'; @theme {…}
  lib/telegram.ts, email.ts, validate.ts
public/ uploads/
data/ gallery.json, reviews.json
```

### ENV
```
RESEND_API_KEY=re_xxx
ADMIN_PASS=supersecret
TELEGRAM_BOT_TOKEN=123:AAH...
TELEGRAM_CHAT_ID=-100123 / 123456
YANDEX_MAPS_API_KEY=xxx
```

### Core Web Vitals бюджет
- HTML 35KB gz, CSS 18KB, JS islands 28KB (quiz) + 12KB (lightbox)
- LCP <1.8s (hero AVIF 800w, preload)
- CLS 0 (размеры картинок фиксированы)
- Анимации — только `transform`/`opacity`, `will-change` точечно.

### Риски и митигация
- Спам → honeypot + Cloudflare Turnstile + rate limit 5/min IP
- VIN — проверять regex `^[A-HJ-NPR-Z0-9]{17}$` (без I,O,Q), + кнопка «Где найти?»
- Загрузка фото 10MB limit, конвертация в WebP на клиенте (browser-image-compression)

### Домены .ru
1. **portovaya439.ru** — ★ SEO-идеал, запоминается таксистам
2. **ats61.ru** — коротко, бренд
3. **portovaya61.ru** — гео

**Лого идея:** щит + шестерня + цифра 439, шрифт Golos Bold, оранжевый #FF5A1F на графите #0B0E12.

### Оценка: 9/10, реализуемо за 10 дней.
