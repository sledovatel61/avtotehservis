/* 02 «Смета» — визитка как бланк заказ-наряда: светлая бумага, тонкая сетка,
   подписи капслоком вразрядку, номера и значения по правому краю, точечные
   выноски. Ощущение документа и порядка. */
import { C } from '../lib/palette.mjs';
import { F } from '../lib/content.mjs';

export const meta = {
  id: '02-smeta', num: '02', title: 'Смета',
  idea: 'Бланк заказ-наряда на светлой бумаге: сетка, выноски, значения справа',
};

const L = 10.5, R = 66.0;      // правая колонка текста; QR живёт правее          // поля бланка
const INK = '#0B1410', SUB = '#3F4E47', ACC = '#9A5B2C';

/* Строка бланка: подпись слева, точечная выноска, значение справа. */
function row(card, { y, label, value, valueSize = 6.6, valueWeight = 500 }) {
  const lw = card.w(label, { size: 6, weight: 500, tracking: 0.1 });
  const vw = card.w(value, { size: valueSize, weight: valueWeight });
  card.T(label, { x: L, y, size: 6, weight: 500, fill: SUB, tracking: 0.1, bg: C.ivory, label: `подпись «${label}»` });
  card.T(value, { x: R, y, size: valueSize, weight: valueWeight, fill: INK, align: 'right', bg: C.ivory, label: `значение «${label}»` });
  const x1 = L + lw + 2.2, x2 = R - vw - 2.2;
  if (x2 - x1 > 3) card.raw(`M${x1} ${y - 0.7}L${x2} ${y - 0.7}`, { stroke: SUB, sw: 0.16, strokeOpacity: 0.55, dash: '0.24 0.85' });
}

export function front(card) {
  card.rect(0, 0, 96, 56, { fill: C.ivory });
  // поле бланка
  card.rect(L - 3.2, 7, 79.2, 42, { stroke: ACC, sw: 0.22, strokeOpacity: 0.5 });
  card.symbol({ x: L - 0.6, y: 8.2, scale: 0.215, variant: 'plate', ink: INK, cut: C.ivory, accent: ACC, strokeW: 1.9 });

  card.T('БЛАНК · ЗАКАЗ-НАРЯД', { x: 27.6, y: 12.4, size: 6, weight: 500, fill: ACC, tracking: 0.16, bg: C.ivory, label: 'шапка' });
  card.T(F.name, { x: 27.6, y: 18.6, family: 'Unbounded', weight: 600, size: 8.2, fill: INK, bg: C.ivory, label: 'название' });

  card.raw(`M${L} 21.4L${R + 16} 21.4`, { stroke: INK, sw: 0.28 });
  card.T('АДРЕС', { x: L, y: 24.6, size: 6, fill: SUB, tracking: 0.14, bg: C.ivory, label: 'адрес' });
  card.T('РОСТОВ-НА-ДОНУ, ПОРТОВАЯ, 439', { x: R + 16, y: 24.6, size: 6.2, weight: 500, fill: INK, tracking: 0.06, align: 'right', bg: C.ivory, label: 'адрес значение' });

  row(card, { y: 29.6, label: 'РЕЖИМ', value: F.hoursShort });
  row(card, { y: 34.0, label: 'РАБОТЫ', value: 'шиномонтаж · ТО · ходовая', valueSize: 6.2 });
  row(card, { y: 38.4, label: 'ГОРОДСКОЙ НОМЕР', value: F.phoneCity, valueSize: 8 });

  card.raw(`M${L} 41.6L${R + 16} 41.6`, { stroke: INK, sw: 0.28 });
  card.T('ЗАПИСЬ ПО ТЕЛЕФОНУ', { x: L, y: 45.6, size: 6, fill: SUB, tracking: 0.12, bg: C.ivory, label: 'подпись телефона' });
  card.T(F.phoneMain, { x: R + 16, y: 47.4, family: 'Unbounded', weight: 600, size: 9.2, fill: ACC, align: 'right', bg: C.ivory, label: 'телефон основной' });
}

export function back(card) {
  card.rect(0, 0, 96, 56, { fill: C.ivory });
  card.rect(L - 3.2, 7, 79.2, 42, { stroke: ACC, sw: 0.22, strokeOpacity: 0.5 });

  card.T('НА ОБОРОТЕ · КУДА ЕХАТЬ', { x: L, y: 12.2, size: 6, weight: 500, fill: ACC, tracking: 0.16, bg: C.ivory, label: 'шапка' });

  row(card, { y: 17.4, label: 'АДРЕС', value: 'ул. Портовая, 439' });
  row(card, { y: 21.8, label: 'ОРИЕНТИР', value: 'ост. «3-й Поселковый» ~330 м', valueSize: 6.2 });
  row(card, { y: 26.2, label: 'РЕЖИМ', value: F.hours });
  row(card, { y: 30.6, label: 'ГОРОДСКОЙ НОМЕР', value: F.phoneCity, valueSize: 8 });
  row(card, { y: 35.0, label: 'TELEGRAM', value: F.telegramPhone, valueSize: 8 });
  row(card, { y: 39.4, label: 'ПОЧТА', value: F.email, valueSize: 6.2 });

  card.raw(`M${L} 42.2L${R} 42.2`, { stroke: INK, sw: 0.28 });
  card.T(`ИП Яковенко П. И. · ИНН ${F.inn}`, { x: L, y: 45.2, size: 6, fill: SUB, bg: C.ivory, label: 'юрлицо' });
  card.T(`ОГРНИП ${F.ogrnip}`, { x: L, y: 48.0, size: 6, fill: SUB, bg: C.ivory, label: 'ОГРНИП' });

  const q = card.qr(F.siteUrl, { x: 71.4, y: 16.4, size: 12.0, plate: C.ivory, color: INK });
  card.T(F.site, { x: q.x + q.w / 2, y: q.y + q.h + 3.4, size: 6.2, weight: 500, fill: ACC, align: 'center', bg: C.ivory, label: 'сайт' });
}
