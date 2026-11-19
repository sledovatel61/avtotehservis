import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findDemoInArtifact } from '../scripts/check-reviews-artifact.mjs';

const SIX_DEMO_ITEMS = [
  {
    id: 'r-2026-11-14-001',
    text: 'Заезжал на сезонный шиномонтаж и балансировку комплекта R17 по предварительной записи.',
    demo: true,
  },
  {
    id: 'r-2026-11-05-001',
    text: 'Меняли передние тормозные колодки и диски, заодно обслужили направляющие суппортов.',
    demo: true,
  },
  {
    id: 'r-2026-10-26-001',
    text: 'Обратился со стуком в передней подвеске на мелких неровностях. На подъёмнике нашли люфт.',
    demo: true,
  },
  {
    id: 'r-2026-10-17-001',
    text: 'Проходила плановое ТО: замена моторного масла, масляного, воздушного и салонного фильтров.',
    demo: true,
  },
  {
    id: 'r-2026-10-07-001',
    text: 'Менял рулевые наконечники и тяги с последующей проверкой углов установки колёс (развал-схождение).',
    demo: true,
  },
  {
    id: 'r-2026-09-25-001',
    text: 'Приехал на компьютерную диагностику — загорелся индикатор двигателя и появились подёргивания.',
    demo: true,
  },
];

describe('check-reviews-artifact — защита боевого домена от демо-отзывов (круг 88)', () => {
  it('1. basePath="/avtotehservis", HTML с чипами rev-demo → ok: true (превью, демо разрешены)', () => {
    const html = `
      <div class="rev-grid">
        <article class="rev-card"><p>${SIX_DEMO_ITEMS[0].text}</p><span class="rev-demo">пример</span></article>
        <article class="rev-card"><p>${SIX_DEMO_ITEMS[1].text}</p><span class="rev-demo">пример</span></article>
      </div>
    `;
    const res = findDemoInArtifact({
      html,
      items: SIX_DEMO_ITEMS,
      basePath: '/avtotehservis',
    });
    assert.equal(res.ok, true);
    assert.equal(res.demoCount, 2);
  });

  it('2. basePath="/", HTML с чипами rev-demo → ok: false, в problems есть id демо-отзывов', () => {
    const html = `
      <div class="rev-grid">
        <article class="rev-card"><p>${SIX_DEMO_ITEMS[0].text}</p><span class="rev-demo">пример</span></article>
        <article class="rev-card"><p>${SIX_DEMO_ITEMS[1].text}</p><span class="rev-demo">пример</span></article>
      </div>
    `;
    const res = findDemoInArtifact({
      html,
      items: SIX_DEMO_ITEMS,
      basePath: '/',
    });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.ok(res.problems.some((p) => p.includes('r-2026-11-14-001')));
    assert.ok(res.problems.some((p) => p.includes('r-2026-11-05-001')));
  });

  it('3. basePath="/", шесть демо-записей в items, но без чипов и без текстов на странице → ok: true', () => {
    const emptyStateHtml = `
      <section class="sec">
        <p class="rev-summary-line">Пока на сайте нет опубликованных отзывов — будьте первым.</p>
        <p class="hint">Читайте отзывы на Яндекс.Картах — там же оценки и схема проезда.</p>
      </section>
    `;
    const res = findDemoInArtifact({
      html: emptyStateHtml,
      items: SIX_DEMO_ITEMS,
      basePath: '/',
    });
    assert.equal(res.ok, true);
    assert.equal(res.demoCount, 0);
  });

  it('4. basePath="/", HTML без чипа rev-demo, но с текстом демо-отзыва → ok: false (ловит утечку текста без чипа)', () => {
    const leakedTextHtml = `
      <div class="rev-grid">
        <article class="rev-card">
          <div class="rev-text"><p>${SIX_DEMO_ITEMS[2].text}</p></div>
        </article>
      </div>
    `;
    const res = findDemoInArtifact({
      html: leakedTextHtml,
      items: SIX_DEMO_ITEMS,
      basePath: '/',
    });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.ok(res.problems.some((p) => p.includes('демо-отзыв «r-2026-10-26-001» в /otzyvy')));
  });

  it('5. файла pages-dist/otzyvy/index.html нет → CLI выходит с кодом 2 и пишет понятный текст', () => {
    const scriptPath = path.resolve(import.meta.dirname, '../scripts/check-reviews-artifact.mjs');
    const emptyTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-artifact-'));
    try {
      const proc = spawnSync(process.execPath, [scriptPath, '--pages-dist', emptyTmpDir], {
        encoding: 'utf8',
      });
      assert.equal(proc.status, 2);
      assert.match(proc.stderr, /не найден собранный файл.*otzyvy\/index\.html/);
    } finally {
      fs.rmSync(emptyTmpDir, { recursive: true, force: true });
    }
  });
});
