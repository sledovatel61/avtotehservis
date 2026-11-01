import { db } from './db.ts';
import { generateTicket } from './tickets.ts';
import { getSlots, isSlotAvailable, type SlotInfo } from './slots.ts';
import { sha256 } from './auth.ts';
import type { BookingPayload, MessagePayload } from './validation.ts';

export interface LeadResult { ticket: string; lead_id: number; status: 'accepted'; duplicate: boolean }

export class SlotTakenError extends Error {
  slots: SlotInfo[];
  constructor(slots: SlotInfo[]) {
    super('Выбранное время занято');
    this.name = 'SlotTakenError';
    this.slots = slots;
  }
}

/** IP — только хешем (152-ФЗ, минимум данных). Соль — SESSION_SECRET, если задан
 *  (|| , а не ??: пустая строка из EnvironmentFile считается незаданным — §2 ревью round5). */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return sha256(ip + '::' + (process.env.SESSION_SECRET || 'avtotehservis'));
}

function attachPhotos(leadId: number, photoIds: string[]): void {
  const dbx = db();
  const sel = dbx.prepare('SELECT id FROM media WHERE id=? AND kind=\'photo\' AND (attached_to IS NULL OR attached_to=?)');
  const upd = dbx.prepare(`UPDATE media SET attached_to=? WHERE id=?`);
  const link = dbx.prepare('INSERT OR IGNORE INTO lead_photos(lead_id, media_id) VALUES(?, ?)');
  for (const pid of photoIds) {
    const row = sel.get(pid, `lead:${leadId}`);
    if (!row) continue; // чужой/несуществующий id тихо игнорируем
    upd.run(`lead:${leadId}`, pid);
    link.run(leadId, pid);
  }
}

function insertOutbox(leadId: number): void {
  const dbx = db();
  const ins = dbx.prepare(`INSERT INTO outbox(lead_id, channel, status, attempts, next_attempt_at) VALUES(?, ?, 'pending', 0, datetime('now'))`);
  ins.run(leadId, 'telegram');
  ins.run(leadId, 'email');
}

/** Заявка-запись: одна транзакция — INSERT leads + outbox (2 строки). Идемпотентность по ключу. */
export function createBooking(p: BookingPayload, ctx: { ip?: string | null; ua?: string | null }): LeadResult {
  const dbx = db();
  const tx = dbx.transaction((): LeadResult => {
    const existing = dbx.prepare('SELECT id, ticket FROM leads WHERE idempotency_key=?').get(p.idempotency_key) as { id: number; ticket: string } | undefined;
    if (existing) return { ticket: existing.ticket, lead_id: existing.id, status: 'accepted', duplicate: true };
    if (!p.preferred.asap) {
      const date = p.preferred.date as string, slot = p.preferred.slot as string;
      if (!isSlotAvailable(date, slot)) throw new SlotTakenError(getSlots(date));
    }
    const ticket = generateTicket(dbx, 'booking');
    const info = dbx.prepare(`INSERT INTO leads(
        ticket, kind, name, phone, contact_method, brand, model, year, vin, mileage,
        services_json, preferred_date, preferred_slot, asap, message,
        consent_at, consent_version, page, idempotency_key, status, ip_hash, user_agent, payload_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,'new',?,?,?)`).run(
      ticket, 'booking', p.name, p.phone, p.contact_method, p.car.brand, p.car.model, p.car.year, p.car.vin, p.car.mileage,
      JSON.stringify(p.services), p.preferred.asap ? null : p.preferred.date, p.preferred.asap ? null : p.preferred.slot,
      p.preferred.asap ? 1 : 0,
      new Date().toISOString(), p.consent_version, p.page, p.idempotency_key, hashIp(ctx.ip), ctx.ua ?? null, JSON.stringify(p),
    );
    const leadId = Number(info.lastInsertRowid);
    attachPhotos(leadId, p.photos);
    insertOutbox(leadId);
    return { ticket, lead_id: leadId, status: 'accepted', duplicate: false };
  });
  return tx();
}

/** Обращение с формы контактов: тот же конвейер доставки. */
export function createMessage(p: MessagePayload, ctx: { ip?: string | null; ua?: string | null }): LeadResult {
  const dbx = db();
  const tx = dbx.transaction((): LeadResult => {
    const existing = dbx.prepare('SELECT id, ticket FROM leads WHERE idempotency_key=?').get(p.idempotency_key) as { id: number; ticket: string } | undefined;
    if (existing) return { ticket: existing.ticket, lead_id: existing.id, status: 'accepted', duplicate: true };
    const ticket = generateTicket(dbx, 'message');
    const info = dbx.prepare(`INSERT INTO leads(
        ticket, kind, name, phone, contact_method, services_json, asap, message,
        consent_at, consent_version, page, idempotency_key, status, ip_hash, user_agent, payload_json)
      VALUES(?,?,?,?,?,'[]',0,?,?,?,?,?,'new',?,?,?)`).run(
      ticket, 'message', p.name, p.phone, p.contact_method, p.message,
      new Date().toISOString(), p.consent_version, p.page, p.idempotency_key, hashIp(ctx.ip), ctx.ua ?? null, JSON.stringify(p),
    );
    const leadId = Number(info.lastInsertRowid);
    insertOutbox(leadId);
    return { ticket, lead_id: leadId, status: 'accepted', duplicate: false };
  });
  return tx();
}
