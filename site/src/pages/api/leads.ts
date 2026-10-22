import type { APIRoute } from 'astro';
import { randomInt } from 'node:crypto';
import { bookingSchema, messageSchema, toErrorFields, consentVersionOk, MIN_FILL_MS, type BookingPayload, type MessagePayload } from '../../server/validation.ts';
import { createBooking, createMessage, hashIp, SlotTakenError } from '../../server/leads.ts';
import { getSettings, DEFAULTS } from '../../server/settings.ts';
import { checkLimit, peekLimit, consumeLimit, limitFromEnv, LIMITS } from '../../server/ratelimit.ts';
import { ddmm } from '../../server/tickets.ts';
import { runOutboxOnce, ensureWorkers, maskPhone } from '../../server/outbox.ts';
import { clientIp, json, err } from '../../server/http.ts';

/** Бота тихо игнорируем: отвечаем как при успехе, ничего не сохраняя. */
function botAccepted(isMessage: boolean): Response {
  return json({ ticket: `${isMessage ? 'K' : 'A'}-${ddmm()}-${randomInt(1000, 10000)}`, lead_id: 0, status: 'accepted', duplicate: false }, 201);
}

export const POST: APIRoute = async (ctx) => {
  ensureWorkers();
  // Два независимых уровня лимитов (M2 ревью round4 — cookie подделываем, IP нет):
  // 1) ЖЁСТКИЙ — только хэш IP: бот за NAT с любой подменой ats_cid в него упрётся.
  // 2) МЯГКИЙ — хэш IP + cookie ats_cid (ставится сервером на страницах форм):
  //    соседи по офису/NAT с разными браузерами не мешают друг другу.
  const ipPart = hashIp(clientIp(ctx)) ?? 'anon';
  const cid = (ctx.cookies.get('ats_cid')?.value ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  const ipKey = `leads-ip:${ipPart}`;
  const rlKey = `leads:${ipPart}|${cid}`;

  // Антифлуд — грубый порог на ЛЮБЫЕ обращения к endpoint (расход на каждый запрос),
  // тоже двухуровневый: жёсткий по IP (60/10 мин) и мягкий по IP+cookie (30/10 мин).
  const afIpMax = limitFromEnv('RATE_LIMIT_ANTIFLOOD_IP', LIMITS.antifloodIp.max);
  const afIp = checkLimit(`af-ip:${ipPart}`, afIpMax, LIMITS.antifloodIp.windowMs);
  if (!afIp.ok) return err(429, 'too_many', 'Слишком много обращений к форме. Повторите позже или позвоните нам.', {}, undefined, { 'Retry-After': String(afIp.retryAfterSec) });
  const afMax = limitFromEnv('RATE_LIMIT_ANTIFLOOD', LIMITS.antiflood.max);
  const af = checkLimit(`af:${ipPart}|${cid}`, afMax, LIMITS.antiflood.windowMs);
  if (!af.ok) return err(429, 'too_many', 'Слишком много обращений к форме. Повторите позже или позвоните нам.', {}, undefined, { 'Retry-After': String(af.retryAfterSec) });

  let body: unknown;
  try { body = await ctx.request.json(); } catch {
    return err(400, 'bad_json', 'Ожидался JSON-запрос');
  }
  const isMessage = typeof (body as { message?: unknown } | null)?.message === 'string';
  const parsed = (isMessage ? messageSchema : bookingSchema).safeParse(body);
  if (!parsed.success) {
    return err(400, 'validation', 'Проверьте заполнение полей', {}, toErrorFields(parsed.error).fields);
  }
  const p = parsed.data as BookingPayload & MessagePayload;
  if ((p.honeypot ?? '').trim() !== '') return botAccepted(isMessage);
  if (p.form_started_at && Date.now() - p.form_started_at < MIN_FILL_MS) return botAccepted(isMessage);
  if (!consentVersionOk(p.consent_version)) {
    return err(400, 'consent_version', 'Версия согласия устарела. Обновите страницу и отправьте заявку снова.');
  }
  // Квоты заявок проверяются перед созданием, но РАСХОДУЮТСЯ только после успешного
  // создания (не дубль): ошибки валидации, занятый слот и боты квоту не тратят.
  // Обе должны разрешить: жёсткая по IP и мягкая по IP+cookie.
  const maxLeadsIp = limitFromEnv('RATE_LIMIT_LEADS_IP', LIMITS.leadsIp.max);
  const maxLeads = limitFromEnv('RATE_LIMIT_LEADS', LIMITS.leads.max);
  const qIp = peekLimit(ipKey, maxLeadsIp, LIMITS.leadsIp.windowMs);
  const q = peekLimit(rlKey, maxLeads, LIMITS.leads.windowMs);
  if (!qIp.ok || !q.ok) {
    const retry = String(Math.max(qIp.retryAfterSec, q.retryAfterSec));
    return err(429, 'too_many', 'Слишком много заявок с вашего адреса. Повторите позже или позвоните нам.', {}, undefined, { 'Retry-After': retry });
  }

  const reqCtx = { ip: clientIp(ctx), ua: ctx.request.headers.get('user-agent') };
  try {
    const res = isMessage
      ? createMessage(p as MessagePayload, reqCtx)
      : createBooking(p as BookingPayload, reqCtx);
    if (!res.duplicate) { consumeLimit(ipKey); consumeLimit(rlKey); }
    // Доставка — сразу, но не блокируем ответ клиенту: заявка уже в БД (ноль потерь).
    void runOutboxOnce().catch((e) => console.error('[outbox] immediate:', maskPhone(String((e as Error)?.message ?? e))));
    return json({ ticket: res.ticket, lead_id: res.lead_id, status: 'accepted', duplicate: res.duplicate }, 201);
  } catch (e) {
    if (e instanceof SlotTakenError) {
      return err(409, 'slot_taken', 'Выбранное время только что заняли. Выберите, пожалуйста, другой слот.', { slots: e.slots });
    }
    console.error('[leads]', maskPhone(String((e as Error)?.message ?? e)).slice(0, 300));
    // Телефон — из настроек; если БД сама лежит, остаётся единый дефолт (тот же, что в 500.astro).
    let phone = DEFAULTS.phone_main;
    try { phone = getSettings().phone_main || phone; } catch { /* БД недоступна — дефолт */ }
    return err(500, 'internal', `Сервер не смог принять заявку. Попробуйте ещё раз или позвоните: ${phone}.`);
  }
};
