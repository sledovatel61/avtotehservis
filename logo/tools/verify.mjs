/**
 * Ядро проверки векторного знака Voyah.
 *
 * Эталон: logo/vy-mark.png — файл владельца (Voyah_Logo-1536x864.png).
 * Вектор: logo/vy-logo.svg — viewBox «0 0 804 765», координата SVG = координата
 *         растра минус (366, 50). То есть пиксель растра (366+u, 50+v) = SVG (u, v).
 *
 * Метрика контура: набор субпиксельных точек границы эталона (переходы альфы
 * через 0.5 по строкам и столбцам) и аналитическая граница вектора (сплющенные
 * сегменты path). Для каждой точки считается расстояние до противоположной
 * границы; берётся среднее, 95-й процентиль и максимум в пикселях растра.
 */
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { decodePng } from './png.mjs';
import { parsePath, flattenSubpath } from './svg-path.mjs';

export const REF_OFFSET = { x: 366, y: 50 };

export function loadReference(pngPath) {
  const { width, height, rgba } = decodePng(readFileSync(pngPath));
  const alpha = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) alpha[i] = rgba[i * 4 + 3] / 255;
  return { width, height, rgba, alpha };
}

export function loadSvg(svgPath) {
  const text = readFileSync(svgPath, 'utf8');
  const viewBox = (text.match(/viewBox\s*=\s*"([^"]+)"/) || [])[1] || null;
  const paths = [...text.matchAll(/<path\b([^>]*)>/g)].map((m) => ({
    attrs: m[1],
    d: (m[1].match(/\bd\s*=\s*"([^"]*)"/) || [])[1] || '',
    fill: (m[1].match(/\bfill\s*=\s*"([^"]*)"/) || [])[1] || null,
  }));
  return {
    text,
    viewBox,
    viewBoxNumbers: viewBox ? viewBox.trim().split(/[\s,]+/).map(Number) : null,
    paths,
    bytes: Buffer.byteLength(text, 'utf8'),
    gzipBytes: gzipSync(Buffer.from(text, 'utf8'), { level: 9 }).length,
    hasText: /<\s*(text|tspan|textPath)\b/i.test(text),
    hasFontAttr: /font-family|@font-face|font-size/i.test(text),
  };
}

/** Все подпути SVG в координатах эталонного растра. */
export function vectorSubpaths(svg) {
  const subs = [];
  for (const p of svg.paths) {
    for (const sp of parsePath(p.d)) {
      const pts = flattenSubpath(sp, 0.02).map(([x, y]) => [x + REF_OFFSET.x, y + REF_OFFSET.y]);
      const xs = pts.map((q) => q[0]);
      const ys = pts.map((q) => q[1]);
      subs.push({
        pts,
        fill: p.fill,
        bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
        closed: true,
        segments: sp.segments.length,
        length: polylineLength(pts, true),
      });
    }
  }
  return subs;
}

export function polylineLength(pts, closed = false) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed) L += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  return L;
}

/** Субпиксельные точки границы по переходам альфы через 0.5. */
export function referenceBoundary(ref) {
  const { width: W, height: H, alpha } = ref;
  const pts = [];
  const cross = (a, b) => (a < 0.5) !== (b < 0.5);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      const a = alpha[y * W + x];
      const b = alpha[y * W + x + 1];
      if (cross(a, b)) {
        const t = (0.5 - a) / (b - a);
        pts.push([x + t, y + 0.5]);
      }
    }
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H - 1; y++) {
      const a = alpha[y * W + x];
      const b = alpha[(y + 1) * W + x];
      if (cross(a, b)) {
        const t = (0.5 - a) / (b - a);
        pts.push([x + 0.5, y + t]);
      }
    }
  }
  return pts;
}

/** Плотная выборка границы вектора (шаг ~0.5 px). */
export function vectorBoundary(subpaths, step = 0.5) {
  const pts = [];
  for (const sp of subpaths) {
    const p = sp.pts;
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.ceil(L / step));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
  }
  return pts;
}

/**
 * Точное расстояние «точка — ломаная»: сегменты раскладываются по сетке,
 * поэтому метрика не зависит от плотности выборки (нет квантования ~шаг/2).
 */
export function makeSegmentGrid(points, cell = 8) {
  const key = (ix, iy) => ix * 73856093 ^ (iy * 19349663);
  const map = new Map();
  const segs = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const id = segs.length;
    segs.push([a[0], a[1], b[0], b[1]]);
    const x0 = Math.floor(Math.min(a[0], b[0]) / cell);
    const x1 = Math.floor(Math.max(a[0], b[0]) / cell);
    const y0 = Math.floor(Math.min(a[1], b[1]) / cell);
    const y1 = Math.floor(Math.max(a[1], b[1]) / cell);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const k = key(ix, iy);
        let arr = map.get(k);
        if (!arr) map.set(k, (arr = []));
        arr.push(id);
      }
    }
  }
  return {
    nearest(px, py, maxR = 256) {
      const cx = Math.floor(px / cell);
      const cy = Math.floor(py / cell);
      let best = Infinity;
      for (let r = 0; r <= Math.ceil(maxR / cell); r++) {
        if (best <= (r - 1) * cell) break;
        for (let ix = cx - r; ix <= cx + r; ix++) {
          for (let iy = cy - r; iy <= cy + r; iy++) {
            if (Math.max(Math.abs(ix - cx), Math.abs(iy - cy)) !== r) continue;
            const arr = map.get(key(ix, iy));
            if (!arr) continue;
            for (const id of arr) {
              const s = segs[id];
              const d = segDist(px, py, s[0], s[1], s[2], s[3]);
              if (d < best) best = d;
            }
          }
        }
      }
      return best;
    },
  };
}

export function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const L2 = vx * vx + vy * vy;
  let t = L2 > 0 ? (wx * vx + wy * vy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(wx - vx * t, wy - vy * t);
}

/** Ускоритель поиска ближайшей точки: сетка со стороной ячейки cell. */
export function makeGrid(points, cell = 8) {
  const map = new Map();
  const key = (ix, iy) => ix * 73856093 ^ (iy * 19349663);
  for (const p of points) {
    const ix = Math.floor(p[0] / cell);
    const iy = Math.floor(p[1] / cell);
    const k = key(ix, iy);
    let arr = map.get(k);
    if (!arr) map.set(k, (arr = []));
    arr.push(p);
  }
  return {
    nearest(px, py, maxR = 128) {
      const cx = Math.floor(px / cell);
      const cy = Math.floor(py / cell);
      let best = Infinity;
      let bestR = maxR;
      for (let r = 0; r <= Math.ceil(maxR / cell); r++) {
        // если уже нашли точку ближе, чем гарантированный радиус обхода — выходим
        if (best < (r - 1) * cell) break;
        for (let ix = cx - r; ix <= cx + r; ix++) {
          for (let iy = cy - r; iy <= cy + r; iy++) {
            if (Math.max(Math.abs(ix - cx), Math.abs(iy - cy)) !== r) continue;
            const arr = map.get(key(ix, iy));
            if (!arr) continue;
            for (const q of arr) {
              const d = Math.hypot(q[0] - px, q[1] - py);
              if (d < best) {
                best = d;
                bestR = Math.min(bestR, d);
              }
            }
          }
        }
      }
      return best;
    },
  };
}

export function contourMetrics(refPts, refGrid, vecPts, vecGrid) {
  const dRefToVec = new Float64Array(refPts.length);
  for (let i = 0; i < refPts.length; i++) dRefToVec[i] = vecGrid.nearest(refPts[i][0], refPts[i][1]);
  const dVecToRef = new Float64Array(vecPts.length);
  for (let i = 0; i < vecPts.length; i++) dVecToRef[i] = refGrid.nearest(vecPts[i][0], vecPts[i][1]);
  const all = [...dRefToVec, ...dVecToRef];
  return { stats: stats(all), refToVec: stats(dRefToVec), vecToRef: stats(dVecToRef) };
}

export function stats(arr) {
  const a = Array.from(arr).filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return { n: 0, mean: NaN, p95: NaN, max: NaN, median: NaN };
  const sum = a.reduce((s, v) => s + v, 0);
  return {
    n: a.length,
    mean: sum / a.length,
    median: a[Math.floor(a.length / 2)],
    p95: a[Math.min(a.length - 1, Math.floor(a.length * 0.95))],
    max: a[a.length - 1],
  };
}

/** Маска покрытия из альфы (порог 50 %). */
export function maskFromAlpha(alpha, threshold = 0.5) {
  const m = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) m[i] = alpha[i] >= threshold ? 1 : 0;
  return m;
}

export function iou(a, b, w, h) {
  let inter = 0;
  let uni = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (a[i] && b[i]) inter++;
      if (a[i] || b[i]) uni++;
    }
  }
  return { iou: uni ? inter / uni : 1, inter, union: uni };
}

export function countMask(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}

/** Раздутие маски квадратом (2r+1) в метрике Чебышёва. */
export function dilate(mask, w, h, r) {
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let d = -r; d <= r; d++) {
        const xx = x + d;
        if (xx >= 0 && xx < w) tmp[y * w + xx] = 1;
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!tmp[y * w + x]) continue;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        if (yy >= 0 && yy < h) out[yy * w + x] = 1;
      }
    }
  }
  return out;
}

/** Каждая маска должна лежать внутри раздутой другой — покрытие с допуском. */
export function toleranceCoverage(a, b, w, h, r) {
  const da = dilate(a, w, h, r);
  const db = dilate(b, w, h, r);
  let refMissed = 0;
  let vecMissed = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && !db[i]) refMissed++;
    if (b[i] && !da[i]) vecMissed++;
  }
  return { refMissed, vecMissed };
}

export function bboxOfMask(mask, w, h) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return [x0, y0, x1, y1];
}

/**
 * Рендер SVG в RGBA в координатах растра-эталона.
 * Основной путь — resvg (настоящий SVG-рендерер). Если его нет — встроенный
 * растеризатор по nonzero (см. svg-path.mjs), чтобы проверка не падала без npm install.
 */
export async function renderSvg(svgText, width, height, offset = REF_OFFSET, scale = 1) {
  let resvg = null;
  try {
    resvg = await import('@resvg/resvg-js');
  } catch {
    resvg = null;
  }
  if (resvg) {
    const vb = (svgText.match(/viewBox\s*=\s*"([^"]+)"/) || [])[1];
    const vbW = vb ? Number(vb.trim().split(/[\s,]+/)[2]) : width - offset.x;
    const r = new resvg.Resvg(svgText, {
      fitTo: { mode: 'width', value: Math.round(vbW * scale) },
      background: 'rgba(0,0,0,0)',
      font: { loadSystemFonts: false },
    });
    const png = r.render().asPng();
    const dec = decodePng(Buffer.from(png));
    const out = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x < offset.x || y < offset.y) continue;
        const dx = Math.round((x - offset.x) * scale);
        const dy = Math.round((y - offset.y) * scale);
        if (dx < 0 || dy < 0 || dx >= dec.width || dy >= dec.height) continue;
        out[y * width + x] = dec.rgba[(dy * dec.width + dx) * 4 + 3] / 255;
      }
    }
    return { alpha: out, renderer: `resvg ${resvg.Resvg ? 'ok' : ''}`.trim() };
  }
  const { rasterizeFill } = await import('./svg-path.mjs');
  const subs = [];
  for (const p of svgText.match(/<path\b[^>]*>/g) || []) {
    const d = (p.match(/\bd\s*=\s*"([^"]*)"/) || [])[1] || '';
    for (const sp of parsePath(d)) subs.push({ pts: flattenSubpath(sp, 0.05) });
  }
  const w = width - offset.x;
  const h = height - offset.y;
  const mask = rasterizeFill(subs, w, h);
  const out = new Float32Array(width * height);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[(y + offset.y) * width + (x + offset.x)] = mask[y * w + x] ? 1 : 0;
    }
  }
  return { alpha: out, renderer: 'встроенный растеризатор (nonzero)' };
}

/** Проверка, что JSON-контуры дают ту же геометрию, что и SVG. */
export function boundaryDistance(ptsA, ptsB, gridB, gridA) {
  let sum = 0;
  let max = 0;
  for (const p of ptsA) {
    const d = gridB.nearest(p[0], p[1]);
    sum += d;
    if (d > max) max = d;
  }
  for (const p of ptsB) {
    const d = gridA.nearest(p[0], p[1]);
    sum += d;
    if (d > max) max = d;
  }
  return { mean: sum / (ptsA.length + ptsB.length), max };
}
