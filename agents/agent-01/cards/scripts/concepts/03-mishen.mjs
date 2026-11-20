/* 03 «Мишень» — самая смелая композиция: знак увеличен до 26 мм и обрезан
   краем карточки, работает как графика; текст мелкий, но контрастный.
   Никаких «прицелов» и мишеней-кругов — обрезка по краю, как кадр. */
import { C } from '../lib/palette.mjs';
import { F } from '../lib/content.mjs';

export const meta = {
  id: '03-mishen', num: '03', title: 'Мишень',
  idea: 'Знак-щит крупно и обрезан краем — графика, а текст собран в узкую колонку',
};

export function front(card) {
  card.rect(0, 0, 96, 56, { fill: C.night });
  // знак 26 мм: левый край уходит за обрез на ~5 мм, низ — на 4 мм
  card.symbol({ x: -1.2, y: 15.4, scale: 0.62, variant: 'light', ink: C.ivory, cut: C.night, accent: C.brass, strokeW: 1.0 });
  // световая «тень» под знаком не нужна: плоские макеты, без теней

  // узкая колонка справа
  card.T('АВТОСЕРВИС', { x: 49.6, y: 15.4, size: 6.4, weight: 500, fill: C.brass, tracking: 0.2, label: 'надзаголовок 1' });
  card.T('И ШИНОМОНТАЖ', { x: 49.6, y: 19.6, size: 6.4, weight: 500, fill: C.brass, tracking: 0.2, label: 'надзаголовок 2' });

  card.T(F.name, { x: 49.6, y: 32.4, family: 'Unbounded', weight: 600, size: 9.2, fill: C.ivory, label: 'название' });
  card.line(49.6, 35.0, 84.0, 35.0, { stroke: C.brass, sw: 0.22, strokeOpacity: 0.6 });
  card.T('ПОРТОВАЯ, 439', { x: 49.6, y: 38.6, size: 6.4, weight: 500, fill: C.mist, tracking: 0.1, label: 'адрес' });
  card.T(F.phoneMain, { x: 49.6, y: 44.4, family: 'Unbounded', weight: 600, size: 8.6, fill: C.brass, label: 'телефон основной' });
  card.T(F.site, { x: 49.6, y: 48.2, size: 6.4, weight: 500, fill: C.ivory, label: 'сайт' });
}

export function back(card) {
  card.rect(0, 0, 96, 56, { fill: C.ivory });
  // приём тот же, но спокойнее: узкая тёмная полоса у правого края, обрезанная обрезом,
  // и на ней маленький знак — без «случайных» обрезков машины
  card.rect(90.0, 0, 6, 56, { fill: C.night });
  card.symbol({ x: 93.0, y: 22.4, scale: 0.13, variant: 'light', ink: C.ivory, cut: C.night, accent: C.copperDark, strokeW: 2.6 });

  card.T('КОНТАКТЫ', { x: 10.5, y: 13.4, size: 6.2, weight: 500, fill: C.copperDark, tracking: 0.18, bg: C.ivory, label: 'рубрика' });
  card.T('Ростов-на-Дону,', { x: 10.5, y: 18.8, size: 7.4, weight: 500, fill: C.night, bg: C.ivory, label: 'адрес, стр.1' });
  card.T(F.street, { x: 10.5, y: 22.6, size: 7.4, weight: 500, fill: C.night, bg: C.ivory, label: 'адрес, стр.2' });
  card.T('ост. «3-й Поселковый» ~330 м', { x: 10.5, y: 26.2, size: 6.2, fill: '#3F4E47', bg: C.ivory, label: 'ориентир' });
  card.T(F.hours, { x: 10.5, y: 30.2, size: 6.6, fill: '#3F4E47', bg: C.ivory, label: 'часы' });

  card.line(10.5, 32.8, 46, 32.8, { stroke: C.copperDark, sw: 0.22, strokeOpacity: 0.6 });
  card.T('городской', { x: 10.5, y: 36.4, size: 6, fill: '#3F4E47', bg: C.ivory, label: 'подпись городского' });
  card.T(F.phoneCity, { x: 10.5, y: 40.4, size: 8.2, family: 'Unbounded', weight: 600, fill: C.night, bg: C.ivory, label: 'телефон городской' });
  card.T(`Telegram: ${F.telegramPhone}`, { x: 10.5, y: 44.0, size: 8, fill: C.night, bg: C.ivory, label: 'telegram' });
  card.T(`ИП Яковенко П. И. · ИНН ${F.inn}`, { x: 10.5, y: 47.6, size: 6, fill: '#3F4E47', bg: C.ivory, label: 'юрлицо' });

  // QR внизу справа, знак — справа вверху: оба не задевают текст левой колонны
  const q = card.qr(F.siteUrl, { x: 57.6, y: 29.0, size: 12.4, plate: C.ivory, color: C.night });
  card.T(F.site, { x: q.x + q.w / 2, y: q.y - 2.0, size: 6.2, weight: 500, fill: C.copperDark, bg: C.ivory, align: 'center', label: 'сайт' });
}
