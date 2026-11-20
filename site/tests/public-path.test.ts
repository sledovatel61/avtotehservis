import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BASE_PATH,
  DEFAULT_PUBLIC_ORIGIN,
  readPublicPath,
} from '../scripts/lib/public-path.mjs';

describe('readPublicPath — разбор PUBLIC_ORIGIN и PUBLIC_BASE_PATH (круг 88)', () => {
  it('значения по умолчанию (без переменных и при пустых строках из GitHub Actions vars.*)', () => {
    const def1 = readPublicPath({});
    assert.equal(def1.base, '/avtotehservis');
    assert.equal(def1.publicOrigin, 'https://sledovatel61.github.io');
    assert.equal(def1.cnameHost, null);
    assert.equal(def1.base, DEFAULT_BASE_PATH);
    assert.equal(def1.publicOrigin, DEFAULT_PUBLIC_ORIGIN);

    // Незаданные переменные репозитория в GitHub Actions приходят пустыми строками
    const def2 = readPublicPath({ PUBLIC_ORIGIN: '', PUBLIC_BASE_PATH: '' });
    assert.equal(def2.base, '/avtotehservis');
    assert.equal(def2.publicOrigin, 'https://sledovatel61.github.io');
    assert.equal(def2.cnameHost, null);
  });

  it('пустой base (корень домена при PUBLIC_BASE_PATH="/") и cnameHost для своего домена', () => {
    const rootDomain = readPublicPath({
      PUBLIC_ORIGIN: 'https://ats-rostov.ru',
      PUBLIC_BASE_PATH: '/',
    });
    assert.equal(rootDomain.base, '');
    assert.equal(rootDomain.publicOrigin, 'https://ats-rostov.ru');
    assert.equal(rootDomain.cnameHost, 'ats-rostov.ru');
  });

  it('нормализация PUBLIC_BASE_PATH ("avtotehservis/" → "/avtotehservis", "/sub/dir/" → "/sub/dir")', () => {
    assert.equal(
      readPublicPath({ PUBLIC_BASE_PATH: 'avtotehservis/' }).base,
      '/avtotehservis',
    );
    assert.equal(
      readPublicPath({ PUBLIC_BASE_PATH: '/avtotehservis/' }).base,
      '/avtotehservis',
    );
    assert.equal(
      readPublicPath({ PUBLIC_BASE_PATH: 'preview/v2/' }).base,
      '/preview/v2',
    );
  });

  it('отказ на http:// в PUBLIC_ORIGIN', () => {
    assert.throws(
      () => readPublicPath({ PUBLIC_ORIGIN: 'http://ats-rostov.ru' }),
      /https:\/\//,
    );
  });

  it('отказ на завершающий "/" в PUBLIC_ORIGIN', () => {
    assert.throws(
      () => readPublicPath({ PUBLIC_ORIGIN: 'https://ats-rostov.ru/' }),
      /не должен заканчиваться на «\/»/,
    );
  });

  it('отказ на мусор в PUBLIC_ORIGIN и PUBLIC_BASE_PATH', () => {
    // Мусор в PUBLIC_ORIGIN: не URL, путь, query, пробелы
    assert.throws(() => readPublicPath({ PUBLIC_ORIGIN: 'not-a-url' }));
    assert.throws(() => readPublicPath({ PUBLIC_ORIGIN: 'https://ats-rostov.ru/sub' }));
    assert.throws(() => readPublicPath({ PUBLIC_ORIGIN: 'https://ats-rostov.ru?x=1' }));
    assert.throws(() => readPublicPath({ PUBLIC_ORIGIN: 'https://ats rostov.ru' }));

    // Мусор в PUBLIC_BASE_PATH: пробелы, query, hash, "..", "//", URL
    assert.throws(() => readPublicPath({ PUBLIC_BASE_PATH: '/bad path' }));
    assert.throws(() => readPublicPath({ PUBLIC_BASE_PATH: '/path?query=1' }));
    assert.throws(() => readPublicPath({ PUBLIC_BASE_PATH: '/path#hash' }));
    assert.throws(() => readPublicPath({ PUBLIC_BASE_PATH: '/../secret' }));
    assert.throws(() => readPublicPath({ PUBLIC_BASE_PATH: '//evil.example' }));
    assert.throws(() => readPublicPath({ PUBLIC_BASE_PATH: 'https://ats-rostov.ru' }));
  });
});
