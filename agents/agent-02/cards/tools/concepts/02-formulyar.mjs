/* 02 «Формуляр» — визитка как бланк: тонкая сетка, подписи капслоком, значения
 * по правому краю. Ощущение документа и порядка — то, чем сервис торгует
 * на сайте («смета до ремонта»). */
import { Card, C, TRIM_W, TRIM_H } from '../lib/canvas.mjs';
import { facts, phones, legalShort } from '../lib/facts.mjs';

export const slug = 'formulyar';
export const num = '02';
export const name = 'Формуляр';
export const idea = 'Бланк заказ-наряда: сетка, подписи капслоком, значения по правому краю.';

const X0 = 9;
const X1 = 81;

async function row(c, { y, label, value, vFace = 'golos-500', vPt = 7.2, vFill = C.night }) {
  await c.text({ s: label, face: 'golos-500', ptSize: 6, x: X0, y, fill: C.copperDark, tracking: 0.16, on: C.ivory });
  await c.text({ s: value, face: vFace, ptSize: vPt, x: X1, y, anchor: 'end', fill: vFill, tracking: 0.01, on: C.ivory });
}

export async function front() {
  const c = new Card({ bg: C.night });
  c.plate(C.night);
  c.rect({ x: 5.4, y: 5.4, w: TRIM_W - 10.8, h: TRIM_H - 10.8, fill: C.ivory, name: 'sheet' });
  c.rect({ x: 5.4, y: 5.4, w: 2.2, h: TRIM_H - 10.8, fill: C.copperDark, name: 'spine' });

  c.logo({ x: 66.4, y: 8.8, w: 12.4 });

  await c.text({ s: 'СЕРВИСНЫЙ ЛИСТ', face: 'golos-500', ptSize: 6, x: X0, y: 13.4, fill: C.copperDark, tracking: 0.2, on: C.ivory });
  await c.text({ s: facts.name, face: 'unbounded-600', ptSize: 9.6, x: X0, y: 21, fill: C.night, tracking: -0.02, on: C.ivory });

  c.rule({ x1: X0, y1: 23.6, x2: X1, y2: 23.6, color: C.night, w: 0.2, opacity: 0.45 });
  await row(c, { y: 28, label: 'АДРЕС', value: `${facts.city}, ${facts.address}`, vPt: 7 });
  c.rule({ x1: X0, y1: 30, x2: X1, y2: 30, color: C.copperDark, w: 0.25, opacity: 0.55 });
  await row(c, { y: 34.4, label: 'ЧАСЫ', value: facts.hours, vPt: 7 });
  c.rule({ x1: X0, y1: 36.4, x2: X1, y2: 36.4, color: C.copperDark, w: 0.25, opacity: 0.55 });
  await row(c, { y: 41.4, label: 'ТЕЛЕФОН', value: phones.main, vFace: 'golos-700', vPt: 9, vFill: C.copperDark });
  return c;
}

export async function back() {
  const c = new Card({ bg: C.ivory });
  c.plate(C.ivory);

  await c.text({ s: facts.name.toUpperCase(), face: 'unbounded-600', ptSize: 6, x: X0, y: 11.4, fill: C.night, tracking: 0.08 });
  c.rule({ x1: X0, y1: 13.8, x2: 62, y2: 13.8, color: C.night, w: 0.3, opacity: 0.7 });

  await c.text({ s: 'НАПРАВЛЕНИЯ', face: 'golos-500', ptSize: 6, x: X0, y: 18, fill: C.copperDark, tracking: 0.18 });
  await c.text({ s: 'Шиномонтаж и колёса', face: 'golos-500', ptSize: 6.5, x: X0, y: 22.4, fill: C.night });
  await c.text({ s: 'ТО, масло, тормоза, подвеска', face: 'golos-500', ptSize: 6.5, x: X0, y: 26, fill: C.night });
  await c.text({ s: 'Диагностика, кондиционер, сварка', face: 'golos-500', ptSize: 6.5, x: X0, y: 29.6, fill: C.night });
  await c.text({ s: facts.shortLandmark, face: 'golos-400', ptSize: 6, x: X0, y: 33.2, fill: C.night, opacity: 0.75 });

  c.rule({ x1: X0, y1: 36, x2: 62, y2: 36, color: C.night, w: 0.2, opacity: 0.35 });

  await c.text({ s: 'ТЕЛЕФОНЫ', face: 'golos-500', ptSize: 6, x: X0, y: 38.2, fill: C.copperDark, tracking: 0.18 });
  await c.text({ s: phones.city, face: 'golos-700', ptSize: 8.6, x: X0, y: 42, fill: C.night });
  await c.text({ s: `Telegram ${phones.telegram}`, face: 'golos-400', ptSize: 8, x: X0, y: 45.4, fill: C.night });

  // правый столбец: QR (12,5 мм), сайт и юрлицо в две строки
  c.qr({ x: 64.4, y: 9, module: 0.48, url: facts.siteUrl, plate: C.ivory, ink: C.night, rx: 0.4 });
  await c.text({ s: facts.site, face: 'golos-700', ptSize: 7, x: X1, y: 25.4, anchor: 'end', fill: C.night });
  await c.text({ s: 'ИП Яковенко П. И.', face: 'golos-400', ptSize: 6, x: X1, y: 30.6, anchor: 'end', fill: C.night, opacity: 0.85, name: 'legal-name' });
  await c.text({ s: `ИНН ${facts.legal.inn}`, face: 'golos-400', ptSize: 6, x: X1, y: 34.6, anchor: 'end', fill: C.night, opacity: 0.85, name: 'legal-inn' });
  return c;
}
