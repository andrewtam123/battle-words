import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyWord, classifyPools, isRegularInflection, parseLexicon } from '../scripts/lib/target-classification.mjs';

const fixture = `35: act <n_v>: acted, acting, acts, act's

35: acting <n>

35: paint <n_v>: painted, painting, paints, paint's

35: painting <n>: paintings, painting's

35: bore <n_v>: bored, boring, bores

40: boring <aj>

35: learn <v>: (A B= Z: learned | B Zv: learnt), learning, learns

35: A B= Z: learned <aj>

35: knife <n>: knives, knife's

35: leaf <n>: leaves†, leaf's

35: leave <v> {depart}: left, leaving, leaves†

35: A B: wolf <n>: (A B: wolf | A B: wolves | A-: wolfs), wolf's

35: take <v>: took, taken, taking, takes

35: tall <aj>: taller, tallest

35: good <aj>: better, best

35: child <n>: children, child's

35: tree <n>: trees, tree's
`;

test('classification preserves independent nouns and adjectives alongside inflections', () => {
  const entries = parseLexicon(fixture);
  for (const word of ['acting', 'painting', 'boring', 'learned']) {
    assert.equal(classifyWord(word, entries.get(word)).category, 'normal', word);
    assert.equal(classifyWord(word, entries.get(word)).reason, 'independent-entry', word);
  }
  for (const word of ['acted', 'painted', 'paintings', 'trees']) {
    assert.equal(classifyWord(word, entries.get(word)).category, 'specialized', word);
  }
});

test('irregular forms qualify individually without exempting their whole family', () => {
  const entries = parseLexicon(fixture);
  for (const word of ['took', 'taken', 'learnt', 'children', 'left']) {
    assert.equal(classifyWord(word, entries.get(word)).category, 'normal', word);
  }
  for (const word of ['taking', 'takes', 'learning', 'learns', 'leaving']) {
    assert.equal(classifyWord(word, entries.get(word)).category, 'specialized', word);
  }
});

test('f and fe plurals remain specialized while all comparisons remain normal', () => {
  const entries = parseLexicon(fixture);
  for (const word of ['knives', 'leaves', 'wolves']) {
    assert.equal(classifyWord(word, entries.get(word)).category, 'specialized', word);
  }
  for (const word of ['taller', 'tallest', 'better', 'best']) {
    assert.equal(classifyWord(word, entries.get(word)).category, 'normal', word);
    assert.equal(classifyWord(word, entries.get(word)).reason, 'comparison', word);
  }
});

test('regular spelling adjustments need a documented base-form relationship', () => {
  for (const [base, form, pos] of [
    ['study', 'studied', 'v'], ['study', 'studies', 'v'], ['baby', 'babies', 'n'],
    ['stop', 'stopped', 'v'], ['stop', 'stopping', 'v'], ['make', 'making', 'v'],
    ['die', 'dying', 'v'], ['panic', 'panicked', 'v'], ['panic', 'panicking', 'v'],
    ['bus', 'busses', 'n'], ['potato', 'potatoes', 'n'], ['roof', 'roofs', 'n'],
  ]) assert.equal(isRegularInflection(base, form, pos), true, `${base} -> ${form}`);
  assert.equal(isRegularInflection('go', 'went', 'v'), false);
  assert.equal(isRegularInflection('foot', 'feet', 'n'), false);
  assert.equal(isRegularInflection('cat', 'cats', 'aj'), false);
  assert.equal(classifyWord('invented', undefined), null);
});

test('variant roots and continuation lines stay within their lexical group', () => {
  const entries = parseLexicon(`35: A: color <n_v>: colored, coloring, colors
35: B: colour <n_v>
60: B: - <n_v>: coloured, colouring, colours

35: ring <n_v>: rang, rung, ringing, rings
`);
  assert.deepEqual(entries.get('colouring')[0].roots, ['color', 'colour']);
  assert.deepEqual(entries.get('rang')[0].roots, ['ring']);
  for (const word of ['colored', 'coloring', 'coloured', 'colouring']) {
    assert.equal(classifyWord(word, entries.get(word)).category, 'specialized', word);
  }
  assert.equal(classifyWord('rang', entries.get('rang')).category, 'normal');
});

test('parser handles numbered spelling variants, override forms and missing POS', () => {
  const entries = parseLexicon(`35: _V {1}: color <n_v>: colored, coloring, colors
35: _V {2}: colour <n_v>: coloured, colouring, colours

60: speak <v>: spoke, spoken, speaking, speaks
70: +: speak <v>: spake

40: glasses
`);
  assert.equal(classifyWord('glasses', entries.get('glasses')).reason, 'independent-entry');
  assert.equal(classifyWord('spake', entries.get('spake')).reason, 'irregular-inflection');
  assert.equal(classifyWord('colours', entries.get('colours')).reason, 'regular-inflection');
});

test('excluded lexical classes cannot supply an independent lowercase meaning', () => {
  const entries = parseLexicon(`35: tree <n>: trees, tree's

35: trees <abbr>

35: trees </name>

35: trees <pre>

35: trees <suf>
`);
  assert.equal(classifyWord('trees', entries.get('trees')).category, 'specialized');
  assert.equal(entries.has("tree's"), false);
});

test('unresolved words and obsolete overrides fail generation instead of silently selecting a pool', () => {
  const entries = parseLexicon('35: tree <n>: trees\n\n80: obscure <n>\n');
  assert.equal(classifyWord('obscure', entries.get('obscure')), null);
  assert.throws(() => classifyPools({ 4: ['tree'], 5: ['trees', 'ghost'] }, entries), /Unreviewed.*ghost/u);
  assert.throws(() => classifyPools({ 4: ['tree'] }, entries, { ghost: { category: 'normal', reason: 'reviewed' } }), /obsolete/u);
  const override = classifyWord('obscure', entries.get('obscure'), { category: 'normal', reason: 'Reviewed independent noun.' });
  assert.deepEqual(override, { category: 'normal', reason: 'reviewed', detail: 'Reviewed independent noun.' });
});
