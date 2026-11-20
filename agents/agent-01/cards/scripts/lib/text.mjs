/* Текст → контуры (кривые). Кегль задаётся в пунктах типографики и переводится
   в миллиметры макета: «6 pt» на макете — это ровно 6 pt на печати. */
import { PT_PER_MM } from './palette.mjs';

export const mm = (ptValue) => ptValue / PT_PER_MM;
export const capMm = (size) => mm(size) * 0.72;  // высота прописных (с запасом)
export const descMm = (size) => mm(size) * 0.22; // выносные вниз

export function measure(fonts, family, weight, text, sizePt, trackingEm = 0) {
  let w = 0;
  const chars = [...text];
  chars.forEach((ch, i) => {
    const f = fonts.face(family, weight, ch);
    w += (f.otf.charToGlyph(ch).advanceWidth / f.otf.unitsPerEm) * sizePt;
    if (i < chars.length - 1) w += trackingEm * sizePt;
  });
  return w; // пункты
}
export const widthMm = (fonts, family, weight, text, sizePt, trackingEm = 0) =>
  mm(measure(fonts, family, weight, text, sizePt, trackingEm));

/* Контуры строки. (x,y) — начало базовой линии, y растёт вниз (SVG-логика).
   Возвращает { cmds, d, width, x0, x1 }. */
export function textCmds(fonts, text, o) {
  const { x = 0, y = 0, family = 'Golos', weight = 400, size = 7, tracking = 0, align = 'left' } = o;
  const width = mm(measure(fonts, family, weight, text, size, tracking));
  // pen — в миллиметрах; единицы шрифта (em) тоже переводим в мм:
  // кегль pt → мм, делим на unitsPerEm.
  let pen = align === 'center' ? -width / 2 : align === 'right' ? -width : 0;
  const cmds = [];
  for (const ch of [...text]) {
    const f = fonts.face(family, weight, ch);
    const g = f.otf.charToGlyph(ch);
    const s = (size / f.otf.unitsPerEm) / PT_PER_MM; // единицы шрифта → мм
    const X = (v) => x + pen + v * s;
    const Y = (v) => y - v * s;
    for (const c of g.path.commands) {
      if (c.type === 'M' || c.type === 'L') cmds.push({ c: c.type, p: [X(c.x), Y(c.y)] });
      else if (c.type === 'Q') cmds.push({ c: 'Q', p: [X(c.x1), Y(c.y1), X(c.x), Y(c.y)] });
      else if (c.type === 'C') cmds.push({ c: 'C', p: [X(c.x1), Y(c.y1), X(c.x2), Y(c.y2), X(c.x), Y(c.y)] });
      else if (c.type === 'Z') cmds.push({ c: 'Z', p: [] });
    }
    pen += s * g.advanceWidth + mm(tracking * size);
  }
  const x0 = x - (align === 'center' ? width / 2 : align === 'right' ? width : 0);
  return { cmds, d: toPathD(cmds), width, x0, x1: x0 + width };
}

/* Многострочный блок. leading — межстрочное расстояние в пунктах. */
export function textLines(fonts, lines, o) {
  const { x, y, leading = 9, ...rest } = o;
  const out = lines.map((line, i) => textCmds(fonts, line, { ...rest, x, y: y + mm(i * leading) }));
  return {
    cmds: out.flatMap((o2) => o2.cmds),
    lines: out,
    width: Math.max(...out.map((o2) => o2.width)),
    x0: Math.min(...out.map((o2) => o2.x0)),
    x1: Math.max(...out.map((o2) => o2.x1)),
  };
}

const fmt = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};
export function toPathD(cmds) {
  return cmds.map((c) => (c.c === 'Z' ? 'Z' : c.c + c.p.map(fmt).join(' '))).join('');
}
