/**
 * Ядро проверки векторной марки Voyah.
 *
 * Эталон — docs/brand/voyah/source/logo-black-on-white.png (1536×864, RGBA):
 * единственный настоящий источник формы. site/public/img/vy-mark.png (512×733)
 * искажён по пропорции и эталоном НЕ является (см. metrics.md, §5).
 *
 * Система координат: пиксели эталона, y вниз. Каждый SVG проверяется в СВОЁМ
 * viewBox — поэтому у знака, лейбла и локапа свои метрики, а не «общие по локапу».
 */
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { decodePng } from './png.mjs';
import { parsePath, flattenSubpath } from './svg-path.mjs';

export function loadReference(pngPath) {
  const { width, height, rgba } = decodePng(readFileSync(pngPath));
  const alpha = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) alpha[i] = rgba[i * 4 + 3] / 255;
  return { width, height, rgba, alpha };
}

/** Границы «знак / зазор / лейбл» по горизонтальным пробелам альфа-канала. */
export function splitRows(ref, minGap = 20) {
  const { width, height, alpha } = ref;
  const has = new Uint8Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] > 0.5) { has[y] = 1; break; }
    }
  }
  const runs = [];
  let st = null;
  for (let y = 0; y < height; y++) {
    if (has[y] && st === null) st = y;
    if (!has[y] && st !== null) { runs.push([st, y - 1]); st = null; }
  }
  if (st !== null) runs.push([st, height - 1]);
  const gaps = [];
  for (let i = 0; i < runs.length - 1; i++) {
    gaps.push({ gap: runs[i + 1][0] - runs[i][1] - 1, markBottom: runs[i][1], labelTop: runs[i + 1][0] });
  }
  gaps.sort((a, b) => b.gap - a.gap);
  const best = gaps[0];
  if (!best || best.gap < minGap) throw new Error(`Не найден зазор знак/лейбл ≥ ${minGap} px`);
  return best;
}

/** bbox маски альфы в полосе строк [y0, y1). */
export function alphaBbox(ref, y0, y1, threshold = 0.5) {
  const { width, alpha } = ref;
  let x0 = Infinity; let yy0 = Infinity; let x1 = -Infinity; let yy1 = -Infinity;
  for (let y = y0; y < Math.min(y1, ref.height); y++) {
    for (let x = 0; x < width; x++) {
      if (alpha[y * width + x] < threshold) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < yy0) yy0 = y;
      if (y > yy1) yy1 = y;
    }
  }
  return [x0, yy0, x1, yy1];
}

export function loadSvg(svgPath) {
  const text = readFileSync(svgPath, 'utf8');
  const viewBoxStr = (text.match(/viewBox\s*=\s*"([^"]+)"/) || [])[1] || null;
  const paths = [...text.matchAll(/<path\b([^>]*)>/g)].map((m) => ({
    attrs: m[1],
    d: (m[1].match(/\bd\s*=\s*"([^"]*)"/) || [])[1] || '',
    fill: (m[1].match(/\bfill\s*=\s*"([^"]*)"/) || [])[1] || null,
    fillOpacity: (m[1].match(/\bfill-opacity\s*=\s*"([^"]*)"/) || [])[1] ?? null,
  }));
  return {
    text,
    viewBox: viewBoxStr,
    viewBoxNumbers: viewBoxStr ? viewBoxStr.trim().split(/[\s,]+/).map(Number) : null,
    paths,
    bytes: Buffer.byteLength(text, 'utf8'),
    gzipBytes: gzipSync(Buffer.from(text, 'utf8'), { level: 9 }).length,
    hasText: /<\s*(text|tspan|textPath)\b/i.test(text),
    hasFontAttr: /font-family|@font-face|font-size/i.test(text),
    hasMetadata: /<\s*(metadata|title|desc)\b|<!--/i.test(text),
  };
}

/**
 * Подпути SVG в координатах своего viewBox (не эталона!).
 * origin — смещение viewBox, чтобы получить координаты эталона при сравнении.
 */
export function svgSubpaths(svg) {
  const [vx, vy] = svg.viewBoxNumbers || [0, 0];
  const subs = [];
  for (const p of svg.paths) {
    for (const sp of parsePath(p.d)) {
      const pts = flattenSubpath(sp, 0.02).map(([x, y]) => [x + vx, y + vy]);
      const xs = pts.map((q) => q[0]);
      const ys = pts.map((q) => q[1]);
      subs.push({
        pts,
        fill: p.fill,
        fillOpacity: p.fillOpacity,
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

/** Субпиксельные точки границы эталона (переходы альфы через 0.5). */
export function referenceBoundary(ref, y0 = 0, y1 = null, x0 = 0, x1 = null) {
  const { width: W, height: H, alpha } = ref;
  const ya = Math.max(0, y0);
  const yb = Math.min(H - 1, y1 ?? H - 1);
  const xa = Math.max(0, x0);
  const xb = Math.min(W - 1, x1 ?? W - 1);
  const pts = [];
  const cross = (a, b) => (a < 0.5) !== (b < 0.5);
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x < xb; x++) {
      const a = alpha[y * W + x];
      const b = alpha[y * W + x + 1];
      if (cross(a, b)) pts.push([x + (0.5 - a) / (b - a), y + 0.5]);
    }
  }
  for (let x = xa; x <= xb; x++) {
    for (let y = ya; y < yb; y++) {
      const a = alpha[y * W + x];
      const b = alpha[(y + 1) * W + x];
      if (cross(a, b)) pts.push([x + 0.5, y + (0.5 - a) / (b - a)]);
    }
  }
  return pts;
}

export function vectorBoundary(subpaths, step = 0.25) {
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

/**
 * Точное расстояние «точка — ломаная»: сегменты разложены по сетке, поэтому
 * метрика не зависит от плотности выборки (нет квантования ~шаг/2).
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

export function makeGrid(points, cell = 8) {
  const key = (ix, iy) => ix * 73856093 ^ (iy * 19349663);
  const map = new Map();
  for (const p of points) {
    const ix = Math.floor(p[0] / cell);
    const iy = Math.floor(p[1] / cell);
    const k = key(ix, iy);
    let arr = map.get(k);
    if (!arr) map.set(k, (arr = []));
    arr.push(p);
  }
  return {
    nearest(px, py, maxR = 256) {
      const cx = Math.floor(px / cell);
      const cy = Math.floor(py / cell);
      let best = Infinity;
      let bestR = maxR;
      for (let r = 0; r <= Math.ceil(maxR / cell); r++) {
        if (best < (r - 1) * cell) break;
        for (let ix = cx - r; ix <= cx + r; ix++) {
          for (let iy = cy - r; iy <= cy + r; iy++) {
            if (Math.max(Math.abs(ix - cx), Math.abs(iy - cy)) !== r) continue;
            const arr = map.get(key(ix, iy));
            if (!arr) continue;
            for (const q of arr) {
              const d = Math.hypot(q[0] - px, q[1] - py);
              if (d < best) { best = d; bestR = Math.min(bestR, d); }
            }
          }
        }
      }
      return best;
    },
  };
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

/** Двусторонняя ошибка контура: эталон ↔ вектор. */
export function contourMetrics(refPts, vecSegGrid, vecPts, refPtGrid) {
  const refToVec = Float64Array.from(refPts.map((p) => vecSegGrid.nearest(p[0], p[1])));
  const vecToRef = Float64Array.from(vecPts.map((p) => refPtGrid.nearest(p[0], p[1])));
  return {
    stats: stats([...refToVec, ...vecToRef]),
    refToVec: stats(refToVec),
    vecToRef: stats(vecToRef),
  };
}

export function maskFromAlpha(alpha, threshold = 0.5) {
  const m = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) m[i] = alpha[i] >= threshold ? 1 : 0;
  return m;
}

export function countMask(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}

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
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
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

export function iouCounts(a, b, w, h) {
  let inter = 0;
  let union = 0;
  for (let y = 0; y < h * w; y++) {
    if (a[y] && b[y]) inter++;
    if (a[y] || b[y]) union++;
  }
  return { iou: union ? inter / union : 1, inter, union };
}

/**
 * Рендер SVG в координатах эталона: viewBox ставится в (originX, originY),
 * растр увеличивается в SCALE раз (суперсэмплинг), затем сводится к 1:1 по альфе.
 */
/**
 * Приведение SVG к «геометрии без цвета»: currentColor вне страницы не определён,
 * а fill-opacity у ghost скрыл бы контур. Для измерения формы заливка делается
 * сплошной чёрной, прозрачность снимается. Контраст проверяется по исходному файлу.
 */
export function normalizeForRender(svgText) {
  return svgText
    .replace(/fill="currentColor"/g, 'fill="#000000"')
    .replace(/fill-opacity="[^"]*"/g, '')
    .replace(/(<svg\b[^>]*?)\s+fill="[^"]*"/g, '$1')
    .replace(/<path\b(?![^>]*\bfill=)/g, '<path fill="#000000"');
}

export async function renderSvg(svgText, ref, originX, originY, scale = 4) {
  svgText = normalizeForRender(svgText);
  let resvg = null;
  try {
    resvg = await import('@resvg/resvg-js');
  } catch {
    resvg = null;
  }
  const W = ref.width;
  const H = ref.height;
  const alpha = new Float32Array(W * H);
  const cap = { width: 0, height: 0 };

  if (resvg) {
    const vb = (svgText.match(/viewBox\s*=\s*"([^"]+)"/) || [])[1];
    const [vx, vy, vw, vh] = vb.trim().split(/[\s,]+/).map(Number);
    const r = new resvg.Resvg(svgText, {
      fitTo: { mode: 'width', value: Math.round(vw * scale) },
      background: 'rgba(0,0,0,0)',
      font: { loadSystemFonts: false },
    });
    const img = r.render();
    const dec = decodePng(Buffer.from(img.asPng()));
    cap.width = dec.width;
    cap.height = dec.height;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const dx = Math.round((x - originX) * scale);
        const dy = Math.round((y - originY) * scale);
        if (dx < 0 || dy < 0 || dx >= dec.width || dy >= dec.height) continue;
        alpha[y * W + x] = dec.rgba[(dy * dec.width + dx) * 4 + 3] / 255;
      }
    }
    return { alpha, renderer: `resvg, ${scale}× суперсэмплинг`, cap };
  }

  const { rasterizeFill } = await import('./svg-path.mjs');
  const svg = loadSvgText(svgText);
  const subs = [];
  for (const p of svg.paths) for (const sp of parsePath(p.d)) subs.push({ pts: flattenSubpath(sp, 0.05) });
  const [vx, vy, vw, vh] = svg.viewBoxNumbers;
  const w = Math.max(1, Math.round(vw));
  const h = Math.max(1, Math.round(vh));
  // маска считается в координатах viewBox; содержимое SVG лежит в эталоне
  // со сдвигом (vx, vy) — кладём её туда же
  const ox = Math.round(vx);
  const oy = Math.round(vy);
  const mask = rasterizeFill(subs, w, h);
  cap.width = w;
  cap.height = h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const X = x + ox;
      const Y = y + oy;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      alpha[Y * W + X] = mask[y * w + x] ? 1 : 0;
    }
  }
  return { alpha, renderer: 'встроенный растеризатор (nonzero, 1:1)', cap };
}

function loadSvgText(text) {
  const vb = (text.match(/viewBox\s*=\s*"([^"]+)"/) || [])[1] || '0 0 1 1';
  const paths = [...text.matchAll(/<path\b([^>]*)>/g)].map((m) => ({
    d: (m[1].match(/\bd\s*=\s*"([^"]*)"/) || [])[1] || '',
    fill: (m[1].match(/\bfill\s*=\s*"([^"]*)"/) || [])[1] || null,
  }));
  return { viewBoxNumbers: vb.trim().split(/[\s,]+/).map(Number), paths };
}

// ------------------------------------------------------------------ контраст

const lin = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
export const luminance = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
export function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
