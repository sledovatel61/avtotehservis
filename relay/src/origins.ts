/**
 * Список источников, которым разрешено ходить в прослойку.
 *
 * Живёт отдельным модулем, потому что нужен двум местам сразу: заголовкам CORS
 * (их выставляет `index.ts` для всех ответов) и проверке `Origin` в приёме
 * отзывов. Список берётся только из `ALLOWED_ORIGINS` — новые домены дописывает
 * владелец в `wrangler.toml` при переезде, хардкода здесь быть не должно.
 */

export const DEFAULT_ORIGINS = [
  'https://sledovatel61.github.io',
  'http://localhost:4321',
  'http://127.0.0.1:4321',
];

export interface OriginsEnv {
  ALLOWED_ORIGINS?: string;
}

/** `ALLOWED_ORIGINS` из конфига; пустое значение — значения по умолчанию. */
export function allowedOrigins(env: OriginsEnv): string[] {
  const list = (env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS.join(','))
    .split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_ORIGINS;
}

/** Разрешён ли запрос с такого `Origin`. Пустой заголовок (curl, сервер) — нет. */
export function originAllowed(req: Request, env: OriginsEnv): boolean {
  const origin = req.headers.get('origin') ?? '';
  if (!origin) return false;
  const allowed = allowedOrigins(env);
  return allowed.includes('*') || allowed.includes(origin);
}
