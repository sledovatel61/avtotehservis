/* Круг 75: две обложки для статей-продолжений по материалам чата «Прошивка | SIM».

   Мастера лежат в docs/photos-source/r75/ (1672×941, PNG), сгенерированы по
   референсу r70 (тот же свет, тот же бокс) и отличаются от старых кадра
   и ракурсом, и цветом кузова — как требует владелец:
     voyah-art-update.png   — тёмно-зелёный, передняя три-четверти, ноутбук с диагностикой;
     voyah-art-connect.png  — шампань-серебристый, задняя три-четверти, телефон в кадре.

   Ширины, форматы и лимиты веса — те же, что у r70: 480/960/1600, AVIF + WebP,
   апскейла нет. Запуск: node scripts/build-voyah-art-r75.mjs

   Исходная версия скрипта (r70):
   «нужны новые картинки, старые не используем, разные ракурсы и разные цвета»).

   Мастера лежат в docs/photos-source/r70/ (1672×941, PNG):
     voyah-art-to.png       — белый Voyah Free, вид сзади-три-четверти, на двухстоечном подъёмнике;
     voyah-art-maslo.png    — тёмно-синий, капот открыт, канистра масла и воронка;
     voyah-art-bolezni.png  — графитовый, крупно передний тормозной диск и суппорт.

   Даёт по три ширины (480/960/1600) в AVIF + WebP — под srcset в разметке и под
   одиночный cover_static в списках «Полезного». Ширину сверх мастера не берём
   (апскейла нет), поэтому 2560 здесь не генерируется.

   Запуск: node site/scripts/build-voyah-art.mjs                */

import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../public/img');
const SRC = join(HERE, '../../docs/photos-source/r75');
mkdirSync(OUT, { recursive: true });

const WIDTHS = [480, 960, 1600];

const ART = {
  'vy-art-update': join(SRC, 'voyah-art-update.png'),
  'vy-art-connect': join(SRC, 'voyah-art-connect.png'),
  'vy-art-app': join(SRC, 'voyah-art-app.png'),
  'vy-art-media': join(SRC, 'voyah-art-media.png'),
};

/* Лимиты веса, КБ. Отталкиваемся от уже собранных webp (12/21/15, 31/63/45,
   73/153/116), avif ставим примерно на 35 % ниже. */
const CAPS = {
  480: { avif: 16, webp: 26 },
  960: { avif: 44, webp: 70 },
  1600: { avif: 92, webp: 165 },
};

function kb(path) {
  return statSync(path).size / 1024;
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
for (const [name, src] of Object.entries(ART)) {
  const meta = await sharp(src).metadata();
  for (const width of WIDTHS) {
    for (const format of ['avif', 'webp']) {
      report.push(await encode(name, src, width, format, CAPS[width][format]));
    }
  }
  report.push({ master: name, source: `${meta.width}×${meta.height}` });
}

for (const row of report) {
  if (row.master) console.log(`${row.master.padEnd(20)} мастер ${row.source}`);
  else console.log(`${row.file.padEnd(28)} ${String(row.kb).padStart(5)} КБ  q${row.quality}`);
}

const biggest = report.filter((r) => r.kb).sort((a, b) => b.kb - a.kb)[0];
/* Манифест r70 не перезаписываем: в нём лежат старые три кадра, а статьи на них
   ссылаются. Новые файлы пишем в отдельный манифест, чтобы ничего не сломать. */
writeFileSync(
  join(OUT, 'vy-art-r75-manifest.json'),
  JSON.stringify({ widths: WIDTHS, biggest, files: report.filter((r) => r.kb) }, null, 2) + '\n',
);
console.log(`\nсамый тяжёлый: ${biggest.file} — ${biggest.kb} КБ`);
