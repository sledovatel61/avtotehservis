import { db } from './db.ts';
import { getSettings } from './settings.ts';

export const SLOT_TIMES = ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00'];
export const DAYS_AHEAD = 13; // сегодня + 13 дней = 14

/** Текущая дата/время в Москве (сервис работает по МСК). */
export function moscowNow(): { date: string; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '0';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24, minute: Number(get('minute')) };
}

export function isValidSlotDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const now = moscowNow();
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return false;
  const today = new Date(now.date + 'T00:00:00Z');
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  return diff >= 0 && diff <= DAYS_AHEAD;
}

export interface SlotInfo { time: string; available: boolean; reason?: string }

/** Занятость слота: ручные блокировки (slot_blocks) + принятые заявки сверх вместимости + прошедшее время. */
export function getSlots(dateStr: string): SlotInfo[] {
  const now = moscowNow();
  const isToday = dateStr === now.date;
  const capacity = Math.max(1, getSettings().slot_capacity);
  const blocked = new Set(
    (db().prepare('SELECT slot FROM slot_blocks WHERE date=?').all(dateStr) as { slot: string }[]).map((r) => r.slot),
  );
  const booked = db().prepare(
    `SELECT preferred_slot AS slot, COUNT(*) AS c FROM leads
     WHERE preferred_date=? AND asap=0 AND status != 'canceled' AND preferred_slot IS NOT NULL
     GROUP BY preferred_slot`,
  ).all(dateStr) as { slot: string; c: number }[];
  const bookedMap = new Map(booked.map((b) => [b.slot, b.c]));
  return SLOT_TIMES.map((time) => {
    const hour = Number(time.slice(0, 2));
    if (isToday && hour <= now.hour) return { time, available: false, reason: 'прошедшее время' };
    if (blocked.has(time)) return { time, available: false, reason: 'заблокировано сервисом' };
    if ((bookedMap.get(time) ?? 0) >= capacity) return { time, available: false, reason: 'занято' };
    return { time, available: true };
  });
}

export function isSlotAvailable(dateStr: string, slot: string): boolean {
  const s = getSlots(dateStr).find((x) => x.time === slot);
  return !!s?.available;
}
