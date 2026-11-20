/* 04 «Светлая» — слоновая кость, тёмный текст, тёмная медь в акценте.
   Максимум воздуха и читаемости, дешевле всех в печати (одна краска по бумаге). */
import { C } from '../lib/palette.mjs';
import { F } from '../lib/content.mjs';

const INK = '#0B1410', SUB = '#3F4E47', ACC = '#9A5B2C';

export const meta = {
  id: '04-svetlaya', num: '04', title: 'Светлая',
  idea: 'Слоновая кость и воздух: читается в любом кармане, печать в одну краску',
};

export function front(card) {
  card.rect(0, 0, 96, 56, { fill: C.ivory });
  // двойная линейка — единственное украшение
  card.raw('M10 11.4L86 11.4', { stroke: INK, sw: 0.35 });
  card.raw('M10 12.5L86 12.5', { stroke: ACC, sw: 0.2, strokeOpacity: 0.8 });

  card.symbol({ x: 10, y: 15.0, scale: 0.27, variant: 'plate', ink: INK, cut: C.ivory, accent: ACC, strokeW: 1.8 });
  card.T('РОСТОВ-НА-ДОНУ · ПОРТОВАЯ, 439', { x: 86, y: 18.4, size: 6.2, weight: 500, fill: SUB, tracking: 0.1, align: 'right', bg: C.ivory, label: 'адрес' });
  card.T('ЕЖЕДНЕВНО 9:00–19:00', { x: 86, y: 22.4, size: 6.2, weight: 500, fill: SUB, tracking: 0.1, align: 'right', bg: C.ivory, label: 'часы' });

  card.T(F.name, { x: 10, y: 37.0, family: 'Unbounded', weight: 600, size: 15.6, fill: INK, bg: C.ivory, tracking: -0.015, label: 'название' });
  card.raw('M10 40.0L86 40.0', { stroke: INK, sw: 0.22, strokeOpacity: 0.5 });

  card.T('запись и вопросы', { x: 10, y: 44.2, size: 6.2, fill: SUB, bg: C.ivory, label: 'подпись телефона' });
  card.T(F.phoneMain, { x: 10, y: 48.0, family: 'Unbounded', weight: 600, size: 10.2, fill: ACC, bg: C.ivory, label: 'телефон основной' });
  card.T(F.site, { x: 86, y: 48.0, size: 7.2, weight: 500, fill: INK, align: 'right', bg: C.ivory, label: 'сайт' });
}

export function back(card) {
  card.rect(0, 0, 96, 56, { fill: C.ivory });
  card.raw('M10 11.4L86 11.4', { stroke: INK, sw: 0.35 });
  card.raw('M10 12.5L86 12.5', { stroke: ACC, sw: 0.2, strokeOpacity: 0.8 });

  card.T('КОНТАКТЫ', { x: 10, y: 17.4, size: 6.2, weight: 500, fill: ACC, tracking: 0.18, bg: C.ivory, label: 'рубрика' });

  card.T('Ростов-на-Дону, ул. Портовая, 439', { x: 10, y: 22.8, size: 7.6, weight: 500, fill: INK, bg: C.ivory, label: 'адрес' });
  card.T('ост. «3-й Поселковый» ~330 м, база «Бум»', { x: 10, y: 26.6, size: 6.4, fill: SUB, bg: C.ivory, label: 'ориентир' });
  card.T(F.hours, { x: 10, y: 30.4, size: 6.8, fill: SUB, bg: C.ivory, label: 'часы' });

  card.raw('M10 33.0L64 33.0', { stroke: INK, sw: 0.22, strokeOpacity: 0.55 });
  card.T('городской', { x: 10, y: 36.6, size: 6, fill: SUB, bg: C.ivory, label: 'подпись городского' });
  card.T(F.phoneCity, { x: 10, y: 41.0, size: 8.8, family: 'Unbounded', weight: 600, fill: INK, bg: C.ivory, label: 'телефон городской' });
  card.T(`Telegram: ${F.telegramPhone}`, { x: 10, y: 44.6, size: 8, fill: ACC, bg: C.ivory, label: 'telegram' });
  const legal = `ИП Яковенко П. И. · ИНН ${F.inn}`;
  const legalW = card.w(legal, { size: 6 });
  card.T(legal, { x: 10, y: 47.6, size: 6, fill: SUB, bg: C.ivory, label: 'юрлицо' });
  card.T(`ОГРНИП ${F.ogrnip}`, { x: 10 + legalW + 3.4, y: 47.6, size: 6, fill: SUB, bg: C.ivory, label: 'ОГРНИП' });

  const q = card.qr(F.siteUrl, { x: 70.4, y: 18.2, size: 12.0, plate: C.ivory, color: INK });
  card.T(F.site, { x: q.x + q.w / 2, y: q.y + q.h + 3.6, size: 6.4, weight: 500, fill: ACC, bg: C.ivory, align: 'center', label: 'сайт' });
}
