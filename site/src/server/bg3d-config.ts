/**
 * Разрешён ли 3D-фон и на каких страницах (задание №44).
 *
 * По умолчанию **выключено везде**. Решение «включать или нет» — за владельцем,
 * и до его решения код не должен менять ни одну страницу сайта. Включается одной
 * переменной окружения на сервере:
 *
 *   BG3D=off                      — фон выключен (по умолчанию)
 *   BG3D=voyah-free               — только на /services/voyah-free, вариант B «силуэт в глубине»
 *   BG3D=voyah-free:depth         — то же, но вариант A «глубина»
 *   BG3D=*                        — на всех разрешённых страницах (список ниже)
 *
 * Список страниц держим здесь, а не в базе: фон — это код и шейдер, а не контент,
 * и владелец не должен иметь возможность включить его случайно в админке.
 */
export type Bg3dVariant = 'depth' | 'silhouette';

/** Страницы, где фон технически возможен. Ключ — slug услуги. */
export const BG3D_PAGES: Record<string, Bg3dVariant> = {
  'voyah-free': 'silhouette',
};

export interface Bg3dPageConfig {
  enabled: boolean;
  variant: Bg3dVariant;
}

/** Прочитать флаг из окружения сервера. Значение по умолчанию — 'off'. */
export function bg3dFlag(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): string {
  return String(env.BG3D ?? 'off').trim();
}

/** Что отдать странице услуг для данного slug. */
export function bg3dFor(slug: string | undefined, flag = bg3dFlag()): Bg3dPageConfig {
  if (!slug || !BG3D_PAGES[slug]) return { enabled: false, variant: 'depth' };
  if (!flag || flag === 'off') return { enabled: false, variant: BG3D_PAGES[slug] };
  if (flag === '*') return { enabled: true, variant: BG3D_PAGES[slug] };
  const [target, variant] = flag.split(':');
  if (target !== slug) return { enabled: false, variant: BG3D_PAGES[slug] };
  return { enabled: true, variant: variant === 'depth' ? 'depth' : BG3D_PAGES[slug] };
}
