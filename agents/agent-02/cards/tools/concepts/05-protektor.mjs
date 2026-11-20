/* 05 «Протектор» — своя идея, опирается на реальность сервиса: шиномонтаж —
 * главный поток (сезонная переобувка, два бокса с подъёмниками). Шашки
 * протектора идут вертикальной полосой по короткому краю. */
import { Card, C, TRIM_W, TRIM_H } from '../lib/canvas.mjs';
import { facts, phones, legalShort } from '../lib/facts.mjs';

export const slug = 'protektor';
export const num = '05';
export const name = 'Протектор';
export const idea = 'Шашки протектора по левому краю: карточка-шина, главный поток сервиса.';

/** Вертикальная полоса шашек: каждая пара смещена влево/вправо, как грунтозацепы. */
function treadStrip(c, { x, w, color, opacity = 1, step = 6.6, h = 4.4 }) {
  let i = 0;
  for (let y = -3; y < TRIM_H + 3; y += step) {
    const wide = i % 2 === 0;
    const bw = wide ? w : w * 0.62;
    c.rect({ x: wide ? x : x + w * 0.38, y, w: bw, h, fill: color, opacity, rx: 0.5, name: 'tread' });
    i++;
  }
}

export async function front() {
  const c = new Card({ bg: C.night });
  c.plate(C.night);

  c.rect({ x: -3, y: -3, w: 15.6, h: TRIM_H + 6, fill: C.deep, name: 'strip-bg' });
  treadStrip(c, { x: 1.6, w: 7.4, color: C.brass, opacity: 0.85 });
  c.rect({ x: 15.6, y: -3, w: 0.25, h: TRIM_H + 6, fill: C.copper, opacity: 0.6, name: 'strip-line' });

  await c.text({ s: facts.name, face: 'unbounded-600', ptSize: 9.6, x: 21.4, y: 17, fill: C.ivory, tracking: -0.014 });
  await c.text({ s: 'АВТОСЕРВИС И ШИНОМОНТАЖ', face: 'golos-500', ptSize: 6, x: 21.4, y: 22.4, fill: C.brass, tracking: 0.14 });

  c.rule({ x1: 21.4, y1: 26.4, x2: 62, y2: 26.4, color: C.brass, w: 0.25, opacity: 0.6 });

  await c.text({ s: phones.main, face: 'golos-700', ptSize: 10.6, x: 21.4, y: 34, fill: C.copper, tracking: 0.004 });
  await c.text({ s: 'ежедневно 9:00–19:00 · Ростов-на-Дону', face: 'golos-400', ptSize: 6.5, x: 21.4, y: 39, fill: C.mist });
  await c.text({ s: facts.address, face: 'golos-400', ptSize: 6.5, x: 21.4, y: 43.2, fill: C.mist, opacity: 0.85 });
  return c;
}

export async function back() {
  const c = new Card({ bg: C.night });
  c.plate(C.night);
  c.rect({ x: -3, y: -3, w: 15.6, h: TRIM_H + 6, fill: C.deep, name: 'strip-bg' });
  treadStrip(c, { x: 1.6, w: 7.4, color: C.copper, opacity: 0.7 });
  c.rect({ x: 15.6, y: -3, w: 0.25, h: TRIM_H + 6, fill: C.copper, opacity: 0.45, name: 'strip-line' });

  await c.text({ s: facts.city.toUpperCase(), face: 'golos-500', ptSize: 6, x: 21.4, y: 11.4, fill: C.brass, tracking: 0.16 });
  await c.text({ s: facts.address, face: 'golos-700', ptSize: 8.4, x: 21.4, y: 18.6, fill: C.ivory });
  await c.text({ s: facts.shortLandmark, face: 'golos-400', ptSize: 6.5, x: 21.4, y: 23.2, fill: C.mist });
  await c.text({ s: facts.hours, face: 'golos-400', ptSize: 6.5, x: 21.4, y: 27.4, fill: C.mist });

  c.rule({ x1: 21.4, y1: 30.6, x2: 60, y2: 30.6, color: C.brass, w: 0.25, opacity: 0.5 });

  await c.text({ s: phones.city, face: 'golos-700', ptSize: 8.4, x: 21.4, y: 36.2, fill: C.ivory });
  await c.text({ s: `Telegram ${phones.telegram}`, face: 'golos-400', ptSize: 8, x: 21.4, y: 40.2, fill: C.mist });
  await c.text({ s: legalShort, face: 'golos-400', ptSize: 6, x: 21.4, y: 45.2, fill: C.mist, opacity: 0.75, name: 'legal' });

  c.qr({ x: 64.2, y: 11.6, module: 0.48, url: facts.siteUrl });
  await c.text({ s: facts.site, face: 'golos-700', ptSize: 7, x: 64.2, y: 41.6, fill: C.brass });
  return c;
}
