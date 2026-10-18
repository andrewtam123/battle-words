/** Shared puzzle and entry rules. No browser, storage, network, or game lifecycle. */
export const WORD_LENGTHS = Object.freeze([
  4, 4, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 7, 7, 7, 8, 8, 9, 10,
]);
export const ROUND_MS = 30_000;
const UINT32_RANGE = 0x1_0000_0000;

/** Deterministic, non-cryptographic xoshiro128** generator, seeded by a safe integer. */
export function createRng(seed) {
  if (!Number.isSafeInteger(seed)) {
    throw new TypeError('The random seed must be a safe integer.');
  }
  // Hash the whole seed so its high bits participate too.
  let hash = 0x811c9dc5;
  for (const character of String(seed)) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0;
  }
  const seedWord = () => {
    hash = (hash + 0x9e3779b9) >>> 0;
    let value = Math.imul(hash ^ (hash >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    return (value ^ (value >>> 15)) >>> 0;
  };
  let a = seedWord();
  let b = seedWord();
  let c = seedWord();
  let d = seedWord();
  if (!(a | b | c | d)) a = 1;
  const rotateLeft = (value, bits) =>
    ((value << bits) | (value >>> (32 - bits))) >>> 0;

  return {
    nextUint32() {
      const result = Math.imul(rotateLeft(Math.imul(b, 5), 7), 9) >>> 0;
      const temporary = b << 9;
      c ^= a;
      d ^= b;
      b ^= c;
      a ^= d;
      c ^= temporary;
      d = rotateLeft(d, 11);
      return result;
    },
  };
}

/** Rejection sampling avoids the bias of simply taking a random integer modulo n. */
export function randomIndex(rng, length) {
  if (!Number.isInteger(length) || length < 1 || length > UINT32_RANGE) {
    throw new RangeError('A random selection requires between 1 and 2^32 items.');
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % length);
  let value;
  do {
    value = rng.nextUint32();
  } while (value >= limit);
  return value % length;
}

export function drawWords(pools, rng) {
  return WORD_LENGTHS.map((length) => {
    const pool = pools[length];
    if (!Array.isArray(pool) || pool.length === 0) {
      throw new RangeError(`The ${length}-letter word pool is empty or missing.`);
    }
    const word = pool[randomIndex(rng, pool.length)];
    if (typeof word !== 'string' || word.length !== length || !/^[a-z]+$/.test(word)) {
      throw new TypeError(`The ${length}-letter word pool contains an invalid word.`);
    }
    return word;
  });
}

/** Twenty independent, uniform word draws with replacement; no group weighting. */
export function chooseWords(pools, seed = Date.now()) {
  return drawWords(pools, createRng(seed));
}

/**
 * Shuffle tiles, preserving IDs when previous tiles are supplied. Avoid the target
 * spelling and visibly change the previous order whenever a different order exists.
 */
export function scrambledTiles(word, rng, previous) {
  const source = previous
    ? previous.map((tile) => ({ ...tile }))
    : Array.from(word, (letter, id) => ({ id, letter }));
  const previousLetters = previous?.map((tile) => tile.letter).join('');
  const suitable = (tiles) => {
    const letters = tiles.map((tile) => tile.letter).join('');
    return letters !== word && letters !== previousLetters;
  };
  let tiles = source;
  // The limit also makes this helper terminate with a pathological test RNG.
  for (let attempt = 0; attempt < 16; attempt += 1) {
    tiles = source.map((tile) => ({ ...tile }));
    for (let index = tiles.length - 1; index > 0; index -= 1) {
      const other = randomIndex(rng, index + 1);
      [tiles[index], tiles[other]] = [tiles[other], tiles[index]];
    }
    if (suitable(tiles)) return tiles;
  }
  for (let first = 0; first < tiles.length; first += 1) {
    for (let second = first + 1; second < tiles.length; second += 1) {
      const candidate = tiles.map((tile) => ({ ...tile }));
      [candidate[first], candidate[second]] = [candidate[second], candidate[first]];
      if (suitable(candidate)) return candidate;
    }
  }
  // Identical-letter inputs have no different visible permutation.
  return tiles;
}

/** Read an entry by stable tile ID, including duplicate letters. */
export function entryWord(tiles, selectedIds) {
  return selectedIds.map((id) => tiles.find((tile) => tile.id === id)?.letter ?? '').join('');
}

/** Return a new selection, removing the suffix at the last selected matching letter. */
export function selectTileIds(tiles, selectedIds, id) {
  const tile = tiles.find((candidate) => candidate.id === id);
  if (!tile) return [...selectedIds];
  if (!selectedIds.includes(id)) return [...selectedIds, id];
  // Either selected N in NNO removes the final N and O, leaving N.
  return selectedIds.slice(0, entryWord(tiles, selectedIds).lastIndexOf(tile.letter));
}

/** Typing consumes the first unselected tile with that letter in visible order. */
export function tileForLetter(tiles, selectedIds, letter) {
  if (typeof letter !== 'string') return undefined;
  const normalized = letter.toLowerCase();
  return tiles.find((tile) => tile.letter === normalized && !selectedIds.includes(tile.id));
}

/**
 * Require a complete lowercase ASCII anagram and dictionary membership. A private
 * target can be supplied by a controller so its chosen word is always accepted.
 */
export function isValidAnswer(answer, tiles, acceptedWords, target) {
  if (typeof answer !== 'string' || !/^[a-z]+$/.test(answer) || answer.length !== tiles.length) {
    return false;
  }
  if ([...answer].sort().join('') !== tiles.map((tile) => tile.letter).sort().join('')) {
    return false;
  }
  return answer === target || (acceptedWords instanceof Set
    ? acceptedWords.has(answer) : acceptedWords.includes(answer));
}

