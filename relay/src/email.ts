/**
 * Дублирование заявки на почту.
 *
 * Cloudflare Worker не умеет ходить в SMTP (порт 25 закрыт, а TLS-хендшейк руками —
 * лишний риск), поэтому письмо отправляется через HTTP-API почтового сервиса.
 * Поддерживаются два, включается тот, чей ключ лежит в секретах:
 *
 *   RESEND_API_KEY — Resend (https://resend.com): домен ats-rostov.ru подтверждён
 *                    (DKIM + CNAME rsend/send + DMARC), письма идут с
 *                    no-reply@ats-rostov.ru на любой ящик;
 *   BREVO_API_KEY  — Brevo (https://brevo.com): отправитель EMAIL_FROM должен быть
 *                    подтверждён в аккаунте (single sender), домен не нужен.
 *
 * Если ключа нет — почта просто выключена, заявки идут только в Telegram.
 * Секреты задаются в GitHub (Settings → Secrets): они уезжают в воркер шагом
 * «Push secrets to worker» в .github/workflows/relay.yml.
 */
import type { LeadPayload, ReviewPayload } from './validate.ts';
import { fmtPhone } from './telegram.ts';

export const DEFAULT_EMAIL_TO = 'Pavel.yakovenko@mail.ru';

export type EmailProvider = 'resend' | 'brevo';

export interface EmailEnv {
  RESEND_API_KEY?: string;
  BREVO_API_KEY?: string;
  EMAIL_TO?: string;
  EMAIL_FROM?: string;
}

export interface EmailOpts {
  siteName: string;
  address?: string;
  at?: Date;
  to?: string;
  from?: string;
}

/** Провайдер по наличию ключа. Brevo в приоритете: у него нет ограничения на получателя. */
export function emailProvider(env: EmailEnv): EmailProvider | null {
  if (env.BREVO_API_KEY) return 'brevo';
  if (env.RESEND_API_KEY) return 'resend';
  return null;
}

const escHtml = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const MONTHS_FULL = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** 18 ноября 2026, 12:15 (МСК) */
export function fmtMailStamp(at: Date): string {
  const msk = new Date(at.getTime() + 3 * 3600_000);
  const hh = String(msk.getUTCHours()).padStart(2, '0');
  const mm = String(msk.getUTCMinutes()).padStart(2, '0');
  return `${msk.getUTCDate()} ${MONTHS_FULL[msk.getUTCMonth()]} ${msk.getUTCFullYear()}, ${hh}:${mm} (МСК)`;
}

/** 2026-11-19 → 19.11.2026 */
const fmtDate = (iso: string | null): string => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

export interface ComposedEmail {
  subject: string;
  text: string;
  html: string;
}

/** Письмо-дубль: те же данные, что и в Telegram, но читаемо в почте и без разметки. */
export function composeEmail(lead: LeadPayload, ticket: string, opts: EmailOpts): ComposedEmail {
  const at = opts.at ?? new Date();
  const stamp = fmtMailStamp(at);
  const contact = lead.contact_method === 'telegram' ? 'писать в Telegram' : 'звонок';

  const rows: [string, string][] = [
    ['Заявка', ticket],
    ['Время', stamp],
    ['Имя', lead.name],
    ['Телефон', `${fmtPhone(lead.phone)} (${contact})`],
    ['Страница', lead.page],
    ['Согласие', `версия ${lead.consent_version}, отметка ${stamp}`],
  ];

  const subjectBase = lead.kind === 'message'
    ? 'Обращение с сайта'
    : `Заявка ${lead.car.brand}${lead.car.model ? ' ' + lead.car.model : ''}`;

  if (lead.kind === 'booking') {
    const car = [lead.car.brand, lead.car.model, lead.car.year ? `${lead.car.year} г.` : '']
      .filter(Boolean).join(' ');
    rows.push(['Автомобиль', car]);
    if (lead.car.vin) rows.push(['VIN', lead.car.vin]);
    if (lead.car.mileage != null) rows.push(['Пробег', `${lead.car.mileage.toLocaleString('ru-RU')} км`]);
    rows.push(['Услуги', lead.services.map((s) => (s === 'diagnostika' ? 'Не знаю — нужна диагностика' : s)).join('; ') || '—']);
    rows.push(['Желаемое время', lead.preferred.asap
      ? 'Как можно скорее'
      : `${fmtDate(lead.preferred.date)} ${lead.preferred.slot ?? ''}`.trim()]);
    rows.push(['Фото', lead.photos.length ? `${lead.photos.length} шт. — во вложении` : 'не прикладывали']);
  } else {
    rows.push(['Сообщение', lead.message]);
  }

  const subject = `${subjectBase} — ${lead.name}, ${fmtPhone(lead.phone)} · ${ticket}`;

  const text = [
    lead.kind === 'message' ? 'ОБРАЩЕНИЕ С САЙТА' : 'ЗАЯВКА НА СЕРВИС',
    opts.siteName + (opts.address ? `, ${opts.address}` : ''),
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    lead.kind === 'booking' ? 'Время предварительное — подтвердить звонком.' : '',
    'Ответить клиенту: ' + fmtPhone(lead.phone),
  ].filter((l) => l !== '').join('\n');

  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>${escHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#0b1410;color:#f2efe6;font:16px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#111c16;border:1px solid #2a3a31;border-radius:12px">
    <tr><td style="padding:22px 24px 6px">
      <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#b7c4bb">
        ${lead.kind === 'message' ? 'Обращение с сайта' : 'Заявка на сервис'} · ${escHtml(opts.siteName)}
      </div>
      <div style="font-size:22px;font-weight:700;margin-top:6px;color:#e0a96d">${escHtml(ticket)}</div>
    </td></tr>
    <tr><td style="padding:10px 24px 4px">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
        ${rows.map(([k, v]) => `<tr>
          <td style="padding:7px 0;color:#b7c4bb;font-size:14px;vertical-align:top;width:38%">${escHtml(k)}</td>
          <td style="padding:7px 0;font-size:15px;vertical-align:top">${escHtml(v)}</td>
        </tr>`).join('')}
      </table>
    </td></tr>
    <tr><td style="padding:14px 24px 22px">
      ${lead.kind === 'booking' ? '<p style="margin:0 0 10px;color:#b7c4bb;font-size:14px">Время предварительное — подтвердить звонком.</p>' : ''}
      <a href="tel:${escHtml(lead.phone)}" style="display:inline-block;padding:11px 18px;border-radius:10px;background:#c87f45;color:#0b1410;text-decoration:none;font-weight:700">
        Позвонить ${escHtml(fmtPhone(lead.phone))}
      </a>
      ${lead.contact_method === 'telegram' ? '<p style="margin:12px 0 0;color:#b7c4bb;font-size:14px">Клиент просил написать в Telegram.</p>' : ''}
    </td></tr>
  </table>
  <p style="max-width:640px;margin:14px auto 0;color:#7d8a83;font-size:12px">
    Письмо-дубль заявки с сайта. Копия отправлена в Telegram сервиса.
  </p>
</body></html>`;

  return { subject, text, html };
}

export interface SendEmailArgs {
  lead: LeadPayload;
  ticket: string;
  photos?: File[];
  env: EmailEnv;
  opts: EmailOpts;
  /** для тестов; по умолчанию настоящий fetch */
  fetchImpl?: typeof fetch;
}

export interface SentEmail {
  provider: EmailProvider;
  to: string;
  withPhotos: number;
}

const MAX_ATTACH_BYTES = 8 * 1024 * 1024;

/** base64 без Buffer: в Workers его нет, а btoa есть. */
function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** Вложения из фото заявки: имя + base64. Слишком тяжёлые не отправляем — письмо важнее. */
export async function buildAttachments(
  photos: File[],
): Promise<{ name: string; content: string }[]> {
  const out: { name: string; content: string }[] = [];
  let total = 0;
  for (const [i, f] of photos.entries()) {
    if (f.size > MAX_ATTACH_BYTES || total + f.size > MAX_ATTACH_BYTES * 2) break;
    const bytes = new Uint8Array(await f.arrayBuffer());
    total += bytes.length;
    const ext = /image\/png/i.test(f.type) ? 'png' : /image\/webp/i.test(f.type) ? 'webp' : 'jpg';
    out.push({ name: `zayavka-foto-${i + 1}.${ext}`, content: toBase64(bytes) });
  }
  return out;
}

export function emailFrom(env: EmailEnv, to: string): string {
  const own = (env.EMAIL_FROM ?? '').trim();
  if (own) return own;
  /* Resend: домен ats-rostov.ru подтверждён (DKIM, rsend, send, DMARC), поэтому
     по умолчанию пишем с адреса сервиса. Пока домен не подтверждён, Resend отвечает
     403 — этот код виден в /health как emailLastError. Brevo (закрыт) требовал
     подтверждённого отправителя, поэтому там по умолчанию берём ящик получателя. */
  return emailProvider(env) === 'resend' ? 'АвтоТехСервис <no-reply@ats-rostov.ru>' : to;
}

export async function sendEmail(args: SendEmailArgs): Promise<SentEmail> {
  const provider = emailProvider(args.env);
  if (!provider) throw new Error('email_not_configured');

  const to = (args.env.EMAIL_TO ?? args.opts.to ?? DEFAULT_EMAIL_TO).trim();
  const from = emailFrom(args.env, to);
  const { subject, text, html } = composeEmail(args.lead, args.ticket, args.opts);
  const attachments = await buildAttachments(args.photos ?? []);
  const doFetch = args.fetchImpl ?? fetch;

  const send = async (url: string, headers: Record<string, string>, body: unknown): Promise<void> => {
    let lastErr = 'unknown';
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
      let res: Response;
      try {
        res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      } catch (e) {
        lastErr = `network:${(e as Error)?.name ?? 'error'}`;
        continue;
      }
      if (res.ok) return;
      lastErr = `http:${res.status}`;
      /* 4xx — ошибка в ключе/отправителе/адресе: повторять бессмысленно и вредно. */
      if (res.status !== 429 && res.status < 500) break;
    }
    throw new Error(`email_${provider}_${lastErr}`);
  };

  if (provider === 'resend') {
    await send('https://api.resend.com/emails', {
      authorization: `Bearer ${args.env.RESEND_API_KEY ?? ''}`,
      'content-type': 'application/json',
    }, {
      from,
      to: [to],
      subject,
      text,
      html,
      attachments: attachments.map((a) => ({ filename: a.name, content: a.content })),
    });
  } else {
    const senderEmail = /<([^>]+)>/.exec(from)?.[1] ?? from;
    const senderName = /^(.*)<[^>]+>$/.exec(from)?.[1]?.trim() || args.opts.siteName;
    await send('https://api.brevo.com/v3/smtp/email', {
      'api-key': args.env.BREVO_API_KEY ?? '',
      'content-type': 'application/json',
    }, {
      sender: { name: senderName, email: senderEmail },
      to: [{ email: to }],
      replyTo: { email: to, name: args.opts.siteName },
      subject,
      htmlContent: html,
      textContent: text,
      ...(attachments.length ? { attachment: attachments.map((a) => ({ name: a.name, content: a.content })) } : {}),
    });
  }

  return { provider, to, withPhotos: attachments.length };
}

/* ------------------------------------------------------------------ *
 *  Письмо о новом отзыве
 *
 *  Отзыв не публикуется, поэтому письмо — такое же уведомление модератору,
 *  как и в Telegram. Вложений нет: прикладывать к отзыву нечего. Получатель и
 *  отправитель берутся те же (`EMAIL_TO`/`EMAIL_FROM`) — контракт заявок не трогаем.
 * ------------------------------------------------------------------ */

export function composeReviewEmail(review: ReviewPayload, opts: EmailOpts): ComposedEmail {
  const at = opts.at ?? new Date();
  const stamp = fmtMailStamp(at);
  const subject = `Новый отзыв на сайте — ${opts.siteName}`;

  const rows: [string, string][] = [
    ['Оценка', `${review.rating}/5`],
    ['Имя', review.author],
    ['Время', stamp],
    ['Страница', review.page],
    ['Согласие', `версия ${review.consentVersion}, отметка ${stamp}`],
  ];

  const text = [
    'НОВЫЙ ОТЗЫВ НА САЙТЕ',
    opts.siteName + (opts.address ? `, ${opts.address}` : ''),
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'Отзыв:',
    review.text,
    '',
    'Отзыв не опубликован — он ждёт модерации в админке (раздел «Отзывы»).',
  ].join('\n');

  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>${escHtml(subject)}</title></head>
<body style="margin:0;padding:24px;background:#0b1410;color:#f2efe6;font:16px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#111c16;border:1px solid #2a3a31;border-radius:12px">
    <tr><td style="padding:22px 24px 6px">
      <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#b7c4bb">
        Отзыв с сайта · ${escHtml(opts.siteName)}
      </div>
      <div style="font-size:22px;font-weight:700;margin-top:6px;color:#e0a96d">${'⭐'.repeat(review.rating)} ${review.rating}/5</div>
    </td></tr>
    <tr><td style="padding:10px 24px 4px">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
        ${rows.map(([k, v]) => `<tr>
          <td style="padding:7px 0;color:#b7c4bb;font-size:14px;vertical-align:top;width:38%">${escHtml(k)}</td>
          <td style="padding:7px 0;font-size:15px;vertical-align:top">${escHtml(v)}</td>
        </tr>`).join('')}
      </table>
    </td></tr>
    <tr><td style="padding:6px 24px 4px">
      <div style="border-left:3px solid #c87f45;padding:2px 0 2px 14px;white-space:pre-wrap;font-size:15px">${escHtml(review.text)}</div>
    </td></tr>
    <tr><td style="padding:14px 24px 22px">
      <p style="margin:0;color:#b7c4bb;font-size:14px">Отзыв не опубликован — ждёт модерации в админке, раздел «Отзывы».</p>
    </td></tr>
  </table>
</body></html>`;

  return { subject, text, html };
}

export interface SendReviewEmailArgs {
  review: ReviewPayload;
  env: EmailEnv;
  opts: EmailOpts;
  /** для тестов; по умолчанию настоящий fetch */
  fetchImpl?: typeof fetch;
}

/** Письмо об отзыве: те же провайдеры и адреса, что у заявок, но без вложений. */
export async function sendReviewEmail(args: SendReviewEmailArgs): Promise<{ provider: EmailProvider; to: string }> {
  const provider = emailProvider(args.env);
  if (!provider) throw new Error('email_not_configured');

  const to = (args.env.EMAIL_TO ?? args.opts.to ?? DEFAULT_EMAIL_TO).trim();
  const from = emailFrom(args.env, to);
  const { subject, text, html } = composeReviewEmail(args.review, args.opts);
  const doFetch = args.fetchImpl ?? fetch;

  const send = async (url: string, headers: Record<string, string>, body: unknown): Promise<void> => {
    let lastErr = 'unknown';
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 500));
      let res: Response;
      try {
        res = await doFetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      } catch (e) {
        lastErr = `network:${(e as Error)?.name ?? 'error'}`;
        continue;
      }
      if (res.ok) return;
      lastErr = `http:${res.status}`;
      if (res.status !== 429 && res.status < 500) break;
    }
    throw new Error(`email_${provider}_${lastErr}`);
  };

  if (provider === 'resend') {
    await send('https://api.resend.com/emails', {
      authorization: `Bearer ${args.env.RESEND_API_KEY ?? ''}`,
      'content-type': 'application/json',
    }, { from, to: [to], subject, text, html });
  } else {
    const senderEmail = /<([^>]+)>/.exec(from)?.[1] ?? from;
    const senderName = /^(.*)<[^>]+>$/.exec(from)?.[1]?.trim() || args.opts.siteName;
    await send('https://api.brevo.com/v3/smtp/email', {
      'api-key': args.env.BREVO_API_KEY ?? '',
      'content-type': 'application/json',
    }, {
      sender: { name: senderName, email: senderEmail },
      to: [{ email: to }],
      replyTo: { email: to, name: args.opts.siteName },
      subject,
      htmlContent: html,
      textContent: text,
    });
  }

  return { provider, to };
}
