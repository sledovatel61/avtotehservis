#!/usr/bin/env node
/* Импорт экспорта Telegram (HTML) в плоский корпус для grep.

   Зачем: экспорт чата «Воя клуб» — 76 файлов messages*.html, ≈65 МБ, кириллица
   записана как \uXXXX. Читать это в контекст нельзя, а grep'ать — можно, если
   сначала снять HTML и раскодировать. Скрипт делает одну вещь: превращает
   каталог с messages*.html в corpus.txt (строка = сообщение) + corpus.jsonl +
   stats.json. Дальше — grep/awk, никаких LLM.

   Запуск:
     node site/tools/chat-import/import.mjs --in /tmp/chat/raw --out /tmp/chat/txt
     node site/tools/chat-import/import.mjs --self-test

   Формат строки корпуса:
     [#538563 16.06.2024 12:05 Dmitry StarSing] текст сообщения в одну строку

   Данные НЕ попадают в git: держите их в /tmp или в каталоге из .gitignore. */

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/* ---------- разбор одного файла ---------- */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…',
  laquo2: '«', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
};

function decodeEscapes(s) {
  // \u041e\u0431 → Об. Суррогатные пары собираются сами: каждая половина \uXXXX.
  let out = s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  out = out.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"');
  return out;
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => ENTITIES[name] ?? m);
}

function stripTags(s) {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

/* Достать содержимое <div class="text"> с учётом вложенных div.
   Регексом нельзя: внутри бывают <div class="clearfix"> и вложенные блоки. */
function takeDivByClass(html, cls, from) {
  const open = new RegExp(`<div class="[^"]*\\b${cls}\\b[^"]*"[^>]*>`, 'i');
  const m = open.exec(html.slice(from));
  if (!m) return null;
  const start = from + m.index + m[0].length;
  let depth = 1;
  const re = /<div\b|<\/div>/gi;
  re.lastIndex = start;
  for (;;) {
    const t = re.exec(html);
    if (!t) break;
    if (t[0][1] === '/') depth--; else depth++;
    if (depth === 0) return { html: html.slice(start, t.index), end: t.index + t[0].length };
  }
  return { html: html.slice(start), end: html.length };
}

export function parseFile(name, html) {
  const messages = [];
  const blockRe = /<div class="message (default clearfix|service|joined)"[^>]*id="message(-?\d+)"[^>]*>/g;
  const starts = [];
  let m;
  while ((m = blockRe.exec(html))) starts.push({ kind: m[1], id: m[2], at: m.index, bodyAt: blockRe.lastIndex });

  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    const chunk = html.slice(s.bodyAt, starts[i + 1]?.at ?? html.length);
    if (s.kind === 'service') {
      const t = stripTags(decodeEntities(decodeEscapes(chunk)));
      if (t && /^\d{1,2} [A-Z][a-z]+ \d{4}$/.test(t)) messages.push({ file: name, id: s.id, date: t, author: '', text: '', service: 'date' });
      continue;
    }
    /* title="16.06.2024 12:05:00 GMT+03:00" → "16.06.2024 12:05" (без часового пояса:
       он у всех сообщений одинаковый и только засоряет корпус) */
    const dateTitle = /title="(\d{2}\.\d{2}\.\d{4}) (\d{2}:\d{2})/.exec(chunk);
    const date = dateTitle ? `${dateTitle[1]} ${dateTitle[2]}` : '';
    const fromM = /<div class="from_name">\s*([\s\S]*?)<\/div>/.exec(chunk);
    const author = fromM ? stripTags(decodeEntities(decodeEscapes(fromM[1]))).replace(/\s+/g, ' ') : '';
    const box = takeDivByClass(chunk, 'text', 0);
    if (!box) continue;
    const text = stripTags(decodeEntities(decodeEscapes(box.html)));
    if (!text) continue;
    messages.push({ file: name, id: s.id, date, author, text });
  }
  return messages;
}

/* ---------- разбор JSON-экспорта Telegram (result.json) ----------

   {"name":"…","type":"private_supergroup","messages":[
     {"id":538563,"type":"message","date":"2024-06-16T12:05:00","date_unixtime":"…",
      "from":"Дмитрий","from_id":"user…","text":"строка"} |
     {"…","text":[ "часть", {"type":"bold","text":"жирный"},
                   {"type":"link","text":"ссылка"}, {"type":"mention","text":"@x"} ]},
     {"id":8990,"type":"service","date":"…","actor":"Ilya","action":"topic_created","text":""}
   ]}

   text бывает строкой, массивом строк и объектов, а поле text у объекта — снова
   строкой или массивом. Разворачиваем рекурсивно, теряя только форматирование. */

function flattenText(t) {
  if (t == null) return '';
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return t.map(flattenText).join('');
  if (typeof t === 'object') return flattenText(t.text);
  return String(t);
}

function isoToRu(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}` : '';
}

export function parseJsonExport(name, raw) {
  const data = JSON.parse(raw);
  const list = Array.isArray(data.messages) ? data.messages : [];
  const out = [];
  /* Владелец собирал экспорт по частям, и один и тот же id встречается до 5 раз
     с идентичным текстом (14 261 id из 74 705). Дедупликация по id обязательна,
     иначе счётчики тем завышены на ~19 %, а факты «повторилось у 3+ владельцев»
     считаются по одной и той же реплике. Если тексты при одном id разные —
     это не дубль, а склейка; такие случаи считаем и пишем в stats.json. */
  const seen = new Map();
  let dupSame = 0;
  let dupDiff = 0;
  for (const m of list) {
    if (m.type !== 'message') continue;
    const text = flattenText(m.text).trim();
    if (!text) continue;
    const id = String(m.id);
    const prev = seen.get(id);
    if (prev) {
      if (prev.text === text) { dupSame++; continue; }
      dupDiff++;
    }
    const item = {
      file: name,
      id,
      date: isoToRu(m.date),
      author: typeof m.from === 'string' ? m.from.trim() : '',
      text,
    };
    seen.set(id, item);
    out.push(item);
  }
  parseJsonExport.lastDup = { dupSame, dupDiff };
  return out;
}

function naturalKey(f) {
  const n = /messages(\d*)\.html$/.exec(f);
  return n ? (n[1] === '' ? 1 : Number(n[1]) + 1) : 1e9;
}

const oneLine = (t) => t.replace(/\s+/g, ' ').trim();

export function toCorpusLine(m) {
  return `[#${m.id} ${m.date} ${m.author}] ${oneLine(m.text)}`;
}

/* ---------- прогон ---------- */

async function run(inPath, outDir) {
  /* Вход — либо каталог с messages*.html, либо один файл: result.json или messages.html */
  const st = await stat(inPath).catch(() => null);
  if (!st) { console.error(`Нет такого пути: ${inPath}`); process.exit(2); }
  let files;
  let single = null;
  if (st.isFile()) {
    single = basename(inPath);
    files = [single];
  } else {
    files = (await readdir(inPath)).filter((f) => /^messages\d*\.html$/.test(f)).sort((a, b) => naturalKey(a) - naturalKey(b));
    if (!files.length) { console.error(`Нет файлов messages*.html в ${inPath}`); process.exit(2); }
  }
  await mkdir(outDir, { recursive: true });
  const lines = [];
  const jsonl = [];
  let bytes = 0;
  const perFile = [];
  for (const f of files) {
    const full = single ? inPath : join(inPath, f);
    const raw = await readFile(full, 'utf8');
    bytes += raw.length;
    const isJson = /\.json$/i.test(f);
    const msgs = isJson ? parseJsonExport(f, raw) : parseFile(f, raw);
    const real = msgs.filter((m) => m.text);
    perFile.push({ file: f, messages: real.length });
    for (const m of real) {
      lines.push(toCorpusLine(m));
      jsonl.push(JSON.stringify(m));
    }
    process.stderr.write(`${f}: ${real.length}\n`);
  }
  await writeFile(join(outDir, 'corpus.txt'), lines.join('\n') + '\n', 'utf8');
  await writeFile(join(outDir, 'corpus.jsonl'), jsonl.join('\n') + '\n', 'utf8');
  const dates = lines.map((l) => /\s(\d{2}\.\d{2}\.\d{4}) /.exec(l)?.[1]).filter(Boolean);
  const dup = parseJsonExport.lastDup ?? { dupSame: 0, dupDiff: 0 };
  const stats = {
    dup_same_id_dropped: dup.dupSame,
    dup_same_id_conflicting: dup.dupDiff,
    files: files.length,
    raw_bytes: bytes,
    messages: lines.length,
    corpus_chars: lines.join('\n').length,
    first_date: dates[0] ?? null,
    last_date: dates[dates.length - 1] ?? null,
    per_file: perFile,
  };
  await writeFile(join(outDir, 'stats.json'), JSON.stringify(stats, null, 1), 'utf8');
  console.log(`готово: файлов ${stats.files}, сообщений ${stats.messages}, ` +
    `корпус ${(stats.corpus_chars / 1e6).toFixed(2)} млн знаков, ` +
    `период ${stats.first_date} … ${stats.last_date}`);
}

/* ---------- self-test: синтетический кусок в формате экспорта ---------- */

function selfTest() {
  /* --- JSON-экспорт: строка, массив частей, объект с вложенным массивом, service --- */
  const json = JSON.stringify({
    name: 'Обслуживание и ремонт', type: 'private_supergroup',
    messages: [
      { id: 538563, type: 'message', date: '2024-06-16T12:05:00', from: 'Дмитрий',
        text: 'Масло в редукторе 0,9 л' },
      { id: 538564, type: 'message', date: '2024-06-16T12:07:00', from: 'Илья',
        text: ['менять раз в ', { type: 'bold', text: ['30', ' тыс.'] },
               { type: 'link', text: 'ссылка' }] },
      { id: 538565, type: 'service', date: '2024-06-17T09:00:00', actor: 'Илья',
        action: 'topic_created', text: '' },
      { id: 538566, type: 'message', date: '2024-06-17T09:01:00', from: 'Пётр', text: '' },
      { id: 538563, type: 'message', date: '2024-06-16T12:05:00', from: 'Дмитрий',
        text: 'Масло в редукторе 0,9 л' },
    ],
  });
  const jm = parseJsonExport('result.json', json).map(toCorpusLine);
  const jwant = [
    '[#538563 16.06.2024 12:05 Дмитрий] Масло в редукторе 0,9 л',
    '[#538564 16.06.2024 12:07 Илья] менять раз в 30 тыс.ссылка',
  ];
  let jok = jm.length === jwant.length;
  jm.forEach((l, i) => { if (l !== jwant[i]) { jok = false; console.error(`FAIL json ${i}\n  получил: ${l}\n  ждал:    ${jwant[i]}`); } });
  console.log(jok ? 'self-test json: PASS' : 'self-test json: FAIL');

  const html = `
   <div class="message default clearfix" id="message538563">
    <div class="body">
     <div class="pull_right date details" title="16.06.2024 12:05:00 GMT+03:00">12:05</div>
     <div class="from_name">Dmitry StarSing</div>
     <div class="reply_to details">In reply to <a href="#go_to_message1">this message</a></div>
     <div class="text">\\u041c\\u0430\\u0441\\u043b\\u043e \\u0432 \\u0440\\u0435\\u0434\\u0443\\u043a\\u0442\\u043e\\u0440\\u0435 0,9 \\u043b<br>\\u043c\\u0435\\u043d\\u044f\\u0442\\u044c \\u0440\\u0430\\u0437 \\u0432 30 \\u0442\\u044b\\u0441. &laquo;\\u0442\\u0435\\u0441\\u0442&raquo;<div class="clearfix"></div></div>
    </div>
   </div>
   <div class="message service" id="message-3">
    <div class="body details">17 June 2024</div>
   </div>
   <div class="message default clearfix" id="message538564">
    <div class="body">
     <div class="pull_right date details" title="17.06.2024 09:01:00 GMT+03:00">09:01</div>
     <div class="from_name">\\u0418\\u043b\\u044c\\u044f</div>
     <div class="text"><a href="https://x">\\u0441\\u0441\\u044b\\u043b\\u043a\\u0430</a> \\u0438 \\u0442\\u0435\\u043a\\u0441\\u0442</div>
    </div>
   </div>`;
  const msgs = parseFile('messages.html', html);
  const lines = msgs.filter((m) => m.text).map(toCorpusLine);
  const want = [
    '[#538563 16.06.2024 12:05 Dmitry StarSing] Масло в редукторе 0,9 л менять раз в 30 тыс. «тест»',
    '[#538564 17.06.2024 09:01 Илья] ссылка и текст',
  ];
  let ok = lines.length === want.length;
  lines.forEach((l, i) => { if (l !== want[i]) { ok = false; console.error(`FAIL ${i}\n  получил: ${l}\n  ждал:    ${want[i]}`); } });
  if (msgs.some((m) => m.service === 'date' && m.text)) { ok = false; console.error('FAIL: служебная дата попала в текст'); }
  console.log(ok ? 'self-test html: PASS' : 'self-test html: FAIL');
  process.exit(ok && jok ? 0 : 1);
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) selfTest();
else {
  const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  run(get('--in', '/tmp/chat/raw'), get('--out', '/tmp/chat/txt'));
}
