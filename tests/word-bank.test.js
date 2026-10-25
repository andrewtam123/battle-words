import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadWordBank } from '../dist/js/word-bank.js';
import { chooseWords, GameEngine } from '../dist/js/engine.js';

test('the loader supplies classified targets and preserves broader anagram acceptance', async t => {
  t.mock.method(globalThis, 'fetch', async url => new Response(await readFile(url)));
  const bank = await loadWordBank();
  assert.equal(bank.targetCount, 33299);
  assert.equal(bank.count, 83821);
  assert.equal(bank.normalCount + bank.specializedCount, bank.targetCount);
  assert.ok(bank.normalCount > 0 && bank.specializedCount > 0);
  assert.ok(bank.pools[4].normal.includes('neat'));
  assert.ok(!Object.values(bank.pools[4]).flat().includes('etna'));
  assert.ok(bank.acceptedWords.has('etna'));
  const targets = new Set(Object.values(bank.pools).flatMap(pool => [...pool.normal, ...pool.specialized]));
  for (const seed of [0, 1, 42, 1_791_849_600_123]) {
    const selection = chooseWords(bank.pools, seed);
    assert.ok(selection.every(word => targets.has(word)));
    assert.equal(selection.length, 20);
    assert.equal(selection[18].length, 9);
    assert.equal(selection[19].length, 10);
  }

  // ETNA is a valid higher-tier alternative to the eligible target NEAT.
  const engine = new GameEngine({ ...bank, pools: { ...bank.pools, 4: ['neat'] }, now: () => 0 });
  engine.start(42);
  for (const letter of 'etna') engine.typeLetter(letter);
  assert.equal(engine.snapshot().feedback, 'correct');
  assert.equal(engine.snapshot().results[0].answer, 'etna');
});

test('solo rejects a removed spelling even when it uses the exact target letters', async t => {
  t.mock.method(globalThis, 'fetch', async url => new Response(await readFile(url)));
  const bank = await loadWordBank();
  const engine = new GameEngine({ ...bank, pools: { ...bank.pools, 4: ['care'], 5: ['meter'] }, now: () => 0 });
  engine.start(42);
  for (let round = 0; round < 2; round++) {
    for (const letter of 'care') engine.typeLetter(letter);
    engine.nextRound();
  }
  for (const letter of 'metre') engine.typeLetter(letter);
  assert.equal(engine.snapshot().invalidEntry, 'metre');
  assert.equal(engine.snapshot().status, 'playing');
  for (const letter of 'meter') engine.typeLetter(letter);
  assert.equal(engine.snapshot().feedback, 'correct');
});

for (const filename of ['target-pools.json', 'words.json']) {
  for (const length of [9, 10]) {
    test(`the loader rejects a missing ${length}-letter pool in ${filename}`, async t => {
      t.mock.method(globalThis, 'fetch', async url => {
        const pools = JSON.parse(await readFile(url, 'utf8'));
        if (url.pathname.endsWith(`/${filename}`)) delete pools[length];
        return new Response(JSON.stringify(pools));
      });
      await assert.rejects(loadWordBank(), /The word bank is incomplete or invalid/);
    });
  }
}

test('a missing target bank cannot silently fall back to the broad dictionary', async t => {
  const requested = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requested.push(url.pathname);
    return url.pathname.endsWith('/target-pools.json')
    ? new Response('Not found', { status: 404 })
    : new Response(await readFile(url));
  });
  await assert.rejects(loadWordBank(), /Word bank request failed \(404\)/);
  assert.ok(!requested.some(path => path.endsWith('/puzzle-words.json')));
});

const normal = { 4: 'care', 5: 'apple', 6: 'planet', 7: 'teacher', 8: 'elephant', 9: 'pineapple', 10: 'bookkeeper' };
const specialized = { 4: 'cars', 5: 'walks', 6: 'walked', 7: 'walkers', 8: 'teachers', 9: 'elephants', 10: 'pineapples' };
function classifiedFixture() {
  const pools = Object.fromEntries(Object.entries(normal).map(([length, word]) =>
    [length, { normal: [word], specialized: [specialized[length]] }]));
  const accepted = Object.fromEntries(Object.entries(pools).map(([length, pool]) =>
    [length, [...pool.normal, ...pool.specialized].sort()]));
  return { pools, accepted };
}

for (const [description, damage] of [
  ['missing category', pools => { delete pools[4].specialized; }],
  ['empty normal category', pools => { pools[4].normal = []; }],
  ['empty specialized category', pools => { pools[4].specialized = []; }],
  ['old unclassified format', pools => { pools[4] = ['care', 'cars']; }],
  ['null category', pools => { pools[4].normal = null; }],
  ['unexpected category', pools => { pools[4].other = ['cart']; }],
  ['unexpected length', pools => { pools[3] = { normal: ['cat'], specialized: ['ate'] }; }],
  ['overlapping categories', pools => { pools[4].specialized = ['care']; }],
  ['duplicate target', pools => { pools[4].normal = ['care', 'care']; }],
  ['unsorted targets', pools => { pools[4].normal = ['cart', 'care']; }],
  ['wrong target length', pools => { pools[4].normal = ['apple']; }],
  ['uppercase target', pools => { pools[4].normal = ['CARE']; }],
  ['non-word target', pools => { pools[4].normal = [1234]; }],
  ['non-ASCII target', pools => { pools[4].normal = ['café']; }],
]) {
  test(`the loader rejects ${description}`, async t => {
    const { pools, accepted } = classifiedFixture();
    damage(pools);
    t.mock.method(globalThis, 'fetch', async url => new Response(JSON.stringify(
      url.pathname.endsWith('/target-pools.json') ? pools : accepted)));
    await assert.rejects(loadWordBank(), /The word bank is incomplete or invalid/);
  });
}

test('every classified target must remain in the broad accepted vocabulary', async t => {
  const { pools, accepted } = classifiedFixture();
  accepted[4] = ['care'];
  t.mock.method(globalThis, 'fetch', async url => new Response(JSON.stringify(
    url.pathname.endsWith('/target-pools.json') ? pools : accepted)));
  await assert.rejects(loadWordBank(), /A puzzle word is missing from the accepted vocabulary/);
});

test('duplicate accepted entries are rejected instead of masking malformed data', async t => {
  const { pools, accepted } = classifiedFixture();
  accepted[4] = ['care', 'care', 'cars'];
  t.mock.method(globalThis, 'fetch', async url => new Response(JSON.stringify(
    url.pathname.endsWith('/target-pools.json') ? pools : accepted)));
  await assert.rejects(loadWordBank(), /The word bank is incomplete or invalid/);
});
