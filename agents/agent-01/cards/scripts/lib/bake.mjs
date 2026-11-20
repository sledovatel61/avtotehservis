/* Общие сюжеты: сетка сметы, полоса сведений, QR, юрлицо.
   Все они возвращают координаты текста — для отчёта о безопасной зоне. */
import { Card } from './card.mjs';
import { C, SHEET } from './palette.mjs';
import { mm } from './text.mjs';
import { F } from './content.mjs';

export const SAFE = { x0: SHEET.bleed + 4, y0: SHEET.bleed + 4, x1: SHEET.w - SHEET.bleed - 4, y1: SHEET.h - SHEET.bleed - 4 };

/* Юрлицо мелким шрифтом: ИП, ИНН, ОГРНИП. size ≥ 6 pt (правило задания). */
export function legalLine(card, { x, y, size = 6, fill = C.mist, align = 'left', bg }) {
  return card.T(`${F.legalShort} · ИНН ${F.inn} · ОГРНИП ${F.ogrnip}`, { x, y, size, fill, align, bg, label: 'юрлицо' });
}

/* Полоса контактов для оборота: адрес + часы + сайт; вариант «сетка» и «строка». */
export function contactBlock(card, { x, y, w, fillHead = C.ivory, fillBody = C.mist, sizeHead = 7.4, sizeBody = 6.6, leading = 8.6, bg }) {
  const r1 = card.T(F.addressFull, { x, y, size: sizeHead, weight: 500, fill: fillHead, bg });
  const r2 = card.T(F.hours, { x, y: y + mm(leading), size: sizeBody, weight: 400, fill: fillBody, bg });
  return { r1, r2 };
}
