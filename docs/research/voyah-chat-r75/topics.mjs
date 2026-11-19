/* Круг 75: подсчёт тем корпуса по шаблонам — цифры для отчёта и method.md.
   Отдельный скрипт, corpus.jsonl.gz и scan.mjs не меняются.
   Запуск: node topics.mjs */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const rows = gunzipSync(readFileSync(join(HERE, 'corpus.jsonl.gz'))).toString('utf8').trim().split('\n').map((l) => JSON.parse(l));

const TOPICS = {
  updates: [/обновлени/i, /прошивк/i, /ota/i, /встал[ао]?\b/i, /установк/i, /пакет/i, /верси[яию]/i],
  sim: [/симк/i, /sim\b/i, /esim/i, /оператор/i, /модем/i, /t-?box/i, /тибокс/i, /интернет/i, /4g/i, /раздач/i],
  app: [/приложени/i, /lantu/i, /ключ/i, /bluetooth|блютус/i, /мастер.?аккаунт|ма\b/i, /esender/i],
  media: [/музык/i, /радио/i, /медиа/i, /яндекс/i, /видео/i, /флешк|usb|ssd/i, /экран/i, /плеер/i, /кинопоиск|ютуб|youtube/i],
  errors: [/ошибк/i, /предупрежд/i, /неисправ/i, /горит/i, /индикатор/i, /значок/i],
  thirdparty: [/кунб|кумб|твикс|гмс|gmc|adb|apk|лаунчер/i],
};

const count = (res) => rows.filter((r) => r.t && res.some((re) => re.test(r.t))).length;
for (const [k, res] of Object.entries(TOPICS)) console.log(`  ${k.padEnd(11)} ${count(res)}`);

const mediaNative = rows.filter((r) => r.t && TOPICS.media.some((re) => re.test(r.t)) && !TOPICS.thirdparty.some((re) => re.test(r.t)));
console.log(`  media без сторонних сборок/ADB: ${mediaNative.length}`);

for (const topic of ['updates', 'sim', 'app', 'media']) {
  const by = {};
  for (const r of rows) if (r.t && TOPICS[topic].some((re) => re.test(r.t))) by[r.d.slice(0, 4)] = (by[r.d.slice(0, 4)] ?? 0) + 1;
  console.log(`  ${topic} по годам: ${JSON.stringify(by)}`);
}
