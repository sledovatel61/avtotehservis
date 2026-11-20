/* 03 «Клеймо» — знак увеличен почти вчетверо и обрезан краем карточки: он
 * работает как фирменное клеймо, а не как иконка. Текст — в левой трети.
 * Самая смелая композиция из пяти. */
import { Card, C, TRIM_W, TRIM_H } from '../lib/canvas.mjs';
import { facts, phones, legalShort } from '../lib/facts.mjs';

export const slug = 'kleymo';
export const num = '03';
export const name = 'Клеймо';
export const idea = 'Знак вчетверо крупнее карточки и обрезан её краем — фирменное клеймо.';

export async function front() {
  const c = new Card({ bg: C.night });
  c.plate(C.night);

  // крупный знак 3:1 — дальний край уходит в вылет, ближний почти к центру
  c.logo({ x: 47, y: -1, w: 60, opacity: 0.95, clip: { x: 47, y: -3, w: TRIM_W - 47 + 3, h: TRIM_H + 6 }, name: 'bigmark' });

  c.rule({ x1: 8, y1: 9, x2: 15, y2: 9, color: C.brass, w: 0.3 });
  await c.text({ s: 'СЕРВИС НА ЗАПАДНОМ', face: 'golos-500', ptSize: 6, x: 8, y: 14.6, fill: C.brass, tracking: 0.18 });

  await c.text({ s: 'АвтоТех', face: 'unbounded-600', ptSize: 11, x: 7.6, y: 24.6, fill: C.ivory, tracking: -0.02 });
  await c.text({ s: 'Сервис', face: 'unbounded-600', ptSize: 11, x: 7.6, y: 33.4, fill: C.ivory, tracking: -0.02 });

  await c.text({ s: phones.main, face: 'golos-700', ptSize: 8.6, x: 8, y: 42.4, fill: C.copper });
  return c;
}

export async function back() {
  const c = new Card({ bg: C.deep2 });
  c.plate(C.deep2);

  // призрачный знак уходит в левый край как водяной знак
  c.logo({ x: -16, y: 12, w: 44, opacity: 0.12, name: 'ghost' });
  c.rule({ x1: 34, y1: 8, x2: 34, y2: 44, color: C.brass, w: 0.2, opacity: 0.35 });

  await c.text({ s: facts.city.toUpperCase(), face: 'golos-500', ptSize: 6, x: 38, y: 12.2, fill: C.brass, tracking: 0.16 });
  await c.text({ s: facts.address, face: 'golos-700', ptSize: 8.2, x: 38, y: 19.4, fill: C.ivory });
  await c.text({ s: facts.shortLandmark, face: 'golos-400', ptSize: 6.5, x: 38, y: 24.2, fill: C.mist });
  await c.text({ s: facts.hours, face: 'golos-400', ptSize: 6.5, x: 38, y: 28.6, fill: C.mist });
  await c.text({ s: phones.city, face: 'golos-700', ptSize: 8.2, x: 38, y: 34.8, fill: C.ivory });
  await c.text({ s: `Telegram ${phones.telegram}`, face: 'golos-400', ptSize: 8, x: 38, y: 39.4, fill: C.mist });
  await c.text({ s: legalShort, face: 'golos-400', ptSize: 6, x: 38, y: 44.6, fill: C.mist, opacity: 0.75, name: 'legal' });

  c.qr({ x: 6.6, y: 24.6, module: 0.48, url: facts.siteUrl });
  await c.text({ s: facts.site, face: 'golos-700', ptSize: 7, x: 6.6, y: 44.4, fill: C.brass });
  return c;
}
