#!/usr/bin/env node
/**
 * Rebuild the bundled vocabulary from a checksum-pinned SCOWL release.
 * Requires Node.js 18+. Downloads data only; no upstream code is executed.
 *
 * node scripts/prepare-words.mjs
 * node scripts/prepare-words.mjs --archive /path/to/scowl-2020.12.07.tar.gz
 *
 * The archive is cached in vendor/ for subsequent, network-free rebuilds.
 * Generated output is deterministic (including metadata: no build timestamps).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { prepareClassifiedTargets } from './lib/prepare-targets.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '2020.12.07';
const ARCHIVE_NAME = `scowl-${VERSION}.tar.gz`;
const SOURCE_URL = `https://downloads.sourceforge.net/wordlist/${ARCHIVE_NAME}`;
const ARCHIVE_SHA256 = '5587667caa20c4891390c2d42dbb4d5c4c3f41bee77af1457ece3ba23fb859cc';
const SPELLINGS = [
  'english', 'american', 'british', 'british_z', 'canadian',
  'variant_1', 'variant_2',
  'british_variant_1', 'british_variant_2',
  'canadian_variant_1', 'canadian_variant_2',
];
const MAX_SIZE = 70;
const MAX_PUZZLE_SIZE = 35;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const args = process.argv.slice(2);
const options = new Map();
for (let i = 0; i < args.length; i += 2) {
  if (!['--archive', '--lexicon-dir'].includes(args[i]) || !args[i + 1] || options.has(args[i])) {
    throw new Error('Usage: node scripts/prepare-words.mjs [--archive path] [--lexicon-dir directory]');
  }
  options.set(args[i], resolve(args[i + 1]));
}
const archivePath = options.get('--archive') ?? resolve(ROOT, 'vendor', ARCHIVE_NAME);
let archive;
try {
  archive = await readFile(archivePath);
} catch (error) {
  if (error.code !== 'ENOENT' || options.has('--archive')) throw error;
  console.log(`Downloading ${SOURCE_URL}`);
  const response = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`SCOWL download failed: HTTP ${response.status}`);
  archive = Buffer.from(await response.arrayBuffer());
  if (sha256(archive) !== ARCHIVE_SHA256) throw new Error('SCOWL archive checksum mismatch.');
  await mkdir(dirname(archivePath), { recursive: true });
  await writeFile(archivePath, archive);
}
if (sha256(archive) !== ARCHIVE_SHA256) throw new Error('SCOWL archive checksum mismatch.');

// Read regular files directly from the verified tar in memory. No paths from
// the archive are extracted to disk, and scripts inside it are never executed.
function readTarFiles(bytes) {
  const files = new Map();
  const text = (start, length) => bytes.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const name = text(offset, 100);
    if (!name) break;
    const size = Number.parseInt(text(offset + 124, 12).trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > bytes.length) {
      throw new Error('Invalid SCOWL tar entry length.');
    }
    const prefix = text(offset + 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const type = text(offset + 156, 1);
    if (type === '0' || type === '') files.set(path, bytes.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

const files = readTarFiles(gunzipSync(archive));
const selected = [...files.keys()].filter((path) => {
  const match = path.match(/^scowl-2020\.12\.07\/final\/([a-z_0-9]+)-words\.(\d+)$/);
  return match && SPELLINGS.includes(match[1]) && Number(match[2]) <= MAX_SIZE;
}).sort();
if (selected.length !== 88) throw new Error(`Unexpected source-file count: ${selected.length}.`);

// SCOWL's individual source files are incremental. Include every source level
// at or below the target cutoff, not just files ending in the cutoff itself.
const puzzleSelected = selected.filter((path) => Number(path.match(/\.(\d+)$/)[1]) <= MAX_PUZZLE_SIZE);
const puzzleSizes = [...new Set(puzzleSelected.map((path) => Number(path.match(/\.(\d+)$/)[1])))].sort((a, b) => a - b);
if (JSON.stringify(puzzleSizes) !== '[10,20,35]') throw new Error('Unexpected puzzle source levels.');

function buildVocabulary(paths) {
  const unique = new Set();
  for (const path of paths) {
    // SCOWL v1 word-list files use ISO-8859-1. Do not normalize accents or
    // lowercase first: both would silently admit entries outside this policy.
    for (const word of files.get(path).toString('latin1').split(/\r?\n/)) {
      if (/^[a-z]{4,10}$/.test(word)) unique.add(word);
    }
  }
  const words = Object.fromEntries([4, 5, 6, 7, 8, 9, 10].map((length) => [String(length), []]));
  for (const word of [...unique].sort()) words[word.length].push(word);
  const counts = Object.fromEntries(Object.entries(words).map(([length, list]) => [length, list.length]));
  if (Object.values(counts).some((count) => count < 1000)) throw new Error('Unexpectedly small vocabulary.');
  return { output: `${JSON.stringify(words)}\n`, counts, total: unique.size };
}
const accepted = buildVocabulary(selected);
const puzzle = buildVocabulary(puzzleSelected);
// Finish classification before replacing any generated artifacts. Unknown forms
// require a documented review rather than a silent fallback to either category.
const classified = await prepareClassifiedTargets(ROOT, puzzle.output, options.get('--lexicon-dir'));

const copyright = files.get(`scowl-${VERSION}/Copyright`);
if (!copyright) throw new Error('Missing SCOWL copyright notices.');
const metadata = {
  name: 'SCOWL (Spell Checker Oriented Word Lists)',
  version: VERSION,
  sourcePage: 'https://wordlist.aspell.net/other/',
  sourceUrl: SOURCE_URL,
  sourceArchive: ARCHIVE_NAME,
  sourceArchiveSha256: ARCHIVE_SHA256,
  documentation: 'https://wordlist.aspell.net/scowl_v1-readme/',
  licenseFile: 'SCOWL-LICENSE.txt',
  copyright: 'Copyright 2000-2018 by Kevin Atkinson and the contributors named in SCOWL-LICENSE.txt.',
  modifications: 'Extracted and deduplicated lowercase ASCII words of 4–10 letters from the source files listed below. Source spelling is unchanged.',
  filters: {
    subcategory: 'words',
    spellingCategories: SPELLINGS,
    maximumScowlSizeInclusive: MAX_SIZE,
    acceptedLinePattern: '^[a-z]{4,10}$',
    caseConversion: 'none; uppercase entries are rejected before any normalization',
    sourceEncoding: 'ISO-8859-1',
    ordering: 'deduplicated and sorted by ASCII code point within each length',
    exclusions: 'No proper-names, upper, abbreviations, contractions, special, or variant_3 files. Non-ASCII letters, punctuation, spaces, and digits are excluded.',
    curation: 'No additional familiarity, frequency, content, or manual word exclusions.',
  },
  puzzleWordsAndAcceptedAnswers: 'Puzzle targets use all included SCOWL source levels through 35 in puzzle-words.json. Accepted answers retain the full vocabulary through level 70 in words.json.',
  wordCounts: accepted.counts,
  totalWords: accepted.total,
  wordsJsonSha256: sha256(accepted.output),
  includedSourceFiles: selected.map((path) => path.replace(`scowl-${VERSION}/`, '')),
  puzzleSelection: {
    maximumScowlSizeInclusive: MAX_PUZZLE_SIZE,
    includedScowlSizes: puzzleSizes,
    file: 'puzzle-words.json',
    wordCounts: puzzle.counts,
    totalWords: puzzle.total,
    wordsJsonSha256: sha256(puzzle.output),
    includedSourceFiles: puzzleSelected.map((path) => path.replace(`scowl-${VERSION}/`, '')),
    classifiedFile: 'target-pools.json',
    classificationMetadata: 'target-source.json',
    classifiedSha256: classified.metadata.sha256,
  },
};
const target = resolve(ROOT, 'dist', 'data');
await mkdir(target, { recursive: true });
await writeFile(resolve(target, 'words.json'), accepted.output);
await writeFile(resolve(target, 'puzzle-words.json'), puzzle.output);
await writeFile(resolve(target, 'word-source.json'), `${JSON.stringify(metadata, null, 2)}\n`);
await writeFile(resolve(target, 'SCOWL-LICENSE.txt'), copyright);
await writeFile(resolve(target, 'target-pools.json'), classified.output);
await writeFile(resolve(target, 'target-source.json'), `${JSON.stringify(classified.metadata, null, 2)}\n`);
await writeFile(resolve(target, 'ESDB-LICENSE.txt'), classified.license);
console.log(`Prepared ${accepted.total.toLocaleString('en-US')} accepted words (${Buffer.byteLength(accepted.output).toLocaleString('en-US')} bytes).`);
console.log(JSON.stringify(accepted.counts));
console.log(`Prepared ${puzzle.total.toLocaleString('en-US')} puzzle words from ${puzzleSelected.length} source files (${Buffer.byteLength(puzzle.output).toLocaleString('en-US')} bytes).`);
console.log(JSON.stringify(puzzle.counts));
console.log(`Classified targets: ${classified.metadata.totals.normal} normal, ${classified.metadata.totals.specialized} specialized; independent 80:20 draws.`);
console.log(JSON.stringify(classified.metadata.wordCounts));
