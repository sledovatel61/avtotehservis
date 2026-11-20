/**
 * ats-leads — прослойка между статическим сайтом на GitHub Pages и Telegram.
 *
 * Контракт (задание 80-1, менять нельзя):
 *   GET  /health              → { ok, service:'ats-leads', time, telegram, email, emailTo, consentVersion, kv }
 *   GET  /slots?date=…        → { date, slots:[{time, available, reason?}] }
 *   POST /reviews             → 201 { ok:true, status:'pending', id }  (отзыв, только модерация)
 *                               400 { error:'validation'|'consent_version'|'link_not_allowed' }
 *                               403 { error:'origin' }, 413 { error:'too_large' }
 *                               429 { error:'rate_limit', retryAfter } + Retry-After
 *                               503 { error:'delivery_failed' }
 *   GET  /reviews/inbox       → { items:[…] } при заголовке `x-inbox-key: <REVIEWS_INBOX_KEY>`
 *   POST /reviews/inbox/done  → { ok:true } — отзыв опубликован, из журнала уходит
 *   POST /leads               → 201 { ticket, lead_id: 0, status:'accepted', duplicate }
 *                               принимает JSON или multipart (payload=JSON + photo до 3 шт.)
 *                               400 { error:{ code:'validation'|'bad_json'|'consent_version', message, fields? } }
 *                               429 { error:{ code:'too_many', message } } + Retry-After
 *                               дубль уходит и в Telegram, и на почту (если настроена)
 *
 * Секреты (wrangler secret put): BOT_TOKEN, TELEGRAM_CHAT_ID.
 * Переменные (wrangler.toml): ALLOWED_ORIGINS, SITE_NAME, SITE_ADDRESS, CONSENT_VERSION.
 */

import { validateLead, MIN_FILL_MS, type LeadPayload } from './validate.ts';
import { getSlots, isValidSlotDate } from './slots.ts';
import { composeTelegram, sendTelegram, sendPhotos } from './telegram.ts';
import { emailProvider, sendEmail, DEFAULT_EMAIL_TO } from './email.ts';
import { mailStatus, markMailOk, markMailFailed } from './mail-status.ts';
import { handleReview, reviewsHealth, type ReviewsStore } from './reviews.ts';
import { handleInbox, inboxHealth } from './reviews-inbox.ts';
import { allowedOrigins } from './origins.ts';

export interface Env {
  BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_API_BASE?: string;
  ALLOWED_ORIGINS?: string;
  SITE_NAME?: string;
  SITE_ADDRESS?: string;
  CONSENT_VERSION?: string;
  /** Почта-дубль: включается наличием ключа сервиса (Brevo или Resend). */
  BREVO_API_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_TO?: string;
  EMAIL_FROM?: string;
  /** Необязательное KV: лимиты и идемпотентность переживают перезапуск изолята. */
  ATS_KV?: KVNamespace;
  /** Код доступа к запасному журналу отзывов. Без него адреса `/reviews/inbox` нет. */
  REVIEWS_INBOX_KEY?: string;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

const json = (data: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra },
  });

const err = (
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
  extra: Record<string, string> = {},
): Response => json({ error: { code, message, ...(fields ? { fields } : {}) } }, status, extra);

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const allowed = allowedOrigins(env);
  const origin = req.headers.get('origin') ?? '';
  const ok = allowed.includes(origin) || allowed.includes('*');
  return {
    /* Не разрешено (в том числе пустой список) — отдаём `null`: браузер такой
       ответ заблокирует, и подставлять чужой адрес из конфига не нужно. */
    'access-control-allow-origin': ok ? origin : 'null',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type, x-inbox-key',
    /* `retry-after` на 429 не входит в safelist, поэтому без этого заголовка
       кросс-доменный JS не видит, через сколько секунд повторять. */
    'access-control-expose-headers': 'retry-after',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

/** A-1811-4821, как в серверных талонах: буква + ММДД + 4 цифры. */
export function makeTicket(now: Date = new Date(), rand: () => number = Math.random): string {
  const msk = new Date(now.getTime() + 3 * 3600_000);
  const mm = String(msk.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(msk.getUTCDate()).padStart(2, '0');
  const n = 1000 + Math.floor(rand() * 9000);
  return `A-${mm}${dd}-${n}`;
}

/* ---------- лимиты и идемпотентность ---------- */

const mem = new Map<string, { v: string; exp: number }>();
const memGet = (k: string): string | null => {
  const hit = mem.get(k);
  if (!hit) return null;
  if (hit.exp < Date.now()) { mem.delete(k); return null; }
  return hit.v;
};
const memPut = (k: string, v: string, ttl: number): void => { mem.set(k, { v, exp: Date.now() + ttl * 1000 }); };

const kvGet = async (env: Env, k: string): Promise<string | null> =>
  env.ATS_KV ? env.ATS_KV.get(k) : memGet(k);
const kvPut = async (env: Env, k: string, v: string, ttl: number): Promise<void> => {
  if (env.ATS_KV) await env.ATS_KV.put(k, v, { expirationTtl: ttl });
  else memPut(k, v, ttl);
};

/* Приём отзывов живёт в ./reviews.ts, но лимиты и идемпотентность у него общие
   с заявками: тот же KV, та же память изолята, только другие ключи. */
const reviewStore = (env: Env): ReviewsStore => ({
  get: (k) => kvGet(env, k),
  put: (k, v, ttl) => kvPut(env, k, v, ttl),
});

/** Простой счётчик: N заявок с одного адреса за 10 минут. */
export const LEAD_LIMIT = { max: 5, windowSec: 600 };

async function tooMany(env: Env, ipHash: string): Promise<{ ok: boolean; retry: number }> {
  const key = `rl:${ipHash}`;
  const raw = await kvGet(env, key);
  const n = raw ? Number(raw) || 0 : 0;
  if (n >= LEAD_LIMIT.max) return { ok: false, retry: LEAD_LIMIT.windowSec };
  await kvPut(env, key, String(n + 1), LEAD_LIMIT.windowSec);
  return { ok: true, retry: 0 };
}

/** Хэш IP: в логах и KV не должно быть открытых адресов. */
export async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`ats-leads:${ip}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- обработчики ---------- */

/* Фото: до 3 файлов, только изображения, до 6 МБ каждое после сжатия в браузере.
   Потолок нужен, чтобы один запрос не съел лимиты воркера и не залил группу мусором. */
const MAX_PHOTOS = 3;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

interface LeadBody { payload: unknown; photos: File[] }

/** Тело заявки: обычный JSON или multipart (payload=JSON + photo…). */
async function readLeadBody(req: Request): Promise<LeadBody | null> {
  const type = (req.headers.get('content-type') ?? '').toLowerCase();
  if (type.startsWith('multipart/form-data')) {
    let form: FormData;
    try { form = await req.formData(); } catch { return null; }
    const raw = form.get('payload');
    /* Браузер шлёт строку; curl с «payload=@file» присылает файл — читаем и его. */
    const text = typeof raw === 'string' ? raw : raw instanceof File ? await raw.text() : '';
    if (!text) return null;
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { return null; }
    const photos = form.getAll('photo').filter((f): f is File => f instanceof File && f.size > 0);
    return { payload, photos };
  }
  try { return { payload: await req.json(), photos: [] }; } catch { return null; }
}

/** Почему фото не годится — null, если всё в порядке. */
function photoProblem(files: File[]): string | null {
  if (files.length > MAX_PHOTOS) return `Не больше ${MAX_PHOTOS} фото`;
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_TOTAL_BYTES) return 'Фото слишком тяжёлые — приложите меньше снимков';
  for (const f of files) {
    if (!/^image\//.test(f.type)) return 'Принимаются только изображения';
    if (/^image\/svg/i.test(f.type)) return 'SVG не принимается';
    if (f.size > MAX_PHOTO_BYTES) return 'Фото больше 6 МБ';
  }
  return null;
}

async function handleLead(req: Request, env: Env): Promise<Response> {
  const read = await readLeadBody(req);
  if (!read) return err(400, 'bad_json', 'Ожидался JSON-запрос');
  const body = read.payload;
  const photos = read.photos;

  const badPhoto = photoProblem(photos);
  if (badPhoto) return err(400, 'validation', badPhoto, { photos: badPhoto });

  const v = validateLead(body);
  if (!v.ok) {
    if (v.error === 'bad_json') return err(400, 'bad_json', 'Ожидался JSON-запрос');
    return err(400, 'validation', 'Проверьте заполнение полей', v.fields);
  }
  const lead: LeadPayload = v.value;

  // Бот: отвечаем как при успехе, но ничего не отправляем (защита от перебора).
  if (lead.honeypot.trim() !== '') return json({ ticket: makeTicket(), lead_id: 0, status: 'accepted', duplicate: false }, 201);
  if (lead.form_started_at && Date.now() - lead.form_started_at < MIN_FILL_MS) {
    return json({ ticket: makeTicket(), lead_id: 0, status: 'accepted', duplicate: false }, 201);
  }
  if (env.CONSENT_VERSION && lead.consent_version !== env.CONSENT_VERSION) {
    return err(400, 'consent_version', 'Версия согласия устарела. Обновите страницу и отправьте заявку снова.');
  }

  // Идемпотентность: повторная отправка того же ключа возвращает тот же талон.
  const idemKey = `idem:${lead.idempotency_key}`;
  const seen = await kvGet(env, idemKey);
  if (seen) {
    const [ticket, hash] = seen.split('|');
    if (hash !== (await hashIp(lead.phone))) {
      return err(409, 'conflict', 'Ключ идемпотентности уже использован');
    }
    return json({ ticket, lead_id: 0, status: 'accepted', duplicate: true }, 201);
  }

  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? 'unknown';
  const ipHash = await hashIp(ip);
  const rl = await tooMany(env, ipHash);
  if (!rl.ok) {
    return err(429, 'too_many', 'Слишком много заявок с вашего адреса. Повторите позже или позвоните нам.', undefined, {
      'retry-after': String(rl.retry),
    });
  }

  if (!env.BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.error('[leads] telegram не настроен');
    return err(502, 'telegram', 'Сервис не смог принять заявку. Позвоните нам, пожалуйста.');
  }

  const ticket = makeTicket();
  const text = composeTelegram(lead, ticket, {
    siteName: env.SITE_NAME ?? 'АвтоТехСервис',
    address: env.SITE_ADDRESS ?? 'Ростов-на-Дону, ул. Портовая, 439',
  });

  /* Доставка в два канала. Заявка считается принятой, если сработал хотя бы один:
     мастеру важнее увидеть заявку хоть где-то, чем потерять её из-за чужого сбоя.
     Идём параллельно — человек не должен ждать два последовательных запроса. */
  const tg = { token: env.BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID, apiBase: env.TELEGRAM_API_BASE };
  const emailOn = Boolean(emailProvider(env));
  const telegramJob = (async (): Promise<string | null> => {
    try {
      await sendTelegram(text, tg);
      return null;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 120);
      console.error('[leads] telegram failed', msg);
      return msg;
    }
  })();
  const emailJob = (async (): Promise<string | null> => {
    if (!emailOn) return 'email_not_configured';
    try {
      await sendEmail({
        lead, ticket, photos,
        env,
        opts: {
          siteName: env.SITE_NAME ?? 'АвтоТехСервис',
          address: env.SITE_ADDRESS ?? 'Ростов-на-Дону, ул. Портовая, 439',
        },
      });
      await markMailOk(env);
      return null;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 120);
      console.error('[leads] email failed', msg);
      /* Причину видно в /health: emailLastError. */
      await markMailFailed(env, msg);
      return msg;
    }
  })();
  const [tgErr, mailErr] = await Promise.all([telegramJob, emailJob]);
  const delivered = { telegram: !tgErr, email: emailOn && !mailErr };
  if (!delivered.telegram && !delivered.email) {
    /* Почта не настроена — это не второй канал, и код ошибки должен остаться прежним. */
    return emailOn
      ? err(502, 'delivery', 'Не удалось доставить заявку. Позвоните нам, пожалуйста.')
      : err(502, 'telegram', 'Не удалось доставить заявку. Позвоните нам, пожалуйста.');
  }

  /* Фото — после текста: мастер сразу видит, к какой заявке они относятся.
     Ошибку фото не считаем отказом: заявка уже в группе, телефон у мастера есть. */
  if (photos.length) {
    try {
      await sendPhotos(photos, ticket, tg);
    } catch (e) {
      console.error('[leads] photos failed', String((e as Error)?.message ?? e).slice(0, 120));
    }
  }

  await kvPut(env, idemKey, `${ticket}|${await hashIp(lead.phone)}`, 86400);
  return json({ ticket, lead_id: 0, status: 'accepted', duplicate: false, delivered }, 201);
}

function handleSlots(url: URL): Response {
  const date = url.searchParams.get('date') ?? '';
  if (!isValidSlotDate(date)) {
    return err(400, 'bad_date', 'Дата должна быть в пределах 14 дней от сегодня');
  }
  return json({ date, slots: getSlots(date) });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    const withCors = (r: Response): Response => {
      const headers = new Headers(r.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(r.body, { status: r.status, headers });
    };

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        const mail = emailProvider(env);
        const mailLog = mail ? await mailStatus(env) : {};
        return withCors(json({
          ok: true,
          service: 'ats-leads',
          time: new Date().toISOString(),
          telegram: Boolean(env.BOT_TOKEN && env.TELEGRAM_CHAT_ID),
          email: emailProvider(env),
          emailTo: emailProvider(env) ? (env.EMAIL_TO ?? DEFAULT_EMAIL_TO) : undefined,
          /* Версия согласия, которую принимает воркер. Смоук и владелец видят её
             здесь и не гадают, почему форма получает 400 consent_version. */
          /* Последняя попытка письма: код ошибки и время. Помогает понять, почему
             заявка пришла в Telegram, а письма нет, не открывая логи Cloudflare. */
          ...(mail ? {
            emailLastOk: mailLog.lastOk,
            emailLastError: mailLog.lastError,
            emailLastErrorAt: mailLog.lastErrorAt,
          } : {}),
          consentVersion: env.CONSENT_VERSION ?? null,
          kv: Boolean(env.ATS_KV),
          /* Приём отзывов: по `reviews` смоук понимает, что сборка доехала,
             по `reviewsKv` — что дубли и лимиты переживают перезапуск изолята. */
          ...reviewsHealth(env),
          ...inboxHealth(env),
        }));
      }
      if (req.method === 'GET' && url.pathname === '/slots') return withCors(handleSlots(url));
      if (req.method === 'POST' && url.pathname === '/leads') return withCors(await handleLead(req, env));
      if (req.method === 'POST' && url.pathname === '/reviews') {
        return withCors(await handleReview(req, env, { hashIp, store: reviewStore(env) }));
      }
      /* Запасной журнал отзывов: закрыт кодом `REVIEWS_INBOX_KEY`. */
      const inbox = await handleInbox(req, url, env, reviewStore(env));
      if (inbox) return withCors(inbox);
      return withCors(err(404, 'not_found', 'Неизвестный адрес'));
    } catch (e) {
      console.error('[relay] unhandled', String((e as Error)?.stack ?? e).slice(0, 400));
      return withCors(err(500, 'internal', 'Внутренняя ошибка сервиса. Позвоните нам, пожалуйста.'));
    }
  },
};
