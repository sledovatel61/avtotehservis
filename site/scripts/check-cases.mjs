#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { parseCasesFile, PHOTO_WIDTHS } from '../src/shared/cases-schema.ts';

const siteRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
function options(argv) {
  const out = {
    json: false,
    casesFile: resolve(siteRoot, 'content/cases.json'),
    mediaDir: resolve(siteRoot, 'public/media'),
    pagesDist: resolve(siteRoot, 'pages-dist'),
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') out.json = true;
    else if (argv[i] === '--cases' && argv[i + 1]) out.casesFile = resolve(argv[++i]);
    else if (argv[i] === '--media-dir' && argv[i + 1]) out.mediaDir = resolve(argv[++i]);
    else if (argv[i] === '--pages-dist' && argv[i + 1]) out.pagesDist = resolve(argv[++i]);
    else if (argv[i] === '--help') {
      console.log('Usage: node scripts/check-cases.mjs [--json] [--cases PATH] [--media-dir PATH] [--pages-dist PATH]');
      process.exit(0);
    } else throw new Error(`Неизвестный параметр: ${argv[i]}`);
  }
  return out;
}

async function isFile(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}
async function imageSize(path) {
  try {
    const meta = await sharp(path, { failOn: 'error' }).metadata();
    if (!meta.width || !meta.height) throw new Error('в изображении нет размеров');
    return { width: meta.width, height: meta.height };
  } catch (error) {
    throw new Error(`не удалось прочитать размеры: ${error.message}`);
  }
}
function dimensionsFor(photo, width) {
  const scale = Math.min(1, width / Math.max(photo.w, photo.h));
  return { width: Math.max(1, Math.round(photo.w * scale)), height: Math.max(1, Math.round(photo.h * scale)) };
}

async function main() {
  let opt;
  try { opt = options(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; return; }

  const errors = [];
  let raw;
  try { raw = JSON.parse(await readFile(opt.casesFile, 'utf8')); }
  catch (error) {
    errors.push(`${opt.casesFile}: не удалось прочитать JSON: ${error.message}`);
    raw = null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) errors.push('cases.json: корень должен быть объектом');
  if (raw?.version !== 1) errors.push(`cases.json: version должен быть 1 (получено ${String(raw?.version)})`);
  if (!Array.isArray(raw?.cases)) errors.push('cases.json: cases должен быть массивом');

  const parsed = parseCasesFile(raw);
  errors.push(...parsed.errors.map((message) => `cases.json: ${message}`));
  const cases = parsed.file.cases;
  const slugs = new Set();
  for (const item of cases) {
    if (slugs.has(item.slug)) errors.push(`${item.slug}: слаг повторяется`);
    slugs.add(item.slug);
    if (item.mode === 'single' && (item.before.length || item.after.length)) {
      errors.push(`${item.slug}: режим single допускает фотографии только в поле photos`);
    }
    if (item.mode === 'before_after') {
      if (!item.after.length) errors.push(`${item.slug}: в режиме before_after нужен хотя бы один кадр after`);
      if (item.photos.length) errors.push(`${item.slug}: в режиме before_after фотографии должны быть в before/after, не в photos`);
    }

    const frames = [...item.before, ...item.after, ...item.photos];
    if (item.cover) {
      const match = frames.find((photo) => photo.base === item.cover.base);
      if (!match) errors.push(`${item.slug}: cover не ссылается на кадр в before/after/photos`);
      else if (match.alt !== item.cover.alt || match.w !== item.cover.w || match.h !== item.cover.h || (match.ext ?? 'webp') !== (item.cover.ext ?? 'webp')) {
        errors.push(`${item.slug}: данные cover не совпадают с выбранным кадром`);
      }
    }

    const unique = new Map();
    for (const photo of [...frames, ...(item.cover ? [item.cover] : [])]) unique.set(`${photo.base}.${photo.ext ?? 'webp'}`, photo);
    for (const [key, photo] of unique) {
      if (!photo.alt.trim()) errors.push(`${item.slug}/${key}: alt не должен быть пустым`);
      if (photo.alt.length > 160) errors.push(`${item.slug}/${key}: alt длиннее 160 символов`);
      if (photo.alt.toLocaleLowerCase('ru').includes('официальный')) errors.push(`${item.slug}/${key}: alt содержит запрещённое слово «официальный»`);
      for (const width of PHOTO_WIDTHS) {
        const path = join(opt.mediaDir, 'cases', item.slug, `${photo.base}-${width}.${photo.ext ?? 'webp'}`);
        if (!(await isFile(path))) {
          errors.push(`${item.slug}/${key}: не найден ${path}`);
          continue;
        }
        try {
          const actual = await imageSize(path);
          const expected = dimensionsFor(photo, width);
          if (actual.width !== expected.width || actual.height !== expected.height) {
            errors.push(`${item.slug}/${key}-${width}: размер ${actual.width}×${actual.height}, в cases.json ожидается ${expected.width}×${expected.height}`);
          }
        } catch (error) {
          errors.push(`${item.slug}/${key}-${width}: ${error.message}`);
        }
      }
    }

    if (item.status === 'draft') {
      const page = join(opt.pagesDist, 'cases', item.slug, 'index.html');
      if (await isFile(page)) errors.push(`${item.slug}: черновик появился в pages-dist (${page})`);
    }
  }
  if (!(await isFile(join(opt.pagesDist, 'index.html')))) errors.push(`pages-dist не найден или не собран: ${opt.pagesDist}`);

  const result = {
    ok: errors.length === 0,
    summary: { total: cases.length, published: cases.filter((item) => item.status === 'published').length, drafts: cases.filter((item) => item.status === 'draft').length },
    errors,
  };
  if (opt.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`Кейсов: ${result.summary.total} (на сайте: ${result.summary.published}, черновиков: ${result.summary.drafts})`);
    for (const error of errors) console.error(`ОШИБКА: ${error}`);
    if (!errors.length) console.log('Проверка cases.json, фотографий и черновиков пройдена.');
  }
  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Не удалось проверить кейсы: ${error.message}`);
  process.exitCode = 1;
});
