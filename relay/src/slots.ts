/**
 * Слоты для совместимости с контрактом сайта (`GET /slots?date=…`).
 *
 * Сервис работает в порядке живой очереди, поэтому «занятых» слотов нет:
 * время на сайте — пожелание клиента. Единственное ограничение — прошедшие
 * часы сегодняшнего дня: их предлагать бессмысленно.
 */

export const SLOT_TIMES = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
export const DAYS_AHEAD = 13;

export interface MoscowNow { date: string; hour: number; minute: number }

export function moscowNow(now: Date = new Date()): MoscowNow {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '0';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24, minute: Number(get('minute')) };
}

export function isValidSlotDate(dateStr: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(dateStr + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date(moscowNow(now).date + 'T00:00:00Z');
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  return diff >= 0 && diff <= DAYS_AHEAD;
}

export interface SlotInfo { time: string; available: boolean; reason?: string }

export function getSlots(dateStr: string, now: Date = new Date()): SlotInfo[] {
  const cur = moscowNow(now);
  const isToday = dateStr === cur.date;
  return SLOT_TIMES.map((time) => {
    const hour = Number(time.slice(0, 2));
    if (isToday && hour <= cur.hour) return { time, available: false, reason: 'past' };
    return { time, available: true };
  });
}
