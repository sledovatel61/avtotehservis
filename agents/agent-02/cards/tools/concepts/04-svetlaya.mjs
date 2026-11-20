/* 04 «Светлая» — слоновая кость, тёмный текст, тёмная медь в акценте.
 * Читается в любом кармане и на любой стойке, дешевле в печати: одна краска
 * по площади, без тёмных плашек. */
import { Card, C, TRIM_W, TRIM_H } from '../lib/canvas.mjs';
import { facts, phones, legalShort } from '../lib/facts.mjs';

export const slug = 'svetlaya';
export const num = '04';
export const name = 'Светлая';
export const idea = 'Слоновая кость и тёмная медь: одна краска по площади, читается где угодно.';

export async function front() {
  const c = new Card({ bg: C.ivory });
  c.plate(C.ivory);

  // медная полоса внизу — единственная плашка на всю ширину, уходит в вылет
  c.rect({ x: -3, y: 39.6, w: TRIM_W + 6, h: TRIM_H - 39.6 + 3, fill: C.copperDark, name: 'band' });
  await c.text({ s: facts.site.toUpperCase(), face: 'golos-500', ptSize: 6.5, x: 9, y: 45.4, fill: C.ivory, tracking: 0.16, on: C.copperDark });

  c.logo({ x: 9, y: 6.4, w: 13.4 });
  await c.text({ s: facts.name, face: 'unbounded-600', ptSize: 11.2, x: 26.4, y: 14.4, fill: C.night, tracking: -0.015 });
  await c.text({ s: 'АВТОСЕРВИС И ШИНОМОНТАЖ · РОСТОВ-НА-ДОНУ', face: 'golos-500', ptSize: 6, x: 26.4, y: 19.6, fill: C.copperDark, tracking: 0.02 });

  c.rule({ x1: 9, y1: 25, x2: 81, y2: 25, color: C.copperDark, w: 0.3, opacity: 0.55 });
  await c.text({ s: 'ЗАПИСЬ И ВОПРОСЫ', face: 'golos-500', ptSize: 6, x: 9, y: 29.8, fill: C.copperDark, tracking: 0.16 });
  await c.text({ s: phones.main, face: 'golos-700', ptSize: 11.6, x: 9, y: 36.4, fill: C.night, tracking: 0.004 });
  return c;
}

export async function back() {
  const c = new Card({ bg: C.ivory });
  c.plate(C.ivory);
  c.rect({ x: -3, y: -3, w: 4.4, h: TRIM_H + 6, fill: C.copperDark, name: 'spine' });

  await c.text({ s: facts.city, face: 'golos-500', ptSize: 6, x: 8.6, y: 10.6, fill: C.copperDark, tracking: 0.14 });
  await c.text({ s: facts.address, face: 'golos-700', ptSize: 8.2, x: 8.6, y: 17.4, fill: C.night });
  await c.text({ s: facts.shortLandmark, face: 'golos-400', ptSize: 6.5, x: 8.6, y: 22.2, fill: C.night, opacity: 0.8 });
  await c.text({ s: facts.hours, face: 'golos-400', ptSize: 6.5, x: 8.6, y: 26.4, fill: C.night, opacity: 0.8 });

  c.rule({ x1: 8.6, y1: 30, x2: 56, y2: 30, color: C.night, w: 0.2, opacity: 0.35 });

  await c.text({ s: phones.city, face: 'golos-700', ptSize: 8.4, x: 8.6, y: 35.6, fill: C.night });
  await c.text({ s: `Telegram ${phones.telegram}`, face: 'golos-400', ptSize: 8, x: 8.6, y: 39.8, fill: C.night, opacity: 0.85 });
  await c.text({ s: legalShort, face: 'golos-400', ptSize: 6, x: 8.6, y: 45.2, fill: C.night, opacity: 0.7, name: 'legal' });

  // QR 12,5 мм: тёмный код на светлом
  c.qr({ x: 64.6, y: 9, module: 0.48, url: facts.siteUrl, plate: C.ivory, ink: C.night, rx: 0.5 });
  await c.text({ s: facts.site, face: 'golos-700', ptSize: 7, x: 81, y: 33.4, anchor: 'end', fill: C.night });
  await c.text({ s: 'ПОРТОВАЯ, 439', face: 'golos-500', ptSize: 6, x: 81, y: 37.6, anchor: 'end', fill: C.copperDark, tracking: 0.12 });
  return c;
}
