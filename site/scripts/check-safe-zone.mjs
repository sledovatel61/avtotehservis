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
  /* раунд 15: проверка снова может упасть — машины, вывеска и пересечение считаются по числам */
  const bad = r.cars === 'нет' || r.title === 'нет';
  if (bad) fail = 1;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${r.vp} полоса ${r.band} машины ${r.cars} вывеска ${r.title} (пересечение ${r.inter}: текст под кадром)`);
}
/* раунд 15: самопроверка гейта на мутантах — проверка обязана падать, если машины
   или вывеска вылезли за кадр (иначе она снова станет «всегда ok», как было в круге 14) */
const mutants = [
  ['машины уехали за левый край', { ...geom.mob, cars: [-60, 389, 1127, 803] }],
  ['вывеска выше кадра', { ...geom.mob, title: [101, -40, 1031, 517] }],
  ['машины ниже кадра', { ...geom.mob, cars: [25, 389, 1127, 2000] }],
];
let caught = 0;
for (const [name, g] of mutants) {
  const rows = safeZoneMobile(g);
  const bad = rows.some((r) => r.cars === 'нет' || r.title === 'нет');
  if (bad) caught++;
  console.log(`${bad ? 'ok  ' : 'FAIL'} мутант «${name}» ${bad ? 'поймана' : 'ПРОПУЩЕНА'}`);
}
if (caught !== mutants.length) fail = 1;
process.exit(fail);
