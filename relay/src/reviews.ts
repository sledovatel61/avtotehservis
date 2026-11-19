/**
 * Приём отзывов: `POST /reviews`.
 *
 * Отзыв НЕ публикуется автоматически — у воркера нет доступа к репозиторию, и
 * это осознанно. Прослойка только проверяет текст и кладёт уведомление в ту же
 * группу Telegram (и на почту, если настроена); дальше человек открывает
 * админку → «Отзывы» и решает сам.
 *
 * Контракт (менять нельзя — на него завязаны форма сайта и админка):
 *   201 { ok:true, status:'pending', id:'<uuid>' }
 *   400 { error:'validation', fields:{…} }
 *   400 { error:'link_not_allowed', fields:{…} }
 *   400 { error:'consent_version' }
 *   403 { error:'origin' }
 *   413 { error:'too_large' }
 *   429 { error:'rate_limit', retryAfter:60 }
 *   503 { error:'delivery_failed' }
 *
 * Приватность: в логах только id, длина текста и результат доставки. Ни текста,
 * ни имени — они уходят исключительно в Telegram и на почту владельца.
 */

import {
  validateReview,
  type ReviewPayload,
} from './validate.ts';
import { composeReviewTelegram, sendTelegram } from './telegram.ts';
import { emailProvider, sendReviewEmail } from './email.ts';
import { originAllowed, type OriginsEnv } from './origins.ts';

/** Тело отзыва: больше 8 КБ — это уже не отзыв, а попытка что-то залить. */
export const REVIEW_MAX_BYTES = 8 * 1024;
/** Лимит отзывов с одного адреса: 10 минут на 3 штуки. */
export const REVIEW_LIMIT = { max: 3, windowSec: 600 };

const REVIEW_RETRY_AFTER = 60;

export interface ReviewsEnv extends OriginsEnv {
  BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_API_BASE?: string;
  SITE_NAME?: string;
  SITE_ADDRESS?: string;
  CONSENT_VERSION?: string;
  BREVO_API_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_TO?: string;
  EMAIL_FROM?: string;
  ATS_KV?: KVLike;
}

export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

/** Хранилище ключей: KV, если он подключён, иначе память изолята. */
export interface ReviewsStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSec: number): Promise<void>;
}

/**
 * Ответы у отзывов плоские (`{error:'validation'}`), в отличие от заявок
 * (`{error:{code,message}}`). Так задано контрактом — форма читает `error` строкой.
 */
const reply = (data: unknown, status: number): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const fail = (code: string, status: number, extra: Record<string, unknown> = {}): Response =>
  reply({ error: code, ...extra }, status);

/** SHA-256 отпечаток: в KV и логах не должно быть ни имени, ни текста. */
export async function reviewFingerprint(review: ReviewPayload): Promise<string> {
  const data = new TextEncoder().encode(`${review.author}|${review.text}|${review.rating}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Тело не читаем целиком, если оно заведомо больше лимита: сначала смотрим на
 * `content-length`, а потом режем поток по счётчику. Иначе 8 КБ превращаются в
 * «сколько пришлют, столько и прочитаем».
 */
async function readBody(req: Request): Promise<{ ok: true; text: string } | { ok: false; reason: 'too_large' | 'bad_body' }> {
  const len = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(len) && len > REVIEW_MAX_BYTES) return { ok: false, reason: 'too_large' };
  if (!req.body) return { ok: true, text: '' };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > REVIEW_MAX_BYTES) {
      try { await reader.cancel(); } catch { /* поток уже закрыт — не наша забота */ }
      return { ok: false, reason: 'too_large' };
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(all) };
  } catch {
    return { ok: false, reason: 'bad_body' };
  }
}

/** Счётчик по IP: инкремент только при успехе проверки, как у заявок. */
async function takeRateLimit(store: ReviewsStore, ipHash: string): Promise<{ ok: boolean; retry: number }> {
  const key = `rl:review:${ipHash}`;
  const raw = await store.get(key);
  const n = raw ? Number(raw) || 0 : 0;
  if (n >= REVIEW_LIMIT.max) return { ok: false, retry: REVIEW_RETRY_AFTER };
  await store.put(key, String(n + 1), REVIEW_LIMIT.windowSec);
  return { ok: true, retry: 0 };
}

export interface HandleReviewDeps {
  /** SHA-256 первых 8 байт от IP — тот же формат, что у заявок. */
  hashIp(ip: string): Promise<string>;
  store: ReviewsStore;
}

/**
 * Обработчик `POST /reviews`. Заголовки CORS навешивает `index.ts` — здесь
 * только логика, чтобы её можно было тестировать без воркера целиком.
 */
export async function handleReview(
  req: Request,
  env: ReviewsEnv,
  deps: HandleReviewDeps,
): Promise<Response> {
  /* Origin проверяем первым: чужой сайт не должен даже узнать, что здесь есть
     приём отзывов, и уж точно не должен тратить наш лимит. */
  if (!originAllowed(req, env)) return fail('origin', 403);

  const body = await readBody(req);
  if (!body.ok) {
    return body.reason === 'too_large' ? fail('too_large', 413) : fail('validation', 400, { fields: { body: 'bad_body' } });
  }

  let parsed: unknown;
  try { parsed = JSON.parse(body.text); } catch {
    return fail('validation', 400, { fields: { body: 'bad_json' } });
  }

  const v = validateReview(parsed);
  if (!v.ok) {
    if (v.error === 'bad_json') return fail('validation', 400, { fields: { body: 'bad_json' } });
    return fail(v.error, 400, { fields: v.fields });
  }
  const review = v.value;

  /* Тихая ловушка: боту отвечаем как при успехе, но не отправляем ничего.
     Именно поэтому здесь есть id — по ответу нельзя отличить ловушку от приёма. */
  if (review.honeypot.trim() !== '') {
    return reply({ ok: true, status: 'pending', id: crypto.randomUUID() }, 201);
  }

  if (env.CONSENT_VERSION && review.consentVersion !== env.CONSENT_VERSION) {
    return fail('consent_version', 400);
  }

  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? 'unknown';
  const ipHash = await deps.hashIp(ip);

  const rl = await takeRateLimit(deps.store, ipHash);
  if (!rl.ok) {
    return new Response(JSON.stringify({ error: 'rate_limit', retryAfter: rl.retry }), {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': String(rl.retry),
      },
    });
  }

  const fingerprint = await reviewFingerprint(review);
  const idemKey = `review:${fingerprint}`;

  /* Дубль: уведомление уже уходило за последние сутки. Отвечаем тем же 201 —
     человек не должен видеть ошибку из-за того, что нажал кнопку дважды. */
  const seen = await deps.store.get(idemKey);
  if (seen) return reply({ ok: true, status: 'pending', id: seen }, 201);

  const id = crypto.randomUUID();
  const telegramOn = Boolean(env.BOT_TOKEN && env.TELEGRAM_CHAT_ID);
  const emailOn = Boolean(emailProvider(env));

  const opts = {
    siteName: env.SITE_NAME ?? 'АвтоТехСервис',
    address: env.SITE_ADDRESS ?? 'Ростов-на-Дону, ул. Портовая, 439',
  };

  /* Каналы идут параллельно и независимо: отзыв важнее доставить хоть куда-то,
     чем потерять из-за сбоя одного сервиса. */
  const telegramJob = (async (): Promise<string | null> => {
    if (!telegramOn) return 'telegram_not_configured';
    try {
      await sendTelegram(composeReviewTelegram(review, opts), {
        token: env.BOT_TOKEN as string,
        chatId: env.TELEGRAM_CHAT_ID as string,
        apiBase: env.TELEGRAM_API_BASE,
      });
      return null;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 120);
      console.error('[reviews] telegram failed', id, msg);
      return msg;
    }
  })();

  const emailJob = (async (): Promise<string | null> => {
    if (!emailOn) return 'email_not_configured';
    try {
      await sendReviewEmail({ review, env, opts });
      return null;
    } catch (e) {
      const msg = String((e as Error)?.message ?? e).slice(0, 120);
      console.error('[reviews] email failed', id, msg);
      return msg;
    }
  })();

  const [tgErr, mailErr] = await Promise.all([telegramJob, emailJob]);
  const delivered = { telegram: telegramOn && !tgErr, email: emailOn && !mailErr };

  /* Ни один канал не принял — говорим честно 503: «попробуйте позже». Врать про
     успех нельзя, иначе человек будет ждать отзыв, которого никто не увидит. */
  if (!delivered.telegram && !delivered.email) {
    console.error('[reviews] delivery failed', id, review.text.length, `tg=${tgErr ?? 'ok'}`, `mail=${mailErr ?? 'ok'}`);
    return fail('delivery_failed', 503);
  }

  await deps.store.put(idemKey, id, 86400);
  /* Лог без текста и имени: только id, длина и что сработало. */
  console.log('[reviews] accepted', id, review.text.length, `tg=${delivered.telegram}`, `mail=${delivered.email}`);

  return reply({ ok: true, status: 'pending', id }, 201);
}

/** Что показать в `/health`: включён ли приём отзывов и переживает ли он перезапуск. */
export function reviewsHealth(env: ReviewsEnv): { reviews: boolean; reviewsKv: boolean } {
  return { reviews: true, reviewsKv: Boolean(env.ATS_KV) };
}
