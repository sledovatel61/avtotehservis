import nodemailer from 'nodemailer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getSettings } from './settings.ts';
import { getLeadRow, serviceTitles, adminLeadUrl, type LeadRow } from './telegram.ts';
import { fmtDateShort } from './format.ts';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function composeLeadMail(lead: LeadRow): { subject: string; text: string; html: string } {
  const S = getSettings();
  const services = serviceTitles(JSON.parse(lead.services_json || '[]') as string[]);
  const subject = `Заявка ${lead.ticket} — ${S.site_name}${lead.kind === 'message' ? ' (обращение)' : ''}`;
  const when = lead.asap ? 'как можно скорее' : `${lead.preferred_date ? fmtDateShort(lead.preferred_date) : ''} ${lead.preferred_slot ?? ''}`.trim();
  const carLine = [lead.brand, lead.model, lead.year ? `${lead.year} г.` : null, lead.mileage != null ? `${lead.mileage} км` : null, lead.vin ? `VIN ${lead.vin}` : null].filter(Boolean).join(', ');
  const lines = [
    `Заявка: ${lead.ticket}`,
    `Тип: ${lead.kind === 'message' ? 'обращение с сайта' : 'запись на сервис'}`,
    `Имя: ${lead.name}`,
    `Телефон: ${lead.phone} (${lead.contact_method === 'telegram' ? 'писать в Telegram' : 'звонок'})`,
    carLine ? `Авто: ${carLine}` : '',
    services.length ? `Услуги: ${services.join('; ')}` : '',
    lead.message ? `Сообщение: ${lead.message}` : '',
    lead.kind === 'message' ? '' : `Когда: ${when || '—'}`,
    `Источник: ${lead.page}`,
    `Админка: ${adminLeadUrl(lead.id)}`,
  ].filter(Boolean);
  const text = lines.join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">
<h3 style="margin:0 0 12px">Заявка ${esc(lead.ticket)} — ${esc(S.site_name)}</h3>
<table cellpadding="4" cellspacing="0" border="0">
${lines.map((l) => {
    const [k, ...rest] = l.split(': ');
    return `<tr><td style="color:#666;vertical-align:top">${esc(k)}:</td><td>${esc(rest.join(': '))}</td></tr>`;
  }).join('\n')}
</table>
<p><a href="${esc(adminLeadUrl(lead.id))}">Открыть в админке</a></p>
</div>`;
  return { subject, text, html };
}

export async function sendLeadEmail(leadId: number): Promise<void> {
  const lead = getLeadRow(leadId);
  if (!lead) throw new Error(`Заявка ${leadId} не найдена`);
  const { subject, text, html } = composeLeadMail(lead);
  const S = getSettings();
  const to = process.env.MAIL_TO || S.email;
  const from = process.env.MAIL_FROM || to;

  // Тестовый/разработческий транспорт: письма складываются в каталог JSON-файлами (без сети).
  const jsonDir = process.env.SMTP_JSON_DIR;
  if (jsonDir) {
    mkdirSync(jsonDir, { recursive: true });
    const file = join(jsonDir, `${Date.now()}-${lead.ticket}.json`);
    writeFileSync(file, JSON.stringify({ to, from, subject, text, html }, null, 1));
    return;
  }
  const host = process.env.SMTP_HOST;
  if (!host) throw new Error('SMTP не настроен: SMTP_HOST');
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE ?? 'true') === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
  });
  await transport.sendMail({ from, to, subject, text, html });
}
