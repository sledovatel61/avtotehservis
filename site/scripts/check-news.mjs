#!/usr/bin/env node
/**
 * Гейт проверки статей раздела «Полезное» (`site/content/news.json`) и артефакта `pages-dist`
 * (круг 89, задание `prompts/130-task-r89-news-store.md`).
 *
 * Режимы:
 *   • `node scripts/check-news.mjs`          — проверяет схему `site/content/news.json` и печатает
 *                                              `ok: N статей (published M, draft K)`;
 *   • `node scripts/check-news.mjs --strict` — дополнительно сверяет собранный `pages-dist`:
 *                                              для каждого `published` есть `pages-dist/news/<slug>/index.html`,
 *                                              для каждого `draft` такого файла нет;
 *   • `node scripts/check-news.mjs --count`  — печатает только число опубликованных статей.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { draftItems, parseNewsDoc, publishedItems } from '../src/shared/news-schema.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = resolve(HERE, '../content/news.json');
const DEFAULT_PAGES_DIST = resolve(HERE, '../pages-dist');

function parseArgs(argv) {
  const out = {
    strict: false,
    countOnly: false,
    file: DEFAULT_FILE,
    pagesDist: DEFAULT_PAGES_DIST,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--strict') out.strict = true;
    else if (a === '--count') out.countOnly = true;
    else if (a === '--file' && argv[i + 1]) {
      out.file = resolve(argv[++i]);
    } else if (a.startsWith('--file=')) {
      out.file = resolve(a.slice('--file='.length));
    } else if (a === '--pages-dist' && argv[i + 1]) {
      out.pagesDist = resolve(argv[++i]);
    } else if (a.startsWith('--pages-dist=')) {
      out.pagesDist = resolve(a.slice('--pages-dist='.length));
    }
  }
  return out;
}

/**
 * Проверяет `news.json` (и при `strict: true` — собранный `pages-dist`).
 *
 * @param {string} [filePath]
 * @param {{ strict?: boolean; pagesDist?: string }} [options]
 */
export function checkNewsFile(filePath = DEFAULT_FILE, options = {}) {
  const strict = Boolean(options?.strict);
  const pagesDist = options?.pagesDist ? resolve(options.pagesDist) : DEFAULT_PAGES_DIST;

  if (!existsSync(filePath)) {
    throw new Error(`ОШИБКА: не найден файл статей ${filePath}`);
  }

  let rawText = '';
  try {
    rawText = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(
      `ОШИБКА: не удалось прочитать ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const doc = parseNewsDoc(rawText);
  const published = publishedItems(doc);
  const drafts = draftItems(doc);

  if (strict) {
    const newsIndexPath = join(pagesDist, 'news', 'index.html');
    if (!existsSync(newsIndexPath)) {
      const err = new Error(
        `ОШИБКА: не найден собранный артефакт ${newsIndexPath} (сначала выполните npm run build:pages)`,
      );
      err.exitCode = 2;
      throw err;
    }

    const artifactProblems = [];
    for (const item of published) {
      const pagePath = join(pagesDist, 'news', item.slug, 'index.html');
      if (!existsSync(pagePath)) {
        artifactProblems.push(
          `ОШИБКА: опубликованная статья «${item.slug}» отсутствует в артефакте (${pagePath})`,
        );
      }
    }
    for (const item of drafts) {
      const pagePath = join(pagesDist, 'news', item.slug, 'index.html');
      if (existsSync(pagePath)) {
        artifactProblems.push(
          `ОШИБКА: черновик «${item.slug}» попал в артефакт (${pagePath})`,
        );
      }
    }

    if (artifactProblems.length > 0) {
      throw new Error(artifactProblems.join('\n'));
    }
  }

  return {
    total: doc.items.length,
    published: published.length,
    draft: drafts.length,
  };
}

const isMain =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const opt = parseArgs(process.argv.slice(2));
  const envFile = process.env.NEWS_FILE;
  const targetFile = opt.file === DEFAULT_FILE && envFile ? resolve(envFile) : opt.file;

  try {
    const summary = checkNewsFile(targetFile, {
      strict: opt.strict,
      pagesDist: opt.pagesDist,
    });
    if (opt.countOnly) {
      console.log(String(summary.published));
    } else {
      console.log(
        `ok: ${summary.total} статей (published ${summary.published}, draft ${summary.draft})`,
      );
    }
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    const exitCode = typeof err?.exitCode === 'number' ? err.exitCode : 1;
    process.exit(exitCode);
  }
}
