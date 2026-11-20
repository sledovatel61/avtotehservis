/* Локальные woff2 сайта → TrueType → глифы в кривых.
   Каждое начертание — пара сабсетов (кириллица + латиница): у них разные
   unicode-range, поэтому буква берётся из того файла, где она есть. */
import fs from 'node:fs/promises';
import path from 'node:path';
import opentype from 'opentype.js';

const SUBSETS = [
  ['unbounded-cyrillic-600.woff2', 'Unbounded', 600],
  ['unbounded-latin-600.woff2', 'Unbounded', 600],
  ['golos-cyrillic-400.woff2', 'Golos', 400],
  ['golos-latin-400.woff2', 'Golos', 400],
  ['golos-cyrillic-500.woff2', 'Golos', 500],
  ['golos-latin-500.woff2', 'Golos', 500],
  ['golos-cyrillic-700.woff2', 'Golos', 700],
  ['golos-latin-700.woff2', 'Golos', 700],
];

/* wawoff2 — Emscripten-модуль: при загрузке и при распаковке он пишет в stderr
   предупреждения про wasm streaming (это не ошибка, распаковка работает).
   Гасим только его болтовню, на время импорта и вызова. */
let wawoff2 = null;
async function quiet(fn) {
  const { warn, error, log } = console;
  console.warn = console.error = console.log = () => {};
  try { return await fn(); } finally { console.warn = warn; console.error = error; console.log = log; }
}

export async function loadFonts(fontsDir, { verbose = false } = {}) {
  const faces = {};
  const meta = [];
  if (!wawoff2) wawoff2 = (await quiet(() => import('wawoff2'))).default;
  for (const [file, family, weight] of SUBSETS) {
    const buf = await fs.readFile(path.join(fontsDir, file));
    const ttf = Buffer.from(await quiet(() => wawoff2.decompress(buf)));
    const otf = opentype.parse(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength));
    const cmap = otf.tables.cmap.glyphIndexMap;
    const key = `${family}:${weight}`;
    (faces[key] ??= []).push({ otf, file, has: (cp) => cmap[cp] !== undefined && cmap[cp] !== 0 });
    meta.push({ file, family, weight, chars: Object.keys(cmap).length, unitsPerEm: otf.unitsPerEm });
  }
  if (verbose) meta.forEach((m) => console.log(`  шрифт ${m.file}: ${m.family} ${m.weight}, upem ${m.unitsPerEm}, символов в cmap ${m.chars}`));
  return {
    faces,
    meta,
    face(family, weight, ch) {
      const list = faces[`${family}:${weight}`];
      if (!list) throw new Error(`нет начертания ${family} ${weight}`);
      const cp = ch.codePointAt(0);
      const f = list.find((x) => x.has(cp));
      if (!f) throw new Error(`в ${family} ${weight} нет символа «${ch}» (U+${cp.toString(16)})`);
      return f;
    },
    canRender(family, weight, text) {
      const miss = [];
      for (const ch of text) {
        if (ch === '\n') continue;
        const cp = ch.codePointAt(0);
        if (!faces[`${family}:${weight}`]?.some((x) => x.has(cp))) miss.push(ch);
      }
      return miss;
    },
  };
}
