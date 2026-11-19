/**
 * Круг 86: генерация site/public/manage/price-refs.json (или произвольного outFile).
 * Запуск: node scripts/build-price-refs.mjs [outFile]
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePriceRefs } from './lib/price-refs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(HERE, '..');
const outFile = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : join(siteRoot, 'public/manage/price-refs.json');

const report = await writePriceRefs({ siteRoot, outFile });
const refItems = Object.keys(report.refs).length;
const featItems = Object.keys(report.featured).length;
console.log(`[price-refs] записано в ${outFile} (позиций со ссылками: ${refItems}, плашек featured: ${featItems})`);
