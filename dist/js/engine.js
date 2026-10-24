/** Solo state machine; reusable puzzle rules live in game-core.js. */
import {
  WORD_LENGTHS, ROUND_MS, createRng, drawWords, scrambledTiles,
  entryWord, selectTileIds, tileForLetter, isValidAnswer,
} from './game-core.js';

// Preserve the original engine module's public API for existing callers.
export {
  WORD_LENGTHS, ROUND_MS, createRng, randomIndex, chooseWords, scrambledTiles,
} from './game-core.js';

/**
 * Synchronous state machine. Every action returns a defensive snapshot. Call tick()
 * while playing to update the timer; snapshot() itself never advances the clock.
 * The UI owns the brief feedback delay and calls nextRound() when it has elapsed.
 */
export class GameEngine {
  #pools;
  #accepted;
  #now;
  #rng;
  #deadline = 0;
  #state = {
    status: 'ready',
    seed: null,
    words: [],
    index: -1,
    remainingMs: ROUND_MS,
    tiles: [],
    selectedIds: [],
    entry: '',
    shuffleUsed: false,
    results: [],
    feedback: null,
    invalidAttempt: 0,
    invalidEntry: '',
  };

  constructor({
    pools,
    acceptedWords = Object.values(pools).flatMap(pool => Array.isArray(pool)
      ? pool : [...(pool?.normal ?? []), ...(pool?.specialized ?? [])]),
    now = () => performance.now(),
  }) {
    this.#pools = pools;
    this.#accepted = new Set(Array.from(acceptedWords, (word) => word.toLowerCase()));
    this.#now = now;
  }

  snapshot() {
    return {
      ...this.#state,
      words: [...this.#state.words],
      tiles: this.#state.tiles.map((tile) => ({ ...tile })),
      selectedIds: [...this.#state.selectedIds],
      results: this.#state.results.map((result) => ({ ...result })),
    };
  }

  start(seed = Date.now()) {
    const rng = createRng(seed);
    // Select the whole game before scrambling consumes any of its random stream.
    const words = drawWords(this.#pools, rng);
    this.#rng = rng;
    Object.assign(this.#state, {
      seed,
      words,
      index: 0,
      results: [],
      invalidAttempt: 0,
    });
    this.#beginRound();
    return this.snapshot();
  }

  #beginRound() {
    Object.assign(this.#state, {
      status: 'playing',
      remainingMs: ROUND_MS,
      tiles: scrambledTiles(this.#state.words[this.#state.index], this.#rng),
      selectedIds: [],
      entry: '',
      shuffleUsed: false,
      feedback: null,
      invalidEntry: '',
    });
    this.#deadline = this.#now() + ROUND_MS;
  }

  #syncClock() {
    if (this.#state.status !== 'playing') return;
    this.#state.remainingMs = Math.max(
      0,
      Math.min(this.#state.remainingMs, this.#deadline - this.#now()),
    );
    if (this.#state.remainingMs === 0) this.#complete(false);
  }

  #complete(solved) {
    if (this.#state.status !== 'playing') return;
    this.#state.results.push({
      target: this.#state.words[this.#state.index],
      answer: solved ? this.#state.entry : null,
      solved,
      elapsedMs: ROUND_MS - this.#state.remainingMs,
    });
    this.#state.status = 'feedback';
    this.#state.feedback = solved ? 'correct' : 'timeout';
    this.#state.invalidEntry = '';
  }

  #refreshEntry() {
    this.#state.entry = entryWord(this.#state.tiles, this.#state.selectedIds);
  }

  selectTile(id) {
    this.#syncClock();
    if (this.#state.status !== 'playing') return this.snapshot();
    const tile = this.#state.tiles.find((tile) => tile.id === id);
    if (!tile) return this.snapshot();
    this.#state.invalidEntry = '';
    this.#state.selectedIds = selectTileIds(this.#state.tiles, this.#state.selectedIds, id);
    this.#refreshEntry();
    if (this.#state.selectedIds.length === this.#state.tiles.length) {
      if (isValidAnswer(this.#state.entry, this.#state.tiles, this.#accepted, this.#state.words[this.#state.index])) {
        this.#complete(true);
      } else {
        this.#state.invalidEntry = this.#state.entry;
        this.#state.invalidAttempt += 1;
        this.#state.selectedIds = [];
        this.#state.entry = '';
      }
    }
    return this.snapshot();
  }

  typeLetter(letter) {
    this.#syncClock();
    if (this.#state.status !== 'playing') return this.snapshot();
    const tile = tileForLetter(this.#state.tiles, this.#state.selectedIds, letter);
    return tile ? this.selectTile(tile.id) : this.snapshot();
  }

  backspace() {
    this.#syncClock();
    if (this.#state.status === 'playing') {
      this.#state.selectedIds.pop();
      this.#state.invalidEntry = '';
      this.#refreshEntry();
    }
    return this.snapshot();
  }

  clear() {
    this.#syncClock();
    if (this.#state.status === 'playing') {
      this.#state.selectedIds = [];
      this.#state.entry = '';
      this.#state.invalidEntry = '';
    }
    return this.snapshot();
  }

  shuffle() {
    this.#syncClock();
    if (this.#state.status !== 'playing' || this.#state.shuffleUsed) return this.snapshot();
    this.#state.tiles = scrambledTiles(
      this.#state.words[this.#state.index],
      this.#rng,
      this.#state.tiles,
    );
    this.#state.shuffleUsed = true;
    this.#state.selectedIds = [];
    this.#state.entry = '';
    this.#state.invalidEntry = '';
    return this.snapshot();
  }

  pause() {
    this.#syncClock();
    if (this.#state.status === 'playing') this.#state.status = 'paused';
    return this.snapshot();
  }

  resume() {
    if (this.#state.status === 'paused') {
      this.#deadline = this.#now() + this.#state.remainingMs;
      this.#state.status = 'playing';
    }
    return this.snapshot();
  }

  tick() {
    this.#syncClock();
    return this.snapshot();
  }

  nextRound() {
    if (this.#state.status !== 'feedback') return this.snapshot();
    if (this.#state.index === WORD_LENGTHS.length - 1) {
      this.#state.status = 'finished';
    } else {
      this.#state.index += 1;
      this.#beginRound();
    }
    return this.snapshot();
  }
}
