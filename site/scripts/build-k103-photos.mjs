/* Круг 103: фотографии владельца (20.11.2026) для блока «Как выглядит сервис» на /about.
 *
 * Что делает: берёт выправленные кадры из `docs/photos-source/k103` (это уже обрезанные
 * до 4:3 версии исходников с телефона, номера машин закрыты) и собирает из них
 * адаптивные avif/webp 640 и 1280 для `site/public/img`.
 *
 * Почему отдельным скриптом, а не через `build-images.mjs`: тот собирает раунды 9–28
 * и завязан на мастера героя; эти три кадра к герою не относятся, а держать их
 * в общем сборщике — лишний риск сломать утверждённые кадры.
 *
 * Запуск: node site/scripts/build-k103-photos.mjs
 */
import { readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '../../docs/photos-source/k103');
const OUT = join(HERE, '../public/img');

/** Имя на сайте → файл мастера. Публичные имена без круга: они живут дольше задания. */
const PHOTOS = [
  { out: 'k103-facade', src: 'b-facade-front.jpg' },
  { out: 'k103-cars', src: 'a-facade-cars.jpg' },
  { out: 'k103-engine', src: 'c-vw-engine.jpg' },
  { out: 'k103-wheels', src: 'e-largus-wheels.jpg' },
];
const WIDTHS = [640, 1280];
const QUALITY = { avif: 52, webp: 80 };

export async function buildK103({ log = true } = {}) {
  const made = [];
  for (const photo of PHOTOS) {
    const srcPath = join(SRC, photo.src);
    try {
      statSync(srcPath);
    } catch {
      throw new Error(`Нет мастера ${srcPath} — положите кадры в docs/photos-source/k103`);
    }
    for (const width of WIDTHS) {
      const base = sharp(srcPath).rotate().resize({ width, withoutEnlargement: true });
      for (const fmt of ['avif', 'webp']) {
        const file = join(OUT, `${photo.out}-${width}.${fmt}`);
        await base
          .clone()
          .toFormat(fmt, fmt === 'avif' ? { quality: QUALITY.avif } : { quality: QUALITY.webp })
          .toFile(file);
        made.push(basename(file));
      }
    }
  }
  if (log) console.log(`Фото к103: ${made.length} файлов в ${OUT}`);
  return made;
}

const isMain = process.argv[1] && process.argv[1].endsWith('build-k103-photos.mjs');
if (isMain) {
  await buildK103();
  /* Подсказка для глаз: сколько всего webp/avif лежит рядом (не проверка, просто вывод). */
  const extra = readdirSync(OUT).filter((f) => f.startsWith('k103-')).length;
  console.log(`В public/img файлов k103-*: ${extra}`);
}
