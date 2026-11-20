/* Рендер карточки: SVG-текст, PNG 600 dpi, базовая проверка чтения QR. */
import fs from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { svgDoc } from './ops.mjs';
import { SHEET } from './palette.mjs';

export async function toSvg(card, { extraGroups = [] } = {}) {
  return svgDoc({
    w: SHEET.w, h: SHEET.h,
    ops: card.list,
    defs: card.defs ?? [],
    rawGroups: [...(card.rawSvg ?? []), ...extraGroups],
    title: `${card.title}`,
    desc: 'Визитка АвтоТехСервис, Ростов-на-Дону, ул. Портовая, 439. Текст в кривых, шрифты Unbounded 600 и Golos Text.',
  });
}

export async function toPng(svg, { dpi = 600, file = null } = {}) {
  const width = Math.round((SHEET.w / 25.4) * dpi);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render().asPng();
  if (file) await fs.writeFile(file, png);
  return png;
}

/* QR проверяем на растре 300 dpi — как его увидит телефон с бумаги. */
export async function decodeQr(png, box, dpi = 600, { widthPx = null } = {}) {
  const img = sharp(png);
  const meta = await img.metadata();
  const k = meta.width / SHEET.w; // px на мм
  const pad = 2;
  const left = Math.max(0, Math.round((box.x - pad) * k));
  const top = Math.max(0, Math.round((box.y - pad) * k));
  const w = Math.min(meta.width - left, Math.round((box.w + pad * 2) * k));
  const h = Math.min(meta.height - top, Math.round((box.h + pad * 2) * k));
  const { data, info } = await sharp(png).extract({ left, top, width: w, height: h }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const res = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
  return res ? { ok: true, url: res.data } : { ok: false, url: null };
}
