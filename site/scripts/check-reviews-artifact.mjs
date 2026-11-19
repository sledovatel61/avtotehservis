#!/usr/bin/env node
/**
 * Круг 88: гейт собранного артефакта `pages-dist/otzyvy/index.html` (задание №120).
 *
 * Защищает боевой домен (`PUBLIC_BASE_PATH=/`) от случайной публикации демо-отзывов,
 * если в настройках репозитория забыли выставить `PUBLIC_DEMO_REVIEWS=0`.
 *
 * Режимы:
 *   node scripts/check-reviews-artifact.mjs                  — берёт режим из PUBLIC_BASE_PATH
 *   node scripts/check-reviews-artifact.mjs --require-empty  — принудительно боевой режим
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReviewsFile } from '../src/shared/reviews-schema.ts';
import { readPublicPath } from './lib/public-path.mjs';

const siteRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEMO_SNIPPET_LEN = 40;

/**
 * Чистая функция проверки готового HTML страницы `/otzyvy` и массива записей `items`.
 * Ничего не читает с диска.
 *
 * @param {{
 *   html: string;
 *   items: Array<{ id: string; text: string; demo?: boolean }>;
 *   basePath?: string;
 * }} input
 * @returns {{ ok: true; demoCount: number } | { ok: false; demoCount: number; problems: string[] }}
 */
export function findDemoInArtifact({ html, items, basePath }) {
  const htmlStr = String(html ?? '');
  const list = Array.isArray(items) ? items : [];
  const demoItems = list.filter((item) => item && item.demo === true);

  const chipMatches = htmlStr.match(/\brev-demo\b(?!-)/g) ?? [];
  const matchedDemoItems = demoItems.filter((item) => {
    const snippet = String(item.text ?? '').trim().slice(0, DEMO_SNIPPET_LEN);
    return snippet.length > 0 && htmlStr.includes(snippet);
  });

  const demoCount = Math.max(chipMatches.length, matchedDemoItems.length);
  const normBase = basePath === undefined ? '/avtotehservis' : String(basePath).trim();
  const isProdRoot = normBase === '/' || normBase === '';

  if (!isProdRoot) {
    return { ok: true, demoCount };
  }

  if (chipMatches.length === 0 && matchedDemoItems.length === 0) {
    return { ok: true, demoCount: 0 };
  }

  /** @type {string[]} */
  const problems = [];
  const reportedItems = matchedDemoItems.length > 0 ? matchedDemoItems : demoItems;
  for (const item of reportedItems) {
    problems.push(`демо-отзыв «${item.id}» в /otzyvy`);
  }
  if (chipMatches.length > 0) {
    problems.push(`чип rev-demo в /otzyvy (${chipMatches.length} шт.)`);
  }

  return {
    ok: false,
    demoCount,
    problems,
  };
}

function parseCliArgs(argv) {
  const out = {
    requireEmpty: false,
    pagesDist: resolve(siteRoot, 'pages-dist'),
    htmlFile: '',
    reviewsFile: process.env.REVIEWS_FILE
      ? resolve(process.env.REVIEWS_FILE)
      : resolve(siteRoot, 'content/reviews.json'),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--require-empty') out.requireEmpty = true;
    else if (arg === '--pages-dist' && argv[i + 1]) out.pagesDist = resolve(argv[++i]);
    else if (arg === '--html' && argv[i + 1]) out.htmlFile = resolve(argv[++i]);
    else if ((arg === '--reviews' || arg === '--file') && argv[i + 1]) {
      out.reviewsFile = resolve(argv[++i]);
    } else if (arg === '--help') {
      console.log(
        'Usage: node scripts/check-reviews-artifact.mjs [--require-empty] [--pages-dist DIR] [--html FILE] [--reviews FILE]',
      );
      process.exit(0);
    } else {
      throw new Error(`Неизвестный параметр: ${arg}`);
    }
  }

  if (!out.htmlFile) {
    out.htmlFile = join(out.pagesDist, 'otzyvy', 'index.html');
  }
  return out;
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  let opt;
  try {
    opt = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`ОШИБКА: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  if (!existsSync(opt.htmlFile)) {
    console.error(
      `ОШИБКА: не найден собранный файл ${opt.htmlFile} (сначала выполните npm run build:pages)`,
    );
    process.exit(2);
  }

  if (!existsSync(opt.reviewsFile)) {
    console.error(`ОШИБКА: не найден файл отзывов ${opt.reviewsFile}`);
    process.exit(2);
  }

  let html = '';
  let items = [];
  try {
    html = readFileSync(opt.htmlFile, 'utf8');
    const rawReviews = JSON.parse(readFileSync(opt.reviewsFile, 'utf8'));
    const parsed = parseReviewsFile(rawReviews);
    items = parsed.file.items;
  } catch (err) {
    console.error(
      `ОШИБКА: не удалось прочитать входные файлы: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(2);
  }

  let basePath = '/avtotehservis';
  if (opt.requireEmpty) {
    basePath = '/';
  } else if (process.env.PUBLIC_BASE_PATH && process.env.PUBLIC_BASE_PATH.trim() !== '') {
    try {
      const pub = readPublicPath(process.env);
      basePath = pub.base === '' ? '/' : pub.base;
    } catch (err) {
      console.error(`ОШИБКА: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(2);
    }
  } else if (
    existsSync(join(opt.pagesDist, 'CNAME')) ||
    !/href=["']\/avtotehservis\//.test(html)
  ) {
    basePath = '/';
  }

  const result = findDemoInArtifact({ html, items, basePath });
  if (!result.ok) {
    for (const problem of result.problems) {
      console.error(`ОШИБКА: на боевой сборке найден ${problem}`);
    }
    process.exit(1);
  }

  if (basePath === '/' || basePath === '') {
    console.log('Отзывы в артефакте (/otzyvy): примеров 0 — боевая сборка чиста.');
  } else {
    console.log(`Отзывы в артефакте (/otzyvy): примеров ${result.demoCount} — превью, допустимо.`);
  }
  process.exit(0);
}
