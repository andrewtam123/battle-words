import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  ROUND_MS, chooseWords, entryWord, selectTileIds, tileForLetter, isValidAnswer,
} from '../dist/js/game-core.js';
import { GameEngine } from '../dist/js/engine.js';
import { createMatch, joinSeat, readyPlayer, advanceMatch, submitAnswer } from '../dist/js/battle-rules.js';
import { COUNTDOWN_MS } from '../dist/js/battle-protocol.js';

const pools = {
  4: ['care'], 5: ['apple'], 6: ['planet'], 7: ['teacher'],
  8: ['elephant'], 9: ['pineapple'], 10: ['bookkeeper'],
};

function playing(acceptedWords) {
  const solo = new GameEngine({ pools, acceptedWords, now: () => 1000 });
  solo.start(123);
  const battle = createMatch({ id: 'shared-rules', pools, seed: 123, now: 1000 });
  for (const seat of [0, 1]) {
    joinSeat(battle, seat, `Player ${seat}`, 1000);
    readyPlayer(battle, seat, 1000);
  }
  advanceMatch(battle, 1000 + COUNTDOWN_MS);
  return { solo, battle };
}

test('shared entry preserves repeated-letter suffix removal without mutating selections or tiles', () => {
  const tiles = Object.freeze([...'nnoo'].map((letter, id) => Object.freeze({ letter, id })));
  const selected = Object.freeze([0, 1, 2]);
  assert.equal(entryWord(tiles, selected), 'nno');
  assert.deepEqual(selectTileIds(tiles, selected, 0), [0]);
  assert.deepEqual(selectTileIds(tiles, selected, 1), [0]);
  assert.deepEqual(selectTileIds(tiles, selected, 3), [0, 1, 2, 3]);
  assert.deepEqual(selectTileIds(tiles, selected, 99), [0, 1, 2]);
});

test('typed letters use visible tile order and skip selected duplicate identities', () => {
  const tiles = [{ id: 3, letter: 'n' }, { id: 0, letter: 'n' }, { id: 8, letter: 'o' }];
  assert.equal(tileForLetter(tiles, [], 'N').id, 3);
  assert.equal(tileForLetter(tiles, [3], 'n').id, 0);
  assert.equal(tileForLetter(tiles, [3, 0], 'n'), undefined);
  for (const letter of [null, 3, '', 'no', 'é', ' ']) {
    assert.equal(tileForLetter(tiles, [], letter), undefined);
  }
});

test('validation requires lowercase ASCII, dictionary membership, and exact repeated-letter counts', () => {
  const tiles = [...'noon'].map((letter, id) => ({ letter, id }));
  for (const accepted of [new Set(['noon', 'moon', 'nooo']), ['noon', 'moon', 'nooo']]) {
    assert.equal(isValidAnswer('noon', tiles, accepted), true);
    for (const word of ['moon', 'nooo', 'nnoo', 'noo', 'NOON', 'noön', 'noo1', null, 1234]) {
      assert.equal(isValidAnswer(word, tiles, accepted), false, String(word));
    }
  }
  assert.equal(isValidAnswer('noon', tiles, [], 'noon'), true);
  assert.equal(isValidAnswer('noon', tiles, []), false, 'browser validation has no target fallback');
  assert.equal(isValidAnswer('moon', tiles, [], 'moon'), false, 'fallback cannot bypass the letters');
});

test('solo, local battle checks and authority agree on valid alternatives and rejected permutations', () => {
  const accepted = new Set(['care', 'race']);
  for (const answer of ['race', 'care', 'caer']) {
    const { solo, battle } = playing(accepted);
    for (const letter of answer) solo.typeLetter(letter);
    const state = solo.snapshot();
    const valid = answer !== 'caer';
    assert.equal(isValidAnswer(answer, battle.rounds[0].initialTiles, accepted), valid);
    assert.equal(submitAnswer(battle, {
      seat: 0, round: 0, submissionId: answer, answer,
    }, accepted, battle.startAt + 1).accepted, valid);
    assert.equal(state.feedback === 'correct', valid);
    if (!valid) {
      assert.equal(state.invalidEntry, answer);
      assert.equal(state.entry, '');
      assert.deepEqual(state.selectedIds, []);
      assert.equal(state.remainingMs, ROUND_MS);
      assert.deepEqual(solo.selectTile(-1), state, 'unknown tiles must preserve invalid feedback');
    }
  }
});

test('both controllers retain the private target fallback without supplying a target to the browser', () => {
  const { solo, battle } = playing([]);
  for (const letter of 'care') solo.typeLetter(letter);
  assert.equal(solo.snapshot().feedback, 'correct');
  assert.equal(submitAnswer(battle, {
    seat: 0, round: 0, submissionId: 'target-only', answer: 'care',
  }, [], battle.startAt + 1).accepted, true);
  assert.equal(isValidAnswer('care', battle.rounds[0].initialTiles, []), false);
});

test('American array-pool targets and tile arrangements match the prior runtime baseline', async () => {
  const bank = JSON.parse(await readFile(new URL('../dist/data/puzzle-words.json', import.meta.url), 'utf8'));
  let now = 1000;
  const engine = new GameEngine({ pools: bank, now: () => now });
  let state = engine.start(123);
  const solo = [];
  for (let index = 0; index < 20; index += 1) {
    solo.push({ initial: state.tiles, shuffled: index % 2 ? null : engine.shuffle().tiles });
    now += ROUND_MS;
    engine.tick();
    state = engine.nextRound();
  }
  const match = createMatch({ id: 'baseline', pools: bank, seed: 123, now: 1000 });
  const plan = {
    targets: chooseWords(bank, 123), solo,
    battle: match.rounds.map(({ target, initialTiles, shuffledTiles }) => ({ target, initialTiles, shuffledTiles })),
  };
  // Independently computed with the f4fc2c2 runtime and the American target inventory.
  // Array-pool sampling stays compatible; classified 80:20 draws have separate tests.
  // Solo consumes shuffles on demand; battle precomputes all of them.
  assert.equal(createHash('sha256').update(JSON.stringify(plan)).digest('hex'),
    '1ab08296f4139f551c249d67d85654af5c02096436ab0bf13b58747368f68b46');
});
