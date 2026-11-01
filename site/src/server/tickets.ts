import { randomInt } from 'node:crypto';
import type Database from 'better-sqlite3';

/** ДДММ по московскому времени — филиал в Ростове-на-Дону, часы работы 9:00–19:00 МСК. */
export function ddmm(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit',
  }).formatToParts(date);
  const d = parts.find((p) => p.type === 'day')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  return `${d}${m}`;
}

/** Номер заявки: A-DDMM-XXXX (запись) или K-DDMM-XXXX (обращение). XXXX — случайные 4 цифры, UNIQUE. */
export function generateTicket(dbx: Database.Database, kind: 'booking' | 'message', date: Date = new Date()): string {
  const prefix = kind === 'message' ? 'K' : 'A';
  const day = ddmm(date);
  for (let i = 0; i < 100; i++) {
    const t = `${prefix}-${day}-${randomInt(1000, 10000)}`;
    const exists = dbx.prepare('SELECT 1 FROM leads WHERE ticket=?').get(t);
    if (!exists) return t;
  }
  throw new Error('ticket exhausted'); // 9000 номеров на день — практически недостижимо
}
