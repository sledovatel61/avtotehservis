/* Знак сайта как операции (только вектор): печатная версия logo.svg.
   Пропорции и числа — из site/public/img/logo.svg (viewBox 72×44); меняются
   только краска, масштаб и цвет «окон» (равен фону карточки).
   Градиенты сайта заменены плоской краской: на офсете градиент в 4 мм даёт грязь. */
import { ops } from './ops.mjs';

const BODY = 'M 6.2 29.8 L 9.6 28.5 L 7.8 26.8 C 10.6 24.4 15.2 22.1 20.8 20.3 C 26.6 16.5 33.4 14.9 41.2 15.1 C 47.6 15.3 53.4 17 58.2 19.3 L 64.6 16.4 L 62.6 20.3 L 64.4 21.1 L 63.8 23.6 L 65.5 24.1 L 63.4 28 L 65.1 27.6 L 62.4 29.8 L 58.3 29.8 A 6.6 6.6 0 0 0 45.1 29.8 L 26.1 29.8 A 6.5 6.5 0 0 0 13.1 29.8 Z';
const GLASS = 'M 23.2 20.1 C 28.2 17.1 34.4 16 41.2 16.3 C 45.2 16.5 48.8 17.4 51.4 18.7 L 45.4 20.8 L 25 20.9 Z';
const INTAKE = 'M 41.4 22 L 45.8 19.6 L 43.4 26.9 L 39.8 26.9 Z';
const DETAIL = 'M 26.8 23.2 L 41.4 22 M 27.6 26.9 L 43.2 26.9 L 45.8 19.6 M 28 28.4 L 43.6 28.4 M 12.5 28.6 A 7.1 7.1 0 0 1 26.7 28.6 M 44.5 28.6 A 7.2 7.2 0 0 1 58.9 28.6';
const GROUND = 'M 9.5 36.8 C 24 37.6 48 37.6 62.5 36.8';

/* variant:
   'plate' — тёмный щит на светлой бумаге: кант и кузов одной краской ink;
   'light' — на тёмном фоне: щит контуром + кузов слоновой костью;
   'bare'  — без щита: только машина контуром.
   cut — цвет фона: им «вырублены» окна стекла и заборника. */
export function symbolOps({ x, y, scale, variant = 'plate', ink = '#0B1410', cut = '#F4EFE6', accent = null, strokeW = 1.5 }) {
  const g = [];
  const A = accent ?? ink;
  const body = variant === 'plate' ? ink : ink;
  if (variant === 'bare') {
    g.push(ops.raw(BODY, { fill: 'none', stroke: ink, sw: strokeW * 0.8 }));
    g.push(ops.raw(GLASS, { fill: 'none', stroke: ink, sw: strokeW * 0.45 }));
    for (const cx of [19.6, 51.7]) {
      g.push(ops.circle(cx, 29.4, 4.6, { stroke: ink, sw: strokeW * 0.7 }));
      g.push(ops.circle(cx, 29.4, 1.0, { fill: ink }));
    }
    g.push(ops.raw(GROUND, { stroke: ink, sw: strokeW * 0.55, strokeOpacity: 0.5 }));
    return [ops.group(g, { transform: `translate(${x} ${y}) scale(${scale})` })];
  }
  // щит: на светлом — заливка краской; на тёмном — контур
  g.push(ops.rect(1, 1, 70, 42, { rx: 11, fill: variant === 'plate' ? ink : 'none', stroke: A, sw: strokeW }));
  if (variant === 'plate') g.push(ops.rect(3.2, 3.2, 65.6, 37.6, { rx: 9, stroke: A, sw: 0.5, strokeOpacity: 0.35 }));
  g.push(ops.raw(BODY, { fill: body }));
  g.push(ops.raw(GLASS, { fill: cut }));
  g.push(ops.raw(INTAKE, { fill: cut }));
  g.push(ops.raw(DETAIL, { stroke: cut, sw: 0.7, strokeOpacity: 0.5 }));
  for (const cx of [19.6, 51.7]) {
    g.push(ops.circle(cx, 29.4, 5.05, { fill: cut }));
    g.push(ops.circle(cx, 29.4, 4.2, { stroke: body, sw: 0.95 }));
    for (let k = 0; k < 5; k++) {
      const a = (-90 + k * 72) * Math.PI / 180;
      g.push(ops.line(cx, 29.4, cx + Math.cos(a) * 3.1, 29.4 + Math.sin(a) * 3.1, { stroke: body, sw: 0.95 }));
    }
    g.push(ops.circle(cx, 29.4, 0.95, { fill: body }));
  }
  g.push(ops.raw(GROUND, { stroke: A, sw: 0.9, strokeOpacity: 0.65 }));
  return [ops.group(g, { transform: `translate(${x} ${y}) scale(${scale})` })];
}
