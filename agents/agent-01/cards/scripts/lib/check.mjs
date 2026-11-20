/* Самопроверка макета без глаз: безопасная зона, пересечения блоков,
   минимальный кегль, контраст, QR. Возвращает список нарушений и таблицу. */
import { SHEET, C } from './palette.mjs';

export const SAFE = { x0: SHEET.bleed + 4, y0: SHEET.bleed + 4, x1: SHEET.w - SHEET.bleed - 4, y1: SHEET.h - SHEET.bleed - 4 };
const EPS = 0.02;

export function checkCard(card) {
  const out = { id: card.id, side: card.side, violations: [], warnings: [], stats: {} };
  const boxes = [];
  for (const t of card.texts) {
    if (t.allowLow) continue;
    const b = { kind: 'text', label: t.label, text: t.text, x0: t.x0, x1: t.x1, y0: t.top, y1: t.bottom };
    boxes.push(b);
    // 1. безопасная зона
    if (b.x0 < SAFE.x0 - EPS || b.x1 > SAFE.x1 + EPS || b.y0 < SAFE.y0 - EPS || b.y1 > SAFE.y1 + EPS) {
      out.violations.push(`вне безопасной зоны: «${t.label}» (${b.x0.toFixed(1)}…${b.x1.toFixed(1)} × ${b.y0.toFixed(1)}…${b.y1.toFixed(1)}), зона ${SAFE.x0}…${SAFE.x1} × ${SAFE.y0}…${SAFE.y1}`);
    }
    // 2. кегль
    if (t.size < 6 - 1e-9) out.violations.push(`кегль ${t.size} pt < 6 pt: «${t.label}»`);
    if (/\+7 \(\d{3}\)/.test(t.text) && t.size < 8 - 1e-9) out.violations.push(`телефон набран ${t.size} pt < 8 pt: «${t.text}»`);
    // 3. контраст
    if (t.contrast < 4.5) out.violations.push(`контраст ${t.contrast.toFixed(2)} < 4,5: «${t.label}» ${t.color} на ${t.bg}`);
  }
  // 4. QR
  for (const q of card.qrList) {
    boxes.push({ kind: 'qr', label: 'QR', x0: q.x, x1: q.x + q.w, y0: q.y, y1: q.y + q.h });
    if (q.x < SAFE.x0 || q.x + q.w > SAFE.x1 || q.y < SAFE.y0 || q.y + q.h > SAFE.y1) out.violations.push(`QR вне безопасной зоны`);
    if (q.moduleMm < 0.38) out.violations.push(`модуль QR ${q.moduleMm.toFixed(2)} мм < 0,38 мм`);
    if (q.modules * q.moduleMm < 12) out.violations.push(`сторона QR ${(q.modules * q.moduleMm).toFixed(1)} мм < 12 мм`);
    if (q.quietMm < q.moduleMm * 4 - 1e-6) out.violations.push('тихая зона QR меньше 4 модулей');
  }
  // 4б. соседние блоки в одной строке не должны слипаться (без зазора читается как одно слово)
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.kind !== 'text' || b.kind !== 'text') continue;
    const overlapY = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (overlapY <= EPS) continue;
    const gap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
    if (gap >= 0 && gap < 1.0) out.warnings.push(`зазор ${gap.toFixed(2)} мм между «${a.label}» и «${b.label}»`);
  }
  // 5. текст не должен лежать на графике (знак, плашки-картинки)
  for (const g of card.graphics ?? []) {
    for (const t of card.texts) {
      if (t.allowLow) continue;
      const ox = Math.min(t.x1, g.x1) - Math.max(t.x0, g.x0);
      const oy = Math.min(t.bottom, g.y1) - Math.max(t.top, g.y0);
      if (ox > EPS && oy > EPS) out.violations.push(`текст «${t.label}» лежит на графике «${g.label}» (${ox.toFixed(2)}×${oy.toFixed(2)} мм)`);
      else if (oy > EPS && ox > -1.0 && ox <= EPS) out.violations.push(`текст «${t.label}» вплотную к графике «${g.label}» (зазор ${(-ox).toFixed(2)} мм < 1 мм)`);
    }
  }
  // 6. пересечения блоков
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (ox > EPS && oy > EPS) {
      out.violations.push(`пересечение «${a.label}» × «${b.label}» (${ox.toFixed(2)}×${oy.toFixed(2)} мм)`);
    }
  }
  out.stats = {
    texts: card.texts.length,
    minSize: Math.min(...card.texts.map((t) => t.size)),
    minContrast: Math.min(...card.texts.map((t) => t.contrast)),
    qr: card.qrList.length,
    safe: `${SAFE.x0}–${SAFE.x1} × ${SAFE.y0}–${SAFE.y1}`,
  };
  return out;
}
