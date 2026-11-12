#!/usr/bin/env node
/* Узкая выборка из корпуса чата: считает попадания и показывает только верхушку.

   Нужен, чтобы разбирать 20 МБ переписки, не затаскивая её в контекст:
   сначала счётчики по темам, потом по 20–40 строк с обрезкой до 220 знаков,
   потом при необходимости — конкретное сообщение по номеру.

   Запуск:
     node site/tools/chat-import/probe.mjs --corpus /tmp/chat/txt/corpus.txt --topics
     node site/tools/chat-import/probe.mjs --corpus ... --pattern "редуктор" --limit 20
     node site/tools/chat-import/probe.mjs --corpus ... --pattern "вязкост|5W-30|0W-20" --from 01.03.2025 --limit 30
     node site/tools/chat-import/probe.mjs --corpus ... --msg 612345
     node site/tools/chat-import/probe.mjs --self-test

   Вывод ограничен: --limit (по умолчанию 20) и --width (по умолчанию 220).
   Полные тексты в контекст не уходят — только по одному сообщению через --msg. */

import { readFile } from 'node:fs/promises';

const TOPICS = [
  ['масло ДВС', /масл[аоу]?\s*(в\s*)?(двигател|двс|моторе)|5W-?30|0W-?20|0W-?40|5W-?40/i],
  ['редуктор', /редуктор/i],
  ['генераторная установка', /генераторн|генератор/i],
  ['свечи', /свеч|свечи/i],
  ['антифриз', /антифриз|охлаждающ/i],
  ['тормозная жидкость', /тормозн[а-я]*\s*жидкост|dot\s*-?4/i],
  ['колодки/диски', /колодк|тормозн[а-я]*\s*диск/i],
  ['регламент/ТО', /регламент|интервал|\bто\b|техобслуж|обслуживан/i],
  ['пробег/проблемы', /пробег|стук|гул|скрип|ошибк|неисправ|сломал/i],
  ['цены', /цен[аы]|стоимост|руб|₽|тыс\.?\s*р/i],
  ['гарантия', /гаранти/i],
  ['расход/заряд', /расход|заряд|пробег на электр|батаре/i],
];

const fmt = (s, w) => (s.length > w ? s.slice(0, w) + '…' : s);

function parseLine(line) {
  const m = /^\[#(-?\d+) (\S+ \S+) ([^\]]*)\] (.*)$/.exec(line);
  if (!m) return null;
  return { id: m[1], date: m[2], author: m[3].trim(), text: m[4] };
}

function cmpDate(a, b) {
  const [d1, m1, y1] = a.split('.');
  const [d2, m2, y2] = b.split('.');
  return new Date(`${y1}-${m1}-${d1}`) - new Date(`${y2}-${m2}-${d2}`);
}

async function run(opts) {
  const raw = await readFile(opts.corpus, 'utf8');
  const msgs = raw.split('\n').map(parseLine).filter(Boolean).map((m) => ({ ...m, dateOnly: m.date.split(' ')[0] }));

  if (opts.msg) {
    const one = msgs.find((m) => m.id === opts.msg);
    if (!one) { console.log(`сообщение ${opts.msg} не найдено`); process.exit(1); }
    console.log(`[#${one.id} ${one.date} ${one.author}]\n${one.text}`);
    return;
  }

  if (opts.topics) {
    console.log(`сообщений в корпусе: ${msgs.length}, период ${msgs[0]?.date} … ${msgs[msgs.length - 1]?.date}\n`);
    for (const [name, re] of TOPICS) {
      const hit = msgs.filter((m) => re.test(m.text));
      console.log(`${String(hit.length).padStart(5)}  ${name}`);
    }
    return;
  }

  if (!opts.pattern) { console.error('нужен --pattern, --topics или --msg'); process.exit(2); }
  const re = new RegExp(opts.pattern, 'i');
  let hit = msgs.filter((m) => re.test(m.text));
  if (opts.from) hit = hit.filter((m) => cmpDate(m.dateOnly, opts.from) >= 0);
  if (opts.to) hit = hit.filter((m) => cmpDate(m.dateOnly, opts.to) <= 0);
  const authors = new Set(hit.map((m) => m.author)).size;
  console.log(`попаданий: ${hit.length}, разных авторов: ${authors}${hit.length > opts.limit ? `, показываю первые ${opts.limit}` : ''}\n`);
  for (const m of hit.slice(0, opts.limit)) {
    console.log(fmt(`[#${m.id} ${m.date}] ${m.text}`, opts.width));
  }
}

function selfTest() {
  const corpus = [
    '[#1 16.06.2024 12:05 Илья] Масло в редукторе 0,9 л',
    '[#2 17.06.2024 09:01 Пётр] масло 5W-30 SN и выше',
    '[#3 18.06.2024 10:00 Илья] свечи менял на 30 тыс',
  ].join('\n') + '\n';
  const file = '/tmp/chat-selftest-corpus.txt';
  import('node:fs').then(async ({ writeFileSync, unlinkSync }) => {
    writeFileSync(file, corpus);
    const lines = corpus.split('\n').map(parseLine).filter(Boolean);
    const oil = lines.filter((m) => /масл/i.test(m.text));
    const ok = lines.length === 3 && oil.length === 2 && lines[0].id === '1' && lines[2].date === '18.06.2024 10:00';
    unlinkSync(file);
    console.log(ok ? 'self-test: PASS' : 'self-test: FAIL');
    process.exit(ok ? 0 : 1);
  });
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) selfTest();
else {
  const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  run({
    corpus: get('--corpus', '/tmp/chat/txt/corpus.txt'),
    pattern: get('--pattern', null),
    from: get('--from', null),
    to: get('--to', null),
    msg: get('--msg', null),
    topics: args.includes('--topics'),
    limit: Number(get('--limit', 20)),
    width: Number(get('--width', 220)),
  });
}
