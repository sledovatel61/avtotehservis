/* Палитра и единицы. Источник — site/src/styles/tokens.css (только эти цвета). */
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

export const MM_PER_PT = 25.4 / 72;          // 1 pt = 0,3528 мм
export const PT_PER_MM = 72 / 25.4;          // 1 мм = 2,8346 pt
export const pt = (ptValue) => ptValue * MM_PER_PT; // пункты → миллиметры (для размеров шрифта)

/* Геометрия листа: 90×50 мм готовый размер + 3 мм вылета = 96×56 мм холст. */
export const SHEET = { w: 96, h: 56, bleed: 3, trimW: 90, trimH: 50, safe: 4 };

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}
export function rgbToHex([r, g, b]) {
  const f = (v) => Math.round(v * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${f(r)}${f(g)}${f(b)}`;
}
/* Наложение цвета с прозрачностью на фон — нужен для честного расчёта контраста. */
export function blend(fgHex, bgHex, alpha = 1) {
  const a = hexToRgb(fgHex), b = hexToRgb(bgHex);
  return rgbToHex([0, 1, 2].map((i) => a[i] * alpha + b[i] * (1 - alpha)));
}
function lin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(fgHex, bgHex, alpha = 1) {
  const fg = alpha < 1 ? blend(fgHex, bgHex, alpha) : fgHex;
  const L1 = luminance(fg), L2 = luminance(bgHex);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}
