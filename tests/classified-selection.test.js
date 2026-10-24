import assert from 'node:assert/strict';
import test from 'node:test';
import { WORD_LENGTHS, ROUND_MS, chooseWords, drawWords } from '../dist/js/game-core.js';
import { GameEngine } from '../dist/js/engine.js';
import { createMatch } from '../dist/js/battle-rules.js';

// Unequal category sizes catch weighting by category population instead of 80:20.
const pools = Object.fromEntries([4, 5, 6, 7, 8, 9, 10].map(length => [length, {
  normal: ['a'.repeat(length), 'b'.repeat(length)],
  specialized: ['c'.repeat(length), 'd'.repeat(length), 'e'.repeat(length)],
}]));

test('classified selection gives four of five category outcomes to normal words', () => {
  for (const category of [0, 1, 2, 3, 4]) {
    for (const lastIndex of [false, true]) {
      let calls = 0;
      const rng = { nextUint32() {
        calls += 1;
        return calls % 2 ? category : lastIndex ? (category < 4 ? 1 : 2) : 0;
      } };
      const marker = category < 4 ? lastIndex ? 'b' : 'a' : lastIndex ? 'e' : 'c';
      assert.deepEqual(drawWords(pools, rng), WORD_LENGTHS.map(length => marker.repeat(length)));
      assert.equal(calls, WORD_LENGTHS.length * 2);
    }
  }
});

test('category and word draws both reject biased tail values', () => {
  const values = [0xffff_ffff, 4, 0xffff_ffff, 2];
  let calls = 0;
  const rng = { nextUint32() { calls += 1; return values.shift() ?? 0; } };
  const words = drawWords(pools, rng);
  assert.equal(words[0], 'eeee');
  assert.deepEqual(words.slice(1), WORD_LENGTHS.slice(1).map(length => 'a'.repeat(length)));
  assert.equal(calls, WORD_LENGTHS.length * 2 + 2);
});

test('category choices are independent with replacement, with no per-game quota', () => {
  const normalOnly = drawWords(pools, { nextUint32: () => 0 });
  const specializedOnly = drawWords(pools, { nextUint32: () => 4 });
  assert.deepEqual(normalOnly, WORD_LENGTHS.map(length => 'a'.repeat(length)));
  assert.deepEqual(specializedOnly, WORD_LENGTHS.map(length => 'd'.repeat(length)));
  assert.equal(normalOnly[0], normalOnly[1]);
  assert.equal(specializedOnly[0], specializedOnly[1]);
});

test('seeded classified draws are deterministic and give each category its intended probability', () => {
  assert.deepEqual(chooseWords(pools, 123), chooseWords(pools, 123));
  assert.notDeepEqual(chooseWords(pools, 123), chooseWords(pools, 124));
  const counts = { a: 0, b: 0, c: 0, d: 0, e: 0 };
  const games = 10_000;
  for (let seed = 0; seed < games; seed += 1) counts[chooseWords(pools, seed)[0][0]] += 1;
  assert.ok(Math.abs((counts.a + counts.b) / games - 0.8) < 0.02, JSON.stringify(counts));
  for (const marker of ['a', 'b']) assert.ok(Math.abs(counts[marker] / games - 0.4) < 0.02);
  for (const marker of ['c', 'd', 'e']) assert.ok(Math.abs(counts[marker] / games - 0.2 / 3) < 0.015);
});

test('classified draws reject either missing category before choosing from it', () => {
  for (const category of ['normal', 'specialized']) {
    for (const invalid of [undefined, null, [], 'word']) {
      assert.throws(() => drawWords({ ...pools, 4: { ...pools[4], [category]: invalid } }, {
        nextUint32() { assert.fail('an incomplete category must fail before randomness is used'); },
      }), new RegExp(`4-letter ${category} word pool`));
    }
  }
  assert.throws(() => drawWords({ ...pools, 4: { ...pools[4], normal: ['BAD!'] } }, {
    nextUint32: () => 0,
  }), /4-letter word pool contains an invalid word/);
});

test('solo and battle draw the same classified targets before any scrambling or shuffling', () => {
  const varied = {
    4: { normal: ['care', 'noon'], specialized: ['acts', 'cars'] },
    5: { normal: ['apple', 'pearl'], specialized: ['cared', 'walks'] },
    6: { normal: ['listen', 'planet'], specialized: ['apples', 'walked'] },
    7: { normal: ['another', 'teacher'], specialized: ['planets', 'walkers'] },
    8: { normal: ['computer', 'elephant'], specialized: ['listened', 'teachers'] },
    9: { normal: ['blueberry', 'pineapple'], specialized: ['computers', 'elephants'] },
    10: { normal: ['basketball', 'bookkeeper'], specialized: ['blueprints', 'pineapples'] },
  };
  const before = structuredClone(varied);
  let now = 1000;
  const solo = new GameEngine({ pools: varied, now: () => now });
  const expected = chooseWords(varied, 123);
  assert.deepEqual(solo.start(123).words, expected);
  const battle = createMatch({ id: 'weighted-game', pools: varied, seed: 123, now });
  assert.deepEqual(battle.rounds.map(round => round.target), expected);
  for (let index = 0; index < WORD_LENGTHS.length; index += 1) {
    solo.shuffle();
    assert.deepEqual(solo.snapshot().words, expected);
    now += ROUND_MS;
    solo.tick();
    solo.nextRound();
  }
  assert.equal(solo.snapshot().status, 'finished');
  assert.deepEqual(varied, before, 'neither mode mutates the supplied pools');
});

test('the solo constructor accepts all words in classified pools by default', () => {
  const varied = { ...pools, 4: { normal: ['care', 'race'], specialized: ['dogs'] } };
  const solo = new GameEngine({ pools: varied, now: () => 0 });
  // Find a normal-category first target without prescribing RNG internals.
  const seed = Array.from({ length: 100 }, (_, value) => value)
    .find(value => chooseWords(varied, value)[0] === 'care');
  assert.notEqual(seed, undefined);
  solo.start(seed);
  for (const letter of 'race') solo.typeLetter(letter);
  assert.equal(solo.snapshot().feedback, 'correct');
  assert.equal(solo.snapshot().results[0].answer, 'race');
});
