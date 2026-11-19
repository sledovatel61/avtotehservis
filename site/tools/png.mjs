/**
 * Минимальный энкодер PNG (RGB8, без чересстрочности) — 40 строк, ноль зависимостей.
 *
 * Вынесен сюда из `tools/bg3d/frames.mjs`, потому что писать картинки нужно не только
 * кадрам 3D-фона, но и замеру заставки (`scripts/measure-intro.mjs --png`). Две копии
 * энкодера в репозитории — ровно тот же порок, что и две копии профиля кузова
 * (задание №55, §1.3), только в малом масштабе.
 *
 * Проверка при выносе: `node tools/bg3d/frames.mjs --out /tmp/f` даёт байт в байт те же
 * PNG, что лежат в `evaluation/round30-bg-3d/frames/`.
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** @param rgb Uint8Array шириной width*height*3 (строки сверху вниз) */
export function encodePng(width, height, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   /* бит на канал */
  ihdr[9] = 2;   /* цвет: RGB */
  /* фильтр 0 (None) в начале каждой строки */
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3)
      .copy(raw, y * (width * 3 + 1) + 1);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
