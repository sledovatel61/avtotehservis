import { Telegraf } from 'telegraf';
import { db } from './db.ts';
import { getSettings } from './settings.ts';
import { fmtDateShort } from './format.ts';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface LeadRow {
  id: number; ticket: string; kind: string; name: string; phone: string; contact_method: string;
  brand: string | null; model: string | null; year: number | null; vin: string | null; mileage: number | null;
  services_json: string; preferred_date: string | null; preferred_slot: string | null; asap: number;
  message: string | null; page: string; created_at: string;
}

export function getLeadRow(leadId: number): LeadRow | undefined {
  return db().prepare('SELECT * FROM leads WHERE id=?').get(leadId) as LeadRow | undefined;
}

export function serviceTitles(slugs: string[]): string[] {
  if (!slugs.length) return [];
  const rows = db().prepare(`SELECT slug, title FROM services`).all() as { slug: string; title: string }[];
  const map = new Map(rows.map((r) => [r.slug, r.title]));
  return slugs.map((s) => (s === 'diagnostika' ? 'Не знаю — нужна диагностика' : map.get(s) ?? s));
}

export function adminLeadUrl(leadId: number): string {
  const base = (process.env.PUBLIC_SITE_URL ?? 'http://localhost:4321').replace(/\/$/, '');
  return `${base}/admin/leads/${leadId}`;
}

export function composeLeadTelegram(lead: LeadRow): string {
  const S = getSettings();
  const services = serviceTitles(JSON.parse(lead.services_json || '[]') as string[]);
  const when = lead.kind === 'message' ? '' :
    lead.asap ? '\nКогда: <b>как можно скорее</b>' :
    `\nКогда: <b>${lead.preferred_date ? fmtDateShort(lead.preferred_date) : ''} ${lead.preferred_slot ?? ''}</b>`;
  const car = lead.kind === 'message' ? '' : [
    `\nАвто: <b>${esc(lead.brand ?? '—')}${lead.model ? ' ' + esc(lead.model) : ''}</b>`,
    lead.year ? `, ${lead.year} г.` : '',
    lead.mileage != null ? `, пробег ${lead.mileage.toLocaleString('ru-RU')} км` : '',
    lead.vin ? `\nVIN: ${esc(lead.vin)}` : '',
  ].join('');
  return [
    `🔧 <b>${esc(lead.ticket)}</b> — ${lead.kind === 'message' ? 'обращение с сайта' : 'запись на сервис'}`,
    `\nИмя: <b>${esc(lead.name)}</b>`,
    `\nТелефон: <b>${esc(lead.phone)}</b> (${lead.contact_method === 'telegram' ? 'писать в Telegram' : 'звонок'})`,
    car,
    services.length ? `\nУслуги: ${esc(services.join('; '))}` : '',
    lead.message ? `\nСообщение: ${esc(lead.message)}` : '',
    when,
    `\nИсточник: ${esc(lead.page)}`,
    `\n\n<a href="${adminLeadUrl(lead.id)}">Открыть в админке</a> · ${esc(S.site_name)}, ${esc(S.address)}`,
  ].join('');
}

export async function sendLeadTelegram(leadId: number): Promise<void> {
  const token = process.env.BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('Telegram не настроен: BOT_TOKEN/TELEGRAM_CHAT_ID');
  const lead = getLeadRow(leadId);
  if (!lead) throw new Error(`Заявка ${leadId} не найдена`);
  const bot = new Telegraf(token, {
    telegram: { apiRoot: process.env.TELEGRAM_API_BASE || 'https://api.telegram.org' },
  });
  await bot.telegram.sendMessage(chatId, composeLeadTelegram(lead), {
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });
}
