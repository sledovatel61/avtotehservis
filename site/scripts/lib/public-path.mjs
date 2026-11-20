/**
 * Единый источник адреса публикации для статической сборки GitHub Pages и гейтов
 * (круг 88, задание `prompts/108-domain-migration.md`).
 *
 * По умолчанию сохраняется адрес превью:
 *   PUBLIC_ORIGIN    → 'https://sledovatel61.github.io'
 *   PUBLIC_BASE_PATH → '/avtotehservis'
 *
 * Правила разбора:
 *   • PUBLIC_ORIGIN: пустая строка или не задано → дефолт 'https://sledovatel61.github.io'.
 *     Иначе обязательна схема https://, валидный хост и отсутствие завершающего «/».
 *   • PUBLIC_BASE_PATH:
 *     - не задано или пустая строка '' (так GitHub Actions раскрывает незаданную
 *       переменную ${{ vars.PUBLIC_BASE_PATH }}) → дефолт '/avtotehservis';
 *     - литерал '/' → корень домена (base = '');
 *     - иначе нормализуется к виду '/segment' без завершающего слэша
 *       ('avtotehservis/' → '/avtotehservis', '/sub/path/' → '/sub/path').
 */

export const DEFAULT_PUBLIC_ORIGIN = 'https://sledovatel61.github.io';
export const DEFAULT_BASE_PATH = '/avtotehservis';

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ base: string; publicOrigin: string; cnameHost: string | null }}
 */
export function readPublicPath(env = process.env) {
  const rawOrigin = typeof env?.PUBLIC_ORIGIN === 'string' ? env.PUBLIC_ORIGIN.trim() : '';
  let publicOrigin = DEFAULT_PUBLIC_ORIGIN;

  if (rawOrigin !== '') {
    if (/\s/.test(rawOrigin)) {
      throw new Error(`PUBLIC_ORIGIN не должен содержать пробелы: «${rawOrigin}»`);
    }
    if (rawOrigin.endsWith('/')) {
      throw new Error(`PUBLIC_ORIGIN не должен заканчиваться на «/»: «${rawOrigin}»`);
    }
    if (!rawOrigin.toLowerCase().startsWith('https://')) {
      throw new Error(`PUBLIC_ORIGIN должен начинаться с https:// (получено «${rawOrigin}»)`);
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(rawOrigin);
    } catch {
      throw new Error(`PUBLIC_ORIGIN не является корректным URL: «${rawOrigin}»`);
    }
    if (
      parsedUrl.protocol !== 'https:' ||
      !parsedUrl.hostname ||
      parsedUrl.username ||
      parsedUrl.password ||
      parsedUrl.search ||
      parsedUrl.hash ||
      parsedUrl.pathname !== '/' ||
      !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(parsedUrl.hostname)
    ) {
      throw new Error(`PUBLIC_ORIGIN должен содержать только https://<домен> без пути и параметров: «${rawOrigin}»`);
    }
    publicOrigin = parsedUrl.origin;
  }

  const rawBase = typeof env?.PUBLIC_BASE_PATH === 'string' ? env.PUBLIC_BASE_PATH.trim() : '';
  let base = DEFAULT_BASE_PATH;

  if (rawBase === '') {
    base = DEFAULT_BASE_PATH;
  } else if (rawBase === '/') {
    base = '';
  } else {
    if (
      /\s/.test(rawBase) ||
      rawBase.includes('://') ||
      /[?#\\]/.test(rawBase) ||
      rawBase.includes('//') ||
      rawBase.includes('..')
    ) {
      throw new Error(`Некорректный PUBLIC_BASE_PATH: «${rawBase}»`);
    }
    const cleaned = rawBase.replace(/^\/+|\/+$/g, '');
    if (!cleaned) {
      base = '';
    } else {
      const segments = cleaned.split('/');
      if (!segments.every((seg) => /^[a-zA-Z0-9._-]+$/.test(seg) && seg !== '.' && seg !== '..')) {
        throw new Error(`Некорректный PUBLIC_BASE_PATH: «${rawBase}»`);
      }
      base = `/${cleaned}`;
    }
  }

  const cnameHost =
    publicOrigin !== DEFAULT_PUBLIC_ORIGIN ? new URL(publicOrigin).hostname : null;

  return { base, publicOrigin, cnameHost };
}
