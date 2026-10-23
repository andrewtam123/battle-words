import { GameEngine } from './engine.js';
import { WORD_LENGTHS } from './game-core.js';
import {
  element as node, renderAnswer, renderTiles, renderTimer, readGameKey, getClearShortcut,
  INVALID_FEEDBACK_MS, INVALID_FEEDBACK_TEXT,
} from './game-view.js';
import { loadWordBank } from './word-bank.js';
import { createBattleUI } from './battle-ui.js';

const $ = id => document.getElementById(id);
const ui = Object.fromEntries([
  'welcome', 'play-area', 'pause-area', 'results-area', 'start', 'load-status', 'retry-load',
  'round-label', 'round-length', 'progress', 'timer', 'seconds', 'timer-fill', 'score-small',
  'answer', 'feedback', 'tiles', 'shuffle', 'shuffle-label', 'clear', 'pause', 'resume',
  'restart', 'play-again', 'results-title', 'final-score', 'result-caption', 'result-grid',
  'word-review', 'help-dialog', 'about-dialog', 'dictionary-info',
].map(id => [id, $(id)]));

const clearShortcut = getClearShortcut();
for (const button of [ui.clear, $('battle-clear')]) {
  button.title = `Clear (${clearShortcut.label})`;
  button.setAttribute('aria-keyshortcuts', clearShortcut.aria);
}
$('clear-shortcut').textContent = clearShortcut.label;

let engine;
let animationFrame = 0;
let feedbackTimer = 0;
let invalidTimer = 0;
let generation = 0;
let renderedKey = '';
let lastInvalidAttempt = 0;
let invalidVisible = false;
let suspendedFeedback = false;
const battle = createBattleUI({
  onEnter() {
    generation += 1;
    clearScheduledWork();
    engine?.pause();
    suspendedFeedback = false;
    for (const id of ['welcome', 'play-area', 'pause-area', 'results-area']) ui[id].hidden = true;
  },
  onExit() { suspendedFeedback = false; showScreen('ready'); },
});
battle.start();

function dialogOpen() {
  return ui['help-dialog'].open || ui['about-dialog'].open;
}

function clearScheduledWork() {
  cancelAnimationFrame(animationFrame);
  clearTimeout(feedbackTimer);
  clearTimeout(invalidTimer);
  animationFrame = feedbackTimer = invalidTimer = 0;
}

function beginGame() {
  if (!engine) return;
  generation += 1;
  clearScheduledWork();
  suspendedFeedback = false;
  invalidVisible = false;
  lastInvalidAttempt = 0;
  renderedKey = '';
  document.querySelector('.word-review').open = false;
  render(engine.start(Date.now()));
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function act(method, value) {
  if (!engine || battle.active || dialogOpen()) return;
  render(engine[method](value));
}

function showScreen(status) {
  const screen = suspendedFeedback || status === 'paused' ? 'pause-area'
    : status === 'finished' ? 'results-area'
    : status === 'ready' ? 'welcome' : 'play-area';
  for (const id of ['welcome', 'play-area', 'pause-area', 'results-area']) ui[id].hidden = id !== screen;
}

function progressCell(index, result, current, tag = 'li') {
  const state = result ? (result.solved ? 'solved' : 'missed') : current ? 'current' : '';
  const label = result ? (result.solved ? 'solved' : 'missed') : current ? 'current word' : 'upcoming';
  const cell = node(tag, `progress-cell ${state}`, result ? (result.solved ? '✓' : '×') : String(index + 1).padStart(2, '0'));
  cell.setAttribute('aria-label', `Word ${index + 1}, ${WORD_LENGTHS[index]} letters, ${label}`);
  if (current) cell.setAttribute('aria-current', 'step');
  return cell;
}

function renderRound(state) {
  const length = WORD_LENGTHS[state.index];
  const solved = state.results.filter(result => result.solved).length;
  ui['round-label'].textContent = `Word ${String(state.index + 1).padStart(2, '0')} / ${WORD_LENGTHS.length}`;
  ui['round-length'].textContent = `${length} letters`;
  ui['score-small'].textContent = `${solved} solved`;
  ui.progress.replaceChildren(...WORD_LENGTHS.map((_, index) => progressCell(index, state.results[index], index === state.index && state.status !== 'feedback')));

  const invalid = invalidVisible && Boolean(state.invalidEntry) && state.status === 'playing';
  const appearance = state.feedback || (invalid ? 'invalid' : '');
  const displayed = state.feedback === 'timeout' ? state.words[state.index]
    : invalid ? state.invalidEntry : state.entry;
  renderAnswer(ui.answer, { word: displayed, length, appearance, label: state.feedback === 'timeout' ? 'Answer' : 'Your answer' });
  ui.feedback.className = `feedback ${appearance}`;
  ui.feedback.textContent = state.feedback === 'correct' ? 'Found it!'
    : state.feedback === 'timeout' ? 'Time’s up. On to the next.'
    : invalid ? INVALID_FEEDBACK_TEXT : '';
  if (state.feedback === 'timeout' && state.index === WORD_LENGTHS.length - 1) ui.feedback.textContent = 'Time’s up. Let’s see how you did.';

  renderTiles(ui.tiles, state.tiles, state.selectedIds, state.status === 'playing');
  ui.shuffle.disabled = state.shuffleUsed || state.status !== 'playing';
  ui['shuffle-label'].textContent = state.shuffleUsed ? 'Shuffle used' : 'Shuffle · 1';
  ui.clear.disabled = (!state.entry && !state.invalidEntry) || state.status !== 'playing';
}

function renderResults(state) {
  const score = state.results.filter(result => result.solved).length;
  ui['results-title'].textContent = score === WORD_LENGTHS.length ? 'Every word found.' : score >= 12 ? 'Nice wordplay.' : 'Another round?';
  ui['final-score'].textContent = score;
  ui['result-caption'].textContent = `${score === 1 ? 'Word' : 'Words'} found before the clock ran out.`;
  ui['result-grid'].replaceChildren(...state.results.map((result, index) => progressCell(index, result, false, 'span')));
  ui['word-review'].replaceChildren(...state.results.map((result, index) => {
    const row = node('li', `review-row ${result.solved ? 'solved' : 'missed'}`);
    row.append(node('span', 'review-number', String(index + 1).padStart(2, '0')));
    const answer = node('span', 'review-answer', result.answer || result.target);
    if (result.answer && result.answer !== result.target) answer.append(node('span', 'review-target', `Also: ${result.target.toUpperCase()}`));
    row.append(answer, node('span', 'review-status', result.solved ? `✓ ${(result.elapsedMs / 1000).toFixed(1)}s` : '× Missed'));
    return row;
  }));
}

function schedule(state) {
  if (state.status === 'playing' && !animationFrame && !document.hidden && !dialogOpen()) {
    animationFrame = requestAnimationFrame(() => {
      animationFrame = 0;
      render(engine.tick());
    });
  }
  if (state.status === 'feedback' && !feedbackTimer && !suspendedFeedback && !document.hidden && !dialogOpen()) {
    const expectedGeneration = generation;
    const expectedRound = state.index;
    feedbackTimer = setTimeout(() => {
      feedbackTimer = 0;
      const current = engine.snapshot();
      if (generation === expectedGeneration && current.index === expectedRound && current.status === 'feedback' && !suspendedFeedback && !document.hidden && !dialogOpen()) render(engine.nextRound());
    }, state.feedback === 'correct' ? 900 : 1800);
  }
}

function render(state) {
  if (battle.active) return;
  if (state.invalidAttempt !== lastInvalidAttempt) {
    lastInvalidAttempt = state.invalidAttempt;
    invalidVisible = true;
    clearTimeout(invalidTimer);
    const expectedGeneration = generation;
    invalidTimer = setTimeout(() => {
      invalidTimer = 0;
      if (expectedGeneration !== generation) return;
      invalidVisible = false;
      render(engine.tick());
    }, INVALID_FEEDBACK_MS);
  }
  showScreen(state.status);
  if (state.status === 'playing' || state.status === 'feedback') {
    renderTimer({ timer: ui.timer, seconds: ui.seconds, fill: ui['timer-fill'] }, state.remainingMs);
  }
  // Countdown frames only update the clock. Keep focus and tile DOM stable.
  const key = JSON.stringify([state.status, state.index, state.entry, state.selectedIds, state.shuffleUsed, state.tiles, state.results.length, state.feedback, state.invalidEntry, state.invalidAttempt, invalidVisible, suspendedFeedback]);
  if (key !== renderedKey) {
    renderedKey = key;
    if (state.status === 'playing' || state.status === 'feedback') renderRound(state);
    if (state.status === 'finished') renderResults(state);
  }
  schedule(state);
}

function suspend() {
  if (!engine || battle.active) return;
  cancelAnimationFrame(animationFrame);
  clearTimeout(feedbackTimer);
  animationFrame = feedbackTimer = 0;
  const state = engine.pause();
  if (state.status === 'feedback') suspendedFeedback = true;
  render(state);
}

function resume() {
  suspendedFeedback = false;
  act('resume');
}

ui.start.addEventListener('click', beginGame);
ui['play-again'].addEventListener('click', beginGame);
ui.restart.addEventListener('click', beginGame);
ui.pause.addEventListener('click', suspend);
ui.resume.addEventListener('click', resume);
ui.shuffle.addEventListener('click', () => act('shuffle'));
ui.clear.addEventListener('click', () => act('clear'));
ui.tiles.addEventListener('click', event => {
  const tile = event.target.closest('button[data-tile]');
  if (tile) act('selectTile', Number(tile.dataset.tile));
});

document.addEventListener('keydown', event => {
  if (!engine || battle.active || dialogOpen()) return;
  if (engine.snapshot().status !== 'playing') return;
  const action = readGameKey(event, ui.tiles);
  if (action) act(action.method, action.value);
});

function openDialog(dialog) {
  suspend();
  dialog.showModal();
}
$('help-open').addEventListener('click', () => openDialog(ui['help-dialog']));
$('about-open').addEventListener('click', () => openDialog(ui['about-dialog']));
for (const dialog of [ui['help-dialog'], ui['about-dialog']]) {
  dialog.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', event => { if (event.target === dialog) {
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  } });
}
document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
window.addEventListener('pagehide', suspend);

async function initialize() {
  ui.start.disabled = true;
  ui.start.textContent = 'Loading words…';
  ui['load-status'].textContent = 'Getting your word bank ready.';
  ui['retry-load'].hidden = true;
  try {
    const bank = await loadWordBank();
    engine = new GameEngine(bank);
    battle.setBank(bank);
    ui.start.disabled = false;
    ui.start.replaceChildren(document.createTextNode('Play solo'), node('span', '', '→'));
    ui.start.lastElementChild.setAttribute('aria-hidden', 'true');
    ui['load-status'].textContent = 'No daily limit. Just one more round.';
    ui['dictionary-info'].textContent = `${bank.targetCount.toLocaleString()} puzzle words from SCOWL 2020.12.07, through level 35. ${bank.count.toLocaleString()} accepted answers through level 70. English, American, British, and Canadian spellings.`;
  } catch (error) {
    ui.start.textContent = 'Words unavailable';
    ui['load-status'].textContent = 'Couldn’t load the words. Check your connection and try again.';
    ui['retry-load'].hidden = false;
    console.error('Unable to initialize the word bank:', error);
  }
}
ui['retry-load'].addEventListener('click', initialize);
initialize();
