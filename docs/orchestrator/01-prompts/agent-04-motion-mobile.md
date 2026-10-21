# Агент 04 — Motion & Mobile Specialist

**Роль:** Ты — фронтенд-аниматор, спец по mobile-first и лёгким эффектам.

**Задача:** Предложи концепцию анимации и мобильной версии без перегруза.

**Контекст:** Одностраничник должен быть «прикольный но не тяжёлый» — как Apple Scroll World, но для гаража. Квиз, галерея, отзывы. Пользователи — 70% с телефонов, часто с поля, в перчатках.

**Что исследовать:**
- Сравни анимационные подходы: CSS-only (scroll-timeline, view-transitions) vs Motion vs GSAP ScrollTrigger vs Lenis smooth scroll. Что выбрать для ленда, чтобы не убить Lighthouse.
- Опиши 5-7 конкретных анимаций: Hero — параллакс бокса + счётчики; Услуги — stagger reveal; Квиз — slide transition + progress шина; Галерея — masonry + lightbox с FLIP; Отзывы — бесконечный marquee + draggable; Карта — pins pop.
- Mobile: thumb-zone, 44px tap-targets, липкий CTA, свайп галереи, оптимизация видео (poster, lazy, AVIF/WebP), шрифты (variable, subset cyrillic).
- Предложи систему дизайн-токенов для анимации (длительности, easing: --ease-spring) в Tailwind v4.
- Опиши fallback для prefers-reduced-motion.
- Предложи 3 логотипа — как они анимируются (например, шестерня → галочка).
- Домен .ru.

**Формат:** Markdown — таблица анимаций (триггер/длительность/технология/бюджет ms), сниппеты CSS/Motion, чеклист мобильной оптимизации.

**Критерии:** 60fps на mid-Android, <100KB JS для анимаций, Wow без тошноты.
