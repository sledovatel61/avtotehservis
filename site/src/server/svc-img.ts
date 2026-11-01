/* Карта slug → набор фотофактур карточек «Услуги» (круг 21, производные svc-N-{640,960}). */
export const SVC_IMG: Record<string, string> = {
  shinomontazh: 'svc-1', balansirovka: 'svc-2', 'remont-shin': 'svc-3',
  'to-maslo': 'svc-4', 'hodovaya-tormoza': 'svc-5', elektrika: 'svc-6',
};
export const svcImgKey = (slug: string | undefined | null): string => SVC_IMG[slug ?? ''] ?? 'svc-1';
