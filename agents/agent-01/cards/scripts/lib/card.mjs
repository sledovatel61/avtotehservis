/* Контекст карточки: собирает операции, ведёт журнал текста для самопроверки
   (кегль, габариты, безопасная зона, контраст) и ставит QR. */
import { ops } from './ops.mjs';
import { textCmds, textLines, widthMm, mm, capMm, descMm } from './text.mjs';
import { contrast, C, SHEET } from './palette.mjs';
import { symbolOps } from './symbol.mjs';
import QRCode from 'qrcode';

const round = (v) => Math.round(v * 1000) / 1000;

export class Card {
  constructor({ id, side, bg, fonts, title }) {
    this.id = id; this.side = side; this.bg = bg; this.fonts = fonts;
    this.list = []; this.texts = []; this.title = title;
    this.rawSvg = []; this.defs = []; this.qrList = []; this.graphics = [];
  }
  /* Текст: контуры + запись в журнал. bg — цвет под текстом (для контраста). */
  T(text, o) {
    const { align = 'left', x, y, family = 'Golos', weight = 400, size = 7, tracking = 0, fill = C.ivory, label = '', bg = this.bg, allowLow = false } = o;
    const r = textCmds(this.fonts, text, { x, y, family, weight, size, tracking, align });
    this.list.push(ops.path(r.cmds, { fill }));
    this.texts.push({
      id: this.id, side: this.side, text, size, family, weight, align,
      x0: r.x0, x1: r.x1, left: r.x0, right: r.x1,
      top: y - capMm(size) * 1.02, bottom: y + descMm(size) * 1.02, baseline: y,
      color: fill, bg, contrast: contrast(fill, bg), label, allowLow,
    });
    return r;
  }
  TL(lines, o) {
    const { x, y, leading = 9, ...rest } = o;
    const r = textLines(this.fonts, lines, { x, y, leading, ...rest });
    this.list.push(ops.path(r.cmds, { fill: rest.fill ?? C.ivory }));
    const size = rest.size ?? 7;
    r.lines.forEach((ln, i) => {
      const by = y + mm(i * leading);
      this.texts.push({
        id: this.id, side: this.side, text: lines[i], size, family: rest.family ?? 'Golos', weight: rest.weight ?? 400, align: rest.align ?? 'left',
        x0: ln.x0, x1: ln.x1, left: ln.x0, right: ln.x1,
        top: by - capMm(size) * 1.02, bottom: by + descMm(size) * 1.02, baseline: by,
        color: rest.fill ?? C.ivory, bg: rest.bg ?? this.bg, contrast: contrast(rest.fill ?? C.ivory, rest.bg ?? this.bg),
        label: rest.label ? `${rest.label} · стр.${i + 1}` : lines[i], allowLow: rest.allowLow,
      });
    });
    return r;
  }
  /* Знак сайта: рисуем и записываем его габарит — чтобы проверка ловила
     наложение текста на знак, а не только текст на текст. */
  symbol({ x, y, scale, ...rest }) {
    const items = symbolOps({ x, y, scale, ...rest });
    this.list.push(...items);
    this.graphics.push({ label: `знак (${rest.variant ?? 'plate'})`, x0: x + scale, y0: y + scale, x1: x + 71 * scale, y1: y + 43 * scale });
    return this;
  }
  mark(label, b) { this.graphics.push({ label, ...b }); return this; }
  w(text, o) { return widthMm(this.fonts, o.family ?? 'Golos', o.weight ?? 400, text, o.size ?? 7, o.tracking ?? 0); }
  rect(...a) { this.list.push(ops.rect(...a)); return this; }
  circle(...a) { this.list.push(ops.circle(...a)); return this; }
  line(...a) { this.list.push(ops.line(...a)); return this; }
  path(cmds, o) { this.list.push(ops.path(cmds, o)); return this; }
  raw(d, o) { this.list.push(ops.raw(d, o)); return this; }
  push(...items) { this.list.push(...items.flat()); return this; }
  /* QR: тёмные модули на светлой плашке, тихая зона ≥ 4 модуля внутри плашки. */
  qr(url, { x, y, size = 12.5, color = C.night, plate = C.ivory, quietModules = 4 } = {}) {
    const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const N = qr.modules.size;
    const mod = size / N;
    const q = quietModules * mod;
    this.rect(x, y, size + 2 * q, size + 2 * q, { fill: plate });
    const rects = [];
    for (let row = 0; row < N; row++) for (let col = 0; col < N; col++) {
      if (qr.modules.data[row * N + col]) rects.push(`M${round(col * mod)} ${round(row * mod)}h${round(mod)}v${round(mod)}h${round(-mod)}z`);
    }
    this.list.push({ ...ops.raw(rects.join(''), { fill: color }), transform: `translate(${round(x + q)} ${round(y + q)})` });
    const box = { x, y, w: size + 2 * q, h: size + 2 * q, modules: N, moduleMm: mod, quietMm: q, url, plate, color };
    this.qrList.push(box);
    return box;
  }
}
