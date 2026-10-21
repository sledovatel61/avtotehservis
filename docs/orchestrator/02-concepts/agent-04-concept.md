# Концепция Агент 04 — Motion & Mobile | Прикольно но легко

## Философия: 60fps на Redmi 9

Запрещено: тяжёлый GSAP ScrollTrigger на каждом блоке, Lenis (ломает натив скролл на Android), видео-фон. Разрешено: CSS scroll-timeline (где поддерживается) + IntersectionObserver + Motion только на островах.

## Таблица анимаций (7)

| Элемент | Триггер | Длительность | Технология | Бюджет |
|---------|---------|-------------|------------|--------|
| Hero parallax | scroll 0-600px | — | CSS `transform: translateY(calc(scroll*0.2))` + `will-change` | 0ms JS |
| Счётчики 11 лет | IO 50% | 900ms | Motion number tween | 2KB |
| Услуги stagger | IO | 400ms stagger 60ms | CSS @keyframes slide-up | 0 JS |
| Квиз slide | click Далее | 300ms spring(0.8) | Motion AnimatePresence | 12KB |
| Галерея FLIP | клик фильтр | 250ms | Motion layout | 6KB |
| Отзывы marquee | всегда | 30s linear infinite | CSS-only marquee (две дорожки) | 0 JS |
| Карта pins pop | IO | 500ms | CSS scale+opacity | 0 |

**Итого JS анимаций:** ~20KB gz, остальное CSS.

### CSS v4 токены

```css
@import 'tailwindcss';
@theme {
  --color-accent: #FF5A1F;
  --ease-spring: linear(0,0.003 0.9%,0.011 1.8%,0.032 3.6%,0.12 6.5%,0.25 8.8%,0.38 10.7%,0.51 12.4%,0.64 13.9%,0.78 15.1%,0.89 16.1%,1 16.9%);
  --animate-reveal: reveal 0.6s var(--ease-spring) forwards;
}
@keyframes reveal { from{opacity:0; transform:translateY(12px)} to{opacity:1; transform:none} }
.animate-marquee { animation: marquee 30s linear infinite; }
```

### Motion snippet (квиз)

```tsx
<motion.div key={step} initial={{x:40,opacity:0}} animate={{x:0,opacity:1}} exit={{x:-40,opacity:0}} transition={{type:'spring',stiffness:300}}>
```

### Mobile-first чеклист

- Viewport 390px base, 44px min tap, thumb-zone снизу 20% — туда CTA.
- Шрифты: variable Inter, subset cyrillic woff2 32KB, `font-display:swap`.
- Изображения: AVIF 600w/1200w, `loading=lazy` кроме hero (preload), `decoding=async`, размеры в `width/height` → CLS 0.
- Видео: poster WebP, `playsinline muted`, ленивая подгрузка YouTube-lite.
- Липкий header: `position: sticky`, высота 56px, backdrop-blur 12px (GPU).
- Галерея: на мобиле — горизонтальный свайп с snap, без masonry.
- Квиз: на мобиле — full screen, кнопка «Далее» 56px, фиксирована снизу, клавиатура не перекрывает (visualViewport).
- Reduced motion: `@media (prefers-reduced-motion) { *{animation:none!important} }`

### Лого анимация

Шестерня 12 зубцов вращается 2s при hover, при клике — morph в галочку (SVG path).

### Домены

- portovaya439.ru (гео)
- ats61.ru (коротко)
- avtotehservice.ru (ошибка: правильно avtotehservis)

Оценка: 8/10 — технарь, но мало про бизнес-логику.
