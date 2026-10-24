/** Lexical classification for puzzle selection. Never infer a lemma from a suffix alone. */
export const CLASSIFICATION_POLICY = 'regular-inflections-v1';
export const INDEPENDENT_SENSE_MAX_SIZE = 70;

const wordPattern = /^[a-z]+$/;
const comparisonPos = new Set(['aj', 'av', 'a', 'aj_av', 'd']);
const inflectingPos = new Set(['n', 'v', 'm', 'n_v', 'pn']);
const excludedPos = new Set(['abbr', 'pre', 'suf', 'wp', 'we', 'x']);

function cleanWord(word) {
  return word.replace(/^[-@!]+|[*@~!†-]+$/gu, '');
}

function splitOutsideNotes(text, delimiter) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if ('({<'.includes(text[i])) depth++;
    if (')}>'.includes(text[i])) depth--;
    if (!depth && text.startsWith(delimiter, i)) {
      parts.push(text.slice(start, i));
      i += delimiter.length - 1;
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * Read the generated ESDB text, not the pre-import sources or executable code.
 * Blank lines separate senses. A '-' lemma continues its sense's base forms;
 * multiple base forms in a sense are spelling variants, not unrelated words.
 * Keep lemmas of every length: act, be and go also produce playable forms.
 */
export function parseLexicon(text) {
  const entries = new Map();
  let group = [];
  function add(word, evidence) {
    if (!wordPattern.test(word)) return;
    if (!entries.has(word)) entries.set(word, []);
    entries.get(word).push(evidence);
  }
  function flush() {
    if (!group.length) return;
    const roots = [...new Set(group.map(row => row.lemma).filter(word => word && word !== '-'))];
    for (const row of group) {
      if (row.lemma !== '-') add(row.lemma, { kind: 'headword', pos: row.pos, size: row.size, line: row.line });
      if (row.forms.length && !roots.length) throw new Error(`ESDB continuation has no lemma at line ${row.line}.`);
      for (const form of row.forms) {
        add(form, { kind: 'form', pos: row.pos, size: row.size, roots, line: row.line });
      }
    }
    group = [];
  }
  for (const [index, raw] of text.split(/\r?\n/u).entries()) {
    if (!raw.trim()) { flush(); continue; }
    if (raw.startsWith('#')) continue;
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    const fields = splitOutsideNotes(line, ': ');
    if (!/^\d+/u.test(fields[0]) || fields.length < 2) throw new Error(`Invalid ESDB line ${index + 1}.`);
    const size = Number(fields.shift().match(/^\d+/u)[0]);
    // Optional dialect/variant prefix or derived-form override marker.
    if (fields[0] === '+' || /^[ABZCD_.=?v~V@x -]+(?: \{\d+\})?$/u.test(fields[0])) fields.shift();
    const head = fields.shift();
    const match = head?.match(/^(.+?)(?: <([^>]*)>)?(?: \{[^}]*\})?(?: \([^)]*\))?$/u);
    if (!match) throw new Error(`Invalid ESDB headword at line ${index + 1}.`);
    const lemma = cleanWord(match[1]);
    const [pos = '', category = ''] = (match[2] ?? '').split('/');
    // Proper names/abbreviations must not lend a lowercase spelling an independent sense.
    if (excludedPos.has(pos) || /^(?:name|person|place|surname|upper|abbr)/u.test(category)) continue;
    const forms = [];
    if (fields.length) {
      for (const slot of fields.join(': ').split(', ')) {
        for (const alternative of slot.replace(/^\(|\)$/gu, '').split(' | ')) {
          const form = cleanWord(alternative.split(': ').at(-1));
          // Apostrophes, hyphens and spaces are not playable spellings.
          if (wordPattern.test(form)) forms.push(form);
        }
      }
    }
    group.push({ lemma, pos, size, forms, line: index + 1 });
  }
  flush();
  return entries;
}

/** Only test documented lemma/form relationships, including regional variants. */
export function isRegularInflection(lemma, form, pos) {
  if (!wordPattern.test(lemma) || !wordPattern.test(form) || form === lemma) return false;
  const noun = ['n', 'm', 'n_v', 'pn'].includes(pos);
  const verb = ['v', 'm', 'n_v'].includes(pos);
  if (!noun && !verb) return false;
  const candidates = new Set([`${lemma}s`, `${lemma}es`]);
  if (/[^aeiou]y$/u.test(lemma)) candidates.add(`${lemma.slice(0, -1)}ies`);
  if (/[sz]$/u.test(lemma)) candidates.add(`${lemma}${lemma.at(-1)}es`);
  // Deliberate game policy: knives/leaves/wolves are specialized plurals.
  if (noun && /fe?$/u.test(lemma)) candidates.add(`${lemma.replace(/ff?e?$/u, '')}ves`);
  if (verb) {
    candidates.add(`${lemma}ed`);
    candidates.add(`${lemma}ing`);
    if (lemma.endsWith('e')) {
      candidates.add(`${lemma}d`);
      candidates.add(`${lemma.slice(0, -1)}ing`);
    }
    if (/[^aeiou]y$/u.test(lemma)) candidates.add(`${lemma.slice(0, -1)}ied`);
    if (lemma.endsWith('ie')) candidates.add(`${lemma.slice(0, -2)}ying`);
    if (/[^aeiouwxy]$/u.test(lemma)) {
      candidates.add(`${lemma}${lemma.at(-1)}ed`);
      candidates.add(`${lemma}${lemma.at(-1)}ing`);
    }
    if (lemma.endsWith('c')) {
      candidates.add(`${lemma}ked`);
      candidates.add(`${lemma}king`);
    }
  }
  return candidates.has(form);
}

export function classifyWord(word, evidence, override) {
  if (override) return { category: override.category, reason: 'reviewed', detail: override.reason };
  if (!evidence?.length) return null;
  if (evidence.some(entry => entry.kind === 'headword' && entry.size <= INDEPENDENT_SENSE_MAX_SIZE)) {
    return { category: 'normal', reason: 'independent-entry' };
  }
  const forms = evidence.filter(entry => entry.kind === 'form');
  if (forms.some(entry => comparisonPos.has(entry.pos))) return { category: 'normal', reason: 'comparison' };
  if (forms.some(entry => inflectingPos.has(entry.pos) && !entry.roots.some(root => isRegularInflection(root, word, entry.pos)))) {
    return { category: 'normal', reason: 'irregular-inflection' };
  }
  if (forms.some(entry => inflectingPos.has(entry.pos) && entry.roots.some(root => isRegularInflection(root, word, entry.pos)))) {
    return { category: 'specialized', reason: 'regular-inflection' };
  }
  // Missing/unsupported evidence must be reviewed, not silently put in either bucket.
  return null;
}

export function classifyPools(pools, entries, overrides = {}) {
  const classified = {};
  const audit = {};
  const unresolved = [];
  const targets = new Set(Object.values(pools).flat());
  for (const [word, override] of Object.entries(overrides)) {
    if (!targets.has(word) || !['normal', 'specialized'].includes(override.category) || !override.reason?.trim()) {
      throw new Error(`Invalid or obsolete classification override: ${word}.`);
    }
  }
  for (const [length, words] of Object.entries(pools)) {
    classified[length] = { normal: [], specialized: [] };
    for (const word of words) {
      const result = classifyWord(word, entries.get(word), overrides[word]);
      if (!result) { unresolved.push(word); continue; }
      classified[length][result.category].push(word);
      audit[word] = result;
    }
  }
  if (unresolved.length) throw new Error(`Unreviewed target classifications (${unresolved.length}): ${unresolved.join(', ')}`);
  for (const [length, buckets] of Object.entries(classified)) {
    if (!buckets.normal.length || !buckets.specialized.length) throw new Error(`Both ${length}-letter target categories must be nonempty.`);
    for (const words of Object.values(buckets)) words.sort();
  }
  return { pools: classified, audit };
}
