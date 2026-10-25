import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CLASSIFICATION_POLICY, INDEPENDENT_SENSE_MAX_SIZE, parseLexicon, classifyPools } from './target-classification.mjs';

export const LEXICON_COMMIT = '7f2f4078354752045ee16a041605686561122185';
export const LEXICON_SOURCE_COMMIT = '1e5b7d3a72f47a71da5d28686c1dd4b397178485';
export const LEXICON_SHA256 = '3ca0f96ef1377a0e2ec4084025933afab8c8d90562257ae73638460f99d2f09c';
export const LEXICON_LICENSE_SHA256 = '71bffd4b74ad47fff01c8b3c666e77da92737854e568850d8728024e0a53f304';
const URL_ROOT = `https://raw.githubusercontent.com/en-wl/wordlist-diff/${LEXICON_COMMIT}`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function pinnedFile(directory, filename, checksum, download) {
  const path = resolve(directory, filename);
  let bytes;
  try { bytes = await readFile(path); }
  catch (error) {
    if (error.code !== 'ENOENT' || !download) throw error;
    const response = await fetch(`${URL_ROOT}/${filename}`, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`ESDB download failed (${filename}): HTTP ${response.status}.`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== checksum) throw new Error(`ESDB checksum mismatch: ${filename}.`);
    await mkdir(directory, { recursive: true });
    await writeFile(path, bytes);
  }
  if (sha256(bytes) !== checksum) throw new Error(`ESDB checksum mismatch: ${filename}.`);
  return bytes;
}

export async function prepareClassifiedTargets(root, puzzleOutput, lexiconDirectory) {
  const cache = lexiconDirectory ?? resolve(root, 'vendor', 'esdb', LEXICON_COMMIT);
  const [source, license, overridesBytes] = await Promise.all([
    pinnedFile(cache, 'scowl.txt', LEXICON_SHA256, !lexiconDirectory),
    pinnedFile(cache, 'Copyright', LEXICON_LICENSE_SHA256, !lexiconDirectory),
    readFile(resolve(root, 'scripts', 'data', 'target-overrides.json')),
  ]);
  const overrides = JSON.parse(overridesBytes);
  const result = classifyPools(JSON.parse(puzzleOutput), parseLexicon(source.toString('utf8')), overrides);
  const output = `${JSON.stringify(result.pools)}\n`;
  const counts = Object.fromEntries(Object.entries(result.pools).map(([length, pool]) => [length, {
    normal: pool.normal.length, specialized: pool.specialized.length,
  }]));
  const reasons = {};
  for (const entry of Object.values(result.audit)) reasons[entry.reason] = (reasons[entry.reason] ?? 0) + 1;
  const metadata = {
    policy: CLASSIFICATION_POLICY,
    selection: { normal: 0.8, specialized: 0.2, independentPerRound: true, replacement: true },
    definition: {
      normal: 'Independent lexical entries, all comparisons, and irregular inflections. A qualifying independent sense or irregular use wins for overlapping spellings.',
      specialized: 'Only regular inflections, including ordinary spelling adjustments and f/fe/ff-to-ves noun plurals. A regular form of an irregular verb is still regular.',
      independentSenseMaximumEsdbSize: INDEPENDENT_SENSE_MAX_SIZE,
      independentSensePolicy: 'Separate ESDB headword/lemma entries through size 70 qualify, including adjectives and entries with unknown part of speech. A participle or gerund form alone does not. Explicit reviewed exceptions preserve existing base targets outside this metadata cutoff.',
      morphologyPolicy: 'Use documented relationships at all ESDB sizes; do not infer base words by stripping endings. Consider complete variant groups and base words outside playable lengths. Pronoun forms using ordinary plural endings are regular; other pronoun forms are irregular.',
    },
    vocabulary: { file: 'puzzle-words.json', sha256: sha256(puzzleOutput), words: Object.values(result.audit).length, added: 0, removed: 0 },
    source: {
      name: 'English Speller Database (ESDB)',
      url: `${URL_ROOT}/scowl.txt`, commit: LEXICON_COMMIT, sourceCommit: LEXICON_SOURCE_COMMIT,
      sha256: LEXICON_SHA256, licenseUrl: `${URL_ROOT}/Copyright`, licenseFile: 'ESDB-LICENSE.txt', licenseSha256: LEXICON_LICENSE_SHA256,
      modifications: 'Parsed lexical groups and inflection relationships to classify the American-only SCOWL 2020.12.07 target inventory. No upstream code executed; no ESDB words added to target or accepted vocabularies.',
    },
    overrides: { file: 'scripts/data/target-overrides.json', sha256: sha256(overridesBytes), entries: overrides },
    wordCounts: counts,
    totals: {
      normal: Object.values(counts).reduce((sum, count) => sum + count.normal, 0),
      specialized: Object.values(counts).reduce((sum, count) => sum + count.specialized, 0),
    },
    reasonCounts: reasons,
    unresolved: 0,
    file: 'target-pools.json',
    sha256: sha256(output),
  };
  return { output, metadata, license };
}
