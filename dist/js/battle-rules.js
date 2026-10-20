/** Authoritative battle rules. State is JSON-serializable; callers own storage and transport. */
import { ROUND_MS, createRng, drawWords, scrambledTiles, isValidAnswer } from './game-core.js';
import { battleScores } from './battle-scoring.js';
import {
  PROTOCOL_VERSION, DICTIONARY_VERSION, COUNTDOWN_MS, TIE_MS, REVEAL_MS, LOBBY_MS,
} from './battle-protocol.js';

export { COUNTDOWN_MS, TIE_MS, REVEAL_MS, LOBBY_MS } from './battle-protocol.js';

const isSeat = (seat) => seat === 0 || seat === 1;
const reject = (reason) => ({ accepted: false, reason });
const copy = (value) => JSON.parse(JSON.stringify(value));

export function createMatch({ id, pools, seed, now, dictionaryVersion = DICTIONARY_VERSION }) {
  const rng = createRng(seed);
  // Draw every target before preparing any initial or button-shuffle arrangement.
  const targets = drawWords(pools, rng);
  const rounds = targets.map((target) => {
    const initialTiles = scrambledTiles(target, rng);
    return {
      target,
      initialTiles,
      shuffledTiles: scrambledTiles(target, rng, initialTiles),
      shuffleUsed: [false, false],
      claims: [null, null],
      resolutionAt: null,
    };
  });
  return {
    protocolVersion: PROTOCOL_VERSION, dictionaryVersion, id,
    createdAt: now, expiresAt: now + LOBBY_MS, phase: 'lobby',
    players: [null, null], scores: [0, 0], rounds, results: [],
    index: -1, startedAt: null, startAt: null, deadline: null,
    revealUntil: null, finishedAt: null,
  };
}

export function joinSeat(match, seat, name, now) {
  advanceMatch(match, now);
  if (!isSeat(seat)) return reject('invalid_seat');
  if (match.phase !== 'lobby') return reject('room_closed');
  if (match.players[seat]) return reject('seat_taken');
  if (typeof name !== 'string') return reject('invalid_name');
  const normalized = name.trim();
  if (!normalized || Array.from(normalized).length > 24 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return reject('invalid_name');
  }
  match.players[seat] = { name: normalized, ready: false };
  return { accepted: true };
}

export function readyPlayer(match, seat, now) {
  advanceMatch(match, now);
  if (!isSeat(seat) || !match.players[seat]) return reject('invalid_seat');
  if (match.phase !== 'lobby') return reject('room_closed');
  match.players[seat].ready = true;
  if (match.players.every((player) => player?.ready)) {
    match.phase = 'countdown';
    match.startAt = now + COUNTDOWN_MS;
    match.startedAt = match.startAt;
  }
  return { accepted: true };
}

function beginRound(match, at) {
  match.phase = 'playing';
  match.index += 1;
  match.startAt = at;
  match.deadline = at + ROUND_MS;
  match.revealUntil = null;
}

function finishRound(match, at) {
  const round = match.rounds[match.index];
  const claims = round.claims;
  const count = claims.filter(Boolean).length;
  const winner = count === 1 ? claims.findIndex(Boolean) : null;
  match.results.push({
    round: match.index,
    target: round.target,
    outcome: count === 2 ? 'tie' : count === 1 ? 'win' : 'timeout',
    winner,
    answers: claims.map((claim) => claim?.answer ?? null),
    elapsedMs: claims.map((claim) => claim ? claim.receivedAt - match.startAt : null),
    endedAt: at,
  });
  match.phase = 'reveal';
  match.revealUntil = at + REVEAL_MS;
}

/** Process all elapsed transitions using their original deadlines, including after a restart. */
export function advanceMatch(match, now) {
  let changed = false;
  while (true) {
    if (match.phase === 'lobby' && now >= match.expiresAt) {
      match.phase = 'expired';
    } else if (match.phase === 'countdown' && now >= match.startAt) {
      beginRound(match, match.startAt);
    } else if (match.phase === 'playing') {
      const round = match.rounds[match.index];
      const resolutionAt = round.resolutionAt ?? match.deadline;
      if (now < resolutionAt) break;
      finishRound(match, resolutionAt);
    } else if (match.phase === 'reveal' && now >= match.revealUntil) {
      if (match.index + 1 === match.rounds.length) {
        match.phase = 'finished';
        match.finishedAt = match.revealUntil;
      } else {
        beginRound(match, match.revealUntil);
      }
    } else {
      break;
    }
    changed = true;
  }
  // Resolved outcomes are authoritative, so older rooms also receive tie points
  // on their next normal operation without replaying rounds or changing clocks.
  const scores = battleScores(match.results);
  if (scores.some((score, seat) => score !== match.scores[seat])) {
    match.scores = scores;
    changed = true;
  }
  return changed;
}

/** Validate again on the authority even though the client rejects ordinary invalid entries. */
export function submitAnswer(match, { seat, round: roundIndex, submissionId, answer }, acceptedWords, now) {
  advanceMatch(match, now);
  if (!isSeat(seat) || !match.players[seat]) return reject('invalid_seat');
  if (typeof submissionId !== 'string' || !submissionId.length || submissionId.length > 80) {
    return reject('invalid_submission');
  }
  // Retain each successful receipt with its round so retries remain idempotent after advancement.
  const previousIndex = match.rounds.findIndex((round) => round.claims[seat]?.submissionId === submissionId);
  if (previousIndex !== -1) {
    const previous = match.rounds[previousIndex].claims[seat];
    if (previousIndex !== roundIndex || previous.answer !== answer) return reject('submission_conflict');
    return { accepted: true, receivedAt: previous.receivedAt };
  }
  if (match.phase !== 'playing' || roundIndex !== match.index) return reject('round_closed');
  if (now < match.startAt || now >= match.deadline) return reject('deadline');
  const round = match.rounds[match.index];
  if (round.claims[seat]) return reject('already_submitted');
  if (!isValidAnswer(answer, round.initialTiles, acceptedWords, round.target)) {
    return reject('invalid_answer');
  }
  round.claims[seat] = { submissionId, answer, receivedAt: now };
  if (round.resolutionAt === null) round.resolutionAt = now + TIE_MS;
  return { accepted: true, receivedAt: now };
}

export function shufflePlayer(match, seat, roundIndex, now) {
  advanceMatch(match, now);
  if (!isSeat(seat) || !match.players[seat]) return reject('invalid_seat');
  if (match.phase !== 'playing' || match.index !== roundIndex || now >= match.deadline) return reject('round_closed');
  const round = match.rounds[match.index];
  if (round.shuffleUsed[seat]) return reject('shuffle_used');
  if (round.claims[seat]) return reject('already_submitted');
  round.shuffleUsed[seat] = true;
  return { accepted: true };
}

export function nextAlarmAt(match) {
  if (match.phase === 'lobby') return match.expiresAt;
  if (match.phase === 'countdown') return match.startAt;
  if (match.phase === 'playing') return match.rounds[match.index].resolutionAt ?? match.deadline;
  if (match.phase === 'reveal') return match.revealUntil;
  return null;
}

/** Read-only projection. Call advanceMatch first; never send the stored match directly. */
export function snapshotFor(match, seat, now) {
  const ownSeat = isSeat(seat) && match.players[seat] ? seat : null;
  const round = match.index >= 0 ? match.rounds[match.index] : null;
  const showTiles = ownSeat !== null && round && (match.phase === 'playing' || match.phase === 'reveal');
  const ownClaim = ownSeat !== null ? round?.claims[ownSeat] : null;
  return {
    protocolVersion: match.protocolVersion,
    dictionaryVersion: match.dictionaryVersion,
    id: match.id,
    phase: match.phase,
    index: match.index,
    roundCount: match.rounds.length,
    players: copy(match.players),
    scores: battleScores(match.results),
    startAt: match.startAt,
    deadline: match.deadline,
    revealUntil: match.revealUntil,
    expiresAt: match.expiresAt,
    finishedAt: match.finishedAt,
    serverNow: now,
    seat: ownSeat,
    tiles: showTiles ? copy(round.shuffleUsed[ownSeat] ? round.shuffledTiles : round.initialTiles) : [],
    shuffleUsed: ownSeat !== null ? round?.shuffleUsed[ownSeat] ?? false : false,
    ownSubmission: ownClaim ? { submissionId: ownClaim.submissionId, answer: ownClaim.answer } : null,
    results: copy(match.results),
  };
}

export function publicResults(match) {
  if (match.phase !== 'finished') return null;
  const scores = battleScores(match.results);
  return {
    protocolVersion: match.protocolVersion,
    dictionaryVersion: match.dictionaryVersion,
    id: match.id,
    players: copy(match.players),
    scores,
    winner: scores[0] === scores[1] ? null : scores[0] > scores[1] ? 0 : 1,
    results: copy(match.results),
    finishedAt: match.finishedAt,
  };
}
