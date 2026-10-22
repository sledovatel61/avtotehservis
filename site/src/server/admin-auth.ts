import type { APIContext } from 'astro';
import { db } from './db.ts';
import { resolveSession, createSession, destroySession, findUser, verifyPassword, SESSION_COOKIE, type SessionUser } from './auth.ts';
import { checkLimit, LIMITS } from './ratelimit.ts';
import { clientIp } from './http.ts';
import { randomBytes, createHash } from 'node:crypto';

export const CSRF_COOKIE = 'ats_csrf';

export function isHttps(): boolean {
  return (process.env.PUBLIC_SITE_URL ?? '').startsWith('https:');
}

export function sessionFromContext(ctx: APIContext): SessionUser | null {
  const token = ctx.cookies.get(SESSION_COOKIE)?.value;
  try { return resolveSession(token); } catch { return null; }
}

export function loginRateKey(ctx: APIContext, login: string): string {
  const ip = clientIp(ctx);
  return 'login:' + createHash('sha256').update(ip + '|' + login.toLowerCase()).digest('hex').slice(0, 16);
}

export async function tryLogin(ctx: APIContext, login: string, password: string):
  Promise<{ ok: true; token: string; user: SessionUser } | { ok: false; reason: 'blocked' | 'bad_credentials' }> {
  const rl = checkLimit(loginRateKey(ctx, login), LIMITS.login.max, LIMITS.login.windowMs);
  if (!rl.ok) return { ok: false, reason: 'blocked' };
  const user = findUser(login.trim());
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return { ok: false, reason: 'bad_credentials' };
  }
  const ip = clientIp(ctx);
  const ipHash = ip === 'local' ? null : createHash('sha256').update(ip).digest('hex');
  const token = createSession(user.id, ctx.request.headers.get('user-agent'), ipHash);
  return { ok: true, token, user: { id: user.id, login: user.login, role: user.role } };
}

export function setSessionCookie(ctx: APIContext, token: string): void {
  ctx.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true, secure: isHttps(), sameSite: 'lax', path: '/', maxAge: 7 * 24 * 3600,
  });
}

export function logout(ctx: APIContext): void {
  destroySession(ctx.cookies.get(SESSION_COOKIE)?.value);
  ctx.cookies.delete(SESSION_COOKIE, { path: '/' });
}

/* ---------- CSRF: double-submit cookie + проверка Origin ---------- */

/** Куда вернуть пользователя после отказа (CSRF/размер тела): referer того же
 *  происхождения и из /admin — иначе /admin. Используется вместе с баннером ?err= в Admin.astro. */
export function refusalBack(ctx: { request: Request }): string {
  const referer = ctx.request.headers.get('referer');
  try {
    if (referer) {
      const u = new URL(referer);
      const self = new URL(ctx.request.url);
      if (u.host === self.host && u.pathname.startsWith('/admin')) return u.pathname;
    }
  } catch { /* битый referer — уходим на /admin */ }
  return '/admin';
}

/** Стилизованный отказ: 302 обратно на страницу админки с ?err=… (баннер в layout). */
export function adminRefusal(ctx: { request: Request; redirect: (to: string, status?: 302) => Response }, message: string): Response {
  return ctx.redirect(refusalBack(ctx) + '?err=' + encodeURIComponent(message), 302);
}

/** Отказ CSRF для POST-обработчиков страниц админки. */
export function csrfRefusal(ctx: { request: Request; redirect: (to: string, status?: 302) => Response }): Response {
  return adminRefusal(ctx, 'Сессия устарела (CSRF). Обновите страницу и повторите действие.');
}
export function ensureCsrfCookie(ctx: APIContext): string {
  const existing = ctx.cookies.get(CSRF_COOKIE)?.value;
  if (existing) return existing;
  const token = randomBytes(24).toString('base64url');
  ctx.cookies.set(CSRF_COOKIE, token, {
    httpOnly: true, secure: isHttps(), sameSite: 'lax', path: '/', maxAge: 24 * 3600,
  });
  return token;
}

/** Origin/Referer должны вести на тот же хост: Host запроса, PUBLIC_SITE_URL или loopback-эквивалент. */
export function originAllowed(ctx: APIContext): boolean {
  const origin = ctx.request.headers.get('origin') ?? ctx.request.headers.get('referer');
  if (!origin) return true; // небраузерный клиент (curl/тесты): остаётся double-submit токен
  let o: URL;
  try { o = new URL(origin); } catch { return false; }
  const hostHeader = ctx.request.headers.get('host') ?? ctx.url.host;
  const pub = process.env.PUBLIC_SITE_URL ? new URL(process.env.PUBLIC_SITE_URL).host : null;
  const loopback = (h: string): boolean => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h);
  if (o.host === hostHeader) return true;
  if (pub && o.host === pub) return true;
  if (loopback(o.host) && loopback(hostHeader)) return true;
  return false;
}

export function csrfValid(ctx: APIContext): boolean {
  const cookie = ctx.cookies.get(CSRF_COOKIE)?.value;
  if (!cookie || !originAllowed(ctx)) return false;
  const formToken = ctx.request.headers.get('x-csrf-token');
  return !!formToken && formToken === cookie;
}

/** Для form-POST: токен может прийти полем _csrf (читаем body один раз). */
export async function csrfValidForm(ctx: APIContext, body: URLSearchParams | FormData): Promise<boolean> {
  const cookie = ctx.cookies.get(CSRF_COOKIE)?.value;
  if (!cookie || !originAllowed(ctx)) return false;
  const token = body.get('_csrf');
  return typeof token === 'string' && token === cookie;
}

/* ---------- журнал действий ---------- */
export function logAction(userId: number | null, action: string, entity?: string, entityId?: string | number | null, meta?: Record<string, unknown>): void {
  let metaStr: string | null = null;
  if (meta) {
    const safe = JSON.parse(JSON.stringify(meta)) as Record<string, unknown>;
    for (const k of Object.keys(safe)) {
      if (/pass|token|secret|hash/i.test(k)) delete safe[k];
    }
    metaStr = JSON.stringify(safe);
  }
  db().prepare('INSERT INTO audit_log(user_id, action, entity, entity_id, meta_json) VALUES(?,?,?,?,?)')
    .run(userId, action, entity ?? null, entityId != null ? String(entityId) : null, metaStr);
}

export interface AuditRow { id: number; user_id: number | null; login: string | null; action: string; entity: string | null; entity_id: string | null; at: string; meta_json: string | null }

export function listAudit(limit = 200): AuditRow[] {
  return db().prepare(`SELECT a.*, u.login FROM audit_log a LEFT JOIN admin_users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT ?`).all(limit) as AuditRow[];
}
