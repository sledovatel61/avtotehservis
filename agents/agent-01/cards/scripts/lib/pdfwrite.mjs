/* Минимальный векторный PDF-писатель (без растра, без встроенных шрифтов:
   весь текст — в кривых). Умеет: контуры M/L/C/Q/A/Z, заливку и обводку,
   прозрачность, групповые трансформации, метки реза и Info-блок. */
import fs from 'node:fs/promises';
import { parsePath } from './svgpath.mjs';

const PT = 72 / 25.4;                    // мм → pt
const num = (v) => { const r = Math.round(v * 1000) / 1000; return Object.is(r, -0) ? '0' : String(r); };
const rgb = (hex) => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
};
const gsName = (a) => `GS${String(a).replace('.', '_')}`;

/* --- геометрия: дуга → кубические кривые --------------------------------- */
function arcToCubics(x1, y1, rx, ry, phiDeg, large, sweep, x2, y2) {
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (phiDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const numr = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, numr / den));
  const cxp = (coef * rx * y1p) / ry, cyp = (-coef * ry * x1p) / rx;
  const cxc = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cyc = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy, len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    return ux * vy - uy * vx < 0 ? -a : a;
  };
  const t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const out = [];
  for (let k = 0; k < segs; k++) {
    const a1 = t1 + (dt * k) / segs, a2 = t1 + (dt * (k + 1)) / segs;
    const al = (4 / 3) * Math.tan((a2 - a1) / 4);
    const P = (t) => [cos * rx * Math.cos(t) - sin * ry * Math.sin(t) + cxc, sin * rx * Math.cos(t) + cos * ry * Math.sin(t) + cyc];
    const D = (t) => [-cos * rx * Math.sin(t) - sin * ry * Math.cos(t), -sin * rx * Math.sin(t) + cos * ry * Math.cos(t)];
    const p1 = P(a1), p2 = P(a2), d1 = D(a1), d2 = D(a2);
    out.push([p1[0] + al * d1[0], p1[1] + al * d1[1], p2[0] - al * d2[0], p2[1] - al * d2[1], p2[0], p2[1]]);
  }
  return out;
}

/* --- контур: строки PDF-операторов в координатах листа (pt) -------------- */
export function contourOps(d, tf) {
  const out = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const P = (x, y) => { const p = tf(x, y); return `${num(p[0])} ${num(p[1])}`; };
  for (const c of parsePath(d)) {
    switch (c[0]) {
      case 'M': cx = c[1]; cy = c[2]; sx = cx; sy = cy; out.push(`${P(cx, cy)} m`); break;
      case 'L': cx = c[1]; cy = c[2]; out.push(`${P(cx, cy)} l`); break;
      case 'C': {
        const p1 = tf(c[1], c[2]), p2 = tf(c[3], c[4]), p3 = tf(c[5], c[6]);
        out.push(`${num(p1[0])} ${num(p1[1])} ${num(p2[0])} ${num(p2[1])} ${num(p3[0])} ${num(p3[1])} c`);
        cx = c[5]; cy = c[6]; break;
      }
      case 'Q': {
        // квадратичная → кубическая (контрольные точки 2/3 от текущей к Q)
        const x0 = cx, y0 = cy;
        const c1x = x0 + (2 / 3) * (c[1] - x0), c1y = y0 + (2 / 3) * (c[2] - y0);
        const c2x = c[3] + (2 / 3) * (c[1] - c[3]), c2y = c[4] + (2 / 3) * (c[2] - c[4]);
        const p1 = tf(c1x, c1y), p2 = tf(c2x, c2y), p3 = tf(c[3], c[4]);
        out.push(`${num(p1[0])} ${num(p1[1])} ${num(p2[0])} ${num(p2[1])} ${num(p3[0])} ${num(p3[1])} c`);
        cx = c[3]; cy = c[4]; break;
      }
      case 'A': {
        const [, rx, ry, rot, large, sweep, x2, y2] = c;
        for (const k of arcToCubics(cx, cy, rx, ry, rot, large, sweep, x2, y2)) {
          const p1 = tf(k[0], k[1]), p2 = tf(k[2], k[3]), p3 = tf(k[4], k[5]);
          out.push(`${num(p1[0])} ${num(p1[1])} ${num(p2[0])} ${num(p2[1])} ${num(p3[0])} ${num(p3[1])} c`);
        }
        cx = x2; cy = y2; break;
      }
      case 'Z': out.push('h'); cx = sx; cy = sy; break;
      default: break;
    }
  }
  return out.join('\n');
}

/* --- операция карточки → PDF ------------------------------------------------- */
function drawOp(o, tf, alphas, k = 1) {
  if (o.t === 'g') {
    const m = /translate\(([-\d.]+) ([-\d.]+)\)\s*scale\(([-\d.]+)\)/.exec(o.transform ?? '');
    const tf2 = m
      ? (x, y) => { const [, tx, ty, sc] = m.map(Number); return tf(tx + sc * x, ty + sc * y); }
      : tf;
    const k2 = m ? k * Number(m[3]) : k;
    const inner = o.children.map((c) => drawOp(c, tf2, alphas, k2)).filter(Boolean).join('\n');
    return `q\n${inner}\nQ`;
  }
  const fill = o.fill && o.fill !== 'none' ? rgb(o.fill) : null;
  const stroke = o.stroke && o.stroke !== 'none' ? rgb(o.stroke) : null;
  if (!fill && !stroke) return '';
  const fo = o.fillOpacity ?? 1, so = o.strokeOpacity ?? 1;
  const d = o.t === 'rect' ? rectPath(o) : o.t === 'circle' ? circlePath(o) : o.d;
  if (!d) return '';
  const lines = ['q'];
  if (fill && fo < 1) { alphas.add(fo); lines.push(`/${gsName(fo)} gs`); }
  if (stroke && so < 1) { alphas.add(so); lines.push(`/${gsName(so)} gs`); }
  if (stroke) {
    // толщина и штрих заданы в мм локальной системы: при переносе в pt
    // учитываем и мм→pt, и масштаб группы (у знака он 0,26–0,62)
    lines.push(`${num(o.sw * PT * k)} w 1 J 1 j`);
    if (o.dash) lines.push(`[${o.dash.split(/\s+/).map((v) => num(parseFloat(v) * PT * k)).join(' ')}] 0 d`);
    lines.push(`${num(stroke[0])} ${num(stroke[1])} ${num(stroke[2])} RG`);
  }
  if (fill) lines.push(`${num(fill[0])} ${num(fill[1])} ${num(fill[2])} rg`);
  lines.push(contourOps(d, tf));
  lines.push(fill && stroke ? 'B' : fill ? 'f' : 'S');
  lines.push('Q');
  return lines.join('\n');
}
function circlePath(o) {
  const { cx, cy, r } = o;
  const k = 0.5523 * r;
  return `M${cx - r} ${cy}C${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r}C${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy}C${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r}C${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy}Z`;
}
function rectPath(o) {
  const { x, y, w, h, rx = 0 } = o;
  if (!rx) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
  const a = `A${rx} ${rx} 0 0 1`;
  return `M${x + rx} ${y}H${x + w - rx}${a} ${x + w} ${y + rx}V${y + h - rx}${a} ${x + w - rx} ${y + h}H${x + rx}${a} ${x} ${y + h - rx}V${y + rx}${a} ${x + rx} ${y}Z`;
}

/* --- документ ---------------------------------------------------------------- */
/* pages: [{ ops, w=96, h=56, label }] — каждый лист это рабочий холст с вылетами. */
export async function writePdf(pages, file, info = {}) {
  const objects = []; // 1-based; объект 0 — каталог страниц, пишем отдельно
  const alphas = new Set();
  const contentOps = pages.map((p) => {
    const tf = (x, y) => [x * PT, (p.h - y) * PT];
    return { ...p, body: p.ops.map((o) => drawOp(o, tf, alphas)).filter(Boolean).join('\n') };
  });
  const alphaList = [...alphas].sort((a, b) => a - b);
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');   // 1 = Catalog
  objects.push(null);                                   // 2 = Pages (заполним ниже)
  const kids = [];
  const gsId = {};
  // экст-состояния прозрачности
  for (const a of alphaList) {
    gsId[a] = objects.length + 1;
    objects.push(`<< /Type /ExtGState /ca ${num(a)} /CA ${num(a)} >>`);
  }
  const fontId = null;
  for (const p of contentOps) {
    const contentId = objects.length + 1;
    const body = p.body;
    objects.push(`<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`);
    const pageId = objects.length + 1;
    const gsRes = alphaList.length
      ? `/ExtGState << ${alphaList.map((a) => `/${gsName(a)} ${gsId[a]} 0 R`).join(' ')} >>`
      : '';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.w * PT)} ${num(p.h * PT)}] /Resources << ${gsRes} >> /Contents ${contentId} 0 R >>`);
    kids.push(pageId);
  }
  objects[1] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] >>`;
  const infoId = objects.length + 1;
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  objects.push(`<< /Title (${esc(info.title ?? '')}) /Author (${esc(info.author ?? '')}) /Creator (${esc(info.creator ?? '')}) /Subject (${esc(info.subject ?? '')}) >>`);

  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  await fs.writeFile(file, Buffer.from(out, 'latin1'));
  return file;
}

/* --- метки реза: уголки по линии реза 90×50 внутри 96×56 -------------------- */
export function cropMarks({ w = 96, h = 56, bleed = 3, len = 3, gap = 0.6 } = {}) {
  const ops = [];
  const x0 = bleed, x1 = w - bleed, y0 = bleed, y1 = h - bleed;
  const add = (x1_, y1_, x2_, y2_) => ops.push({ t: 'path', d: `M${num(x1_)} ${num(y1_)}L${num(x2_)} ${num(y2_)}`, fill: 'none', stroke: '#000000', sw: 0.18, fillOpacity: 0, strokeOpacity: 0.55, dash: null, opacity: 1 });
  for (const [x, y, dx, dy] of [[x0, y0, -1, -1], [x1, y0, 1, -1], [x0, y1, -1, 1], [x1, y1, 1, 1]]) {
    add(x + dx * gap, y, x + dx * (gap + len), y);
    add(x, y + dy * gap, x, y + dy * (gap + len));
  }
  // линия реза — тонкий пунктир только по углам, чтобы не мешать оценке макета
  return ops;
}
