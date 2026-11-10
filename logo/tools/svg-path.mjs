/**
 * Минимальный парсер SVG path + заливка по правилу nonzero для подсчёта контурной ошибки.
 * Поддерживает M, m, L, l, H, h, V, v, C, c, S, s, Q, q, T, t, A, a, Z, z.
 * Никаких внешних зависимостей: файл проверки должен запускаться в голом Node.
 */

const NUM = /[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g;

export function parsePath(d) {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g) || [];
  const subpaths = [];
  let cur = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let cmd = null;
  let i = 0;
  let prevCubicCtrl = null;
  let prevQuadCtrl = null;

  const num = () => {
    const v = Number(tokens[i++]);
    if (!Number.isFinite(v)) throw new Error(`Ошибка разбора path: ожидалось число, токен ${tokens[i - 1]}`);
    return v;
  };

  const start = (px, py) => {
    cur = { start: [px, py], segments: [] };
    subpaths.push(cur);
    x = px;
    y = py;
    sx = px;
    sy = py;
  };

  while (i < tokens.length) {
    if (/^[MmLlHhVvCcSsQqTtAaZz]$/.test(tokens[i])) {
      cmd = tokens[i++];
    } else if (cmd === null) {
      throw new Error('Ошибка разбора path: первая команда должна быть M');
    }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;

    if (C === 'Z') {
      if (cur) cur.segments.push({ type: 'L', to: [sx, sy] });
      x = sx;
      y = sy;
      cur = null;
      prevCubicCtrl = prevQuadCtrl = null;
      cmd = null;
      continue;
    }

    if (C === 'M') {
      const nx = num() + ox;
      const ny = num() + oy;
      start(nx, ny);
      prevCubicCtrl = prevQuadCtrl = null;
      cmd = rel ? 'l' : 'L';
      continue;
    }

    if (!cur) throw new Error('Ошибка разбора path: сегмент до M');

    if (C === 'L' || C === 'H' || C === 'V') {
      let nx;
      let ny;
      if (C === 'L') {
        nx = num() + ox;
        ny = num() + oy;
      } else if (C === 'H') {
        nx = num() + ox;
        ny = y;
      } else {
        nx = x;
        ny = num() + oy;
      }
      cur.segments.push({ type: 'L', to: [nx, ny] });
      x = nx;
      y = ny;
      prevCubicCtrl = prevQuadCtrl = null;
    } else if (C === 'C' || C === 'S') {
      let c1;
      let c2;
      let p;
      if (C === 'C') {
        c1 = [num() + ox, num() + oy];
      } else {
        c1 = prevCubicCtrl ? [2 * x - prevCubicCtrl[0], 2 * y - prevCubicCtrl[1]] : [x, y];
      }
      c2 = [num() + ox, num() + oy];
      p = [num() + ox, num() + oy];
      cur.segments.push({ type: 'C', c1, c2, to: p });
      prevCubicCtrl = c2;
      prevQuadCtrl = null;
      x = p[0];
      y = p[1];
    } else if (C === 'Q' || C === 'T') {
      let c1;
      let p;
      if (C === 'Q') {
        c1 = [num() + ox, num() + oy];
      } else {
        c1 = prevQuadCtrl ? [2 * x - prevQuadCtrl[0], 2 * y - prevQuadCtrl[1]] : [x, y];
      }
      p = [num() + ox, num() + oy];
      cur.segments.push({ type: 'Q', c1, to: p });
      prevQuadCtrl = c1;
      prevCubicCtrl = null;
      x = p[0];
      y = p[1];
    } else if (C === 'A') {
      const rx = num();
      const ry = num();
      const rot = num();
      const large = num();
      const sweep = num();
      const p = [num() + ox, num() + oy];
      cur.segments.push({ type: 'A', rx, ry, rot, large: !!large, sweep: !!sweep, from: [x, y], to: p });
      prevCubicCtrl = prevQuadCtrl = null;
      x = p[0];
      y = p[1];
    } else {
      throw new Error(`Неизвестная команда path: ${cmd}`);
    }
  }
  return subpaths;
}

/** Плоский список точек (полилиния) для сегментов подпути. */
export function flattenSubpath(sub, tol = 0.02) {
  const pts = [sub.start.slice()];
  let cur = sub.start.slice();
  for (const s of sub.segments) {
    if (s.type === 'L') {
      pts.push(s.to.slice());
      cur = s.to.slice();
    } else if (s.type === 'C') {
      const n = Math.max(12, Math.ceil(Math.hypot(s.to[0] - cur[0], s.to[1] - cur[1]) / 0.4) + 12);
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const mt = 1 - t;
        pts.push([
          mt ** 3 * cur[0] + 3 * mt * mt * t * s.c1[0] + 3 * mt * t * t * s.c2[0] + t ** 3 * s.to[0],
          mt ** 3 * cur[1] + 3 * mt * mt * t * s.c1[1] + 3 * mt * t * t * s.c2[1] + t ** 3 * s.to[1],
        ]);
      }
      cur = s.to.slice();
    } else if (s.type === 'Q') {
      const n = Math.max(12, Math.ceil(Math.hypot(s.to[0] - cur[0], s.to[1] - cur[1]) / 0.4) + 12);
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const mt = 1 - t;
        pts.push([
          mt * mt * cur[0] + 2 * mt * t * s.c1[0] + t * t * s.to[0],
          mt * mt * cur[1] + 2 * mt * t * s.c1[1] + t * t * s.to[1],
        ]);
      }
      cur = s.to.slice();
    } else if (s.type === 'A') {
      for (const p of arcToPoints(s, tol)) pts.push(p);
      cur = s.to.slice();
    }
  }
  return pts;
}

export function arcToPoints(a, tol = 0.05) {
  const { rx, ry, rot, large, sweep, from, to } = a;
  if (rx === 0 || ry === 0) return [[...to]];
  const phi = (rot * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1 = cosP * dx + sinP * dy;
  const y1 = -sinP * dx + cosP * dy;
  let rxs = rx * rx;
  let rys = ry * ry;
  const lam = (x1 * x1) / rxs + (y1 * y1) / rys;
  let rX = rx;
  let rY = ry;
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rX *= s;
    rY *= s;
  }
  rxs = rX * rX;
  rys = rY * rY;
  const num = rxs * rys - rxs * y1 * y1 - rys * x1 * x1;
  const den = rxs * y1 * y1 + rys * x1 * x1;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rX * y1) / rY;
  const cyp = (-coef * rY * x1) / rX;
  const cx = cosP * cxp - sinP * cyp + (from[0] + to[0]) / 2;
  const cy = sinP * cxp + cosP * cyp + (from[1] + to[1]) / 2;
  const ang = (ux, uy, vx, vy) => {
    const d = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
    const a0 = Math.acos(Math.min(1, Math.max(-1, d)));
    return ux * vy - uy * vx < 0 ? -a0 : a0;
  };
  const theta1 = ang(1, 0, (x1 - cxp) / rX, (y1 - cyp) / rY);
  let dTheta = ang((x1 - cxp) / rX, (y1 - cyp) / rY, (-x1 - cxp) / rX, (-y1 - cyp) / rY);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
  const rMax = Math.max(rX, rY);
  const n = Math.max(4, Math.ceil(Math.abs(dTheta) / (2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / rMax))))));
  const out = [];
  for (let k = 1; k <= n; k++) {
    const t = theta1 + (dTheta * k) / n;
    const ex = rX * Math.cos(t);
    const ey = rY * Math.sin(t);
    out.push([cosP * ex - sinP * ey + cx, sinP * ex + cosP * ey + cy]);
  }
  out[out.length - 1] = [...to];
  return out;
}

/** Покрытие точкой по правилу nonzero (winding). */
export function windingAt(subpaths, px, py) {
  let w = 0;
  for (const sub of subpaths) {
    const p = sub.pts;
    for (let k = 0; k < p.length; k++) {
      const a = p[k];
      const b = p[(k + 1) % p.length];
      if (a[1] <= py) {
        if (b[1] > py && isLeft(a, b, px, py) > 0) w++;
      } else if (b[1] <= py && isLeft(a, b, px, py) < 0) w--;
    }
  }
  return w;
}

function isLeft(a, b, px, py) {
  return (b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1]);
}

/** Растеризация заливки: возвращает Uint8Array покрытия (1 = внутри). */
export function rasterizeFill(subpaths, w, h, ox = 0, oy = 0) {
  // подготовим рёбра всех подпутей
  const edges = [];
  for (const sub of subpaths) {
    const p = sub.pts;
    for (let k = 0; k < p.length; k++) {
      const a = p[k];
      const b = p[(k + 1) % p.length];
      if (a[1] !== b[1]) edges.push([a[0] - ox, a[1] - oy, b[0] - ox, b[1] - oy]);
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const py = y + 0.5;
    const xs = [];
    for (const e of edges) {
      const [x0, y0, x1, y1] = e;
      if ((y0 <= py && y1 > py) || (y1 <= py && y0 > py)) {
        xs.push([x0 + ((py - y0) / (y1 - y0)) * (x1 - x0), y1 > y0 ? 1 : -1]);
      }
    }
    xs.sort((a, b) => a[0] - b[0]);
    let wind = 0;
    for (let k = 0; k < xs.length - 1; k++) {
      wind += xs[k][1];
      if (wind !== 0) {
        const xa = Math.max(0, Math.ceil(xs[k][0] - 0.5));
        const xb = Math.min(w - 1, Math.floor(xs[k + 1][0] - 0.5));
        for (let x = xa; x <= xb; x++) out[y * w + x] = 1;
      }
    }
  }
  return out;
}

export { NUM };
