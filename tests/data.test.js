import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dataUrl = new URL('../dist/data/', import.meta.url);
const wordBytes = await readFile(new URL('words.json', dataUrl));
const words = JSON.parse(wordBytes);
const source = JSON.parse(await readFile(new URL('word-source.json', dataUrl), 'utf8'));
const expectedCounts = { 4: 3168, 5: 6421, 6: 10742, 7: 15385, 8: 17351, 9: 16707, 10: 14047 };
const puzzleBytes = await readFile(new URL('puzzle-words.json', dataUrl));
const puzzles = JSON.parse(puzzleBytes);
const expectedPuzzleCounts = { 4: 1878, 5: 3462, 6: 5292, 7: 6720, 8: 6526, 9: 5392, 10: 4029 };

test('the bundled vocabulary has exactly the seven required sorted, unique word pools', () => {
  assert.deepEqual(Object.keys(words), ['4', '5', '6', '7', '8', '9', '10']);
  for (const [length, pool] of Object.entries(words)) {
    assert.ok(Array.isArray(pool), `${length}-letter pool must be an array`);
    assert.equal(pool.length, expectedCounts[length]);
    assert.equal(new Set(pool).size, pool.length, `${length}-letter pool has duplicates`);
    assert.deepEqual(pool, [...pool].sort(), `${length}-letter pool must be sorted`);
    for (const word of pool) {
      assert.equal(typeof word, 'string');
      assert.match(word, /^[a-z]{4,10}$/);
      assert.equal(word.length, Number(length), `Wrong pool for ${word}`);
    }
  }
});

test('provenance counts and checksum match the shipped word data', () => {
  assert.equal(source.version, '2020.12.07');
  assert.equal(source.sourceArchiveSha256, '5587667caa20c4891390c2d42dbb4d5c4c3f41bee77af1457ece3ba23fb859cc');
  assert.deepEqual(source.wordCounts, expectedCounts);
  assert.equal(source.totalWords, Object.values(words).reduce((total, pool) => total + pool.length, 0));
  assert.equal(source.totalWords, 83821);
  assert.equal(source.wordsJsonSha256, createHash('sha256').update(wordBytes).digest('hex'));
  assert.equal(source.wordsJsonSha256, '1de6e4a5ed213fb0b47b4fb8683b27ca61f5f5c85a032f7e7d7d2b34eac72a5a');
  assert.equal(source.filters.subcategory, 'words');
  assert.equal(source.filters.maximumScowlSizeInclusive, 70);
  assert.equal(source.filters.acceptedLinePattern, '^[a-z]{4,10}$');
  assert.equal(source.includedSourceFiles.length, 16);
});

test('level-35 targets are sorted, unique, and a strict subset of accepted answers', () => {
  assert.deepEqual(Object.keys(puzzles), ['4', '5', '6', '7', '8', '9', '10']);
  for (const [length, pool] of Object.entries(puzzles)) {
    assert.equal(pool.length, expectedPuzzleCounts[length]);
    assert.deepEqual(pool, [...new Set(pool)].sort());
    const accepted = new Set(words[length]);
    for (const word of pool) {
      assert.match(word, /^[a-z]{4,10}$/);
      assert.equal(word.length, Number(length));
      assert.ok(accepted.has(word), `Puzzle target must be accepted: ${word}`);
    }
  }
  assert.deepEqual(source.puzzleSelection.wordCounts, expectedPuzzleCounts);
  assert.equal(source.puzzleSelection.totalWords, 33299);
  assert.equal(source.puzzleSelection.file, 'puzzle-words.json');
  assert.equal(source.puzzleSelection.wordsJsonSha256, createHash('sha256').update(puzzleBytes).digest('hex'));
  assert.equal(source.puzzleSelection.wordsJsonSha256, '3c6fa5455e4705c4516ee8ff0f77e0e66172a5eba8e523729810c7647e9f944d');
});

test('both new-game banks use only standard American source categories at every included tier', () => {
  assert.deepEqual(source.filters.spellingCategories, ['english', 'american']);
  const paths = levels => ['american', 'english'].flatMap(spelling =>
    levels.map(level => `final/${spelling}-words.${level}`));
  assert.deepEqual(source.includedSourceFiles, paths([10, 20, 35, 40, 50, 55, 60, 70]));
  assert.deepEqual(source.puzzleSelection.includedSourceFiles, paths([10, 20, 35]));
});

test('target cutoff includes lower SCOWL tiers and excludes higher-tier examples', () => {
  assert.equal(source.puzzleSelection.maximumScowlSizeInclusive, 35);
  assert.deepEqual(source.puzzleSelection.includedScowlSizes, [10, 20, 35]);
  const levels = source.puzzleSelection.includedSourceFiles.map(path => Number(path.split('.').at(-1)));
  assert.equal(levels.length, 6);
  assert.deepEqual([...new Set(levels)].sort((a, b) => a - b), [10, 20, 35]);
  const targets = new Set(Object.values(puzzles).flat());
  for (const word of ['young', 'cream', 'cigars']) {
    assert.ok(targets.has(word), `Keep representative from levels 10, 20, and 35: ${word}`);
  }
  for (const word of ['weals', 'haaf', 'lunula', 'scilla', 'cowherb', 'scalage']) {
    assert.ok(!targets.has(word), `Higher-tier word must not be selected: ${word}`);
    assert.ok(words[word.length].includes(word), `Still accept valid alternatives: ${word}`);
  }
});

test('new-game banks retain American words and reject regional spelling alternatives', () => {
  const accepted = new Set(Object.values(words).flat());
  const targets = new Set(Object.values(puzzles).flat());
  for (const word of [
    'care', 'race', 'acre', 'alert', 'alter', 'later',
    'walk', 'walks', 'walked', 'walking',
    'color', 'gray', 'center', 'theater', 'defense', 'offense', 'organize',
    'traveler', 'traveled', 'canceled', 'catalog', 'jewelry', 'aluminum',
    'plow', 'mold', 'analyze', 'fulfill', 'dialogue', 'program', 'meter',
    'license', 'practice', 'check',
  ]) {
    assert.ok(accepted.has(word), `Missing vocabulary example: ${word}`);
  }
  for (const word of ['color', 'center', 'theater', 'organize', 'traveled']) {
    assert.ok(targets.has(word), `Missing American target: ${word}`);
  }
  for (const word of [
    'colour', 'grey', 'centre', 'theatre', 'defence', 'offence', 'organise',
    'traveller', 'travelled', 'cancelled', 'catalogue', 'jewellery', 'aluminium',
    'plough', 'mould', 'analyse', 'fulfil', 'metre', 'licence', 'practise',
    'chequed', 'chequing', 'duellings', 'looneyies', 'wizes',
  ]) {
    assert.ok(!accepted.has(word), `Non-American alternative must not be accepted in new games: ${word}`);
    assert.ok(!targets.has(word), `Non-American alternative must not be a new target: ${word}`);
  }
});

test('the distributed word bank includes upstream copyright and permission notices', async () => {
  assert.equal(source.licenseFile, 'SCOWL-LICENSE.txt');
  const license = await readFile(new URL(source.licenseFile, dataUrl), 'utf8');
  assert.match(license, /Copyright 2000-2018 by Kevin Atkinson/);
  assert.match(license, /Permission to use, copy, modify, distribute and sell these word/);
  assert.match(license, /WordNet 1\.6 Copyright 1997 by Princeton University/);
  assert.match(license, /Copyright 1993, Geoff Kuenning/);
  assert.ok(license.length > 10_000, 'Preserve the complete upstream notice file');
});
