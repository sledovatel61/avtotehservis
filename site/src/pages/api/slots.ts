import type { APIRoute } from 'astro';
import { getSlots, isValidSlotDate } from '../../server/slots.ts';
import { json, err } from '../../server/http.ts';

export const GET: APIRoute = async ({ url }) => {
  const date = url.searchParams.get('date') ?? '';
  if (!isValidSlotDate(date)) {
    return err(400, 'bad_date', 'Дата должна быть в формате ГГГГ-ММ-ДД, в пределах 14 дней от сегодня');
  }
  return json({ date, slots: getSlots(date) });
};
