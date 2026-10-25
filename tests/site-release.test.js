import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareSite } from '../scripts/prepare-site.mjs';

const source = fileURLToPath(new URL('../dist', import.meta.url));
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'battle-words-site-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDir = join(root, 'dist');
  await cp(source, sourceDir, { recursive: true });
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  return { root, sourceDir, outputDir: join(root, '.tmp', 'site') };
}
async function contents(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await contents(join(directory, entry.name), name + '/'));
    else result.push([name, await readFile(join(directory, entry.name))]);
  }
  return result.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

test('published assets preserve the module graph and load their own dictionary without changing source', async t => {
  const paths = await fixture(t);
  const before = await contents(paths.sourceDir);
  const { id } = await prepareSite(paths);
  assert.match(id, /^[a-f0-9]{64}$/);
  assert.deepEqual(await contents(paths.sourceDir), before);
  const release = join(paths.outputDir, '_releases', id);
  const html = await readFile(join(paths.outputDir, 'index.html'), 'utf8');
  assert.ok(html.includes(`<meta name="game-release" content="${id}">`));
  assert.ok(html.includes(`href="./_releases/${id}/styles.css"`));
  assert.ok(html.includes(`href="./_releases/${id}/data/SCOWL-LICENSE.txt"`));
  assert.ok(html.includes(`href="./_releases/${id}/data/ESDB-LICENSE.txt"`));
  assert.ok(!html.includes("import { boot } from './js/site-release.js'"));
  assert.deepEqual(JSON.parse(await readFile(join(paths.outputDir, 'release.json'))), { id });
  for (const [name, bytes] of before) {
    if (name === 'index.html') continue;
    const destination = name === 'manifest.webmanifest' ? join(paths.outputDir, name) : join(release, name);
    assert.deepEqual(await readFile(destination), bytes, name);
    if (!name.startsWith('js/') || !name.endsWith('.js')) continue;
    // All browser dependencies must resolve inside the same immutable release.
    for (const [, specifier] of bytes.toString().matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) {
      const dependency = new URL(specifier, pathToFileURL(destination));
      assert.ok(dependency.href.startsWith(pathToFileURL(release + '/').href));
      await access(dependency);
    }
  }
  for (const file of ['js/app.js', 'data/words.json', 'styles.css']) {
    await assert.rejects(access(join(paths.outputDir, file)), { code: 'ENOENT' });
  }
  const manifest = JSON.parse(await readFile(join(paths.outputDir, 'manifest.webmanifest')));
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  for (const icon of manifest.icons) await access(new URL(icon.src, pathToFileURL(join(paths.outputDir, 'manifest.webmanifest'))));

  const requested = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requested.push(url.href);
    return new Response(await readFile(url));
  });
  const { loadWordBank } = await import(pathToFileURL(join(release, 'js/word-bank.js')));
  const bank = await loadWordBank();
  assert.ok(bank.targetCount > 0 && bank.count > bank.targetCount);
  assert.equal(requested.length, 2);
  assert.ok(requested.every(url => url.startsWith(pathToFileURL(join(release, 'data') + '/').href)));
});

test('release IDs depend on content, not directory insertion order, and every deploy input affects them', async t => {
  const paths = await fixture(t);
  const baseline = (await prepareSite(paths)).id;
  const originals = await contents(paths.sourceDir);
  const other = await fixture(t);
  // Recreate the other source in reverse order; timestamps/order are not release inputs.
  await rm(other.sourceDir, { recursive: true });
  for (const [name, bytes] of [...originals].reverse()) {
    const target = join(other.sourceDir, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  assert.equal((await prepareSite(other)).id, baseline);
  for (const name of ['index.html', 'styles.css', 'js/app.js', 'js/site-release.js', 'js/battle-config.js', 'data/words.json', 'assets/icon.svg']) {
    const path = join(paths.sourceDir, name);
    const original = await readFile(path);
    await writeFile(path, Buffer.concat([original, Buffer.from('\n')]));
    assert.notEqual((await prepareSite(paths)).id, baseline, `${name} must change the release URL`);
    await writeFile(path, original);
  }
  assert.equal((await prepareSite(paths)).id, baseline);
});

test('a new package removes old release files and rejects dangerous cleanup destinations', async t => {
  const paths = await fixture(t);
  const first = await prepareSite(paths);
  await writeFile(join(paths.outputDir, 'stale.txt'), 'old deployment');
  await writeFile(join(paths.sourceDir, 'styles.css'), 'body { color: black; }');
  const second = await prepareSite(paths);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(await readdir(join(paths.outputDir, '_releases')), [second.id]);
  await assert.rejects(access(join(paths.outputDir, 'stale.txt')), { code: 'ENOENT' });

  for (const outputDir of [paths.root, paths.sourceDir, join(paths.sourceDir, 'site'), join(paths.root, 'unrelated')]) {
    await assert.rejects(prepareSite({ ...paths, outputDir }), /Site output must/);
  }
  await access(join(paths.sourceDir, 'index.html'));
  await access(join(paths.outputDir, 'index.html'));
});
