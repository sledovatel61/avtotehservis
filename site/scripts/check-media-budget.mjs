#!/usr/bin/env node
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MiB = 1024 * 1024;
const KiB = 1024;
const WARN_BYTES = 400 * MiB;
const ERROR_BYTES = 700 * MiB;
const MAX_FILE_BYTES = 800 * KiB;
const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const siteRoot = resolve(scriptDir, '..');

function options(argv) {
  const out = { json: false, mediaDir: resolve(siteRoot, 'public/media'), casesFile: resolve(siteRoot, 'content/cases.json') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') out.json = true;
    else if (argv[i] === '--media-dir' && argv[i + 1]) out.mediaDir = resolve(argv[++i]);
    else if (argv[i] === '--cases' && argv[i + 1]) out.casesFile = resolve(argv[++i]);
    else if (argv[i] === '--help') {
      console.log('Usage: node scripts/check-media-budget.mjs [--json] [--media-dir PATH] [--cases PATH]');
      process.exit(0);
    } else throw new Error(`Неизвестный параметр: ${argv[i]}`);
  }
  return out;
}

async function collectFiles(root) {
  const files = [];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (entry.name === '.gitkeep') continue;
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push({ path, bytes: (await stat(path)).size });
    }
  }
  await walk(root);
  return files;
}

async function readCaseSlugs(file) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    return Array.isArray(data?.cases)
      ? new Set(data.cases.map((item) => item?.slug).filter((slug) => typeof slug === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

function auditFamilies(files, mediaDir, errors) {
  const families = new Map();
  for (const file of files) {
    const rel = relative(mediaDir, file.path).split(sep).join('/');
    if (!rel.startsWith('cases/')) continue;
    const dir = rel.slice(0, rel.lastIndexOf('/'));
    const name = rel.slice(rel.lastIndexOf('/') + 1);
    const match = name.match(/^(.*)-(480|960|1600)\.(webp|jpe?g)$/i);
    if (!match) {
      errors.push(`${rel}: имя фото должно оканчиваться на -480, -960 или -1600 и иметь формат WebP/JPEG`);
      continue;
    }
    const key = `${dir}/${match[1]}.${match[3].toLowerCase()}`;
    if (!families.has(key)) families.set(key, new Set());
    families.get(key).add(Number(match[2]));
  }
  for (const [family, widths] of families) {
    const missing = [480, 960, 1600].filter((width) => !widths.has(width));
    if (missing.length) errors.push(`${family}: отсутствуют варианты ${missing.join(', ')}`);
  }
}

async function auditOrphans(files, mediaDir, casesFile, errors) {
  const caseRoot = resolve(mediaDir, 'cases');
  let entries;
  try { entries = await readdir(caseRoot, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const known = await readCaseSlugs(casesFile);
  for (const entry of entries) {
    if (entry.isDirectory() && !known.has(entry.name)) errors.push(`cases/${entry.name}: каталог-сирота — слага нет в cases.json`);
  }
}

function summary(files, mediaDir) {
  const folders = new Map();
  for (const file of files) {
    const relDir = relative(mediaDir, file.path).split(sep).join('/').replace(/\/[^/]+$/, '') || '.';
    const current = folders.get(relDir) ?? { folder: relDir, files: 0, bytes: 0 };
    current.files++;
    current.bytes += file.bytes;
    folders.set(relDir, current);
  }
  return [...folders.values()].sort((a, b) => a.folder.localeCompare(b.folder, 'en')).map((folder) => ({
    ...folder,
    mb: Number((folder.bytes / MiB).toFixed(2)),
  }));
}

async function main() {
  let opt;
  try { opt = options(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; return; }

  const files = await collectFiles(opt.mediaDir);
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const errors = [];
  const warnings = [];
  for (const file of files) {
    if (file.bytes > MAX_FILE_BYTES) errors.push(`${relative(opt.mediaDir, file.path).split(sep).join('/')}: ${(file.bytes / KiB).toFixed(0)} КБ — лимит 800 КБ`);
  }
  auditFamilies(files, opt.mediaDir, errors);
  await auditOrphans(files, opt.mediaDir, opt.casesFile, errors);
  if (totalBytes >= ERROR_BYTES) errors.push(`Общий объём ${(totalBytes / MiB).toFixed(1)} МБ — лимит 700 МБ превышен`);
  else if (totalBytes >= WARN_BYTES) warnings.push(`Общий объём ${(totalBytes / MiB).toFixed(1)} МБ: пора планировать разгрузку (порог 400 МБ)`);

  const result = {
    ok: errors.length === 0,
    totals: { files: files.length, bytes: totalBytes, mb: Number((totalBytes / MiB).toFixed(2)) },
    folders: summary(files, opt.mediaDir),
    warnings,
    errors,
  };
  if (opt.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log('Папка                         Файлов      МБ');
    if (!result.folders.length) console.log('(нет файлов)                       0    0.00');
    for (const folder of result.folders) console.log(`${folder.folder.padEnd(30)} ${String(folder.files).padStart(6)} ${folder.mb.toFixed(2).padStart(9)}`);
    console.log(`Итого: ${result.totals.files} файлов, ${result.totals.mb.toFixed(2)} МБ`);
    for (const warning of warnings) console.warn(`ПРЕДУПРЕЖДЕНИЕ: ${warning}`);
    for (const error of errors) console.error(`ОШИБКА: ${error}`);
    if (!errors.length) console.log('Проверка медиа пройдена.');
  }
  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Не удалось проверить медиа: ${error.message}`);
  process.exitCode = 1;
});
