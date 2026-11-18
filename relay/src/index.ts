/**
 * ats-leads — прослойка между статическим сайтом на GitHub Pages и Telegram.
 *
 * Контракт (задание 80-1, менять нельзя):
 *   GET  /health              → { ok, service:'ats-leads', time }
 *   GET  /slots?date=…        → { date, slots:[{time, available, reason?}] }
 *   POST /leads               → 201 { ticket, lead_id: 0, status:'accepted', duplicate }
 *                               400 { error:{ code:'validation'|'bad_json'|'consent_version', message, fields? } }
 *                               429 { error:{ code:'too_many', message } } + Retry-After
 *
 * Секреты (wrangler secret put): BOT_TOKEN, TELEGRAM_CHAT_ID.
 * Переменные (wrangler.toml): ALLOWED_ORIGINS, SITE_NAME, SITE_ADDRESS, CONSENT_VERSION.
 */

import { validateLead, MIN_FILL_MS, type LeadPayload } from './validate.ts';
import { getSlots, isValidSlotDate } from './slots.ts';
import { composeTelegram, sendTelegram } from './telegram.ts';

export interface Env {
  BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_API_BASE?: string;
  ALLOWED_ORIGINS?: string;
  SITE_NAME?: string;
  SITE_ADDRESS?: string;
  CONSENT_VERSION?: string;
  /** Необязательное KV: лимиты и идемпотентность переживают перезапуск изолята. */
  ATS_KV?: KVNamespace;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

const DEFAULT_ORIGINS = ['https://sledovatel61.github.io', 'http://localhost:4321', 'http://127.0.0.1:4321'];

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
  const allowed = (env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS.join(','))
    .split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get('origin') ?? '';
  const ok = allowed.includes(origin) || allowed.includes('*');
  return {
    'access-control-allow-origin': ok ? origin : allowed[0] ?? 'null',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
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

async function handleLead(req: Request, env: Env): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return err(400, 'bad_json', 'Ожидался JSON-запрос'); }

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

  try {
    await sendTelegram(text, {
      token: env.BOT_TOKEN,
      chatId: env.TELEGRAM_CHAT_ID,
      apiBase: env.TELEGRAM_API_BASE,
    });
  } catch (e) {
    // Телефон в логи не попадаем: только код ошибки.
    console.error('[leads] telegram failed', String((e as Error)?.message ?? e).slice(0, 120));
    return err(502, 'telegram', 'Не удалось доставить заявку. Позвоните нам, пожалуйста.');
  }

  await kvPut(env, idemKey, `${ticket}|${await hashIp(lead.phone)}`, 86400);
  return json({ ticket, lead_id: 0, status: 'accepted', duplicate: false }, 201);
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
        return withCors(json({
          ok: true,
          service: 'ats-leads',
          time: new Date().toISOString(),
          telegram: Boolean(env.BOT_TOKEN && env.TELEGRAM_CHAT_ID),
          kv: Boolean(env.ATS_KV),
        }));
      }
      if (req.method === 'GET' && url.pathname === '/slots') return withCors(handleSlots(url));
      if (req.method === 'POST' && url.pathname === '/leads') return withCors(await handleLead(req, env));
      return withCors(err(404, 'not_found', 'Неизвестный адрес'));
    } catch (e) {
      console.error('[relay] unhandled', String((e as Error)?.stack ?? e).slice(0, 400));
      return withCors(err(500, 'internal', 'Внутренняя ошибка сервиса. Позвоните нам, пожалуйста.'));
    }
  },
};
