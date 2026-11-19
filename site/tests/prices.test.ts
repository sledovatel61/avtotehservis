import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  validatePrices,
  minPrice,
  priceIndexOf,
  fillPrices,
  missingPriceRefs,
  slugifyRu,
} from '../src/shared/prices-schema.ts';
import {
  getPrices,
  readPricesFile,
  writePricesFile,
  clearPricesCache,
} from '../src/server/prices-store.ts';

describe('prices-schema & prices-store (круг 85)', () => {
  const origEnv = process.env.PRICES_FILE;

  afterEach(() => {
    if (origEnv === undefined) delete process.env.PRICES_FILE;
    else process.env.PRICES_FILE = origEnv;
    clearPricesCache();
  });

  it('валидирует штатный site/content/prices.json (7 групп, 73 позиции)', () => {
    const prices = readPricesFile();
    const res = validatePrices(prices);
    assert.equal(res.ok, true);
    if (!res.ok) return;

    assert.equal(res.value.version, 1);
    assert.equal(res.value.updated_at, '2026-11-19');
    assert.deepEqual(
      res.value.groups.map((g) => [g.id, g.items.length]),
      [
        ['to', 6],
        ['tormoza', 5],
        ['podveska', 11],
        ['grm', 13],
        ['diagnostika', 2],
        ['kondicioner', 4],
        ['svarka', 2],
      ],
    );
    assert.equal(res.value.tyres.set.length, 8);
    assert.equal(res.value.tyres.repair.length, 3);
    assert.equal(res.value.tyres.extra.length, 4);
    assert.equal(res.value.voyah.length, 15);
    assert.equal(res.value.featured.length, 3);
  });

  it('отклоняет пустой name, цену без цифр, "руб.", дубли id, битый featured.ref и дату 2026-02-30', () => {
    const base = structuredClone(readPricesFile());

    // 1. пустой name
    const emptyName = structuredClone(base);
    emptyName.groups[0].items[0].name = ' ';
    const r1 = validatePrices(emptyName);
    assert.equal(r1.ok, false);
    if (!r1.ok) assert.ok(r1.errors['groups.0.items.0.name']);

    // 2. цена без цифр ("договорная")
    const noDigits = structuredClone(base);
    noDigits.groups[0].items[0].price = 'договорная';
    const r2 = validatePrices(noDigits);
    assert.equal(r2.ok, false);
    if (!r2.ok) assert.ok(r2.errors['groups.0.items.0.price']);

    // 3. цена с "руб."
    const rubWord = structuredClone(base);
    rubWord.groups[0].items[0].price = '1500 руб.';
    const r3 = validatePrices(rubWord);
    assert.equal(r3.ok, false);
    if (!r3.ok) assert.ok(r3.errors['groups.0.items.0.price']);

    // 4. дублирующийся id
    const dupId = structuredClone(base);
    dupId.groups[1].items[0].id = dupId.groups[0].items[0].id;
    const r4 = validatePrices(dupId);
    assert.equal(r4.ok, false);
    if (!r4.ok) assert.ok(r4.errors['groups.1.items.0.id']);

    // 5. битый featured.ref
    const badRef = structuredClone(base);
    badRef.featured[0].ref = 'non-existent-id';
    const r5 = validatePrices(badRef);
    assert.equal(r5.ok, false);
    if (!r5.ok) assert.ok(r5.errors['featured.0.ref']);

    // 6. несуществующая календарная дата "2026-02-30"
    const badDate = structuredClone(base);
    badDate.updated_at = '2026-02-30';
    const r6 = validatePrices(badDate);
    assert.equal(r6.ok, false);
    if (!r6.ok) assert.ok(r6.errors.updated_at);
  });

  it('корректно считает minPrice по группам, шинам и voyah (с учётом hidden)', () => {
    const prices = readPricesFile();
    assert.equal(minPrice(prices, 'to'), 'от 1000 ₽');
    assert.equal(minPrice(prices, 'podveska'), 'от 800 ₽');
    assert.equal(minPrice(prices, 'grm'), 'от 1200 ₽');
    assert.equal(minPrice(prices, 'shiny'), 'от 600 ₽');
    assert.equal(minPrice(prices, 'voyah'), 'от 1200 ₽');

    // Если скрыть самую дешёвую позицию в подвеске (tie-rod-end, 800 ₽), минимум станет от 1000 ₽
    const copy = structuredClone(prices);
    const podv = copy.groups.find((g) => g.id === 'podveska')!;
    const cheapest = podv.items.find((i) => i.id === 'tie-rod-end')!;
    cheapest.hidden = true;
    assert.equal(minPrice(copy, 'podveska'), 'от 1000 ₽');
  });

  it('раскрывает плейсхолдеры {{price}}, {{from}}, {{span}}, {{tyre}} и находит missingPriceRefs', () => {
    const prices = readPricesFile();
    const sample =
      'Масло седан — {{price:oil-sedan}} ({{from:oil-sedan}}), R16 легковая — {{price:set-r16-pass}}, R20 — {{tyre:set-r20}}, балансировка — {{span:extra-bal-16..extra-bal-20}}, Voyah — {{price:voyah-oil}}.';
    assert.equal(
      fillPrices(sample, prices),
      'Масло седан — 1000–1300 ₽ (от 1000 ₽), R16 легковая — 2200 ₽, R20 — 3600–4000 ₽, балансировка — 800–1000 ₽, Voyah — 2000 ₽.',
    );
    assert.deepEqual(missingPriceRefs(sample, prices), []);

    // Заглавная «От» после точки в предложении
    assert.equal(
      fillPrices('Антифриз. {{from:oil-sedan}} за работу.', prices),
      'Антифриз. От 1000 ₽ за работу.',
    );

    const broken = 'Тест {{price:oil-sedan}}, {{price:unknown-work}}, {{from:missing-from}} и {{span:oil-sedan..missing-span}}';
    assert.deepEqual(missingPriceRefs(broken, prices), ['unknown-work', 'missing-from', 'missing-span']);
    assert.equal(
      fillPrices(broken, prices),
      'Тест 1000–1300 ₽, {{price:unknown-work}}, {{from:missing-from}} и {{span:oil-sedan..missing-span}}',
    );
  });

  it('сохраняет незнакомые поля и флаг hidden при валидации и записи (round-trip)', () => {
    const base = structuredClone(readPricesFile());
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prices-rt-'));
    const tmpFile = path.join(tmpDir, 'prices.json');
    process.env.PRICES_FILE = tmpFile;
    base.admin_comment = 'Тестовая метка админки';
    base.groups[0].custom_group_flag = 42;
    const item0 = base.groups[0].items[0];
    item0.hidden = true;
    item0.extra_meta = { source: 'agent-11' };

    const written = writePricesFile(base);
    assert.equal(written.admin_comment, 'Тестовая метка админки');
    assert.equal(written.groups[0].custom_group_flag, 42);
    assert.equal(written.groups[0].items[0].hidden, true);
    assert.deepEqual(written.groups[0].items[0].extra_meta, { source: 'agent-11' });

    // Чтение с диска и проверка кэша по mtime
    const fromDisk1 = getPrices();
    assert.equal(fromDisk1.groups[0].items[0].price, '1000–1300 ₽');

    // Изменяем файл напрямую на диске с новым mtime
    const rawOnDisk = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    rawOnDisk.groups[0].items[0].price = '1100–1400 ₽';
    fs.writeFileSync(tmpFile, JSON.stringify(rawOnDisk, null, 2), 'utf8');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(tmpFile, future, future);

    const fromDisk2 = getPrices();
    assert.equal(fromDisk2.groups[0].items[0].price, '1100–1400 ₽');
    assert.equal(priceIndexOf(fromDisk2).get('oil-sedan'), '1100–1400 ₽');
    assert.equal(slugifyRu('Развал-схождение'), 'razval-shozhdenie');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
