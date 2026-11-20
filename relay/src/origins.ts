/**
 * Список источников, которым разрешено ходить в прослойку.
 *
 * Живёт отдельным модулем, потому что нужен двум местам сразу: заголовкам CORS
 * (их выставляет `index.ts` для всех ответов) и проверке `Origin` в приёме
 * отзывов.
 *
 * Список задаётся ТОЛЬКО в `wrangler.toml` (`[vars] ALLOWED_ORIGINS`), дефолтов
 * в коде нет: после переезда на домен хардкод в этом файле молча продолжал бы
 * пускать старый адрес и блокировать новый. Пустой список означает «не разрешён
 * ни один источник» (fail-closed) — сайт получит 403, и это заметно сразу.
 * Для локальной разработки список кладётся в `relay/.dev.vars` или передаётся
 * через `wrangler dev --var ALLOWED_ORIGINS=…`.
 */

export interface OriginsEnv {
  ALLOWED_ORIGINS?: string;
}

/**
 * `ALLOWED_ORIGINS` из конфига: split по запятым, trim, без пустых элементов.
 * Нет переменной или она пустая — пустой массив, а не список по умолчанию.
 */
export function allowedOrigins(env: OriginsEnv): string[] {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Разрешён ли запрос с таким `Origin`. Сравнение — точное совпадение строки:
 * ни `www`-эвристик, ни нормализации схемы и порта (иначе `http://ats-rostov.ru`
 * прошёл бы по `https://ats-rostov.ru`). Пустой `Origin` (curl, серверный вызов) —
 * отказ.
 */
export function originAllowed(req: Request, env: OriginsEnv): boolean {
  const origin = req.headers.get('origin') ?? '';
  if (!origin) return false;
  return allowedOrigins(env).includes(origin);
}
