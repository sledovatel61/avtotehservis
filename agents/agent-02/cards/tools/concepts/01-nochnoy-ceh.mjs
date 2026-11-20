/* 01 «Ночной цех» — тёмный фон, крупный знак, латунная линия, название в одну строку.
 * Самая безопасная и «дорогая» из пяти: ничего не спорит со знаком.
 * Мотив «линия + точка» взят из .eyebrow на сайте (base.css). */
import { Card, C, TRIM_W, TRIM_H } from '../lib/canvas.mjs';
import { facts, phones, legalShort } from '../lib/facts.mjs';

export const slug = 'nochnoy-ceh';
export const num = '01';
export const name = 'Ночной цех';
export const idea = 'Тёмная карточка-вывеска: знак, название, один номер. Всё остальное — тишина.';

export async function front() {
  const c = new Card({ bg: C.night });
  c.plate(C.night);
  c.rect({ x: 4.6, y: 4.6, w: TRIM_W - 9.2, h: TRIM_H - 9.2, stroke: C.brass, sw: 0.25, rx: 1.6, opacity: 0.5, name: 'frame' });

  c.logo({ x: 9.2, y: 8.4, w: 12.4 });
  await c.text({ s: 'АВТОСЕРВИС И ШИНОМОНТАЖ', face: 'golos-500', ptSize: 6, x: 9.2, y: 25, fill: C.brass, tracking: 0.16 });
  await c.text({ s: facts.name, face: 'unbounded-600', ptSize: 12.4, x: 9, y: 33.4, fill: C.ivory, tracking: -0.012 });

  c.rule({ x1: 9.2, y1: 36.8, x2: 56, y2: 36.8, color: C.brass, w: 0.25, opacity: 0.75 });
  c.rect({ x: 57.6, y: 35.95, w: 1.7, h: 1.7, fill: C.copper, rx: 0.85, name: 'dot' });
  await c.text({ s: phones.main, face: 'golos-700', ptSize: 9.6, x: 9.2, y: 42.8, fill: C.copper, tracking: 0.006 });
  return c;
}

export async function back() {
  const c = new Card({ bg: C.deep });
  c.plate(C.deep);
  c.rect({ x: 4.6, y: 4.6, w: TRIM_W - 9.2, h: TRIM_H - 9.2, stroke: C.brass, sw: 0.25, rx: 1.6, opacity: 0.35, name: 'frame' });

  await c.text({ s: facts.city.toUpperCase(), face: 'golos-500', ptSize: 6, x: 9.2, y: 12.6, fill: C.brass, tracking: 0.16 });
  await c.text({ s: facts.address, face: 'golos-500', ptSize: 8.4, x: 9.2, y: 19.2, fill: C.ivory });
  await c.text({ s: facts.shortLandmark, face: 'golos-400', ptSize: 6.5, x: 9.2, y: 24, fill: C.mist });
  await c.text({ s: facts.hours, face: 'golos-400', ptSize: 6.5, x: 9.2, y: 28.6, fill: C.mist });

  c.rule({ x1: 9.2, y1: 31.8, x2: 52, y2: 31.8, color: C.brass, w: 0.25, opacity: 0.4 });

  await c.text({ s: phones.city, face: 'golos-700', ptSize: 8.6, x: 9.2, y: 37.4, fill: C.ivory });
  await c.text({ s: `Telegram ${phones.telegram}`, face: 'golos-400', ptSize: 8, x: 9.2, y: 42, fill: C.mist });
  await c.text({ s: legalShort, face: 'golos-400', ptSize: 6, x: 9.2, y: 45.2, fill: C.mist, opacity: 0.75, name: 'legal' });

  c.qr({ x: 64.4, y: 11.6, module: 0.48, url: facts.siteUrl });
  await c.text({ s: facts.site, face: 'golos-500', ptSize: 6.5, x: 64.4, y: 41.2, fill: C.brass });
  return c;
}
