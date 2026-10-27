import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { JSDOM } from 'jsdom';

const root = resolve(import.meta.dirname, '../pages-dist');
let pages = 0;
let links = 0;
async function exists(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) {
      assert.ok(!['admin', 'api', 'server', 'data'].includes(entry.name), `Private directory: ${file}`);
      await walk(file);
    } else if (entry.name.endsWith('.html')) {
      pages++;
      const dom = new JSDOM(await readFile(file, 'utf8'));
      assert.equal(dom.window.document.body.dataset.preview, 'true');
      for (const el of dom.window.document.querySelectorAll('[href], [src], [poster]')) {
        for (const attr of ['href', 'src', 'poster']) {
          const value = el.getAttribute(attr);
          if (!value?.startsWith('/') || value.startsWith('//')) continue;
          assert.ok(value.startsWith('/avtotehservis/'), `Unprefixed URL: ${value} in ${file}`);
          const path = join(root, decodeURIComponent(value.split(/[?#]/)[0].slice('/avtotehservis/'.length)));
          assert.ok(await exists(path) || await exists(join(path, 'index.html')), `Broken link: ${value} in ${file}`);
          links++;
        }
      }
      dom.window.close();
    }
  }
}
await walk(root);
assert.ok(pages >= 9);
console.log(`PASS: ${pages} pages, ${links} local links/assets; no private directories.`);