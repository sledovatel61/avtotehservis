/* 05 «Два подъёмника» — своя идея от реальности сервиса: по фото и тексту
   сайта («Рабочий пост на два подъёмника», about.astro) в боксе стоит пост
   на два подъёмника. Две вертикальные колонны равной ширины, между ними —
   латунная стойка с отметками, как мерная линейка подъёмника. Слева — кто мы,
   справа — куда звонить; на обороте колонны меняются местами. */
import { C } from '../lib/palette.mjs';
import { F } from '../lib/content.mjs';

const INK = '#0B1410';
const L1 = 10.5, L2 = 49.5, R = 86;   // левая колонна, правая колонна, правый край

export const meta = {
  id: '05-dva-podyomnika', num: '05', title: 'Два подъёмника',
  idea: 'Две колонны как два подъёмника, между ними мерная латунная стойка',
};

/* Мерная стойка: вертикальная латунная линия с рисками через 1 мм и подписями через 10. */
function rack(card, x, y0, y1, { color = C.brass } = {}) {
  card.raw(`M${x} ${y0}L${x} ${y1}`, { stroke: color, sw: 0.25, strokeOpacity: 0.55 });
  for (let y = y0, i = 0; y <= y1 + 1e-6; y += 1.2, i++) {
    const w = i % 4 === 0 ? 1.6 : i % 2 === 0 ? 1.0 : 0.6;
    card.raw(`M${x} ${y.toFixed(2)}L${x - w} ${y.toFixed(2)}`, { stroke: color, sw: 0.22, strokeOpacity: i % 4 === 0 ? 0.95 : 0.5 });
    if (i % 4 === 0) card.raw(`M${x} ${y.toFixed(2)}L${x + w * 0.7} ${y.toFixed(2)}`, { stroke: color, sw: 0.22, strokeOpacity: 0.5 });
  }
}

export function front(card) {
  card.rect(0, 0, 96, 56, { fill: C.night });

  // левая колонна: знак + название
  card.symbol({ x: L1, y: 9.6, scale: 0.30, variant: 'light', ink: C.ivory, cut: C.night, accent: C.brass, strokeW: 1.8 });
  card.T('АВТОСЕРВИС', { x: L1, y: 28.6, size: 6.2, weight: 500, fill: C.brass, tracking: 0.18, label: 'рубрика 1' });
  card.T('И ШИНОМОНТАЖ', { x: L1, y: 32.4, size: 6.2, weight: 500, fill: C.brass, tracking: 0.18, label: 'рубрика 2' });
  card.T('ДВА ПОДЪЁМНИКА', { x: L1, y: 36.2, size: 6.2, weight: 500, fill: C.mist, tracking: 0.18, label: 'рубрика 3' });

  // центральная стойка
  rack(card, 47.0, 10.2, 45.8);

  // правая колонна: название и номер
  card.T(F.name, { x: L2, y: 16.0, family: 'Unbounded', weight: 600, size: 9.6, fill: C.ivory, label: 'название, стр.1' });
  card.T('ПОРТОВАЯ, 439', { x: L2, y: 22.0, size: 6.4, weight: 500, fill: C.mist, tracking: 0.1, label: 'адрес' });
  card.raw(`M${L2} 25.2L${R} 25.2`, { stroke: C.brass, sw: 0.2, strokeOpacity: 0.45 });
  card.T('ежедневно 9:00–19:00', { x: L2, y: 29.2, size: 6.4, fill: C.mist, label: 'часы' });

  card.T('запись', { x: L2, y: 36.4, size: 6, fill: C.brass, tracking: 0.16, label: 'подпись телефона' });
  card.T(F.phoneMain, { x: L2, y: 42.4, family: 'Unbounded', weight: 600, size: 9.0, fill: C.brass, label: 'телефон основной' });
  card.T(F.site, { x: L2, y: 47.4, size: 6.6, weight: 500, fill: C.ivory, label: 'сайт' });
}

export function back(card) {
  card.rect(0, 0, 96, 56, { fill: C.deep });
  rack(card, 47.0, 10.2, 45.8, { color: C.brass });

  // левая колонна: контакты
  card.T('КОНТАКТЫ', { x: L1, y: 14.6, size: 6.2, weight: 500, fill: C.brass, tracking: 0.18, label: 'рубрика' });
  card.T('Ростов-на-Дону,', { x: L1, y: 20.2, size: 7.0, weight: 500, fill: C.ivory, label: 'адрес, стр.1' });
  card.T(F.street, { x: L1, y: 24.0, size: 7.0, weight: 500, fill: C.ivory, label: 'адрес, стр.2' });
  card.T('ост. «3-й Поселковый» ~330 м', { x: L1, y: 27.8, size: 6.2, fill: C.mist, label: 'ориентир' });
  card.T(F.hours, { x: L1, y: 31.6, size: 6.6, fill: C.mist, label: 'часы' });
  card.T(F.phoneCity, { x: L1, y: 37.6, family: 'Unbounded', weight: 600, size: 8.4, fill: C.ivory, label: 'телефон городской' });
  card.T(`Telegram: ${F.telegramPhone}`, { x: L1, y: 41.4, size: 8, fill: C.ivory, label: 'telegram' });
  card.T(`${F.email}`, { x: L1, y: 44.4, size: 6.2, fill: C.mist, label: 'почта' });

  // правая колонна: работы списком (как на старой визитке, но без пиктограмм)
  card.T('ЧТО ДЕЛАЕМ', { x: L2, y: 14.6, size: 6.2, weight: 500, fill: C.brass, tracking: 0.18, label: 'рубрика 2' });
  card.TL(F.services, { x: L2, y: 19.0, leading: 8.0, size: 6.6, fill: C.ivory, label: 'работы' });
  const q = card.qr(F.siteUrl, { x: 65.2, y: 28.4, size: 12.0, plate: C.ivory });
  card.T(F.site, { x: q.x + q.w / 2, y: q.y + q.h + 3.2, size: 6.4, weight: 500, fill: C.ivory, align: 'center', label: 'сайт' });

  const a = `ИП Яковенко П. И. · ИНН ${F.inn}`;
  const aW = card.w(a, { size: 6 });
  card.T(a, { x: 10.5, y: 48.2, size: 6, fill: C.mist, label: 'юрлицо' });
}
