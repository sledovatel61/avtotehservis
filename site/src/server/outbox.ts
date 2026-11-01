import { db, mediaDir } from './db.ts';
import { sendLeadTelegram } from './telegram.ts';
import { sendLeadEmail } from './mail.ts';
import { sweepLimits } from './ratelimit.ts';
import { cleanupSessions } from './auth.ts';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_ATTEMPTS = 8;
/** Ретраи: 1 мин → 5 мин → 30 мин → 2 ч → 6 ч (далее 6 ч до лимита попыток). */
export const BACKOFF_MIN = [1, 5, 30, 120, 360, 360, 360];

export function maskPhone(s: string): string {
  return s.replace(/\+7[\s(]*\d{3}[)\s]*\d{3}[-\s]*\d{2}[-\s]*\d{2}/g, '+7 ***-**-**')
    .replace(/\+7\d{10}/g, (m) => '+7***' + m.slice(-2));
}

export interface OutboxRow {
  id: number; lead_id: number; channel: 'telegram' | 'email'; status: string;
  attempts: number; next_attempt_at: string | null; last_error: string | null; sent_at: string | null;
}

/** Один проход воркера: забирает должные строки и доставляет. Возвращает число обработанных. */
export async function runOutboxOnce(limit = 20): Promise<number> {
  const rows = db().prepare(
    `SELECT * FROM outbox
     WHERE (status='pending' OR (status='failed' AND attempts < ?))
       AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))
     ORDER BY id LIMIT ?`,
  ).all(MAX_ATTEMPTS, limit) as OutboxRow[];
  let processed = 0;
  for (const row of rows) {
    processed++;
    try {
      if (row.channel === 'telegram') await sendLeadTelegram(row.lead_id);
      else await sendLeadEmail(row.lead_id);
      db().prepare(`UPDATE outbox SET status='sent', sent_at=datetime('now'), last_error=NULL, attempts=attempts+1 WHERE id=?`).run(row.id);
    } catch (e) {
      const attempts = row.attempts + 1;
      const msg = maskPhone(String((e as Error)?.message ?? e)).slice(0, 300);
      if (attempts >= MAX_ATTEMPTS) {
        db().prepare(`UPDATE outbox SET status='failed', attempts=?, last_error=?, next_attempt_at=NULL WHERE id=?`).run(attempts, msg, row.id);
      } else {
        const mins = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)];
        db().prepare(`UPDATE outbox SET status='failed', attempts=?, last_error=?, next_attempt_at=datetime('now','+${mins} minutes') WHERE id=?`)
          .run(attempts, msg, row.id);
      }
      console.error(`[outbox] заявка=${row.lead_id} канал=${row.channel} попытка=${attempts} ошибка=${msg}`);
    }
  }
  return processed;
}

/** Ручная повторная отправка из админки: сброс попытки и немедленная доставка. */
export async function retryOutboxRow(rowId: number): Promise<boolean> {
  db().prepare(`UPDATE outbox SET status='pending', next_attempt_at=datetime('now') WHERE id=? AND status != 'sent'`).run(rowId);
  await runOutboxOnce(5);
  const row = db().prepare('SELECT status FROM outbox WHERE id=?').get(rowId) as { status: string } | undefined;
  return row?.status === 'sent';
}

/** Невостребованные загрузки (не привязаны ни к чему) удаляются через 24 часа (§10). */
export function cleanupOrphanUploads(): void {
  const rows = db().prepare(
    `SELECT id, path FROM media WHERE attached_to IS NULL AND created_at <= datetime('now','-1 day')`,
  ).all() as { id: string; path: string }[];
  for (const r of rows) {
    try { rmSync(join(mediaDir(), r.id), { recursive: true, force: true }); } catch { /* файлы уже удалены */ }
    db().prepare('DELETE FROM media WHERE id=?').run(r.id);
  }
}

let started = false;
/** Воркер outbox + периодическая уборка. Запускается один раз на процесс. */
export function ensureWorkers(): void {
  if (started) return;
  started = true;
  void runOutboxOnce().catch((e) => console.error('[outbox] стартовый проход:', e));
  const t = setInterval(() => {
    void runOutboxOnce().catch((e) => console.error('[outbox] проход:', e));
    try { sweepLimits(); cleanupSessions(); cleanupOrphanUploads(); } catch { /* уборка не критична */ }
  }, 30_000);
  t.unref?.();
}
