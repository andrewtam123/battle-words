import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { WORD_LENGTHS, ROUND_MS, chooseWords } from '../dist/js/engine.js';
import { battleScores } from '../dist/js/battle-scoring.js';
import {
  createMatch, joinSeat, readyPlayer, advanceMatch, submitAnswer, shufflePlayer,
  nextAlarmAt, snapshotFor, publicResults,
} from '../dist/js/battle-rules.js';
import {
  PROTOCOL_VERSION, DICTIONARY_VERSION, ACCEPTED_WORDS_SHA256, TARGET_WORDS_SHA256,
  CLASSIFIED_TARGETS_SHA256, TARGET_SELECTION_POLICY,
  COUNTDOWN_MS, TIE_MS, REVEAL_MS, LOBBY_MS,
} from '../dist/js/battle-protocol.js';

const pools = {
  4: ['care'], 5: ['apple'], 6: ['planet'], 7: ['teacher'],
  8: ['elephant'], 9: ['pineapple'], 10: ['bookkeeper'],
};
const accepted = new Set([...Object.values(pools).flat(), 'race', 'acre', 'aces', 'xxxx']);
const NOW = 10_000;
const clone = (value) => JSON.parse(JSON.stringify(value));

function lobby(options = {}) {
  return createMatch({ id: 'example-room', pools, seed: 123, now: NOW, ...options });
}

function playing() {
  const match = lobby();
  joinSeat(match, 0, 'Alex', NOW);
  joinSeat(match, 1, 'Alex', NOW);
  readyPlayer(match, 0, NOW);
  readyPlayer(match, 1, NOW);
  advanceMatch(match, NOW + COUNTDOWN_MS);
  return match;
}

function submit(match, seat, at, options = {}) {
  return submitAnswer(match, {
    seat, round: match.index, submissionId: `attempt-${match.index}-${seat}`,
    answer: match.rounds[match.index].target, ...options,
  }, accepted, at);
}

test('battle protocol dictionary version pins targets, classification policy and accepted bank bytes', async () => {
  for (const [file, expected] of [
    ['words.json', ACCEPTED_WORDS_SHA256], ['puzzle-words.json', TARGET_WORDS_SHA256],
    ['target-pools.json', CLASSIFIED_TARGETS_SHA256],
  ]) {
    const bytes = await readFile(new URL(`../dist/data/${file}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
  }
  assert.equal(PROTOCOL_VERSION, 1);
  assert.ok(DICTIONARY_VERSION.includes(ACCEPTED_WORDS_SHA256));
  assert.ok(DICTIONARY_VERSION.includes(TARGET_WORDS_SHA256));
  assert.ok(DICTIONARY_VERSION.includes(CLASSIFIED_TARGETS_SHA256));
  assert.ok(DICTIONARY_VERSION.includes(TARGET_SELECTION_POLICY));
  const source = JSON.parse(await readFile(new URL('../dist/data/target-source.json', import.meta.url), 'utf8'));
  assert.equal(TARGET_SELECTION_POLICY, source.policy);
  assert.deepEqual(source.selection, { normal: 0.8, specialized: 0.2, independentPerRound: true, replacement: true });
});

test('all targets and both arrangements are prepared before any player joins', () => {
  const varied = { ...pools, 4: ['care', 'noon'], 5: ['apple', 'pearl'] };
  const match = lobby({ pools: varied });
  assert.deepEqual(match.rounds.map((round) => round.target), chooseWords(varied, 123));
  assert.deepEqual(match.rounds.map((round) => round.target.length), WORD_LENGTHS);
  assert.equal(match.rounds.length, 20);
  assert.deepEqual(match, lobby({ pools: varied }));
  for (const round of match.rounds) {
    const identity = (tiles) => [...tiles].sort((a, b) => a.id - b.id);
    assert.deepEqual(identity(round.initialTiles), identity(round.shuffledTiles));
    assert.notEqual(round.initialTiles.map((tile) => tile.letter).join(''), round.target);
    assert.notEqual(round.shuffledTiles.map((tile) => tile.letter).join(''), round.target);
    assert.notDeepEqual(round.initialTiles.map((tile) => tile.letter), round.shuffledTiles.map((tile) => tile.letter));
  }
  assert.deepEqual(match.players, [null, null]);
});

test('seats are limited to two, reserved once, and names need not be unique', () => {
  const match = lobby();
  assert.deepEqual(joinSeat(match, 0, ' Alex ', NOW), { accepted: true });
  assert.deepEqual(joinSeat(match, 1, 'Alex', NOW), { accepted: true });
  assert.equal(match.players[0].name, 'Alex');
  assert.equal(joinSeat(match, 0, 'Replacement', NOW).reason, 'seat_taken');
  assert.equal(joinSeat(match, 2, 'Third', NOW).reason, 'invalid_seat');
  assert.equal(joinSeat(lobby(), 0, '', NOW).reason, 'invalid_name');
  assert.equal(joinSeat(lobby(), 0, 'a'.repeat(25), NOW).reason, 'invalid_name');
});

test('both players ready once starts a three-second countdown without revealing tiles', () => {
  const match = lobby();
  joinSeat(match, 0, 'Host', NOW);
  readyPlayer(match, 0, NOW);
  assert.equal(match.phase, 'lobby');
  joinSeat(match, 1, 'Guest', NOW + 100);
  readyPlayer(match, 1, NOW + 100);
  assert.equal(match.phase, 'countdown');
  assert.equal(match.startAt, NOW + 100 + COUNTDOWN_MS);
  assert.equal(nextAlarmAt(match), match.startAt);
  assert.deepEqual(snapshotFor(match, 0, NOW).tiles, []);
  assert.equal(advanceMatch(match, match.startAt - 1), false);
  advanceMatch(match, match.startAt);
  assert.equal(match.phase, 'playing');
  assert.equal(match.index, 0);
  assert.equal(match.deadline, match.startAt + ROUND_MS);
  assert.deepEqual(snapshotFor(match, 0, match.startAt).tiles, snapshotFor(match, 1, match.startAt).tiles);
});

test('unstarted lobbies expire while started matches have no inactivity expiry', () => {
  const match = lobby();
  assert.equal(nextAlarmAt(match), NOW + LOBBY_MS);
  advanceMatch(match, NOW + LOBBY_MS);
  assert.equal(match.phase, 'expired');
  assert.equal(nextAlarmAt(match), null);
  assert.equal(joinSeat(match, 0, 'Too late', NOW + LOBBY_MS).accepted, false);
  const started = playing();
  advanceMatch(started, NOW + LOBBY_MS);
  assert.equal(started.phase, 'finished');
});

test('invalid words and wrong letter multisets never open the arbitration window', () => {
  const match = playing();
  const at = match.startAt + 100;
  for (const answer of ['caer', 'aces', 'xxxx', 'CARE', 'caree', null]) {
    assert.equal(submit(match, 0, at, { answer }).reason, 'invalid_answer');
    assert.deepEqual(match.rounds[0].claims, [null, null]);
    assert.equal(nextAlarmAt(match), match.deadline);
  }
  assert.equal(submit(match, 0, at, { answer: 'race' }).accepted, true);
  assert.equal(match.rounds[0].claims[0].answer, 'race');
});

test('the chosen target is always accepted even without an alternative-answer bank', () => {
  const match = playing();
  assert.equal(submitAnswer(match, {
    seat: 0, round: 0, submissionId: 'target', answer: 'care',
  }, new Set(), match.startAt + 1).accepted, true);
});

test('first valid receipt waits the full 200ms before awarding exactly one point', () => {
  const match = playing();
  const at = match.startAt + 1_000;
  assert.deepEqual(submit(match, 0, at), { accepted: true, receivedAt: at });
  assert.equal(nextAlarmAt(match), at + TIE_MS);
  advanceMatch(match, at + TIE_MS - 1);
  assert.equal(match.phase, 'playing');
  assert.deepEqual(match.scores, [0, 0]);
  assert.equal(match.results.length, 0);
  advanceMatch(match, at + TIE_MS);
  assert.equal(match.phase, 'reveal');
  assert.deepEqual(match.scores, [1, 0]);
  assert.equal(match.results[0].winner, 0);
  assert.equal(match.results[0].elapsedMs[0], 1_000);
  assert.equal(match.revealUntil, at + TIE_MS + REVEAL_MS);
  advanceMatch(match, at + TIE_MS);
  assert.equal(match.results.length, 1);
  assert.deepEqual(match.scores, [1, 0]);
});

test('different valid anagrams arriving 199ms apart tie and award half a point each', () => {
  const match = playing();
  const at = match.startAt + 500;
  submit(match, 1, at, { answer: 'race' });
  submit(match, 0, at + 199, { answer: 'acre' });
  assert.equal(match.results.length, 0);
  advanceMatch(match, at + 200);
  assert.equal(match.results[0].outcome, 'tie');
  assert.equal(match.results[0].winner, null);
  assert.deepEqual(match.results[0].answers, ['acre', 'race']);
  assert.deepEqual(match.results[0].elapsedMs, [699, 500]);
  assert.deepEqual(match.scores, [0.5, 0.5]);
});

test('scores count wins, ties and misses using only completed outcomes', () => {
  const results = [
    { outcome: 'win', winner: 0 }, { outcome: 'tie', winner: null },
    { outcome: 'timeout', winner: null }, { outcome: 'win', winner: 1 },
    { outcome: 'tie', winner: null }, { outcome: 'win', winner: 1 },
  ];
  const original = clone(results);
  assert.deepEqual(battleScores([]), [0, 0]);
  assert.deepEqual(battleScores(results), [2, 3]);
  assert.deepEqual(results, original);
});

test('restored active rooms receive past tie points without changing deadlines or pending claims', () => {
  let match = playing();
  const at = match.startAt + 500;
  submit(match, 0, at);
  submit(match, 1, at + 100);
  advanceMatch(match, at + TIE_MS + REVEAL_MS);
  const secondAt = match.startAt + 100;
  submit(match, 0, secondAt);
  match.scores = [0, 0]; // Persisted under the old zero-point tie rule.
  match = clone(match);
  const original = clone(match);
  assert.deepEqual(snapshotFor(match, 0, secondAt).scores, [0.5, 0.5]);
  assert.deepEqual(match, original, 'read-only projections must not migrate stored state');
  assert.equal(advanceMatch(match, secondAt), true);
  assert.deepEqual(match, { ...original, scores: [0.5, 0.5] });
  assert.equal(advanceMatch(match, secondAt), false, 'normalization is idempotent');
  advanceMatch(match, secondAt + TIE_MS);
  assert.deepEqual(match.scores, [1.5, 0.5]);
});

test('ties remain half a point each after persistence and retries in later rounds', () => {
  let match = playing();
  const at = match.startAt + 500;
  const first = submit(match, 0, at, { submissionId: 'tied-first' });
  const second = submit(match, 1, at + 100, { submissionId: 'tied-second' });
  advanceMatch(match, at + TIE_MS);
  match = clone(match);
  advanceMatch(match, at + TIE_MS + REVEAL_MS);
  for (const [seat, submissionId, response] of [
    [0, 'tied-first', first], [1, 'tied-second', second],
  ]) {
    assert.deepEqual(submit(match, seat, match.startAt + 10, {
      round: 0, submissionId, answer: 'care',
    }), response);
  }
  assert.equal(match.results.length, 1);
  assert.deepEqual(match.scores, [0.5, 0.5]);
  assert.deepEqual(match.rounds[1].claims, [null, null]);
});

test('submissions exactly 200ms apart do not tie even when no alarm has run', () => {
  const match = playing();
  const at = match.startAt + 500;
  submit(match, 1, at);
  assert.equal(submit(match, 0, at + TIE_MS).accepted, false);
  assert.equal(match.results[0].winner, 1);
  assert.deepEqual(match.scores, [0, 1]);
});

test('an answer exactly at the round deadline loses; the last millisecond still qualifies', () => {
  const missed = playing();
  assert.equal(submit(missed, 0, missed.deadline).accepted, false);
  assert.equal(missed.results[0].outcome, 'timeout');
  const match = playing();
  const deadline = match.deadline;
  submit(match, 0, deadline - 1);
  assert.equal(submit(match, 1, deadline).accepted, false);
  assert.equal(match.phase, 'playing', 'pending arbitration can extend past the round deadline');
  assert.equal(nextAlarmAt(match), deadline + 199);
  advanceMatch(match, deadline + 199);
  assert.equal(match.results[0].winner, 0);
});

test('near-deadline receipts can tie only when both arrived before the deadline', () => {
  const match = playing();
  const deadline = match.deadline;
  submit(match, 0, deadline - 2);
  submit(match, 1, deadline - 1);
  advanceMatch(match, deadline + 198);
  assert.equal(match.results[0].outcome, 'tie');
});

test('submission retries retain the original receipt through storage restore and later rounds', () => {
  let match = playing();
  const at = match.startAt + 500;
  const response = submit(match, 0, at, { submissionId: 'retry-me' });
  match = clone(match);
  assert.deepEqual(submit(match, 0, at + 150, { submissionId: 'retry-me' }), response);
  assert.equal(submit(match, 0, at + 160, { submissionId: 'another' }).reason, 'already_submitted');
  advanceMatch(match, at + TIE_MS + REVEAL_MS);
  assert.equal(match.index, 1);
  assert.deepEqual(submit(match, 0, match.startAt + 10, {
    round: 0, submissionId: 'retry-me', answer: 'care',
  }), response);
  assert.equal(submit(match, 0, match.startAt + 20, {
    round: 0, submissionId: 'retry-me', answer: 'race',
  }).reason, 'submission_conflict');
  assert.deepEqual(match.scores, [1, 0]);
  assert.deepEqual(match.rounds[1].claims, [null, null]);
});

test('each player has an independent submission ID namespace and duplicates cannot manufacture a tie', () => {
  const match = playing();
  const at = match.startAt + 100;
  submit(match, 0, at, { submissionId: 'same' });
  submit(match, 0, at + 10, { submissionId: 'same' });
  assert.deepEqual(match.rounds[0].claims.map(Boolean), [true, false]);
  submit(match, 1, at + 20, { submissionId: 'same' });
  advanceMatch(match, at + TIE_MS);
  assert.equal(match.results[0].outcome, 'tie');
});

test('pending claims do not disclose a provisional outcome to either player', () => {
  const match = playing();
  const at = match.startAt + 500;
  const opponentBefore = snapshotFor(match, 1, at);
  submit(match, 0, at, { answer: 'race', submissionId: 'private-attempt' });
  assert.deepEqual(snapshotFor(match, 1, at), opponentBefore);
  const own = snapshotFor(match, 0, at);
  assert.deepEqual(own.ownSubmission, { submissionId: 'private-attempt', answer: 'race' });
  assert.deepEqual(own.scores, [0, 0]);
  assert.deepEqual(own.results, []);
  for (const forbidden of ['rounds', 'target', 'seed', 'claims', 'resolutionAt', 'winner']) {
    assert.equal(Object.hasOwn(own, forbidden), false);
  }
  assert.equal(JSON.stringify(own).includes('bookkeeper'), false, 'future targets stay private');
  assert.equal(publicResults(match), null);
  advanceMatch(match, at + TIE_MS);
  assert.deepEqual(snapshotFor(match, 0, at + TIE_MS).results, snapshotFor(match, 1, at + TIE_MS).results);
});

test('shuffle is independent, prepared, once per seat, and remains spent across a restore', () => {
  let match = playing();
  const plans = match.rounds.map(({ target, initialTiles, shuffledTiles }) => clone({ target, initialTiles, shuffledTiles }));
  const at = match.startAt + 100;
  assert.equal(shufflePlayer(match, 0, 0, at).accepted, true);
  match = clone(match);
  assert.equal(snapshotFor(match, 0, at).shuffleUsed, true);
  assert.deepEqual(snapshotFor(match, 0, at).tiles, match.rounds[0].shuffledTiles);
  assert.deepEqual(snapshotFor(match, 1, at).tiles, match.rounds[0].initialTiles);
  assert.equal(shufflePlayer(match, 0, 0, at).reason, 'shuffle_used');
  assert.equal(shufflePlayer(match, 1, 0, at).accepted, true);
  assert.equal(match.deadline, match.startAt + ROUND_MS);
  assert.deepEqual(match.rounds.map(({ target, initialTiles, shuffledTiles }) => ({ target, initialTiles, shuffledTiles })), plans);
});

test('stale round actions and shuffling after a valid submission cannot change current play', () => {
  const match = playing();
  const at = match.startAt + 100;
  submit(match, 0, at);
  assert.equal(shufflePlayer(match, 0, 0, at + 1).reason, 'already_submitted');
  advanceMatch(match, at + TIE_MS + REVEAL_MS);
  assert.equal(shufflePlayer(match, 1, 0, match.startAt + 1).reason, 'round_closed');
  assert.equal(submit(match, 1, match.startAt + 1, { round: 0 }).reason, 'round_closed');
  assert.deepEqual(match.rounds[1].claims, [null, null]);
});

test('delayed wakeup catches up through absent players without extending deadlines', () => {
  let match = playing();
  const startedAt = match.startAt;
  match = clone(match);
  advanceMatch(match, startedAt + 2 * (ROUND_MS + REVEAL_MS) + 500);
  assert.equal(match.phase, 'playing');
  assert.equal(match.index, 2);
  assert.equal(match.results.length, 2);
  assert.equal(match.startAt, startedAt + 2 * (ROUND_MS + REVEAL_MS));
  assert.equal(match.deadline, match.startAt + ROUND_MS);
  assert.equal(match.results[0].endedAt, startedAt + ROUND_MS);
  assert.equal(match.results[1].endedAt, startedAt + 2 * ROUND_MS + REVEAL_MS);
});

test('a full match finishes with no clients or incoming requests, preserving permanent public results', () => {
  const match = playing();
  const finishAt = match.startAt + WORD_LENGTHS.length * (ROUND_MS + REVEAL_MS);
  advanceMatch(match, finishAt);
  assert.equal(match.phase, 'finished');
  assert.equal(match.results.length, 20);
  assert.equal(match.finishedAt, finishAt);
  assert.deepEqual(match.scores, [0, 0]);
  assert.equal(nextAlarmAt(match), null);
  const result = publicResults(match);
  assert.equal(result.winner, null);
  assert.deepEqual(result.results.map((round) => round.target.length), WORD_LENGTHS);
  for (const forbidden of ['rounds', 'claims', 'initialTiles', 'shuffledTiles', 'ownSubmission', 'submissionId']) {
    assert.equal(JSON.stringify(result).includes(`"${forbidden}"`), false);
  }
  advanceMatch(match, finishAt + 10 * 365 * 24 * 60 * 60_000);
  assert.deepEqual(publicResults(match), result);
});

test('twenty outcomes produce the highest-score match winner and equal totals produce a draw', () => {
  for (const split of [false, true]) {
    const match = playing();
    for (let index = 0; index < 20; index += 1) {
      const at = match.startAt + 100;
      submit(match, split ? index % 2 : 1, at);
      advanceMatch(match, at + TIE_MS + REVEAL_MS);
    }
    const result = publicResults(match);
    assert.equal(result.results.length, 20);
    assert.deepEqual(result.scores, split ? [10, 10] : [0, 20]);
    assert.equal(result.winner, split ? null : 1);
  }
});

test('finished legacy results regain all tie points while preserving outcomes and finish time', () => {
  const match = playing();
  for (let index = 0; index < 20; index += 1) {
    const at = match.startAt + 100;
    if (index % 4 === 0) {
      submit(match, 0, at);
      submit(match, 1, at + 100);
    } else if (index % 4 !== 3) {
      submit(match, index % 4 === 1 ? 0 : 1, at);
    }
    advanceMatch(match, index % 4 === 3 ? match.deadline + REVEAL_MS : at + TIE_MS + REVEAL_MS);
  }
  assert.equal(match.phase, 'finished');
  assert.deepEqual(match.scores, [7.5, 7.5]);
  match.scores = [5, 5];
  const original = clone(match);
  const result = publicResults(match);
  assert.deepEqual(result.scores, [7.5, 7.5]);
  assert.equal(result.winner, null);
  assert.deepEqual(match, original);
  assert.equal(advanceMatch(match, match.finishedAt + 1_000_000), true);
  assert.deepEqual(match, { ...original, scores: [7.5, 7.5] });
  assert.equal(advanceMatch(match, match.finishedAt + 2_000_000), false);
  assert.deepEqual(publicResults(match), result);
});

test('snapshots and public results cannot mutate authority state and snapshots do not advance time', () => {
  const match = playing();
  const snapshot = snapshotFor(match, 0, match.deadline + 100);
  assert.equal(match.phase, 'playing');
  snapshot.players[0].name = 'Changed';
  snapshot.tiles[0].letter = 'z';
  snapshot.scores[0] = 99;
  assert.equal(match.players[0].name, 'Alex');
  assert.equal(match.scores[0], 0);
  assert.notDeepEqual(snapshot.tiles, match.rounds[0].initialTiles);
  advanceMatch(match, NOW + LOBBY_MS);
  publicResults(match).results[0].target = 'changed';
  assert.equal(match.results[0].target, 'care');
});
