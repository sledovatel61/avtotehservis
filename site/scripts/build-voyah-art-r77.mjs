/* Круг 77: нарезка кадров агента в webp/avif.

   Агент кладёт мастер-кадры в docs/photos-source/r77/ (JPEG или PNG, 16:9), имена —
   как в таблице ART ниже. Скрипт делает 480/960/1600 в AVIF и WebP без апскейла и
   пишет манифест с весами. Ширины и лимиты веса — те же, что у r70 и r75.

   Запуск из site/:  node scripts/build-voyah-art-r77.mjs                 */

import { writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../public/img');
const SRC = join(HERE, '../../docs/photos-source/r77');
mkdirSync(OUT, { recursive: true });

const WIDTHS = [480, 960, 1600];

/* Имя ассета → мастер. Порядок и назначение — по заданию круга 77. */
const ART = {
  'vy-art-to-lift': 'voyah-art-to-lift',
  'vy-art-maslo-page': 'voyah-art-maslo-page',
  'vy-art-bolezni-page': 'voyah-art-bolezni-page',
  'vy-art-intervaly': 'voyah-art-intervaly',
  'vy-art-momenty': 'voyah-art-momenty',
  'vy-art-hodovaya': 'voyah-art-hodovaya',
  'vy-art-kondicioner': 'voyah-art-kondicioner',
  'vy-art-zapravka': 'voyah-art-zapravka',
  /* четыре обложки круга 75 — перегенерация, если нос машины в кадре неверный */
  'vy-art-update': 'voyah-art-update',
  'vy-art-connect': 'voyah-art-connect',
  'vy-art-app': 'voyah-art-app',
  'vy-art-media': 'voyah-art-media',
};

const CAPS = {
  480: { avif: 16, webp: 26 },
  960: { avif: 44, webp: 70 },
  1600: { avif: 92, webp: 165 },
};

const kb = (p) => statSync(p).size / 1024;

function findMaster(base) {
  for (const ext of ['png', 'jpg', 'jpeg', 'PNG', 'JPG']) {
    const p = join(SRC, `${base}.${ext}`);
    if (existsSync(p)) return p;
  }
  return null;
}

async function encode(name, src, width, format, cap) {
  let quality = format === 'avif' ? 58 : 80;
  let out;
  for (;;) {
    out = join(OUT, `${name}-${width}.${format}`);
    const pipe = sharp(src).resize({ width, withoutEnlargement: true });
    if (format === 'avif') await pipe.avif({ quality, effort: 6 }).toFile(out);
    else await pipe.webp({ quality, effort: 6 }).toFile(out);
    if (kb(out) <= cap || quality <= 12) break;
    quality -= 6;
  }
  return { file: `${name}-${width}.${format}`, kb: Math.round(kb(out)), quality };
}

const report = [];
const missing = [];
for (const [name, base] of Object.entries(ART)) {
  const src = findMaster(base);
  if (!src) {
    missing.push(name);
    continue;
  }
  const meta = await sharp(src).metadata();
  if (Math.abs(meta.width / meta.height - 16 / 9) > 0.12) {
    console.warn(`! ${name}: пропорции ${meta.width}×${meta.height}, ждём ~16:9`);
  }
  if (meta.width < 1600) {
    console.warn(`! ${name}: мастер ${meta.width} px — 1600 апскейлом не доберём, будет меньше`);
  }
  for (const width of WIDTHS) {
    for (const format of ['avif', 'webp']) {
      report.push(await encode(name, src, width, format, CAPS[width][format]));
    }
  }
  report.push({ master: name, source: `${meta.width}×${meta.height}` });
}

for (const row of report) {
  if (row.master) console.log(`${row.master.padEnd(22)} мастер ${row.source}`);
  else console.log(`${row.file.padEnd(32)} ${String(row.kb).padStart(5)} КБ  q${row.quality}`);
}

if (missing.length) console.log(`\nнет мастеров: ${missing.join(', ')}`);

if (report.length) {
  const biggest = report.filter((r) => r.kb).sort((a, b) => b.kb - a.kb)[0];
  writeFileSync(
    join(OUT, 'vy-art-r77-manifest.json'),
    JSON.stringify({ widths: WIDTHS, biggest, missing, files: report.filter((r) => r.kb) }, null, 2) + '\n',
  );
  console.log(`\nсамый тяжёлый: ${biggest.file} — ${biggest.kb} КБ`);
}
