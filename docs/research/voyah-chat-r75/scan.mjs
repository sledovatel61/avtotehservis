/* Утилита чтения корпуса чата «Прошивка | SIM» (круг 75).

   Зачем: 44 751 сообщение и 3,4 млн знаков в контекст не влезают. Скрипт даёт
   воспроизводимые выборки — по ним и строится разбор, а не «на глаз».

   Запуск (из этой папки):
     node scan.mjs stats
     node scan.mjs grep "прошивк" [--min 250] [--limit 40] [--flags i]
     node scan.mjs grep "симк" --context 2 --limit 20
     node scan.mjs thread 1234567 [--depth 4]
     node scan.mjs sample --n 20 --min 400 --seed 7
     node scan.mjs authors --top 25
     node scan.mjs top --field month|year|author|hour

   Опции:
     --min N      только сообщения длиной ≥ N знаков
     --limit N    сколько вывести (по умолчанию 30)
     --flags f    флаги регулярного выражения (по умолчанию 'i')
     --context N  показать N сообщений до и после каждого совпадения
     --json       вывести массив объектов, а не человекочитаемый вид
     --seed N     зерно для sample (по умолчанию 1)

   Корпус: corpus.jsonl.gz, по строке на сообщение:
     i  — id сообщения в чате (по нему собираются ссылки [msg i, дата])
     d  — дата и время, ISO без зоны (UTC, как в экспорте)
     a  — анонимный автор: u + 6 hex (стабильно во всём корпусе)
     t  — текст; ссылки уже развёрнуты из text_entities
     r  — id сообщения, на которое отвечают (если есть)
     m  — вложение: p фото, f файл, v видео, a голосовое, s стикер
     fw — 1, если сообщение переслано
*/

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const rows = gunzipSync(readFileSync(join(HERE, 'corpus.jsonl.gz')))
  .toString('utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));

const argv = process.argv.slice(2);
const cmd = argv[0] ?? 'stats';
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);
const LIMIT = Number(opt('limit', 30));
const MIN = Number(opt('min', 0));
const CTX = Number(opt('context', 0));
const SEED = Number(opt('seed', 1));

const cut = (s, n = 400) => (s.length > n ? s.slice(0, n) + ' …' : s);
const show = (r, extra = '') =>
  `[msg ${r.i}, ${r.d.slice(0, 10)}] u…${r.a.slice(1)}` +
  (r.m ? ` (${r.m})` : '') +
  (r.fw ? ' (переслано)' : '') +
  (r.r ? ` → ${r.r}` : '') +
  `${extra}\n${cut(r.t)}\n`;

/* детерминированный ГПСЧ, чтобы выборка воспроизводилась у всех одинаково */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

if (cmd === 'stats') {
  const byYear = {};
  const byMonth = {};
  const withText = rows.filter((r) => r.t);
  for (const r of rows) {
    byYear[r.d.slice(0, 4)] = (byYear[r.d.slice(0, 4)] ?? 0) + 1;
    byMonth[r.d.slice(0, 7)] = (byMonth[r.d.slice(0, 7)] ?? 0) + 1;
  }
  const chars = rows.reduce((n, r) => n + r.t.length, 0);
  console.log(`сообщений: ${rows.length}, из них с текстом: ${withText.length}`);
  console.log(`знаков: ${chars}, в среднем ${Math.round(chars / withText.length)} на сообщение`);
  console.log(`период: ${rows[0].d} … ${rows.at(-1).d}`);
  console.log(`авторов (анонимных): ${new Set(rows.map((r) => r.a)).size}`);
  console.log(`вложения: фото ${rows.filter((r) => r.m === 'p').length}, файлы ${rows.filter((r) => r.m === 'f').length}, прочее ${rows.filter((r) => r.m && !['p', 'f'].includes(r.m)).length}`);
  console.log('по годам:', byYear);
  const top = Object.entries(byMonth).sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log('самые активные месяцы:', top.map(([m, n]) => `${m}: ${n}`).join(', '));
  process.exit(0);
}

if (cmd === 'top') {
  const field = opt('field', 'month');
  const get = {
    month: (r) => r.d.slice(0, 7),
    year: (r) => r.d.slice(0, 4),
    author: (r) => r.a,
    hour: (r) => r.d.slice(11, 13),
  }[field];
  if (!get) {
    console.error('--field: month | year | author | hour');
    process.exit(2);
  }
  const { execSync } = await import('node:child_process');
  void execSync;
  const counts = new Map();
  for (const r of rows) counts.set(get(r), (counts.get(get(r)) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1]).slice(0, LIMIT);
  for (const [k, n] of sorted) console.log(`${k}\t${n}`);
  process.exit(0);
}

if (cmd === 'authors') {
  const counts = new Map();
  for (const r of rows) counts.set(r.a, (counts.get(r.a) ?? 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1]).slice(0, Number(opt('top', 25)));
  for (const [a, n] of sorted) console.log(`${a}\t${n}`);
  process.exit(0);
}

if (cmd === 'sample') {
  const n = Number(opt('n', 20));
  const re = opt('regex', null) ? new RegExp(opt('regex'), opt('flags', 'i')) : null;
  let pool = rows.filter((r) => r.t.length >= MIN && (!re || re.test(r.t)));
  const rand = rng(SEED);
  const picks = [];
  const used = new Set();
  while (picks.length < Math.min(n, pool.length)) {
    const k = Math.floor(rand() * pool.length);
    if (used.has(k)) continue;
    used.add(k);
    picks.push(pool[k]);
  }
  if (flag('json')) console.log(JSON.stringify(picks, null, 1));
  else for (const r of picks) console.log(show(r));
  process.exit(0);
}

if (cmd === 'thread') {
  const id = Number(argv[1]);
  const depth = Number(opt('depth', 4));
  const byId = new Map(rows.map((r) => [r.i, r]));
  const root = byId.get(id);
  if (!root) {
    console.error(`нет сообщения ${id}`);
    process.exit(2);
  }
  const chain = [root];
  let cur = root;
  for (let d = 0; d < depth && cur.r; d++) {
    const parent = byId.get(cur.r);
    if (!parent) break;
    chain.unshift(parent);
    cur = parent;
  }
  const replies = rows.filter((r) => r.r === id).slice(0, 20);
  console.log('--- ветка (сверху вниз) ---');
  for (const r of chain) console.log(show(r));
  console.log(`--- ответы на ${id}: ${replies.length} ---`);
  for (const r of replies) console.log(show(r));
  process.exit(0);
}

if (cmd === 'grep') {
  const pattern = argv[1];
  if (!pattern) {
    console.error('укажите регулярное выражение: node scan.mjs grep "масл"');
    process.exit(2);
  }
  const re = new RegExp(pattern, opt('flags', 'i'));
  const hits = rows.filter((r) => r.t.length >= MIN && re.test(r.t));
  const out = hits.slice(0, LIMIT);
  if (flag('json')) console.log(JSON.stringify(out, null, 1));
  else {
    console.log(`совпадений: ${hits.length} (показано ${out.length})`);
    for (const r of out) {
      if (!CTX) {
        console.log(show(r));
        continue;
      }
      const from = Math.max(0, rows.indexOf(r) - CTX);
      const to = Math.min(rows.length, rows.indexOf(r) + CTX + 1);
      for (const c of rows.slice(from, to)) console.log(show(c));
      console.log('· · ·');
    }
  }
  process.exit(0);
}

console.error(`неизвестная команда: ${cmd}`);
console.error('stats | grep <re> | thread <id> | sample | authors | top');
process.exit(2);
