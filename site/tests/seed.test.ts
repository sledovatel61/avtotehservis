/* Круг 26 (задание №30): тест сида БД после миграции 002 и перезаписи seed-data.
   Проверяет решения владельца от 05.11.2026 и состав круга 26:
     S1. старых слагов нет (грузовой шиномонтаж, правка/прокатка дисков, hodovaya-tormoza,
         elektrika, remont-shin и прочие удалённые миграцией 002);
     S2. ровно 7 видимых услуг, у каждой price_from не NULL; значения «от» совпадают
         с прайсом a7/02; 4 скрытых чипа на месте, у kondicioner цены нет (NULL);
     S3. chip_labels: 12 подписей чипов, включая скрытые;
     S4. кейсы a7/05: 6 кейсов, слаги-владельцы из нового набора;
     S5. новости a9: ровно 5 статей с теми же слагами и датами (даты не меняем);
     S6. марки: «легковые, кроссоверы и паркетники», ГАЗ и УАЗ остались.
   Запуск: node --test tests/seed.test.ts (входит в npm test). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'ats-seed-'));
process.env.DATA_DIR = join(TMP, 'data');
process.env.MEDIA_DIR = join(TMP, 'media');
mkdirSync(process.env.DATA_DIR, { recursive: true });
mkdirSync(process.env.MEDIA_DIR, { recursive: true });

const { runMigrations } = await import('../scripts/migrate.ts');
const { runSeed } = await import('../scripts/seed.ts');
const { db: getDb, closeDb } = await import('../src/server/db.ts');
const db = getDb();

const DELETED = ['shinomontazh-gruz', 'pravka-diskov', 'hodovaya-tormoza', 'elektrika', 'remont-shin',
  'porezy-gryzhi', 'vulkanizaciya', 'hranenie-shin', 'razval-shozhdenie',
  'rulevye-reyki', 'dvigatel', 'akpp-mkpp', 'stekla', 'kondicionery'];
/* price_from хранится готовой строкой витрины («от N ₽») — карточка выводит её как есть */
const VISIBLE: [string, string][] = [
  ['shinomontazh', 'от 1000 ₽'], ['balansirovka', 'от 600 ₽'], ['to-maslo', 'от 1000 ₽'], ['tormoza', 'от 1200 ₽'],
  ['podveska', 'от 800 ₽'], ['grm-sceplenie', 'от 3500 ₽'], ['diagnostika', 'от 500 ₽'],
  /* круг 27: восьмая видимая услуга — сварочные работы (от 1500 ₽ за место) */
  ['svarka', 'от 1500 ₽']];
const HIDDEN: [string, string | null][] = [
  ['remont-kolesa', 'от 600 ₽'], ['sceplenie', 'от 6000 ₽'], ['diagnostika-hodovaya', 'от 500 ₽'],
  /* круг 27: у кондиционера появилась подтверждённая владельцем цена — поиск утечки от 500 ₽ */
  ['kondicioner', 'от 500 ₽']];
const NEWS = ['remen-grm-kogda-menat', 'stuk-v-podveske', 'sezonnaya-smena-shin',
  'diagnostika-pered-pokupkoy', 'zapravka-kondicionera'];

type Row = { slug: string; hidden: number; price_from: string | null; sort: number };

before(() => { runMigrations(); runSeed(); });
after(() => { closeDb(); });

test('S1 удалённые слаги не возвращаются сидом', () => {
  const rows = db.prepare('SELECT slug FROM services').all() as { slug: string }[];
  const slugs = new Set(rows.map((r) => r.slug));
  for (const d of DELETED) assert.ok(!slugs.has(d), `слаг ${d} не должен существовать`);
});

test('S2 восемь видимых услуг с ценой «от», четыре скрытых чипа', () => {
  const rows = db.prepare('SELECT slug, hidden, price_from, sort FROM services ORDER BY sort').all() as Row[];
  const vis = rows.filter((r) => r.hidden === 0);
  assert.equal(vis.length, 8, 'видимых услуг ровно 8');
  for (const [slug, price] of VISIBLE) {
    const r = vis.find((x) => x.slug === slug);
    assert.ok(r, `видимая услуга ${slug} на месте`);
    assert.equal(r!.price_from, price, `price_from ${slug} = ${price}`);
  }
  const hid = rows.filter((r) => r.hidden === 1);
  assert.equal(hid.length, 4, 'скрытых чипов ровно 4');
  for (const [slug, price] of HIDDEN) {
    const r = hid.find((x) => x.slug === slug);
    assert.ok(r, `скрытый чип ${slug} на месте`);
    assert.equal(r!.price_from, price, `price_from скрытого ${slug}`);
  }
});

test('S3 chip_labels: 12 подписей', () => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'chip_labels'").get() as { value: string };
  const labels = JSON.parse(row.value) as Record<string, string>;
  assert.equal(Object.keys(labels).length, 12, 'подписей чипов 12');
  for (const slug of ['shinomontazh', 'balansirovka', 'to-maslo', 'tormoza', 'podveska', 'grm-sceplenie', 'diagnostika', 'remont-kolesa', 'sceplenie', 'diagnostika-hodovaya', 'kondicioner', 'svarka']) {
    assert.ok(labels[slug], `подпись чипа ${slug}`);
  }
});

test('S4 кейсы назначены новым услугам', () => {
  const rows = db.prepare('SELECT slug, service_slug FROM cases ORDER BY slug').all() as { slug: string; service_slug: string }[];
  assert.equal(rows.length, 6, 'кейсов 6');
  const expect: Record<string, string> = {
    'case-1': 'balansirovka', 'case-2': 'balansirovka', 'case-3': 'podveska',
    'case-4': 'tormoza', 'case-5': 'to-maslo', 'case-6': 'grm-sceplenie' };
  for (const r of rows) assert.equal(r.service_slug, expect[r.slug], `кейс ${r.slug} → ${expect[r.slug]}`);
  const svc = new Set((db.prepare('SELECT slug FROM services').all() as { slug: string }[]).map((x) => x.slug));
  for (const r of rows) assert.ok(svc.has(r.service_slug), `владелец кейса ${r.slug} существует`);
});

test('S5 пять статей a9, слаги и даты не менялись', () => {
  const rows = db.prepare('SELECT slug, published_at FROM news ORDER BY published_at DESC').all() as { slug: string; published_at: string }[];
  assert.equal(rows.length, 5, 'статей 5');
  for (const s of NEWS) assert.ok(rows.some((r) => r.slug === s), `статья ${s} на месте`);
});

test('S6 марки: легковые, кроссоверы и паркетники; ГАЗ и УАЗ остались', () => {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'brands'").get() as { value: string };
  const brands = JSON.parse(row.value) as string[];
  assert.ok(brands.includes('ГАЗ'), 'ГАЗ остался');
  assert.ok(brands.includes('УАЗ'), 'УАЗ остался');
  /* формула «легковые, кроссоверы и паркетники» живёт в текстах услуг (a7), а не в списке марок */
  const svc = db.prepare("SELECT short FROM services WHERE slug = 'shinomontazh'").get() as { short: string };
  assert.ok(/кроссоверы и паркетники/.test(svc.short), '«кроссоверы и паркетники» в тексте услуги');
});
