import assert from 'node:assert/strict';
import test from 'node:test';
import { boot, checkForUpdate, freshPageUrl } from '../dist/js/site-release.js';

const oldId = 'a'.repeat(64);
const newId = 'b'.repeat(64);
const room = 'c'.repeat(32);
const href = `https://example.test/battle-words/?other=value#room=${room}`;

function fixture(id, url = href) {
  const status = { textContent: '' };
  const retry = { hidden: true };
  const navigations = [];
  const imports = [];
  const cleanups = [];
  return {
    status, retry, navigations, imports, cleanups,
    options: {
      document: { getElementById: name => name === 'load-status' ? status : retry,
        querySelector: () => ({ content: id }) },
      location: { href: url, replace: value => navigations.push(value) },
      history: { state: { kept: true }, replaceState: (...args) => cleanups.push(args) },
      fetchImpl: async () => Response.json({ id: newId }),
      loadApp: async value => imports.push(value),
    },
  };
}

test('local source preview needs no release manifest or network check', async () => {
  const f = fixture('development', 'http://127.0.0.1:4173/battle-words/');
  f.options.fetchImpl = () => { throw new Error('unexpected network request'); };
  assert.equal(await boot(f.options), true);
  assert.deepEqual(f.imports, ['http://127.0.0.1:4173/battle-words/js/app.js']);
});

test('release checks bypass browser and intermediary caches and retain invitations', async () => {
  const update = await checkForUpdate({ currentId: oldId, href, now: () => 1234,
    fetchImpl: async (url, options) => {
      assert.equal(url.href, 'https://example.test/battle-words/release.json?check=1234');
      assert.equal(options.cache, 'no-store');
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json({ id: newId });
    },
  });
  const next = new URL(update);
  assert.equal(next.searchParams.get('release'), newId);
  assert.equal(next.searchParams.get('other'), 'value');
  assert.equal(next.hash, `#room=${room}`);
});

test('stale HTML updates before importing any cached game modules', async () => {
  const f = fixture(oldId);
  assert.equal(await boot(f.options), false);
  assert.equal(f.navigations.length, 1);
  assert.equal(new URL(f.navigations[0]).searchParams.get('release'), newId);
  assert.equal(new URL(f.navigations[0]).hash, `#room=${room}`);
  assert.deepEqual(f.imports, []);
});

test('fresh HTML loads only its pinned release and cleans update markers before app startup', async () => {
  for (const base of ['https://example.test/', 'https://example.test/battle-words/']) {
    const f = fixture(newId, `${base}?release=${newId}&refresh=123#room=${room}`);
    assert.equal(await boot(f.options), true);
    assert.deepEqual(f.imports, [`${base}_releases/${newId}/js/app.js`]);
    assert.deepEqual(f.navigations, []);
    assert.deepEqual(f.cleanups, [[{ kept: true }, '', `${base}#room=${room}`]]);
  }
});

test('an incomplete publication cannot cause an automatic reload loop', async () => {
  const f = fixture(oldId, `https://example.test/battle-words/?release=${newId}#room=${room}`);
  assert.equal(await boot(f.options), false);
  assert.deepEqual(f.navigations, []);
  assert.deepEqual(f.imports, []);
  assert.equal(f.retry.hidden, false);
  assert.match(f.status.textContent, /still being published/);
  f.retry.onclick();
  assert.equal(f.navigations.length, 1, 'only explicit retry reloads again');
  assert.ok(new URL(f.navigations[0]).searchParams.has('refresh'));
  assert.equal(new URL(f.navigations[0]).hash, `#room=${room}`);
});

test('failed update checks and missing release modules offer recovery without unversioned fallback', async () => {
  for (const damage of [
    options => { options.fetchImpl = async () => { throw new Error('offline'); }; },
    options => { options.fetchImpl = async () => new Response('Not found', { status: 404 }); },
    options => { options.fetchImpl = async () => Response.json({ id: '../wrong-path' }); },
    options => { options.loadApp = async () => { throw new Error('missing old release'); }; },
  ]) {
    const f = fixture(newId);
    damage(f.options);
    assert.equal(await boot(f.options), false);
    assert.equal(f.retry.hidden, false);
    assert.match(f.status.textContent, /couldn’t load/);
    assert.deepEqual(f.navigations, []);
  }
});

test('explicit recovery keeps the page path, other parameters and room fragment', () => {
  assert.equal(freshPageUrl(href, 123), `https://example.test/battle-words/?other=value&refresh=123#room=${room}`);
});
