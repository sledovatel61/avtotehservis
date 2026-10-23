/* Проверка safe-zone первого экрана (раунд 10): геометрия из safe-zone-geom.json
   (пишет сборщик), алгоритм — как браузер: object-fit:cover + object-position.
   Падает (exit 1), если bbox машин или bbox названия/телефонов вне видимой
   полосы, или если машины пересекают название. Вызывается из npm test. */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeZoneTable, safeZoneMobile } from './build-images.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const geom = JSON.parse(readFileSync(join(HERE, 'safe-zone-geom.json'), 'utf8'));
let fail = 0;
console.log('safe-zone десктоп:');
for (const r of safeZoneTable(geom.desk)) {
  const bad = r.cars === 'нет' || r.title === 'нет' || r.inter === 'да';
  if (bad) fail = 1;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${r.vp} герой ${r.hero} полоса ${r.band} машины ${r.cars} название ${r.title} пересечение ${r.inter}`);
}
console.log('safe-zone мобильные:');
for (const r of safeZoneMobile(geom.mob)) {
  if (r.title === 'нет') fail = 1;
  console.log(`${r.title === 'нет' ? 'FAIL' : 'ok  '} ${r.vp} полоса ${r.band} название ${r.title}`);
}
process.exit(fail);
