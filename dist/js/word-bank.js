// All data access lives here. A future service worker can cache these
// same-origin resources without changing the engine or presentation layer.
const LENGTHS = [4, 5, 6, 7, 8, 9, 10];
const CATEGORIES = ['normal', 'specialized'];

async function loadJson(filename) {
  const response = await fetch(new URL(`../data/${filename}`, import.meta.url));
  if (!response.ok) throw new Error(`Word bank request failed (${response.status}).`);
  return response.json();
}

function hasKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function isWordList(words, length) {
  // Strict ordering also rejects duplicate entries that would bias selection.
  return Array.isArray(words) && words.length > 0 && words.every((word, index) =>
    typeof word === 'string' && /^[a-z]+$/.test(word) && word.length === length &&
    (index === 0 || words[index - 1] < word));
}

export async function loadWordBank() {
  const [pools, acceptedPools] = await Promise.all([
    loadJson('target-pools.json'),
    loadJson('words.json'),
  ]);
  if (!hasKeys(pools, LENGTHS) || !hasKeys(acceptedPools, LENGTHS) || LENGTHS.some(length => {
    const categories = pools[length];
    if (!hasKeys(categories, CATEGORIES) ||
        CATEGORIES.some(category => !isWordList(categories[category], length)) ||
        !isWordList(acceptedPools[length], length)) return true;
    const normal = new Set(categories.normal);
    return categories.specialized.some(word => normal.has(word));
  })) {
    throw new Error('The word bank is incomplete or invalid.');
  }
  const targets = Object.values(pools).flatMap(pool => [...pool.normal, ...pool.specialized]);
  const acceptedWords = new Set(Object.values(acceptedPools).flat());
  if (targets.some(word => !acceptedWords.has(word))) {
    throw new Error('A puzzle word is missing from the accepted vocabulary.');
  }
  const normalCount = LENGTHS.reduce((count, length) => count + pools[length].normal.length, 0);
  return {
    pools, acceptedWords, count: acceptedWords.size, targetCount: targets.length,
    normalCount, specializedCount: targets.length - normalCount,
  };
}
