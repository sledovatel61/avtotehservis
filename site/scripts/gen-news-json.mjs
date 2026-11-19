#!/usr/bin/env node
/**
 * Перенос статей раздела «Полезное» из `site/src/server/seed-data.ts` (ключ `"news"`)
 * в `site/content/news.json` (круг 89, задание `prompts/130-task-r89-news-store.md`).
 *
 * Скрипт идемпотентный: повторный запуск даёт пустой диф.
 * Запуск: `node scripts/gen-news-json.mjs` (из `site/`).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED } from '../src/server/seed-data.ts';
import { parseNewsDoc } from '../src/shared/news-schema.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = resolve(HERE, '../content/news.json');

const seedNews = SEED.news;

const items = seedNews
  .map((n) => ({
    slug: n.slug,
    title: n.title,
    seo_title: null,
    excerpt: n.excerpt,
    category: n.category,
    body_md: n.body_md,
    cover: null,
    cover_static: n.cover_static ?? null,
    status: 'published',
    published_at: n.published_at,
    updated_at: n.published_at,
  }))
  .sort((a, b) => {
    if (a.published_at !== b.published_at) {
      return a.published_at < b.published_at ? 1 : -1;
    }
    return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });

const doc = {
  version: 1,
  updated_at: '2026-11-21T09:00:00.000Z',
  items,
};

// Проверяем результат схемой перед записью
const validated = parseNewsDoc(doc);

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(doc, null, 2) + '\n', 'utf8');

console.log(`${seedNews.length} → ${validated.items.length}`);
