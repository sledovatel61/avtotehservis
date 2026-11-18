import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, truncate, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const schema = await import('../src/shared/cases-schema.ts');
const { LIMITS } = await import('../public/manage/store.js');
const caseScript = join(root, 'scripts/check-cases.mjs');
const budgetScript = join(root, 'scripts/check-media-budget.mjs');

const photo = (overrides: Record<string, unknown> = {}) => ({
  base: 'abcd-after', alt: 'Передняя стойка после ремонта', w: 1600, h: 1200, ...overrides,
});
const siteCase = (overrides: Record<string, unknown> = {}): any => ({
  slug: 'demo-case', title: 'Ремонт ходовой', description: 'Замена передней стойки',
  service_slug: null, mode: 'before_after', status: 'published', published_at: '2026-10-15', sort: 10,
  cover: null, before: [], after: [photo()], photos: [], ...overrides,
});
const casesFile = (cases: unknown[]) => ({ version: 1, updated_at: '2026-10-15T10:00:00.000Z', cases });
function runNode(script: string, args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
}

// Do not run test cases concurrently: the cases-store test intentionally changes CASES_FILE.
test('parseCasesFile принимает минимальный файл и отбрасывает только испорченное фото', () => {
  const valid = schema.parseCasesFile(casesFile([siteCase({ mode: 'single', before: [], after: [], photos: [photo({ base: 'abcd-single' })] })]));
  assert.equal(valid.errors.length, 0);
  assert.equal(valid.file.cases.length, 1);
  assert.equal(valid.file.cases[0].photos[0].base, 'abcd-single');

  const noAlt = schema.parseCasesFile(casesFile([siteCase({ after: [photo({ alt: undefined })] })]));
  assert.equal(noAlt.file.cases.length, 1);
  assert.equal(noAlt.file.cases[0].after.length, 0);
  assert.ok(noAlt.errors.some((error: string) => error.includes('after[0].alt')));

  const badBase = schema.parseCasesFile(casesFile([siteCase({ after: [photo({ base: '../bad' })] })]));
  assert.equal(badBase.file.cases[0].after.length, 0);
  assert.ok(badBase.errors.some((error: string) => error.includes('after[0].base')));

  const badDimensions = schema.parseCasesFile(casesFile([siteCase({ after: [photo({ w: 0, h: -1 })] })]));
  assert.equal(badDimensions.file.cases[0].after.length, 0);
  assert.ok(badDimensions.errors.some((error: string) => error.includes('размеры')));

  // parseCasesFile проверяет поля, но не межполевой режим; check-cases ловит это отдельно.
  const inconsistentMode = schema.parseCasesFile(casesFile([siteCase({ mode: 'single', before: [photo({ base: 'abcd-before' })], after: [], photos: [] })]));
  assert.equal(inconsistentMode.errors.length, 0);
  assert.equal(inconsistentMode.file.cases[0].before.length, 1);
});

test('photoPath и photoSrcset дают стабильные адреса для webp и jpg', () => {
  const p = photo();
  assert.equal(schema.photoPath('demo-case', p, 960), '/media/cases/demo-case/abcd-after-960.webp');
  assert.equal(schema.photoPath('demo-case', { ...p, ext: 'jpg' }, 480), '/media/cases/demo-case/abcd-after-480.jpg');
  assert.equal(schema.photoSrcset('demo-case', p), '/media/cases/demo-case/abcd-after-480.webp 480w, /media/cases/demo-case/abcd-after-960.webp 960w, /media/cases/demo-case/abcd-after-1600.webp 1600w');
  assert.equal(schema.photoSrcset('demo-case', { ...p, ext: 'jpg' }), '/media/cases/demo-case/abcd-after-480.jpg 480w, /media/cases/demo-case/abcd-after-960.jpg 960w, /media/cases/demo-case/abcd-after-1600.jpg 1600w');
});

test('caseCover: cover, затем after, photos, before', () => {
  const cover = photo({ base: 'cover-after' });
  const after = photo({ base: 'first-after' });
  const photos = photo({ base: 'first-single' });
  const before = photo({ base: 'first-before' });
  assert.equal(schema.caseCover(siteCase({ cover, after: [after], photos: [photos], before: [before] })), cover);
  assert.equal(schema.caseCover(siteCase({ cover: null, after: [after], photos: [photos], before: [before] })), after);
  assert.equal(schema.caseCover(siteCase({ cover: null, after: [], photos: [photos], before: [before] })), photos);
  assert.equal(schema.caseCover(siteCase({ cover: null, after: [], photos: [], before: [before] })), before);
  assert.equal(schema.caseCover(siteCase({ cover: null, after: [], photos: [], before: [] })), null);
});

test('orderCases сортирует sort вверх, при равном published_at — свежую дату выше', () => {
  const ordered = schema.orderCases([
    siteCase({ slug: 'latest', sort: 2, published_at: '2026-10-20' }),
    siteCase({ slug: 'early-sort', sort: 1, published_at: '2026-10-10' }),
    siteCase({ slug: 'older', sort: 2, published_at: '2026-10-01' }),
  ]);
  assert.deepEqual(ordered.map((item: { slug: string }) => item.slug), ['early-sort', 'latest', 'older']);
});

test('LIMITS админки совпадают с границами, фактически принимаемыми schema parser', () => {
  const boundaries: Record<string, [number, number]> = {
    title: [LIMITS.title.min, LIMITS.title.max],
    description: [LIMITS.description.min, LIMITS.description.max],
    alt: [LIMITS.alt.min, LIMITS.alt.max],
    slug: [LIMITS.slug.min, LIMITS.slug.max],
  };
  for (const [field, [min, max]] of Object.entries(boundaries)) {
    for (const length of new Set([min, max])) {
      const values: any = { ...siteCase(), after: [photo()] };
      if (field === 'alt') values.after[0].alt = 'x'.repeat(length);
      else values[field] = 'x'.repeat(length);
      const parsed = schema.parseCasesFile(casesFile([values]));
      assert.equal(parsed.errors.length, 0, `${field}=${length} should be accepted: ${parsed.errors.join('; ')}`);
      assert.equal(parsed.file.cases.length, 1);
    }
    for (const length of new Set([min - 1, max + 1].filter((value) => value >= 0))) {
      const values: any = { ...siteCase(), after: [photo()] };
      if (field === 'alt') values.after[0].alt = 'x'.repeat(Math.max(0, length));
      else values[field] = field === 'description' && length < 0 ? '' : 'x'.repeat(Math.max(0, length));
      const parsed = schema.parseCasesFile(casesFile([values]));
      assert.ok(parsed.errors.some((error: string) => error.includes(field)), `${field}=${length} should be rejected`);
      if (field === 'alt') {
        assert.equal(parsed.file.cases.length, 1);
        assert.equal(parsed.file.cases[0].after.length, 0);
      } else assert.equal(parsed.file.cases.length, 0);
    }
  }
});

test('cases-store: CASES_FILE, битый JSON без исключения, draft фильтр, mtime сбрасывает кэш', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ats-cases-store-'));
  const file = join(dir, 'cases.json');
  const oldEnv = process.env.CASES_FILE;
  const warn = console.warn;
  const warnings: string[] = [];
  const store = await import('../src/server/cases-store.ts');
  try {
    process.env.CASES_FILE = file;
    await writeFile(file, '{not json');
    store.resetCasesCache();
    console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
    assert.doesNotThrow(() => store.readCasesFile());
    assert.equal(store.readCasesFile().file.cases.length, 0);
    assert.ok(warnings.some((line) => line.includes('битый JSON')));

    await writeFile(file, JSON.stringify(casesFile([
      siteCase({ slug: 'live-case', status: 'published' }),
      siteCase({ slug: 'draft-case', status: 'draft' }),
    ])));
    const future = new Date(Date.now() + 5000);
    await utimes(file, future, future);
    store.resetCasesCache();
    assert.deepEqual(store.listPublishedSiteCases(0).map((item: { slug: string }) => item.slug), ['live-case']);

    await writeFile(file, JSON.stringify(casesFile([siteCase({ slug: 'draft-case', status: 'draft' })])));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const newer = new Date(Date.now() + 10000);
    await utimes(file, newer, newer);
    assert.deepEqual(store.listPublishedSiteCases(0), []);
    assert.equal(store.readCasesFile().file.cases[0].status, 'draft');
  } finally {
    console.warn = warn;
    if (oldEnv === undefined) delete process.env.CASES_FILE;
    else process.env.CASES_FILE = oldEnv;
    store.resetCasesCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test('check-media-budget: чистые три ширины проходят, 900 КБ и пропущенная ширина падают', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ats-media-budget-'));
  try {
    const media = join(dir, 'media');
    const cases = join(dir, 'cases.json');
    const folder = join(media, 'cases', 'demo-case');
    await mkdir(folder, { recursive: true });
    await writeFile(cases, JSON.stringify(casesFile([siteCase({ slug: 'demo-case' })])));
    for (const width of [480, 960, 1600]) await writeFile(join(folder, `abcd-after-${width}.webp`), Buffer.alloc(100 * 1024));

    let result = runNode(budgetScript, ['--json', '--media-dir', media, '--cases', cases]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).totals.files, 3);
    assert.deepEqual(JSON.parse(result.stdout).errors, []);

    await writeFile(join(folder, 'abcd-after-1600.webp'), Buffer.alloc(900 * 1024));
    result = runNode(budgetScript, ['--json', '--media-dir', media, '--cases', cases]);
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).errors.some((error: string) => error.includes('лимит 800 КБ')));

    await rm(join(folder, 'abcd-after-960.webp'));
    result = runNode(budgetScript, ['--json', '--media-dir', media, '--cases', cases]);
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).errors.some((error: string) => error.includes('отсутствуют варианты 960')));

    const bulk = join(media, 'bulk.bin');
    await writeFile(bulk, '');
    await truncate(bulk, 400 * 1024 * 1024);
    result = runNode(budgetScript, ['--json', '--media-dir', media, '--cases', cases]);
    assert.ok(JSON.parse(result.stdout).warnings.some((warning: string) => warning.includes('400 МБ')));
    await truncate(bulk, 700 * 1024 * 1024);
    result = runNode(budgetScript, ['--json', '--media-dir', media, '--cases', cases]);
    assert.ok(JSON.parse(result.stdout).errors.some((error: string) => error.includes('700 МБ')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('check-cases: сверяет реальные размеры, предупреждает про alt и не пропускает черновик в pages-dist', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ats-check-cases-'));
  try {
    const media = join(dir, 'media');
    const pagesDist = join(dir, 'pages-dist');
    const cases = join(dir, 'cases.json');
    const folder = join(media, 'cases', 'demo-case');
    await mkdir(folder, { recursive: true });
    await mkdir(pagesDist, { recursive: true });
    await writeFile(join(pagesDist, 'index.html'), '<!doctype html><title>test</title>');
    for (const width of [480, 960, 1600]) {
      const height = Math.round(1200 * width / 1600);
      await sharp({ create: { width, height, channels: 3, background: '#456' } }).webp().toFile(join(folder, `abcd-after-${width}.webp`));
    }

    const published = siteCase();
    await writeFile(cases, JSON.stringify(casesFile([published])));
    let result = runNode(caseScript, ['--json', '--cases', cases, '--media-dir', media, '--pages-dist', pagesDist]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).summary.published, 1);

    await writeFile(cases, JSON.stringify(casesFile([siteCase({ mode: 'single', before: [photo({ base: 'abcd-before' })], after: [], photos: [] })])));
    result = runNode(caseScript, ['--json', '--cases', cases, '--media-dir', media, '--pages-dist', pagesDist]);
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).errors.some((error: string) => error.includes('режим single')));

    await writeFile(cases, JSON.stringify(casesFile([siteCase({ status: 'draft' })])));
    const draftPage = join(pagesDist, 'cases', 'demo-case', 'index.html');
    await mkdir(dirname(draftPage), { recursive: true });
    await writeFile(draftPage, '<!doctype html>');
    result = runNode(caseScript, ['--json', '--cases', cases, '--media-dir', media, '--pages-dist', pagesDist]);
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).errors.some((error: string) => error.includes('черновик появился')));
    await rm(draftPage);

    await writeFile(cases, JSON.stringify(casesFile([siteCase({ after: [photo({ alt: 'Официальный сервис' })] })])));
    result = runNode(caseScript, ['--json', '--cases', cases, '--media-dir', media, '--pages-dist', pagesDist]);
    assert.equal(result.status, 1);
    assert.ok(JSON.parse(result.stdout).errors.some((error: string) => error.includes('официальный')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
