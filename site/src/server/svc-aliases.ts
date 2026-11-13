/* Круг 26 (a7/00-index): 301-адреса расформированных услуг.
   SSR отдаёт Astro.redirect(301); статический экспорт получает meta-refresh страницы
   в scripts/export-pages.mjs (на GitHub Pages серверных 301 нет). */
export const SVC_ALIASES: Record<string, string> = {
  'remont-shin': 'balansirovka',
  'hodovaya-tormoza': 'podveska',
  elektrika: 'diagnostika',
};
/* Якоря групп прайса (a7/02-prices + круг 27): ссылка из карточки услуги на свою таблицу. */
export const PRICE_ANCHOR: Record<string, string> = {
  'to-maslo': 'to', tormoza: 'tormoza', podveska: 'podveska', 'grm-sceplenie': 'grm',
  diagnostika: 'diagnostika', svarka: 'svarka', shinomontazh: 'shiny', balansirovka: 'shiny',
};
