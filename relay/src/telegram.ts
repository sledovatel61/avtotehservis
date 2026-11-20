/**
 * Отправка заявки в Telegram. Разметка — та же, что у серверного
 * `composeLeadTelegram()` в `site/src/server/telegram.ts`: мастер видит
 * в чате ровно то, что видел бы на VPS. Поля не переименовываем.
 */
import type { LeadPayload, ReviewPayload } from './validate.ts';

const esc = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 2026-11-19 → 19.11.2026 */
export function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** +79518269839 → +7 (951) 826-98-39 — так номер читается и набирается с телефона. */
export function fmtPhone(normalized: string): string {
  const d = normalized.replace(/\D/g, '');
  if (d.length !== 11) return normalized;
  return `+${d[0]} (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** метка времени → «18 ноя, 20:15» (МСК) */
export function fmtStamp(at: Date): string {
  const msk = new Date(at.getTime() + 3 * 3600_000);
  const hh = String(msk.getUTCHours()).padStart(2, '0');
  const mm = String(msk.getUTCMinutes()).padStart(2, '0');
  return `${msk.getUTCDate()} ${MONTHS[msk.getUTCMonth()]}, ${hh}:${mm}`;
}

export interface ComposeOpts {
  siteName: string;
  address?: string;
  at?: Date;
}

export function composeTelegram(lead: LeadPayload, ticket: string, opts: ComposeOpts): string {
  const at = opts.at ?? new Date();
  const common = [
    `\nИмя: <b>${esc(lead.name)}</b>`,
    `\nТелефон: <b>${esc(fmtPhone(lead.phone))}</b> (${lead.contact_method === 'telegram' ? 'писать в Telegram' : 'звонок'})`,
  ];
  /* Журнал согласий: в самом уведомлении видно, на какой версии документа человек
     поставил галочку и когда именно. Этого достаточно, чтобы подтвердить факт
     согласия по конкретной заявке — отдельной базы у прослойки нет. */
  const consent = `\nСогласие на обработку ПД: версия <b>${esc(lead.consent_version)}</b>, отметка ${esc(fmtStamp(at))} МСК`;
  const footer = `\n\n<b>${esc(ticket)}</b> · ${esc(fmtStamp(at))} МСК`;

  if (lead.kind === 'message') {
    return [
      '💬 <b>Обращение с сайта</b>',
      ...common,
      `\nСообщение: ${esc(lead.message)}`,
      `\nИсточник: ${esc(lead.page)}`,
      consent,
      footer,
    ].join('');
  }

  const car = [
    `\nАвто: <b>${esc(lead.car.brand)}${lead.car.model ? ' ' + esc(lead.car.model) : ''}</b>`,
    lead.car.year ? `, ${lead.car.year} г.` : '',
    lead.car.mileage != null ? `, пробег ${lead.car.mileage.toLocaleString('ru-RU')} км` : '',
    lead.car.vin ? `\nVIN: ${esc(lead.car.vin)}` : '',
  ].join('');

  // Время — пожелание клиента: приём в порядке живой очереди, подтверждаем звонком.
  const when = lead.preferred.asap
    ? '\nЖелаемое время: <b>как можно скорее</b>'
    : `\nЖелаемое время: <b>${fmtDate(lead.preferred.date)} ${lead.preferred.slot ?? ''}</b>`;

  const services = lead.services.map((s) => (s === 'diagnostika' ? 'Не знаю — нужна диагностика' : s));

  return [
    '🔧 <b>Заявка на сервис</b>',
    ...common,
    car,
    services.length ? `\nУслуги: ${esc(services.join('; '))}` : '',
    lead.photos.length ? `\nФото: ${lead.photos.length} шт.` : '',
    when,
    '\n<i>Время предварительное — подтвердить звонком.</i>',
    `\nИсточник: ${esc(lead.page)}`,
    opts.address ? `\n${esc(opts.siteName)}, ${esc(opts.address)}` : '',
    consent,
    footer,
  ].join('');
}

export interface SendOpts {
  token: string;
  chatId: string;
  apiBase?: string;
  /** для тестов; по умолчанию настоящий fetch */
  fetchImpl?: typeof fetch;
}

/** Одна попытка + один повтор на 5xx/429/сеть. Бросает Error с коротким кодом. */
export async function sendTelegram(text: string, opts: SendOpts): Promise<void> {
  const base = (opts.apiBase ?? 'https://api.telegram.org').replace(/\/$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${base}/bot${opts.token}/sendMessage`;
  const body = JSON.stringify({
    chat_id: opts.chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });

  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400));
    let res: Response;
    try {
      res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    } catch (e) {
      lastErr = `network:${(e as Error)?.name ?? 'error'}`;
      continue;
    }
    if (res.ok) return;
    lastErr = `http:${res.status}`;
    if (res.status !== 429 && res.status < 500) break; // 4xx — повторять бессмысленно
  }
  throw new Error(`telegram_${lastErr}`);
}

/**
 * Фото к заявке: каждое уходит отдельным сообщением с подписью «к заявке A-…»,
 * чтобы в группе было видно, к чему оно относится. Сжатие делает браузер,
 * здесь только доставка. Одна попытка + один повтор на 5xx/429/сеть.
 */
export async function sendPhotos(files: File[], ticket: string, opts: SendOpts): Promise<void> {
  const base = (opts.apiBase ?? 'https://api.telegram.org').replace(/\/$/, '');
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${base}/bot${opts.token}/sendPhoto`;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const name = (file.name || `photo-${i + 1}.jpg`).replace(/[^\w.\-]+/g, '_') || `photo-${i + 1}.jpg`;
    let lastErr = 'unknown';
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 400));
      const fd = new FormData();
      fd.append('chat_id', opts.chatId);
      fd.append('caption', `Фото ${i + 1} к заявке ${ticket}`);
      fd.append('photo', file, name);
      let res: Response;
      try {
        res = await doFetch(url, { method: 'POST', body: fd });
      } catch (e) {
        lastErr = `network:${(e as Error)?.name ?? 'error'}`;
        continue;
      }
      if (res.ok) { lastErr = ''; break; }
      lastErr = `http:${res.status}`;
      if (res.status !== 429 && res.status < 500) break;
    }
    if (lastErr) throw new Error(`telegram_photos_${lastErr}`);
  }
}

/**
 * Уведомление о новом отзыве. Отзыв НЕ публикуется: воркер не имеет доступа к
 * репозиторию, поэтому сообщение — это задача модератору, а не готовый пост.
 * Разметку экранируем так же, как в заявках: текст пишет человек с улицы.
 */
export function composeReviewTelegram(
  review: ReviewPayload,
  opts: ComposeOpts,
): string {
  const at = opts.at ?? new Date();
  const stars = '⭐'.repeat(review.rating);
  return [
    '⭐ <b>Новый отзыв с сайта (на модерации)</b>',
    `\nОценка: <b>${review.rating}/5</b> ${stars}`,
    `\nИмя: <b>${esc(review.author)}</b>`,
    `\nОтзыв:\n${esc(review.text)}`,
    `\nИсточник: ${esc(review.page)}`,
    `\nСогласие на обработку ПД: версия <b>${esc(review.consentVersion)}</b>, отметка ${esc(fmtStamp(at))} МСК`,
    '\n<i>Опубликовать: админка → Отзывы</i>',
  ].join('');
}
