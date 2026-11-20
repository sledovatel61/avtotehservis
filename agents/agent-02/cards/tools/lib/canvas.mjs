/* Ядро: одна геометрия → SVG-макет, векторный PDF и PNG.
 *
 * Всё считается в миллиметрах в системе координат готового размера:
 * (0,0) — левый верхний угол реза, (90,50) — правый нижний.
 * Вылеты (3 мм) добавляются в viewBox, поэтому любая плашка рисуется от -3 до 93,
 * а текст и линии живут внутри 4..86 / 4..46.
 *
 * Текст всегда превращается в кривые (opentype.js): в макете нет ни одного <text>,
 * значит вёрстка не «поедет» ни в типографии, ни на чужой машине.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import PDFDocument from 'pdfkit';
import { textToPath, pt, ttfFiles } from './font.mjs';
import { parsePath, bbox } from './path.mjs';
import { qr as qrModel, qrPath, QR_QUIET_MODULES } from './qr.mjs';

export const TRIM_W = 90;
export const TRIM_H = 50;
export const BLEED = 3;
export const SAFE = 4;            // безопасная зона от линии реза
export const PX_PER_MM = 300 / 25.4; // 300 dpi

/* Палитра — site/src/styles/tokens.css, без добавлений */
export const C = {
  night: '#0B1410',
  deep: '#10201A',
  deep2: '#14281F',
  ivory: '#F4EFE6',
  mist: '#B7C4BB',
  copper: '#C87F45',
  brass: '#E0A96D',
  copperDark: '#9A5B2C',
};

const svgEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let clipSeq = 0;

export class Card {
  constructor({ bg, clip = true } = {}) {
    this.bg = bg || C.night;
    this.items = [];
    this.clipBleed = clip;
  }

  rect({ x, y, w, h, fill = 'none', stroke = 'none', sw = 0.25, rx = 0, opacity = 1, clip, role = 'shape', name }) {
    this.items.push({ kind: 'rect', x, y, w, h, fill, stroke, sw, rx, opacity, clip, role, name });
    return this;
  }

  /** Плашка на всю карточку вместе с вылетами. */
  plate(color = this.bg) {
    return this.rect({ x: -BLEED, y: -BLEED, w: TRIM_W + BLEED * 2, h: TRIM_H + BLEED * 2, fill: color, role: 'bg' });
  }

  rule({ x1, y1, x2, y2, color = C.brass, w = 0.25, opacity = 1, dash = null, role = 'shape', name }) {
    this.items.push({ kind: 'line', x1, y1, x2, y2, stroke: color, sw: w, opacity, dash, role, name });
    return this;
  }

  path({ d, fill = 'none', stroke = 'none', sw = 0.25, opacity = 1, clip, role = 'shape', name }) {
    this.items.push({ kind: 'path', d, fill, stroke, sw, opacity, clip, role, name });
    return this;
  }

  /**
   * Текст в кривые.
   * @param {object} o
   * @param {string} o.s текст
   * @param {'golos-400'|'golos-500'|'golos-700'|'unbounded-600'} o.face
   * @param {number} o.ptSize кегль в пунктах (в макете пересчитывается в мм)
   * @param {number} o.x @param {number} o.y базовая линия
   * @param {number} o.tracking разрядка в долях кегля (em)
   */
  async text({ s, face = 'golos-400', ptSize, x, y, anchor = 'start', fill = C.ivory, tracking = 0, opacity = 1, role = 'text', name, on = null }) {
    const sizeMm = pt(ptSize);
    const res = await textToPath(s, { weight: face, size: sizeMm, x, y, anchor, tracking: tracking * sizeMm });
    if (!res.d) return this;
    const segs = parsePath(res.d);
    const b = bbox(segs);
    this.items.push({
      kind: 'text', d: res.d, fill, opacity, segs,
      bbox: b,
      meta: { s, face, ptSize, x, y, anchor, tracking, width: res.width, bg: on || this.bg },
      role, name,
    });
    return this;
  }

  /** Знак из site/public/img/logo.svg — вложенным <svg>, пропорции не меняются. */
  logo({ x, y, w, opacity = 1, clip, mono = null, role = 'logo' }) {
    const src = fs.readFileSync(LOGO_FILE, 'utf8');
    const inner = src
      .replace(/^[\s\S]*?<svg[^>]*>/, '')
      .replace(/<\/svg>\s*$/, '');
    const idPrefix = `lg${clipSeq++}_`;
    const body = mono
      // одноцветный вариант: все заливки/обводки одним тоном (кроме «cut»-деталей)
      ? inner.replace(/(fill|stroke)="(url\(#[^)]+\)|#[0-9A-Fa-f]{3,6})"/g, (m, attr, val) => {
        if (MONO_CUT.has(val)) return `${attr}="${C.night}"`;
        return `${attr}="${mono}"`;
      })
      : inner;
    const withIds = body.replace(/id="([^"]+)"/g, (m, id) => `id="${idPrefix}${id}"`)
      .replace(/url\(#([^)]+)\)/g, (m, id) => `url(#${idPrefix}${id})`);
    const h = w * 44 / 72;
    this.items.push({ kind: 'logo', x, y, w, h, opacity, clip, body: withIds, mono, role });
    return this;
  }

  /** QR + тихая зона 4 модуля. Плашка светлая, код тёмный. */
  qr({ x, y, module = 0.5, plate = C.ivory, ink = C.night, url, rx = 0.8, role = 'qr' }) {
    const q = qrModel(url, { module });
    const plateW = q.plateMm;
    this.items.push({
      kind: 'qr', x, y, w: plateW, h: plateW, plate, ink, rx,
      q, d: qrPath(q, x + QR_QUIET_MODULES * module, y + QR_QUIET_MODULES * module),
      role,
    });
    return this;
  }

  /* ---------- SVG ---------- */

  toSVG({ widthPx = null } = {}) {
    const vx = -BLEED, vy = -BLEED, vw = TRIM_W + BLEED * 2, vh = TRIM_H + BLEED * 2;
    const pxW = widthPx ?? Math.round(vw * PX_PER_MM);
    const defs = [];
    const body = [];
    for (const it of this.items) {
      const op = it.opacity !== 1 ? ` opacity="${it.opacity}"` : '';
      if (it.kind === 'rect') {
        const r = it.rx ? ` rx="${it.rx}"` : '';
        const st = it.stroke !== 'none' ? ` stroke="${it.stroke}" stroke-width="${it.sw}"` : '';
        body.push(`<rect x="${f(it.x)}" y="${f(it.y)}" width="${f(it.w)}" height="${f(it.h)}"${r} fill="${it.fill}"${st}${op}/>`);
      } else if (it.kind === 'line') {
        const dash = it.dash ? ` stroke-dasharray="${it.dash}"` : '';
        body.push(`<line x1="${f(it.x1)}" y1="${f(it.y1)}" x2="${f(it.x2)}" y2="${f(it.y2)}" stroke="${it.stroke}" stroke-width="${it.sw}"${dash}${op} stroke-linecap="butt"/>`);
      } else if (it.kind === 'path') {
        const st = it.stroke !== 'none' ? ` stroke="${it.stroke}" stroke-width="${it.sw}"` : '';
        body.push(`<path d="${it.d}" fill="${it.fill}"${st}${op}/>`);
      } else if (it.kind === 'text') {
        body.push(`<path d="${it.d}" fill="${it.fill}"${op}/>`);
      } else if (it.kind === 'qr') {
        body.push(`<rect x="${f(it.x)}" y="${f(it.y)}" width="${f(it.w)}" height="${f(it.h)}" rx="${it.rx}" fill="${it.plate}"${op}/>`);
        body.push(`<path d="${it.d}" fill="${it.ink}" shape-rendering="crispEdges"/>`);
      } else if (it.kind === 'logo') {
        const id = `lgc${clipSeq++}`;
        if (it.clip) {
          defs.push(`<clipPath id="${id}"><rect x="${f(it.clip.x)}" y="${f(it.clip.y)}" width="${f(it.clip.w)}" height="${f(it.clip.h)}"/></clipPath>`);
        }
        const clipAttr = it.clip ? ` clip-path="url(#${id})"` : '';
        body.push(`<g${clipAttr}${op}><svg x="${f(it.x)}" y="${f(it.y)}" width="${f(it.w)}" height="${f(it.h)}" viewBox="0 0 72 44" preserveAspectRatio="xMidYMid meet">${it.body}</svg></g>`);
      }
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${pxW}" height="${Math.round(pxW * vh / vw)}" viewBox="${vx} ${vy} ${vw} ${vh}" role="img" aria-label="Визитка АвтоТехСервис">
<!-- 90×50 мм, вылеты 3 мм, безопасная зона 4 мм. Текст в кривых. Палитра и шрифты — как на ats-rostov.ru -->
<defs>${defs.join('')}</defs>
${body.join('\n')}
</svg>`;
  }

  toPNG({ scale = 1 } = {}) {
    const svg = this.toSVG();
    const r = new Resvg(svg, {
      fitTo: { mode: 'width', value: Math.round((TRIM_W + BLEED * 2) * PX_PER_MM * scale) },
      font: { fontFiles: ttfFiles(), loadSystemFonts: false },
      background: this.bg,
    });
    const png = r.render();
    const w = png.width, h = png.height;
    return { buffer: png.asPng(), width: w, height: h };
  }

  /* ---------- PDF ---------- */

  /** Векторный PDF: страница = готовый размер + вылеты + поля под метки реза.
   *  Внутри страницы ставится трансформация «1 единица = 1 мм», поэтому все
   *  координаты макета переносятся как есть, без пересчёта в пункты. */
  async toPDF(file, { title = '', cropMarks = true, note = '' } = {}) {
    const MARGIN = cropMarks ? 9 : 0; // 3 мм вылета + метки реза
    const pageW = TRIM_W + MARGIN * 2;
    const pageH = TRIM_H + MARGIN * 2 + (note ? 8 : 0);
    const doc = new PDFDocument({
      size: [mm(pageW), mm(pageH)],
      margin: 0,
      info: { Title: title, Creator: 'agent-02 cards generator', Subject: 'АвтоТехСервис — визитка 90×50' },
    });
    const out = fs.createWriteStream(file);
    doc.pipe(out);

    const PT_PER_MM = 72 / 25.4;
    doc.save();
    doc.translate(mm(MARGIN), mm(MARGIN));
    doc.scale(PT_PER_MM, PT_PER_MM);

    for (const it of this.items) {
      doc.save();
      if (it.opacity !== 1) doc.fillOpacity(it.opacity).strokeOpacity(it.opacity);
      if (it.clip) doc.rect(it.clip.x, it.clip.y, it.clip.w, it.clip.h);
      if (it.clip) doc.clip();
      if (it.kind === 'rect' || it.role === 'bg') {
        if (it.fill !== 'none') {
          doc.fillColor(it.fill);
          if (it.rx) doc.roundedRect(it.x, it.y, it.w, it.h, it.rx).fill();
          else doc.rect(it.x, it.y, it.w, it.h).fill();
        }
        if (it.stroke !== 'none') {
          doc.lineWidth(it.sw).strokeColor(it.stroke)
            .rect(it.x, it.y, it.w, it.h).stroke();
        }
      } else if (it.kind === 'line') {
        doc.lineWidth(it.sw).strokeColor(it.stroke)
          .moveTo(it.x1, it.y1).lineTo(it.x2, it.y2).stroke();
      } else if (it.kind === 'path' || it.kind === 'text') {
        drawPathMm(doc, parsePath(it.d), it.fill, it.stroke, it.sw || 0.25);
      } else if (it.kind === 'qr') {
        doc.fillColor(it.plate).roundedRect(it.x, it.y, it.w, it.h, it.rx).fill();
        drawPathMm(doc, parsePath(it.d), it.ink, 'none', 0);
      } else if (it.kind === 'logo') {
        drawLogo(doc, it);
      }
      doc.restore();
    }

    if (cropMarks) {
      doc.lineWidth(0.25).strokeColor('#000000');
      const L = 3, off = BLEED + 1.5;
      for (const [x, y, sx, sy] of [[0, 0, -1, -1], [TRIM_W, 0, 1, -1], [0, TRIM_H, -1, 1], [TRIM_W, TRIM_H, 1, 1]]) {
        doc.moveTo(x, y + sy * off).lineTo(x, y + sy * (off + L)).stroke();
        doc.moveTo(x + sx * off, y).lineTo(x + sx * (off + L), y).stroke();
      }
    }
    doc.restore();

    if (note) {
      doc.save();
      doc.fontSize(mm(2.6)).fillColor('#555555')
        .text(note, mm(MARGIN), mm(MARGIN + TRIM_H + BLEED + 2), { width: mm(TRIM_W), lineBreak: true, align: 'left' });
      doc.restore();
    }

    doc.end();
    await new Promise((res, rej) => { out.on('finish', res); out.on('error', rej); });
    return file;
  }

  /** Все текстовые элементы — для самопроверки. */
  texts() {
    return this.items.filter((i) => i.kind === 'text');
  }
}

const MONO_CUT = new Set(['#0D1914', '#0A120E', '#12221B', '#0E1B16']);

function f(n) {
  const v = Math.round(n * 1000) / 1000;
  return String(v);
}
const mm = (v) => (v * 72) / 25.4;

const LOGO_FILE = path.resolve(new URL('.', import.meta.url).pathname, '../../../../..', 'site/public/img/logo.svg');

/* Сегменты пути (мм) → pdfkit. Своя реализация, потому что парсер pdfkit
   спотыкается на дугах вида «A 6.6 6.6 0 0 0 …» из logo.svg. */
function drawPathMm(doc, segs, fill, stroke, sw) {
  doc.moveTo(0, 0); // pdfkit требует открыть путь
  for (const g of segs) {
    if (g[0] === 'M') doc.moveTo(g[1], g[2]);
    else if (g[0] === 'L') doc.lineTo(g[1], g[2]);
    else if (g[0] === 'C') doc.bezierCurveTo(g[1], g[2], g[3], g[4], g[5], g[6]);
    else if (g[0] === 'Q') doc.quadraticCurveTo(g[1], g[2], g[3], g[4]);
    else if (g[0] === 'Z') doc.closePath();
  }
  const hasFill = fill && fill !== 'none';
  const hasStroke = stroke && stroke !== 'none';
  if (hasStroke) doc.lineWidth(sw || 0.25).strokeColor(stroke);
  if (hasFill) doc.fillColor(fill);
  if (hasFill && hasStroke) doc.fillAndStroke(fill, stroke);
  else if (hasFill) doc.fill();
  else if (hasStroke) doc.stroke();
}

const LOGO_GRAD_FLAT = { shield: '#10201A', brass: '#E0A96D', body: '#E6E8E1', rim: '#C87F45' };

/* Логотип в PDF: контуры logo.svg в плоских цветах палитры.
   Градиенты исходника заменяются ближайшим тоном палитры — сводный PDF нужен для
   проверки геометрии и вылетов; печатный файл (SVG) сохраняет градиенты как есть. */
function drawLogo(doc, it) {
  const src = fs.readFileSync(LOGO_FILE, 'utf8');
  const scale = it.w / 72;
  const colorOf = (val) => {
    const m = /^url\(#([^)]+)\)$/.exec(val);
    if (m) return LOGO_GRAD_FLAT[m[1]] || '#E0A96D';
    return val;
  };
  doc.save();
  doc.translate(it.x, it.y);
  doc.scale(scale, scale);
  doc.rect(0, 0, 72, 44);
  doc.clip();
  const shapes = [];
  for (const m of src.matchAll(/<(path|rect|circle|line|polygon)\b([^>]*)\/?>/g)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    shapes.push({ tag: m[1], attrs });
  }
  for (const { tag, attrs } of shapes) {
    const fill = attrs.fill ? colorOf(attrs.fill) : (attrs.stroke ? 'none' : '#E6E8E1');
    const stroke = attrs.stroke ? colorOf(attrs.stroke) : 'none';
    const lw = attrs['stroke-width'] ? parseFloat(attrs['stroke-width']) : 0;
    doc.save();
    const fo = attrs['fill-opacity'] ? parseFloat(attrs['fill-opacity']) : 1;
    const so = attrs['stroke-opacity'] ? parseFloat(attrs['stroke-opacity']) : 1;
    doc.fillOpacity(fo * (it.opacity ?? 1)).strokeOpacity(so * (it.opacity ?? 1));
    if (tag === 'path') {
      drawPathMm(doc, parsePath(attrs.d), fill, stroke, lw);
    } else if (tag === 'rect') {
      const x = parseFloat(attrs.x || 0), y = parseFloat(attrs.y || 0);
      const w = parseFloat(attrs.width), h = parseFloat(attrs.height);
      const rx = attrs.rx ? parseFloat(attrs.rx) : 0;
      doc.lineWidth(lw);
      if (fill !== 'none') doc.fillColor(fill);
      if (stroke !== 'none') {
        doc.strokeColor(stroke);
        if (rx) doc.roundedRect(x, y, w, h, rx); else doc.rect(x, y, w, h);
        if (fill !== 'none') doc.fillAndStroke(fill, stroke); else doc.stroke();
      } else if (rx) doc.roundedRect(x, y, w, h, rx).fill();
      else doc.rect(x, y, w, h).fill();
    } else if (tag === 'circle') {
      const cx = parseFloat(attrs.cx), cy = parseFloat(attrs.cy), r = parseFloat(attrs.r);
      doc.lineWidth(lw);
      if (fill !== 'none') doc.fillColor(fill);
      if (stroke !== 'none') {
        doc.strokeColor(stroke);
        doc.circle(cx, cy, r);
        if (fill !== 'none') doc.fillAndStroke(fill, stroke); else doc.stroke();
      } else doc.circle(cx, cy, r).fill();
    } else if (tag === 'line') {
      doc.lineWidth(lw).strokeColor(stroke)
        .moveTo(parseFloat(attrs.x1), parseFloat(attrs.y1))
        .lineTo(parseFloat(attrs.x2), parseFloat(attrs.y2)).stroke();
    } else if (tag === 'polygon') {
      const pts = attrs.points.trim().split(/[\s,]+/).map(Number);
      doc.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) doc.lineTo(pts[i], pts[i + 1]);
      doc.closePath().fillColor(fill).fill();
    }
    doc.restore();
  }
  doc.restore();
}

export { svgEsc };
