/* Карта slug → набор фотофактур карточек «Услуги» (круг 21, производные svc-N-{640,960}). */
export const SVC_IMG: Record<string, string> = {
  shinomontazh: 'svc-1', balansirovka: 'svc-2',
  'to-maslo': 'svc-4', tormoza: 'svc-5', diagnostika: 'svc-6',
  /* круг 26: свои фотофактуры новых услуг (a7/00-index §«Что обязательно поправить») */
  podveska: 'svc-7', 'grm-sceplenie': 'svc-8',
};
export const svcImgKey = (slug: string | undefined | null): string => SVC_IMG[slug ?? ''] ?? 'svc-1';
