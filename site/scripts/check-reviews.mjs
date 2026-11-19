#!/usr/bin/env node
/**
 * Круг 87: гейт проверки файла отзывов `site/content/reviews.json` (задание №113).
 *
 * Режимы:
 *   node scripts/check-reviews.mjs           — проверка схемы + сводка (`опубликовано N, скрыто M, примеров K`)
 *   node scripts/check-reviews.mjs --strict  — падает (код 1), если остался хотя бы один `demo: true`
 *   node scripts/check-reviews.mjs --count   — печатает только число опубликованных отзывов
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReviewsFile } from '../src/shared/reviews-schema.ts';

const siteRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function parseArgs(argv) {
  const out = {
    strict: false,
    count: false,
    json: false,
    reviewsFile: process.env.REVIEWS_FILE
      ? resolve(process.env.REVIEWS_FILE)
      : resolve(siteRoot, 'content/reviews.json'),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--strict') out.strict = true;
    else if (arg === '--count') out.count = true;
    else if (arg === '--json') out.json = true;
    else if ((arg === '--file' || arg === '--reviews') && argv[i + 1]) {
      out.reviewsFile = resolve(argv[++i]);
    } else if (arg === '--help') {
      console.log('Usage: node scripts/check-reviews.mjs [--strict] [--count] [--json] [--file PATH]');
      process.exit(0);
    } else {
      throw new Error(`Неизвестный параметр: ${arg}`);
    }
  }
  return out;
}

/**
 * @param {string} filePath
 * @param {{ strict?: boolean }} [opts]
 */
export function checkReviewsFile(filePath, opts = {}) {
  const strict = Boolean(opts.strict);
  /** @type {string[]} */
  const errors = [];

  if (!existsSync(filePath)) {
    return {
      ok: false,
      summary: { total: 0, published: 0, hidden: 0, demoCount: 0, updated_at: '' },
      errors: [`Файл отзывов не найден: ${filePath}`],
    };
  }

  let rawText = '';
  try {
    rawText = readFileSync(filePath, 'utf8');
  } catch (err) {
    return {
      ok: false,
      summary: { total: 0, published: 0, hidden: 0, demoCount: 0, updated_at: '' },
      errors: [`Не удалось прочитать ${filePath}: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  let rawJson = null;
  try {
    rawJson = JSON.parse(rawText);
  } catch (err) {
    return {
      ok: false,
      summary: { total: 0, published: 0, hidden: 0, demoCount: 0, updated_at: '' },
      errors: [`${filePath}: битый JSON: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  if (!rawJson || typeof rawJson !== 'object' || Array.isArray(rawJson)) {
    errors.push('reviews.json: корень должен быть объектом { updated_at, items }');
  } else {
    const updatedAt = typeof rawJson.updated_at === 'string' ? rawJson.updated_at.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}/.test(updatedAt)) {
      errors.push(`reviews.json: updated_at должен начинаться с YYYY-MM-DD (получено «${updatedAt}»)`);
    }
    if (!Array.isArray(rawJson.items)) {
      errors.push('reviews.json: поле items должно быть массивом');
    }
  }

  const parsed = parseReviewsFile(rawJson);
  for (const err of parsed.errors) {
    errors.push(`reviews.json: ${err}`);
  }

  const items = parsed.file.items;
  for (const item of items) {
    if (item.source === 'demo' && !item.demo) {
      errors.push(`reviews.json: запись ${item.id} имеет source="demo", но demo=false`);
    }
  }

  const published = items.filter((r) => r.status === 'published').length;
  const hidden = items.filter((r) => r.status === 'hidden').length;
  const demoCount = items.filter((r) => r.demo).length;

  if (strict && demoCount > 0) {
    const demoIds = items.filter((r) => r.demo).map((r) => r.id).join(', ');
    errors.push(
      `режим --strict: в файле остались демо-отзывы (demo: true) — ${demoCount} шт. (${demoIds})`,
    );
  }

  return {
    ok: errors.length === 0,
    summary: {
      total: items.length,
      published,
      hidden,
      demoCount,
      updated_at: parsed.file.updated_at,
    },
    errors,
  };
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  let opt;
  try {
    opt = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }

  const result = checkReviewsFile(opt.reviewsFile, { strict: opt.strict });
  const { published, hidden, demoCount, total } = result.summary;

  if (opt.count) {
    console.log(String(published));
    process.exit(result.ok ? 0 : 1);
  }

  if (opt.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  console.log(
    `Отзывы: всего ${total} (опубликовано ${published}, скрыто ${hidden}, примеров ${demoCount})`,
  );
  for (const err of result.errors) {
    console.error(`ОШИБКА: ${err}`);
  }
  if (result.ok) {
    console.log('PASS: проверка reviews.json пройдена.');
  }
  process.exit(result.ok ? 0 : 1);
}
