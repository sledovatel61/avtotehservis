/* Шрифты сайта → кривые.
 *
 * В репозитории лежат только .woff2-сабсеты (site/public/fonts). Типографии нужны
 * кривые, поэтому каждый текст превращается в контур через opentype.js:
 *  - woff2 распаковывается в .cache/*.ttf (нужно и для resvg, который woff2 не читает);
 *  - сабсеты раздельные (кириллица / латиница), поэтому для строки подбирается
 *    нужное начертание по наличию глифов: сначала кириллический сабсет, если в нём
 *    нет всех символов — латинский.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import wawoff2 from 'wawoff2';
import opentype from 'opentype.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '../../../../..');
export const SITE_FONTS = path.join(REPO_ROOT, 'site/public/fonts');
const CACHE = path.join(HERE, '..', '.cache');

/** Размер в pt → миллиметры (1 pt = 0,352778 мм). */
export const pt = (n) => n * 25.4 / 72;

const SUBSETS = {
  'golos-400': ['golos-cyrillic-400', 'golos-latin-400'],
  'golos-500': ['golos-cyrillic-500', 'golos-latin-500'],
  'golos-700': ['golos-cyrillic-700', 'golos-latin-700'],
  'unbounded-600': ['unbounded-cyrillic-600', 'unbounded-latin-600'],
};

const FAMILY = {
  'golos-400': 'Golos Text',
  'golos-500': 'Golos Text Medium',
  'golos-700': 'Golos Text',
  'unbounded-600': 'Unbounded SemiBold',
};

const cache = new Map();

function ttfPath(base) {
  fs.mkdirSync(CACHE, { recursive: true });
  return path.join(CACHE, base + '.ttf');
}

async function loadFace(base) {
  if (cache.has(base)) return cache.get(base);
  const woff = path.join(SITE_FONTS, base + '.woff2');
  const ttf = ttfPath(base);
  if (!fs.existsSync(ttf) || fs.statSync(ttf).mtimeMs < fs.statSync(woff).mtimeMs) {
    const buf = await wawoff2.decompress(fs.readFileSync(woff));
    fs.writeFileSync(ttf, buf);
  }
  const font = opentype.parse(
    fs.readFileSync(ttf).buffer.slice(0),
  );
  const face = { font, base, family: FAMILY[base.replace(/-(cyrillic|latin)-/, '-')] };
  cache.set(base, face);
  return face;
}

/** Все начертания сразу (для resvg-подписей коллажа и проверок). */
export async function loadAll() {
  const out = {};
  for (const key of Object.keys(SUBSETS)) out[key] = await loadFace(SUBSETS[key][0]);
  return out;
}

/** TTF-файлы на диске — для resvg (он woff2 не понимает). */
export function ttfFiles() {
  return Object.values(SUBSETS).flat().map(ttfPath).filter((f) => fs.existsSync(f));
}

export function covers(face, str) {
  const cmap = face.font.tables.cmap.glyphIndexMap;
  for (const ch of str) {
    if (ch === ' ' || ch === '\n') continue;
    if (!(ch.codePointAt(0) in cmap)) return false;
  }
  return true;
}

/** Подобрать начертание, в котором есть все символы строки. */
async function pickFace(weight, str) {
  for (const base of SUBSETS[weight]) {
    const face = await loadFace(base);
    if (covers(face, str)) return face;
  }
  throw new Error(`Нет глифов для «${str}» в начертании ${weight}`);
}

/**
 * Строка → один SVG-путь (d) в миллиметровых координатах.
 * size — кегль в мм, y — базовая линия, tracking — разрядка в мм на знак.
 */
export async function textToPath(str, { weight = 'golos-400', size, x, y, anchor = 'start', tracking = 0 }) {
  if (!str) return { d: '', width: 0, size };
  const glyphs = [];
  const faces = [];
  // строка может требовать двух сабсетов (кириллица + латиница) — режем на куски
  let run = '';
  let runFace = null;
  for (const ch of str) {
    const face = await pickFace(weight, ch);
    if (runFace && face.base !== runFace.base) {
      glyphs.push({ str: run, face: runFace });
      run = '';
    }
    runFace = face;
    run += ch;
  }
  if (run) glyphs.push({ str: run, face: runFace });

  const width = glyphs.reduce((acc, g) => {
    const chars = [...g.str];
    return acc
      + chars.reduce((s, ch) => s + g.face.font.getAdvanceWidth(ch, size), 0)
      + tracking * Math.max(0, chars.length - 1);
  }, 0) + tracking * Math.max(0, glyphs.length - 2);

  let cursor = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  const parts = [];
  for (const g of glyphs) {
    for (const ch of [...g.str]) {
      parts.push(g.face.font.getPath(ch, cursor, y, size).toPathData(3));
      cursor += g.face.font.getAdvanceWidth(ch, size) + tracking;
      faces.push(g.face);
    }
  }
  return { d: parts.join(' '), width, size, faces };
}

export function advance(faceKey, str, size) {
  const face = cache.get(SUBSETS[faceKey][0]);
  if (!face) throw new Error('font.mjs: сначала вызовите loadAll()/textToPath');
  return face.font.getAdvanceWidth(str, size);
}
