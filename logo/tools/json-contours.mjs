/**
 * Чтение logo/vy-mark-paths.json (контуры для 3D-экструзии) и превращение
 * сегментов (line / arc / cubic) в замкнутые полилинии в координатах растра-эталона.
 */
import { readFileSync } from 'node:fs';

const DEG = Math.PI / 180;

export function loadJsonPaths(path, offset = { x: 0, y: 0 }) {
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  const paths = doc.paths || [];
  const subpaths = [];
  let markCount = 0;
  let labelCount = 0;
  let holeCount = 0;
  let segmentCount = 0;

  for (const p of paths) {
    if (p.group === 'mark') markCount++;
    if (p.group === 'label') labelCount++;
    if (p.role === 'hole') holeCount++;
    const pts = [];
    for (const s of p.segments) {
      segmentCount++;
      if (s.type === 'line') {
        push(pts, s.from);
        push(pts, s.to, true);
      } else if (s.type === 'arc') {
        const { center: c, radius: R, sweep_deg: sw } = s;
        const a0 = (Math.atan2(s.from[1] - c[1], s.from[0] - c[0]) * 180) / Math.PI;
        const n = Math.max(24, Math.ceil(Math.abs(sw) / 0.5) + 24);
        for (let k = 0; k <= n; k++) {
          const a = (a0 + (sw * k) / n) * DEG;
          push(pts, [c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)], k > 0);
        }
      } else if (s.type === 'cubic') {
        const { p0, p1, p2, p3 } = s;
        const n = Math.max(24, Math.ceil(Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) / 0.4) + 24);
        push(pts, p0);
        for (let k = 1; k <= n; k++) {
          const t = k / n;
          const mt = 1 - t;
          push(
            pts,
            [
              mt ** 3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t ** 3 * p3[0],
              mt ** 3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t ** 3 * p3[1],
            ],
            true,
          );
        }
      } else {
        throw new Error(`Неизвестный тип сегмента в ${path}: ${s.type}`);
      }
    }
    if (pts.length < 3) throw new Error(`Контур ${p.name} вырожден`);
    const shifted = pts.map(([x, y]) => [x + offset.x, y + offset.y]);
    const xs = shifted.map((q) => q[0]);
    const ys = shifted.map((q) => q[1]);
    subpaths.push({
      name: p.name,
      pts: shifted,
      bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      group: p.group,
      role: p.role,
    });
  }
  return { doc, subpaths, markCount, labelCount, holeCount, segmentCount };
}

function push(pts, p, force = false) {
  if (!force && pts.length) {
    const q = pts[pts.length - 1];
    if (Math.abs(q[0] - p[0]) < 1e-9 && Math.abs(q[1] - p[1]) < 1e-9) return;
  }
  pts.push([p[0], p[1]]);
}
