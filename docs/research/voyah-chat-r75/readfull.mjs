/* Круг 75: полные тексты сообщений по шаблону — чтобы читать целиком, а не по 400 знаков.
   Запуск: node readfull.mjs "<regex>" [--min 500] [--limit 12] [--skip 0]
   Корпус и scan.mjs не меняются. */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const rows = gunzipSync(readFileSync(join(HERE, 'corpus.jsonl.gz'))).toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
const a = process.argv.slice(2);
const re = new RegExp(a[0], 'i');
const opt = (n, d) => { const i = a.indexOf(`--${n}`); return i >= 0 ? Number(a[i + 1]) : d; };
const MIN = opt('min', 500), LIMIT = opt('limit', 12), SKIP = opt('skip', 0);
const hits = rows.filter((r) => r.t && r.t.length >= MIN && re.test(r.t));
console.log(`# ${a[0]} — совпадений ≥${MIN} знаков: ${hits.length}, показано ${Math.min(LIMIT, hits.length - SKIP)}`);
for (const r of hits.slice(SKIP, SKIP + LIMIT)) console.log(`\n[msg ${r.i}, ${r.d.slice(0, 10)}]\n${r.t}`);
