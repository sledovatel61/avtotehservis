/* 01 «Ночной цех» — самая безопасная: тёмный фон, знак-щит, латунные волоски,
   название Unbounded в одну строку, номер-акцент. Прямая семья сайта. */
import { C } from '../lib/palette.mjs';
import { F } from '../lib/content.mjs';

export const meta = {
  id: '01-nochnoy-ceh', num: '01', title: 'Ночной цех',
  idea: 'Тёмный фон, знак-щит, латунная линия и номер-акцент — прямая семья сайта',
};

export function front(card) {
  card.rect(0, 0, 96, 56, { fill: C.night });
  card.rect(6.5, 6.5, 83, 43, { stroke: C.brass, sw: 0.2, strokeOpacity: 0.42 });

  card.symbol({ x: 12, y: 12.2, scale: 0.36, variant: 'light', ink: C.ivory, cut: C.night, accent: C.brass, strokeW: 1.45 });

  // адрес — верхний правый угол, мелкой вразрядкой
  card.T('РОСТОВ-НА-ДОНУ', { x: 84, y: 18.4, size: 6.2, weight: 500, fill: C.mist, tracking: 0.12, align: 'right', label: 'город' });
  card.T('УЛ. ПОРТОВАЯ, 439', { x: 84, y: 23.2, size: 6.2, weight: 500, fill: C.ivory, tracking: 0.12, align: 'right', label: 'адрес' });

  card.T(F.name, { x: 12, y: 37.0, family: 'Unbounded', weight: 600, size: 15.4, fill: C.ivory, tracking: -0.015, label: 'название' });
  card.T('АВТОСЕРВИС И ШИНОМОНТАЖ · ЕЖЕДНЕВНО 9:00–19:00', { x: 12, y: 42.0, size: 6.2, weight: 500, fill: C.mist, tracking: 0.1, label: 'подпись' });
  card.line(12, 44.4, 50, 44.4, { stroke: C.brass, sw: 0.25, strokeOpacity: 0.75 });

  card.T(F.phoneMain, { x: 12, y: 48.2, family: 'Unbounded', weight: 600, size: 9.6, fill: C.brass, label: 'телефон основной' });
  card.T(F.site, { x: 84, y: 48.2, size: 7, weight: 500, fill: C.ivory, align: 'right', label: 'сайт' });
}

export function back(card) {
  card.rect(0, 0, 96, 56, { fill: C.deep });
  card.rect(6.5, 6.5, 83, 43, { stroke: C.brass, sw: 0.2, strokeOpacity: 0.34 });

  card.symbol({ x: 11, y: 9.2, scale: 0.26, variant: 'light', ink: C.ivory, cut: C.deep, accent: C.brass, strokeW: 2.1 });
  card.T('КОНТАКТЫ', { x: 34, y: 13.8, size: 6, weight: 500, fill: C.brass, tracking: 0.16, label: 'рубрика' });
  card.T('Ростов-на-Дону,', { x: 34, y: 18.2, size: 7.2, weight: 500, fill: C.ivory, label: 'адрес, стр.1' });
  card.T(F.street, { x: 34, y: 21.8, size: 7.2, weight: 500, fill: C.ivory, label: 'адрес, стр.2' });
  card.T('ост. «3-й Поселковый» ~330 м', { x: 34, y: 25.4, size: 6, fill: C.mist, label: 'ориентир' });
  card.T(F.hours, { x: 34, y: 29.4, size: 6.6, fill: C.mist, label: 'часы' });

  card.line(11, 32.0, 60, 32.0, { stroke: C.brass, sw: 0.2, strokeOpacity: 0.38 });
  card.T('городской номер', { x: 11, y: 35.9, size: 6, fill: C.mist, label: 'подпись городского' });
  card.T(F.phoneCity, { x: 11, y: 40.5, size: 9.4, family: 'Unbounded', weight: 600, fill: C.ivory, label: 'телефон городской' });
  card.T(`Telegram: ${F.telegramPhone}`, { x: 11, y: 44.3, size: 8, fill: C.ivory, label: 'telegram' });
  const a = `ИП Яковенко П. И. · ИНН ${F.inn}`;
  const aW = card.w(a, { size: 6 });
  card.T(a, { x: 11, y: 48.4, size: 6, fill: C.mist, label: 'юрлицо и ИНН' });
  card.T(`ОГРНИП ${F.ogrnip}`, { x: 11 + aW + 4, y: 48.4, size: 6, fill: C.mist, label: 'ОГРНИП' });

  const q = card.qr(F.siteUrl, { x: 68.3, y: 13.8, size: 12.2, plate: C.ivory });
  card.T(F.site, { x: q.x + q.w / 2, y: q.y + q.h + 3.7, size: 6.4, weight: 500, fill: C.ivory, align: 'center', label: 'сайт' });
}
