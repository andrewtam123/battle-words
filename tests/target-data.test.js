import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { CLASSIFICATION_POLICY } from '../scripts/lib/target-classification.mjs';
import { LEXICON_SHA256, LEXICON_LICENSE_SHA256 } from '../scripts/lib/prepare-targets.mjs';

const data = new URL('../dist/data/', import.meta.url);
const bytes = await readFile(new URL('target-pools.json', data));
const pools = JSON.parse(bytes);
const union = JSON.parse(await readFile(new URL('puzzle-words.json', data)));
const source = JSON.parse(await readFile(new URL('target-source.json', data)));
const sha256 = value => createHash('sha256').update(value).digest('hex');

test('classified pools partition every American target exactly once at every length', () => {
  assert.deepEqual(Object.keys(pools), Object.keys(union));
  for (const [length, pool] of Object.entries(pools)) {
    assert.deepEqual(Object.keys(pool), ['normal', 'specialized']);
    for (const category of ['normal', 'specialized']) {
      assert.ok(pool[category].length > 0);
      assert.deepEqual(pool[category], [...new Set(pool[category])].sort());
      assert.equal(pool[category].length, source.wordCounts[length][category]);
      for (const word of pool[category]) {
        assert.match(word, /^[a-z]{4,10}$/u);
        assert.equal(word.length, Number(length));
      }
    }
    const joined = [...pool.normal, ...pool.specialized].sort();
    assert.deepEqual(joined, union[length], `No omissions, additions or overlapping categories for length ${length}`);
  }
  assert.deepEqual(source.totals, { normal: 18239, specialized: 15060 });
});

test('real classifications implement independent meanings, irregular forms and regular plural exceptions', () => {
  for (const word of ['acting', 'building', 'painting', 'boring', 'learned', 'studied', 'stopped', 'dreamed',
    'went', 'taken', 'feet', 'mice', 'children', 'criteria', 'taller', 'tallest', 'better', 'best',
    'likest', 'flashest', 'quickly', 'kindness', 'teacher']) {
    assert.ok(pools[word.length].normal.includes(word), `${word} must be normal`);
  }
  for (const word of ['acted', 'walks', 'babies', 'knives', 'leaves', 'wolves', 'staves',
    'paintings', 'takes', 'sings', 'ones', 'others', 'noes']) {
    assert.ok(pools[word.length].specialized.includes(word), `${word} must be specialized`);
  }
});

test('classification provenance pins vocabulary, policy, source, overrides and complete notices', async () => {
  assert.equal(source.policy, CLASSIFICATION_POLICY);
  assert.deepEqual(source.selection, { normal: 0.8, specialized: 0.2, independentPerRound: true, replacement: true });
  assert.equal(source.sha256, sha256(bytes));
  assert.equal(source.vocabulary.sha256, sha256(await readFile(new URL('puzzle-words.json', data))));
  assert.equal(source.vocabulary.added, 0);
  assert.equal(source.vocabulary.removed, 0);
  assert.equal(source.source.sha256, LEXICON_SHA256);
  assert.equal(source.unresolved, 0);
  assert.equal(Object.values(source.reasonCounts).reduce((sum, count) => sum + count, 0), 33299);
  const overrides = await readFile(new URL('../scripts/data/target-overrides.json', import.meta.url));
  assert.equal(source.overrides.sha256, sha256(overrides));
  assert.deepEqual(source.overrides.entries, JSON.parse(overrides));
  const license = await readFile(new URL('ESDB-LICENSE.txt', data));
  assert.equal(sha256(license), LEXICON_LICENSE_SHA256);
  for (const notice of ['Copyright 2000-2026 by Kevin Atkinson', 'Copyright 2016 by Benjamin Titze',
    'Copyright (c) J Ross Beresford 1993-1999', 'WordNet 1.6 Copyright 1997 by Princeton University']) {
    assert.ok(license.toString('utf8').includes(notice));
  }
});
