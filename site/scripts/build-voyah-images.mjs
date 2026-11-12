/* Сборка изображений раздела «Voyah Free» (круг 28).
   Мастера лежат в mockups/r28/voyah/img/ (1400×781) — те же кадры, что в мокапе A6:
     hero.jpg    — кроссовер на подъёмнике в боксе;
     node.jpg    — крупно: рычаг/рулевая тяга в работе;
     evening.jpg — машина у сервиса вечером, отражение в луже.

   Правила (как в build-images.mjs):
     • без апскейла сверх ширины мастера: 960 берём из мастера, 1600/2560 — с
       fit:'cover' и sharpen;
     • каждый ассет — AVIF + WebP с лимитом веса; если лимит не проходит, качество
       снижается шагами по 6, но не ниже 10;
     • мобильный набор героя — 4:3 (portrait 4:5 обрезает корму).

   Запуск: node site/scripts/build-voyah-images.mjs */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../public/img');
const SRC = join(HERE, '../../mockups/r28/voyah/img');
mkdirSync(OUT, { recursive: true });

const NODE = join(SRC, 'node.jpg');
/* круг 29 (требование владельца «F»): знак марки ВОЗВРАЩЁН на обоих кадрах с
   машиной — не ретушью, а чистым металлическим знаком в нишу решётки.
   Мастеры создаёт site/scripts/brand-voyah-mark.mjs:
     hero    → docs/photos-source/r28/voyah-hero-mark.jpg
     evening → docs/photos-source/r28/voyah-evening-mark.jpg
   Прежняя ретушь (retouch-voyah-mark.mjs) удалена вместе с -clean. */
const HERO = join(HERE, '../../docs/photos-source/r28/voyah-hero-mark.jpg');
const EVENING = join(HERE, '../../docs/photos-source/r28/voyah-evening-mark.jpg');

const CAPS = {
  'vy-hero-960': { avif: 30, webp: 50 },
  'vy-hero-1600': { avif: 54, webp: 92 },
  'vy-hero-2560': { avif: 96, webp: 170 },
  'vy-hero-m-640': { avif: 26, webp: 42 },
  'vy-hero-m-960': { avif: 40, webp: 68 },
  'vy-node-640': { avif: 26, webp: 44 },
  'vy-node-960': { avif: 42, webp: 74 },
  'vy-evening-960': { avif: 28, webp: 46 },
  'vy-evening-1600': { avif: 52, webp: 90 },
};

async function encode(name, pipe, w, h) {
  const res = [];
  for (const fmt of ['avif', 'webp']) {
    let q = fmt === 'avif' ? 46 : 66;
    let buf;
    for (;;) {
      buf = await pipe.clone()[fmt]({ quality: q, effort: 4 }).toBuffer();
      if (buf.length / 1024 <= CAPS[name][fmt] || q <= 10) break;
      q -= 6;
    }
    writeFileSync(join(OUT, `${name}.${fmt}`), buf);
    res.push(`${name}.${fmt} ${w}×${h} ${(buf.length / 1024).toFixed(1)} КБ (лимит ${CAPS[name][fmt]}, q=${q})`);
  }
  return res;
}

const report = [];
const meta = async (f) => sharp(f).metadata();

const heroM = await meta(HERO);
const nodeM = await meta(NODE);
const eveM = await meta(EVENING);
console.log(`мастера: hero ${heroM.width}×${heroM.height}, node ${nodeM.width}×${nodeM.height}, evening ${eveM.width}×${eveM.height}`);

/* герой: широкий кадр (16:9 из мастера) */
report.push(...(await encode('vy-hero-960', sharp(HERO).resize({ width: 960, height: 540, fit: 'cover', position: 'attention' }).sharpen({ sigma: 0.5 }), 960, 540)));
report.push(...(await encode('vy-hero-1600', sharp(HERO).resize({ width: 1600, height: 900, fit: 'cover', position: 'attention' }).sharpen({ sigma: 0.6 }), 1600, 900)));
report.push(...(await encode('vy-hero-2560', sharp(HERO).resize({ width: 2560, height: 1440, fit: 'cover', position: 'attention' }).sharpen({ sigma: 0.7 }), 2560, 1440)));

/* герой мобильный: 4:3, центр кадра */
report.push(...(await encode('vy-hero-m-640', sharp(HERO).resize({ width: 640, height: 480, fit: 'cover', position: 'centre' }).sharpen({ sigma: 0.4 }), 640, 480)));
report.push(...(await encode('vy-hero-m-960', sharp(HERO).resize({ width: 960, height: 720, fit: 'cover', position: 'centre' }).sharpen({ sigma: 0.5 }), 960, 720)));

/* узел крупно: 4:3 */
report.push(...(await encode('vy-node-640', sharp(NODE).resize({ width: 640, height: 480, fit: 'cover', position: 'attention' }).sharpen({ sigma: 0.4 }), 640, 480)));
report.push(...(await encode('vy-node-960', sharp(NODE).resize({ width: 960, height: 720, fit: 'cover', position: 'attention' }).sharpen({ sigma: 0.5 }), 960, 720)));

/* вечер: 16:9 */
report.push(...(await encode('vy-evening-960', sharp(EVENING).resize({ width: 960, height: 540, fit: 'cover', position: 'centre' }).sharpen({ sigma: 0.5 }), 960, 540)));
report.push(...(await encode('vy-evening-1600', sharp(EVENING).resize({ width: 1600, height: 900, fit: 'cover', position: 'centre' }).sharpen({ sigma: 0.6 }), 1600, 900)));

console.log(`\nсобрано ${report.length} файлов в ${OUT}`);
for (const line of report) console.log('  ' + line);

/* проверка: все файлы на месте и читаются */
let bad = 0;
for (const name of Object.keys(CAPS)) {
  for (const fmt of ['avif', 'webp']) {
    const f = join(OUT, `${name}.${fmt}`);
    if (!existsSync(f)) { bad++; console.log(`FAIL нет ${name}.${fmt}`); continue; }
    const m = await sharp(f).metadata();
    if (!m.width || !m.height) { bad++; console.log(`FAIL битый ${name}.${fmt}`); }
  }
}
console.log(bad ? `\nПРОВАЛ: ${bad}` : '\nпроверка: 18 файлов на месте');
process.exit(bad ? 1 : 0);
