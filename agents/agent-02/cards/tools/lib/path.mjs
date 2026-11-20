/* Разбор и измерение SVG-путей.
 *
 * Нужно по двум причинам:
 *  1) PDF. pdfkit рисует кривые сам, но ему нужны абсолютные команды —
 *     поэтому SVG-путь (с относительными командами и дугами из logo.svg)
 *     приводится к списку абсолютных сегментов;
 *  2) самопроверка. Чтобы честно сказать «текст внутри безопасной зоны»,
 *     путь расплющивается в точки и считается габарит.
 */

const NUM = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

function tokens(d) {
  const out = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi;
  let m;
  while ((m = re.exec(d))) out.push(m[1] ?? parseFloat(m[2]));
  return out;
}

function arcToCubics(x0, y0, rx, ry, phiDeg, largeArc, sweep, x1, y1) {
  // SVG 1.1 F.6: эллиптическая дуга → кубические Безье
  if (rx === 0 || ry === 0) return [['L', x1, y1]];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x0 - x1) / 2, dy = (y0 - y1) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  let rx2 = rx * rx, ry2 = ry * ry;
  const lam = (x1p * x1p) / rx2 + (y1p * y1p) / ry2;
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; rx2 = rx * rx; ry2 = ry * ry; }
  const sign = largeArc === sweep ? -1 : 1;
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x0 + x1) / 2;
  const cy = sin * cxp + cos * cyp + (y0 + y1) / 2;
  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dtheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  if (sweep && dtheta < 0) dtheta += 2 * Math.PI;

  const segs = Math.ceil(Math.abs(dtheta) / (Math.PI / 2));
  const delta = dtheta / segs;
  const t = (4 / 3) * Math.tan(delta / 4);
  const out = [];
  let th = theta1;
  let p0 = [x0, y0];
  for (let i = 0; i < segs; i++) {
    const th2 = th + delta;
    const e = (ang) => [
      cx + rx * Math.cos(ang) * cos - ry * Math.sin(ang) * sin,
      cy + rx * Math.cos(ang) * sin + ry * Math.sin(ang) * cos,
    ];
    const p1 = e(th2);
    const d1 = [
      -rx * Math.sin(th) * cos - ry * Math.cos(th) * sin,
      -rx * Math.sin(th) * sin + ry * Math.cos(th) * cos,
    ];
    const d2 = [
      -rx * Math.sin(th2) * cos - ry * Math.cos(th2) * sin,
      -rx * Math.sin(th2) * sin + ry * Math.cos(th2) * cos,
    ];
    out.push(['C', p0[0] + t * d1[0], p0[1] + t * d1[1], p1[0] - t * d2[0], p1[1] - t * d2[1], p1[0], p1[1]]);
    p0 = p1; th = th2;
  }
  return out;
}

/**
 * SVG-путь → список абсолютных сегментов:
 *   ['M',x,y] ['L',x,y] ['C',x1,y1,x2,y2,x,y] ['Q',x1,y1,x,y] ['Z']
 */
export function parsePath(d) {
  const tk = tokens(d);
  const segs = [];
  let i = 0, cmd = null, cx = 0, cy = 0, sx = 0, sy = 0;
  let lastCtrl = null, lastQ = null;
  const num = () => { const v = tk[i++]; if (typeof v !== 'number') throw new Error(`parsePath: ожидалось число, получено ${v} в «${d.slice(0, 60)}…»`); return v; };
  while (i < tk.length) {
    if (typeof tk[i] === 'string') { cmd = tk[i++]; }
    else if (!cmd) throw new Error('parsePath: команда не найдена');
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') { segs.push(['Z']); cx = sx; cy = sy; lastCtrl = lastQ = null; cmd = null; continue; }
    if (C === 'M') {
      const x = num(), y = num();
      cx = rel ? cx + x : x; cy = rel ? cy + y : y;
      sx = cx; sy = cy;
      segs.push(['M', cx, cy]);
      cmd = rel ? 'l' : 'L';
      lastCtrl = lastQ = null;
      continue;
    }
    if (C === 'L') {
      const x = num(), y = num();
      cx = rel ? cx + x : x; cy = rel ? cy + y : y;
      segs.push(['L', cx, cy]); lastCtrl = lastQ = null; continue;
    }
    if (C === 'H') { const x = num(); cx = rel ? cx + x : x; segs.push(['L', cx, cy]); lastCtrl = lastQ = null; continue; }
    if (C === 'V') { const y = num(); cy = rel ? cy + y : y; segs.push(['L', cx, cy]); lastCtrl = lastQ = null; continue; }
    if (C === 'C') {
      const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
      const a = [rel ? cx + x1 : x1, rel ? cy + y1 : y1];
      const b = [rel ? cx + x2 : x2, rel ? cy + y2 : y2];
      const p = [rel ? cx + x : x, rel ? cy + y : y];
      segs.push(['C', a[0], a[1], b[0], b[1], p[0], p[1]]);
      lastCtrl = b; lastQ = null; cx = p[0]; cy = p[1]; continue;
    }
    if (C === 'S') {
      const x2 = num(), y2 = num(), x = num(), y = num();
      const a = lastCtrl ? [2 * cx - lastCtrl[0], 2 * cy - lastCtrl[1]] : [cx, cy];
      const b = [rel ? cx + x2 : x2, rel ? cy + y2 : y2];
      const p = [rel ? cx + x : x, rel ? cy + y : y];
      segs.push(['C', a[0], a[1], b[0], b[1], p[0], p[1]]);
      lastCtrl = b; lastQ = null; cx = p[0]; cy = p[1]; continue;
    }
    if (C === 'Q') {
      const x1 = num(), y1 = num(), x = num(), y = num();
      const a = [rel ? cx + x1 : x1, rel ? cy + y1 : y1];
      const p = [rel ? cx + x : x, rel ? cy + y : y];
      segs.push(['Q', a[0], a[1], p[0], p[1]]);
      lastQ = a; lastCtrl = null; cx = p[0]; cy = p[1]; continue;
    }
    if (C === 'T') {
      const x = num(), y = num();
      const a = lastQ ? [2 * cx - lastQ[0], 2 * cy - lastQ[1]] : [cx, cy];
      const p = [rel ? cx + x : x, rel ? cy + y : y];
      segs.push(['Q', a[0], a[1], p[0], p[1]]);
      lastQ = a; lastCtrl = null; cx = p[0]; cy = p[1]; continue;
    }
    if (C === 'A') {
      const rx = num(), ry = num(), rot = num(), la = num(), sw = num(), x = num(), y = num();
      const p = [rel ? cx + x : x, rel ? cy + y : y];
      for (const s of arcToCubics(cx, cy, Math.abs(rx), Math.abs(ry), rot, la ? 1 : 0, sw ? 1 : 0, p[0], p[1])) segs.push(s);
      cx = p[0]; cy = p[1]; lastCtrl = lastQ = null; continue;
    }
    throw new Error(`parsePath: неизвестная команда ${cmd}`);
  }
  return segs;
}

/** Расплющить сегменты в точки (для габарита и проверки попадания в зону). */
export function flatten(segs, step = 0.05) {
  const pts = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  for (const s of segs) {
    if (s[0] === 'M') { cx = s[1]; cy = s[2]; sx = cx; sy = cy; pts.push([cx, cy]); }
    else if (s[0] === 'L') { cx = s[1]; cy = s[2]; pts.push([cx, cy]); }
    else if (s[0] === 'Q') {
      const [x1, y1, x, y] = s.slice(1);
      for (let t = step; t <= 1; t += step) {
        const mt = 1 - t;
        pts.push([mt * mt * cx + 2 * mt * t * x1 + t * t * x, mt * mt * cy + 2 * mt * t * y1 + t * t * y]);
      }
      cx = x; cy = y;
    } else if (s[0] === 'C') {
      const [x1, y1, x2, y2, x, y] = s.slice(1);
      for (let t = step; t <= 1; t += step) {
        const mt = 1 - t;
        pts.push([
          mt ** 3 * cx + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t ** 3 * x,
          mt ** 3 * cy + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t ** 3 * y,
        ]);
      }
      cx = x; cy = y;
    } else if (s[0] === 'Z') { pts.push([sx, sy]); cx = sx; cy = sy; }
  }
  return pts;
}

export function bbox(segs) {
  const pts = flatten(segs);
  if (!pts.length) return { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/** Габарит набора сегментов с учётом матрицы перемещения/масштаба (мм). */
export function transformedBbox(segs, { dx = 0, dy = 0, scale = 1, sx = scale, sy = scale } = {}) {
  const b = bbox(segs);
  return { x0: b.x0 * sx + dx, y0: b.y0 * sy + dy, x1: b.x1 * sx + dx, y1: b.y1 * sy + dy, w: b.w * sx, h: b.h * sy };
}
