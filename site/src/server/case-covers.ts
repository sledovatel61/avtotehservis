/* круг 23 (§D) → круг 78: шесть фото-обложек кейсов, общие для главной и «О компании».
   Раньше карта жила только в about.astro — главная показывала вместо неё шесть векторных
   SVG-заглушек (/img/case-1..6.svg) с бейджем «до / после» и припиской про будущую съёмку.
   Кейсы одни и те же, кадры одни и те же — карта вынесена сюда, чтобы не плодить третью копию. */
export interface CaseCover { avif: string; webp: string; alt: string }

export const CASE_COVERS: Record<string, CaseCover> = {
  'case-1': { avif: '/img/ab-case-1-640.avif', webp: '/img/ab-case-1-640.webp', alt: 'Иллюстрация: боковой порез шины на монтажном станке' },
  'case-2': { avif: '/img/ab-case-2-640.avif', webp: '/img/ab-case-2-640.webp', alt: 'Иллюстрация: грыжа на боковине шины перед вулканизацией' },
  'case-3': { avif: '/img/ab-case-3-640.avif', webp: '/img/ab-case-3-640.webp', alt: 'Иллюстрация: пример работы сервиса — подвеска и колесо' },
  'case-4': { avif: '/img/ab-case-4-640.avif', webp: '/img/ab-case-4-640.webp', alt: 'Иллюстрация: суппорт и тормозные колодки при замене' },
  'case-5': { avif: '/img/ab-case-5-640.avif', webp: '/img/ab-case-5-640.webp', alt: 'Иллюстрация: слив отработанного масла и фильтр при ТО' },
  'case-6': { avif: '/img/ab-case-6-640.avif', webp: '/img/ab-case-6-640.webp', alt: 'Иллюстрация: пример работы сервиса — узлы трансмиссии' },
};
