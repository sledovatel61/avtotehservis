import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  type PricesFile,
  type PriceKind,
  type PriceItemPatch,
  validatePrices,
  findPriceItem as tsFindPriceItem,
  removePriceItem as tsRemovePriceItem,
  renamePriceItem as tsRenamePriceItem,
} from '../src/shared/prices-schema.ts';
import {
  getPrices,
  readPricesFile,
  writePricesFile,
  clearPricesCache,
  findPriceItem as storeFindPriceItem,
  removePriceItem as storeRemovePriceItem,
  renamePriceItem as storeRenamePriceItem,
} from '../src/server/prices-store.ts';
// @ts-ignore -- статический браузерный JS без деклараций
import {
  validate as browserValidate,
  findPriceItem as jsFindPriceItem,
  removePriceItem as jsRemovePriceItem,
  renamePriceItem as jsRenamePriceItem,
} from '../public/manage/prices-schema.js';
import {
  collectPriceRefs,
  buildPriceRefs,
  writePriceRefs,
} from '../scripts/lib/price-refs.mjs';

function makeFixture(): PricesFile {
  return {
    version: 1,
    updated_at: '2026-11-19',
    groups: [
      {
        id: 'to',
        title: 'ТО и жидкости',
        service: 'to-maslo',
        items: [
          {
            id: 'oil-sedan',
            name: 'Замена масла в двигателе, седан',
            note: '',
            price: '1000–1300 ₽',
          },
          {
            id: 'oil-mt',
            name: 'Замена масла в МКПП',
            note: '',
            price: '1500 ₽',
          },
        ],
      },
      {
        id: 'tormoza',
        title: 'Тормоза',
        service: 'tormoza',
        items: [
          {
            id: 'pads-front',
            name: 'Замена передних тормозных колодок',
            note: '',
            price: '1200 ₽',
          },
        ],
      },
    ],
    tyres: {
      set: [
        {
          id: 'set-r16',
          radius: 'R16',
          passenger: '2200 ₽',
          crossover: '2400 ₽',
        },
      ],
      repair: [
        {
          id: 'rep-r13',
          radius: 'R13–R15',
          range: 'R13–R15',
          price: '600 ₽',
        },
      ],
      extra: [
        {
          id: 'extra-set',
          name: 'Смена колёс',
          note: '',
          price: '1000 ₽',
        },
      ],
    },
    voyah: [
      {
        id: 'voyah-oil',
        name: 'Масло в двигателе + все фильтры',
        note: 'масляный, воздушный, салонный',
        price: '2000 ₽',
      },
      {
        id: 'voyah-plugs',
        name: 'Свечи зажигания',
        note: 'комплект, с проверкой зазора',
        price: '2500 ₽',
      },
    ],
    featured: [
      {
        id: 'chip-oil',
        ref: 'voyah-oil',
        title: 'Масло ДВС + 3 фильтра',
        note: 'работа · масляный, воздушный, салонный',
      },
    ],
  };
}

describe('удаление и переименование позиции + price-refs (круг 86)', () => {
  const origEnv = process.env.PRICES_FILE;

  afterEach(() => {
    if (origEnv === undefined) delete process.env.PRICES_FILE;
    else process.env.PRICES_FILE = origEnv;
    clearPricesCache();
  });

  it('1. removePriceItem убирает позицию, не мутирует исходный объект, остальные позиции целы', () => {
    const orig = makeFixture();
    const snapshot = structuredClone(orig);

    const res = tsRemovePriceItem(orig, 'group', 'to', 'oil-mt');
    assert.equal(res.ok, true);
    if (!res.ok) return;

    // Исходный объект не мутирован
    assert.deepEqual(orig, snapshot);

    // Удалённая позиция исчезла, соседняя на месте
    assert.equal(tsFindPriceItem(res.value, 'group', 'to', 'oil-mt'), undefined);
    assert.deepEqual(
      res.value.groups[0].items.map((i) => i.id),
      ['oil-sedan'],
    );
    assert.deepEqual(
      res.value.groups[1].items.map((i) => i.id),
      ['pads-front'],
    );
  });

  it('2. удаление последней позиции группы проходит схему (validatePrices ok)', () => {
    const orig = makeFixture();
    const res = tsRemovePriceItem(orig, 'group', 'tormoza', 'pads-front');
    assert.equal(res.ok, true);
    if (!res.ok) return;

    assert.equal(res.value.groups[1].items.length, 0);
    const tsValid = validatePrices(res.value);
    const jsValid = browserValidate(res.value);
    assert.equal(tsValid.ok, true);
    assert.equal(jsValid.ok, true);
  });

  it('3. удаление при ссылке из featured — отказ с текстом про плашку', () => {
    const orig = makeFixture();
    const res = tsRemovePriceItem(orig, 'voyah', 'voyah', 'voyah-oil');
    assert.equal(res.ok, false);
    if (res.ok) return;

    assert.equal(res.errors.length, 1);
    assert.match(res.errors[0], /Сначала уберите плашку «Масло ДВС \+ 3 фильтра» на главной/);
  });

  it('4. renamePriceItem меняет name/price, id остаётся прежним; невалидное название/цена — отказ', () => {
    const orig = makeFixture();
    const snapshot = structuredClone(orig);

    const okRes = tsRenamePriceItem(orig, 'group', 'to', 'oil-sedan', {
      id: 'hacked-id',
      name: 'Замена масла в двигателе (легковой седан)',
      note: 'включая снятие защиты',
      price: '1100–1400 ₽',
    });
    assert.equal(okRes.ok, true);
    assert.deepEqual(orig, snapshot);
    if (!okRes.ok) return;

    const updated = tsFindPriceItem(okRes.value, 'group', 'to', 'oil-sedan');
    assert.ok(updated);
    assert.equal(updated.id, 'oil-sedan');
    assert.equal(updated.name, 'Замена масла в двигателе (легковой седан)');
    assert.equal(updated.note, 'включая снятие защиты');
    assert.equal(updated.price, '1100–1400 ₽');

    // Невалидное короткое название
    const badName = tsRenamePriceItem(orig, 'group', 'to', 'oil-sedan', { name: 'А' });
    assert.equal(badName.ok, false);

    // Невалидная цена без цифр
    const badPrice = tsRenamePriceItem(orig, 'group', 'to', 'oil-sedan', { price: 'бесплатно' });
    assert.equal(badPrice.ok, false);

    // Невалидная цена с «руб.»
    const badRub = tsRenamePriceItem(orig, 'group', 'to', 'oil-sedan', { price: '1200 руб.' });
    assert.equal(badRub.ok, false);
  });

  it('5. паритет TS ↔ браузерный prices-schema.js на всех кейсах §5 (одинаковый ok и одинаковый набор ошибок)', () => {
    const base = makeFixture();

    const removeCases: Array<[string, PriceKind, string, string]> = [
      ['удаление из группы', 'group', 'to', 'oil-mt'],
      ['удаление последней из группы', 'group', 'tormoza', 'pads-front'],
      ['удаление из tyres.set', 'set', 'tyres:set', 'set-r16'],
      ['удаление из tyres.repair', 'repair', 'tyres:repair', 'rep-r13'],
      ['удаление из tyres.extra', 'extra', 'tyres:extra', 'extra-set'],
      ['удаление из voyah без плашки', 'voyah', 'voyah', 'voyah-plugs'],
      ['удаление из voyah с плашкой featured', 'voyah', 'voyah', 'voyah-oil'],
      ['несуществующая категория', 'group', 'unknown-cat', 'oil-mt'],
      ['несуществующая позиция', 'group', 'to', 'no-such-item'],
    ];

    for (const [label, kind, catId, id] of removeCases) {
      const tsFind = tsFindPriceItem(base, kind, catId, id);
      const jsFind = jsFindPriceItem(base, kind, catId, id);
      assert.deepEqual(tsFind, jsFind, `findPriceItem расходится на кейсе «${label}»`);

      const tsRes = tsRemovePriceItem(base, kind, catId, id);
      const jsRes = jsRemovePriceItem(base, kind, catId, id);
      assert.equal(tsRes.ok, jsRes.ok, `removePriceItem.ok расходится на кейсе «${label}»`);
      if (!tsRes.ok && !jsRes.ok) {
        assert.deepEqual(tsRes.errors, jsRes.errors, `removePriceItem.errors расходится на кейсе «${label}»`);
      } else if (tsRes.ok && jsRes.ok) {
        assert.deepEqual(tsRes.value, jsRes.value, `removePriceItem.value расходится на кейсе «${label}»`);
      }
    }

    const renameCases: Array<[string, PriceKind, string, string, PriceItemPatch]> = [
      ['переименование позиции группы', 'group', 'to', 'oil-sedan', { name: 'Новое имя работы', price: '1250 ₽' }],
      ['правка комплекта шин set', 'set', 'tyres:set', 'set-r16', { radius: 'R16+', passenger: '2300 ₽', crossover: '2500 ₽' }],
      ['правка ремонта колеса repair', 'repair', 'tyres:repair', 'rep-r13', { range: 'R13–R16', price: '700 ₽' }],
      ['правка доп. работ extra', 'extra', 'tyres:extra', 'extra-set', { name: 'Смена готовых колёс', price: '1100 ₽' }],
      ['правка voyah с примечанием', 'voyah', 'voyah', 'voyah-oil', { name: 'ТО Voyah', note: 'с фильтрами', price: '2100 ₽' }],
      ['ошибка: короткое имя', 'group', 'to', 'oil-sedan', { name: 'Я' }],
      ['ошибка: слишком длинное примечание', 'voyah', 'voyah', 'voyah-oil', { note: 'А'.repeat(161) }],
      ['ошибка: цена без цифры', 'group', 'to', 'oil-sedan', { price: 'по договорённости' }],
      ['ошибка: цена 0 ₽ без от', 'group', 'to', 'oil-sedan', { price: '0 ₽' }],
      ['ошибка: цена с руб.', 'group', 'to', 'oil-sedan', { price: '1500 руб.' }],
      ['ошибка: слишком длинный радиус', 'set', 'tyres:set', 'set-r16', { radius: 'R'.repeat(25) }],
      ['ошибка: несуществующая позиция', 'group', 'to', 'missing-item', { name: 'Тест', price: '1000 ₽' }],
    ];

    for (const [label, kind, catId, id, patch] of renameCases) {
      const tsRes = tsRenamePriceItem(base, kind, catId, id, patch);
      const jsRes = jsRenamePriceItem(base, kind, catId, id, patch);
      assert.equal(tsRes.ok, jsRes.ok, `renamePriceItem.ok расходится на кейсе «${label}»`);
      if (!tsRes.ok && !jsRes.ok) {
        assert.deepEqual(tsRes.errors, jsRes.errors, `renamePriceItem.errors расходится на кейсе «${label}»`);
      } else if (tsRes.ok && jsRes.ok) {
        assert.deepEqual(tsRes.value, jsRes.value, `renamePriceItem.value расходится на кейсе «${label}»`);
      }
    }
  });

  it('6. collectPriceRefs на фикстурах: id, alias, {{tyre:set-r16}}, featured.ref и исключение админки', async () => {
    const fixturePrices = makeFixture();
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'price-refs-test-'));

    try {
      const writeFixtureFile = (rel: string, content: string) => {
        const full = path.join(tmpRoot, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf8');
      };

      // Ссылка по id и по слагу названия (alias)
      writeFixtureFile(
        'src/pages/services/tormoza.astro',
        '---\nconst p = 1;\n---\n<p>Колодки — {{price:pads-front}}</p>\n',
      );
      writeFixtureFile(
        'src/pages/index.astro',
        '<p>Масло — {{from:zamena-masla-v-dvigatele-sedan}}</p>\n<p>Шины R16 — {{tyre:set-r16}}</p>\n',
      );
      // Админский файл — не должен попасть в отчёт
      writeFixtureFile(
        'src/pages/admin/prices/index.astro',
        '<p>Пример {{price:pads-front}} и {{price:oil-mt}}</p>\n',
      );
      writeFixtureFile(
        'public/manage/prices.js',
        '// Пример {{price:oil-mt}}\n',
      );

      const report = collectPriceRefs(fixturePrices, {
        siteRoot: tmpRoot,
        roots: [path.join(tmpRoot, 'src'), path.join(tmpRoot, 'content')],
      });

      assert.equal(report.prices_updated_at, '2026-11-19');
      assert.deepEqual(report.featured, { 'voyah-oil': ['chip-oil'] });

      // pads-front: только из витрины, не из админки
      assert.deepEqual(report.refs['pads-front'], [
        {
          file: 'src/pages/services/tormoza.astro',
          line: 4,
          token: '{{price:pads-front}}',
          matched: 'id',
        },
      ]);

      // oil-sedan: найден по слагу названия -> matched: "alias"
      assert.deepEqual(report.refs['oil-sedan'], [
        {
          file: 'src/pages/index.astro',
          line: 1,
          token: '{{from:zamena-masla-v-dvigatele-sedan}}',
          matched: 'alias',
        },
      ]);

      // {{tyre:set-r16}} -> ссылка на set-r16
      assert.deepEqual(report.refs['set-r16'], [
        {
          file: 'src/pages/index.astro',
          line: 2,
          token: '{{tyre:set-r16}}',
          matched: 'id',
        },
      ]);

      // oil-mt упоминался только в админке -> в refs его нет
      assert.equal(report.refs['oil-mt'], undefined);

      // Проверка buildPriceRefs / writePriceRefs на реальном проекте
      const outPath = path.join(tmpRoot, 'out/price-refs.json');
      const written = await writePriceRefs({ outFile: outPath });
      assert.ok(fs.existsSync(outPath));
      assert.ok(written.refs['pads-front']?.some((r: { matched: string }) => r.matched === 'id'));
      assert.deepEqual(written.featured['voyah-oil'], ['voyah-oil-chip']);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('7. prices-store на временном PRICES_FILE: удаление и переименование пишут файл и обновляют кэш', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prices-store-del-'));
    const tmpFile = path.join(tmpDir, 'prices.json');
    process.env.PRICES_FILE = tmpFile;

    try {
      const initial = makeFixture();
      writePricesFile(initial);
      assert.ok(storeFindPriceItem('group', 'to', 'oil-mt'));

      // Переименование через store
      const afterRename = storeRenamePriceItem('group', 'to', 'oil-sedan', {
        name: 'Масло ДВС (седан) — обновлено',
        price: '1150–1350 ₽',
      });
      assert.equal(afterRename.groups[0].items[0].name, 'Масло ДВС (седан) — обновлено');
      assert.equal(getPrices().groups[0].items[0].price, '1150–1350 ₽');

      // Удаление через store
      const afterRemove = storeRemovePriceItem('group', 'to', 'oil-mt');
      assert.equal(afterRemove.groups[0].items.length, 1);
      assert.equal(storeFindPriceItem('group', 'to', 'oil-mt'), undefined);

      // Повторное чтение с диска отдаёт новое состояние
      clearPricesCache();
      const reloaded = readPricesFile();
      assert.deepEqual(
        reloaded.groups[0].items.map((i) => i.id),
        ['oil-sedan'],
      );
      assert.equal(reloaded.groups[0].items[0].name, 'Масло ДВС (седан) — обновлено');

      // Отказ при удалении позиции, на которую ссылается featured
      assert.throws(
        () => storeRemovePriceItem('voyah', 'voyah', 'voyah-oil'),
        /Сначала уберите плашку/,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
