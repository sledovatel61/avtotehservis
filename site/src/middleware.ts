import { randomBytes } from 'node:crypto';
import { defineMiddleware, sequence } from 'astro:middleware';
import type { APIContext } from 'astro';
import { ensureWorkers } from './server/outbox.ts';
import { resolveSession, SESSION_COOKIE } from './server/auth.ts';

/* 301 со старых адресов мокапа на ЧПУ (требование задания §6.4). */
const STATIC_REDIRECTS: Record<string, string> = {
  '/index.html': '/',
  '/about.html': '/about',
  '/services.html': '/services',
  '/appointment.html': '/appointment',
  '/news.html': '/news',
  '/contacts.html': '/contacts',
  '/privacy.html': '/privacy',
  '/mockup.html': '/',
};

function legacyRedirect(url: URL): string | null {
  if (!url.pathname.endsWith('.html')) return null;
  const known = STATIC_REDIRECTS[url.pathname];
  if (known) return known + (url.pathname === '/appointment.html' && url.searchParams.get('s') ? `?s=${encodeURIComponent(url.searchParams.get('s')!)}` : '');
  if (url.pathname === '/service.html') {
    const s = url.searchParams.get('s');
    return s ? `/services/${encodeURIComponent(s)}` : '/services';
  }
  if (url.pathname === '/post.html') {
    const p = url.searchParams.get('p');
    return p ? `/news/${encodeURIComponent(p)}` : '/news';
  }
  if (url.pathname === '/admin.html') return '/admin';
  return url.pathname.replace(/\.html$/, '') || '/';
}

const securityHeaders = defineMiddleware(async (context: APIContext, next) => {
  ensureWorkers(); // воркер доставки заявок + уборка (идемпотентно, один раз на процесс)
  const target = legacyRedirect(context.url);
  if (target) return context.redirect(target, 301);

  // Доступ в админку — только с активной сессией (кроме страниц входа/выхода).
  const p = context.url.pathname;
  if ((p === '/admin' || p.startsWith('/admin/')) && p !== '/admin/login' && p !== '/admin/logout') {
    let user = null;
    try { user = resolveSession(context.cookies.get(SESSION_COOKIE)?.value); } catch { user = null; }
    if (!user) return context.redirect('/admin/login', 302);
  }

  // Идентификатор клиента для ключа лимитов заявок (M3 ревью): выдаётся только на
  // страницах форм и только один раз. Соседи за NAT с общим IP различаются по cookie,
  // а IP остаётся запасным ключом для тех, кто приходит напрямую в API.
  if ((p === '/appointment' || p === '/contacts') && !context.cookies.get('ats_cid')?.value) {
    context.cookies.set('ats_cid', randomBytes(12).toString('base64url'), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 3600,
      secure: (process.env.PUBLIC_SITE_URL ?? '').startsWith('https:'),
    });
  }

  const res = await next();

  // API всегда отвечает JSON — даже на 404/500 (требование задания §7).
  // /api/health исключён: его 503 — намеренный ответ со своим JSON («degraded»), а не необработанная ошибка.
  if (context.url.pathname.startsWith('/api/') && context.url.pathname !== '/api/health' && (res.status === 404 || res.status >= 500)) {
    const code = res.status === 404 ? 'not_found' : 'internal';
    const message = res.status === 404 ? 'Нет такого API-маршрута' : 'Внутренняя ошибка. Попробуйте позже.';
    return new Response(JSON.stringify({ error: { code, message } }), {
      status: res.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' },
    });
  }

  const isHttps = (process.env.PUBLIC_SITE_URL ?? '').startsWith('https:');
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    isHttps ? 'upgrade-insecure-requests' : '',
  ].filter(Boolean).join('; ');
  res.headers.set('Content-Security-Policy', csp);
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (isHttps) res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (context.url.pathname.startsWith('/admin')) res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  res.headers.delete('X-Powered-By');
  return res;
});

export const onRequest = sequence(securityHeaders);
