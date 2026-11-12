/**
 * Общая математика cover-кропов (раунд 18, задание №20 §5.1).
 * Пользуются check-dirs.mjs и check-about-bg.mjs — копипаста кроп-формул запрещена:
 * разойдётся при первой правке.
 *  coverWindow(master, px, py, cw, ch) — видимое окно мастера W×H при object-fit:cover
 *    в боксе cw×ch с object-position px/py (доли, 0.5 = центр);
 *  commonWindow(wins) — пересечение окон (зона, доживающая до всех ширин);
 *  insideZone(zone, win, tol) — прямоугольник зоны {x,y,w,h} целиком внутри окна.
 */
export function coverWindow({ W, H, px = 0.5, py = 0.5 }, cw, ch) {
  const s = Math.max(cw / W, ch / H);
  const vw = Math.min(W, cw / s), vh = Math.min(H, ch / s);
  const x0 = (W - vw) * px, y0 = (H - vh) * py;
  return { x0, y0, x1: x0 + vw, y1: y0 + vh };
}
export function commonWindow(wins) {
  return wins.reduce((a, w) => ({
    x0: Math.max(a.x0, w.x0), y0: Math.max(a.y0, w.y0),
    x1: Math.min(a.x1, w.x1), y1: Math.min(a.y1, w.y1),
  }), { x0: 0, y0: 0, x1: Infinity, y1: Infinity });
}
export function insideZone(zone, win, tol = 1) {
  return zone.x >= win.x0 - tol && zone.y >= win.y0 - tol &&
    zone.x + zone.w <= win.x1 + tol && zone.y + zone.h <= win.y1 + tol;
}
