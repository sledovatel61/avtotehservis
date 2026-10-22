import type { APIContext } from 'astro';

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export interface ApiErrorBody { code: string; message: string; fields?: Record<string, string>; [k: string]: unknown }

export function err(status: number, code: string, message: string, extra: Record<string, unknown> = {}, fields?: Record<string, string>, headers: Record<string, string> = {}): Response {
  const body: ApiErrorBody = { code, message, ...(fields ? { fields } : {}), ...extra };
  return json({ error: body }, status, headers);
}

/** Адрес клиента. Доверяем только тому, что ставит наш nginx (deploy/nginx.conf
 *  ПЕРЕЗАПИСЫВАЕТ оба заголовка значением $remote_addr — клиентская подделка до
 *  приложения не доходит): сначала X-Real-IP, иначе ПОСЛЕДНИЙ элемент
 *  X-Forwarded-For (ближайший к приложению хоп — его дописывает прокси; ПЕРВЫЙ
 *  элемент присылает клиент, на нём лимиты и блокировка входа обходились —
 *  блокер ревью round5), иначе заглушка для локального запуска без прокси. */
export function clientIp(ctx: APIContext | { request: Request }): string {
  const real = ctx.request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const xff = ctx.request.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return 'local';
}

/** Заявленный размер тела (Content-Length) больше лимита — отклонять ДО чтения тела
 *  в память (minor-5 ревью). Без заголовка (chunked) проверка пропускает запрос —
 *  дальше сработают пофайловые лимиты. */
export function bodyTooLarge(req: Request, maxBytes: number): boolean {
  const cl = Number(req.headers.get('content-length') ?? 0);
  return Number.isFinite(cl) && cl > maxBytes;
}
