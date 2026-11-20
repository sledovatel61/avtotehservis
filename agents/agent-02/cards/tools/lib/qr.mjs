/* QR-код: матрица из пакета qrcode, геометрия — в миллиметрах.
 * Тихая зона не «на глаз», а ровно 4 модуля: она входит в плату-подложку. */
import QRCode from 'qrcode';

export const QR_QUIET_MODULES = 4;

/** @returns {{size:number, data:Uint8Array, module:number, mm:number, plateMm:number}} */
export function qr(text, { module = 0.48, ecLevel = 'M' } = {}) {
  const q = QRCode.create(text, { errorCorrectionLevel: ecLevel });
  const size = q.modules.size;
  const data = q.modules.data;
  const mm = size * module; // размер собственно кода, без тихой зоны
  const plateMm = (size + QR_QUIET_MODULES * 2) * module;
  return { size, data, module, mm, plateMm, text };
}

/** Путь из тёмных модулей (без тихой зоны), начало — левый верхний угол кода. */
export function qrPath(q, x, y) {
  const parts = [];
  const m = q.module;
  for (let r = 0; r < q.size; r++) {
    let c = 0;
    while (c < q.size) {
      if (!q.data[r * q.size + c]) { c++; continue; }
      let c2 = c;
      while (c2 + 1 < q.size && q.data[r * q.size + c2 + 1]) c2++;
      const w = (c2 - c + 1) * m;
      parts.push(`M${(x + c * m).toFixed(3)} ${(y + r * m).toFixed(3)}h${w.toFixed(3)}v${m.toFixed(3)}h${(-w).toFixed(3)}z`);
      c = c2 + 1;
    }
  }
  return parts.join('');
}
