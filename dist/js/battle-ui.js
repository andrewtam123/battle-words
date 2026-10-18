import { BattleClient } from './battle-client.js';
import { BATTLE_API_URL } from './battle-config.js';
import { WORD_LENGTHS, entryWord, selectTileIds, tileForLetter, isValidAnswer } from './game-core.js';
import { roundFeedback } from './battle-feedback.js';
import {
  element, renderAnswer, renderTiles, renderTimer, readGameKey,
  INVALID_FEEDBACK_MS, INVALID_FEEDBACK_TEXT,
} from './game-view.js';

const $ = id => document.getElementById(`battle-${id}`);
const roomFromLink = value => {
  if (/^[a-f0-9]{32}$/.test(value)) return value;
  try {
    const id = new URL(value, location.href).hash.match(/^#room=([a-f0-9]{32})$/)?.[1];
    return id || null;
  } catch { return null; }
};

export function createBattleUI({ onEnter, onExit }) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const apiUrl = BATTLE_API_URL || (local ? 'http://127.0.0.1:8787' : '');
  let active = false;
  let bank = null;
  let state = null;
  let roomId = null;
  let joining = false;
  let busy = false;
  let joiningBlocked = false;
  let operation = 0;
  let selected = [];
  let pending = '';
  let invalid = '';
  let invalidTimer = 0;
  let frame = 0;
  let shuffleWaiting = false;
  let publicResult = null;
  let lastResultsKey = '';
  const client = new BattleClient({
    apiUrl,
    onState: receive,
    onStatus: () => { if (active) { renderConnection(); render(); } },
    onError: error => {
      if (!active) return;
      $('message').textContent = error.message || 'Couldn’t reach the room. Please try again.';
      $('retry').hidden = false;
      if (error.code === 'MATCH_FINISHED' && roomId) openRoom(roomId);
    },
    onAck: ack => {
      if (ack.accepted || !state || state.phase !== 'playing') return;
      if (ack.reason === 'invalid_answer') {
        const rejected = pending;
        pending = '';
        rejectEntry(rejected);
      }
      // A closed round's local valid entry remains filled until its result.
    },
  });
  $('name').value = client.name || '';

  function shareLink() {
    const url = new URL(location.href);
    url.hash = roomId ? `room=${roomId}` : '';
    return url.href;
  }

  function setHash(id) {
    const url = new URL(location.href);
    url.hash = id ? `room=${id}` : '';
    history.replaceState(null, '', url);
  }

  function panel(name) {
    for (const id of ['setup', 'lobby', 'countdown', 'game', 'results']) $(id).hidden = id !== name;
  }

  function enter() {
    if (active) return;
    active = true;
    onEnter();
    $('area').hidden = false;
    tick();
  }

  function clearEntry() {
    selected = [];
    pending = invalid = '';
    shuffleWaiting = false;
    clearTimeout(invalidTimer);
  }

  function setup() {
    operation += 1;
    client.disconnect();
    state = publicResult = roomId = null;
    lastResultsKey = '';
    joining = busy = false;
    joiningBlocked = false;
    clearEntry();
    setHash(null);
    enter();
    $('message').textContent = apiUrl ? '' : 'Online battles aren’t available here yet. Solo is ready to play.';
    $('retry').hidden = true;
    $('retry').textContent = 'Try again';
    $('copy').textContent = 'Copy link';
    $('copy-results').textContent = 'Copy results link';
    $('setup-title').textContent = 'Wordplay for two.';
    $('setup-note').textContent = 'Invite a friend. Find the words first.';
    render();
  }

  async function openRoom(id) {
    enter();
    const current = ++operation;
    client.disconnect();
    state = publicResult = null;
    lastResultsKey = '';
    roomId = id;
    joining = true;
    joiningBlocked = false;
    busy = true;
    clearEntry();
    setHash(id);
    $('message').textContent = '';
    $('retry').hidden = true;
    $('retry').textContent = 'Try again';
    $('setup-title').textContent = 'Join the wordplay.';
    $('setup-note').textContent = 'Opening your room…';
    render();
    try {
      if (!apiUrl) throw new Error('Online battles aren’t available here yet.');
      const info = await client.open(id);
      if (current !== operation || !active) return;
      if (info.phase === 'finished') {
        publicResult = info.results;
        panel('results');
        renderResults(publicResult);
      } else if (info.phase === 'expired') {
        joiningBlocked = true;
        $('setup-note').textContent = 'This waiting room has expired. Start a new battle from Home.';
        $('join').hidden = true;
      } else if (client.hasCredential(id)) {
        await client.connect(id);
        if (current !== operation) return;
      } else if (info.players.every(Boolean)) {
        joiningBlocked = true;
        $('setup-note').textContent = 'Both player seats are reserved. Reopen this link after the match to see the results.';
        $('join').hidden = true;
        $('retry').hidden = false;
        $('retry').textContent = 'Check for results';
      } else {
        $('setup-note').textContent = `${info.players[0]?.name || 'Your friend'} is waiting. Enter your name to join.`;
      }
    } catch (error) {
      if (current === operation) {
        $('message').textContent = error.message;
        $('retry').hidden = false;
      }
    } finally {
      if (current === operation) {
        busy = false;
        if (state) render();
        else if (!publicResult) renderSetup(false);
      }
    }
  }

  async function startOrJoin(event) {
    event.preventDefault();
    if (busy || !bank || !apiUrl) return;
    const current = ++operation;
    busy = true;
    $('message').textContent = '';
    render();
    try {
      const response = joining ? await client.join(roomId, $('name').value) : await client.create($('name').value);
      if (current !== operation || !active) return;
      roomId = response.id || response.state.id;
      setHash(roomId);
      receive(response.state);
      await client.connect(roomId);
    } catch (error) {
      if (current === operation) {
        $('message').textContent = error.message;
        $('retry').hidden = false;
      }
    } finally {
      if (current === operation) { busy = false; render(); }
    }
  }

  function receive(next) {
    if (!active || (roomId && next.id !== roomId)) return;
    if (!state || state.id !== next.id || state.index !== next.index) clearEntry();
    else if (state.shuffleUsed !== next.shuffleUsed) {
      selected = [];
      invalid = '';
      shuffleWaiting = false;
    }
    state = next;
    roomId = next.id;
    if (next.ownSubmission) pending = next.ownSubmission.answer;
    if (next.phase === 'finished') {
      publicResult = { ...next, winner: next.scores[0] === next.scores[1] ? null : next.scores[0] > next.scores[1] ? 0 : 1 };
    }
    $('message').textContent = '';
    $('retry').hidden = true;
    render();
  }

  function canInput() {
    return active && bank && state?.phase === 'playing' && client.status === 'connected' &&
      client.serverNow() < state.deadline && !pending && !shuffleWaiting && !document.querySelector('dialog[open]');
  }

  function rejectEntry(word) {
    invalid = word;
    selected = [];
    clearTimeout(invalidTimer);
    invalidTimer = setTimeout(() => { invalid = ''; if (active) render(); }, INVALID_FEEDBACK_MS);
    render();
  }

  function select(id) {
    if (!canInput()) return;
    invalid = '';
    selected = selectTileIds(state.tiles, selected, id);
    const word = entryWord(state.tiles, selected);
    if (selected.length === state.tiles.length) {
      if (!isValidAnswer(word, state.tiles, bank.acceptedWords)) { rejectEntry(word); return; }
      pending = word;
      client.submit(state.index, word);
    }
    render();
  }

  function renderConnection() {
    const labels = {
      connecting: 'Connecting…', reconnecting: 'Connection interrupted. Reconnecting—the match keeps going.',
      replaced: 'This player is active in another tab. Use “Continue here” to take control.',
      connected: 'Connected', disconnected: '',
    };
    $('connection').textContent = labels[client.status] || '';
    if (client.storageAvailable === false) $('connection').textContent += ' This browser cannot save your seat; keep this tab open to stay in the match.';
    if (client.status === 'replaced') { $('retry').hidden = false; $('retry').textContent = 'Continue here'; }
  }

  function renderSetup(resetButtons = true) {
    panel('setup');
    $('form').hidden = joiningBlocked;
    if (resetButtons) $('join').hidden = !joining || joiningBlocked;
    $('create').hidden = joining;
    $('paste').hidden = joining;
    $('create').disabled = $('join').disabled = busy || !bank || !apiUrl;
    $('name').disabled = busy;
    if (!bank && !busy && apiUrl && !joining) $('setup-note').textContent = 'Load the word bank before starting. You can retry from Home.';
  }

  function renderPlayers(container, players, scores, seat) {
    container.replaceChildren(...players.map((player, index) => {
      const box = element('div', `battle-player${index === seat ? ' you' : ''}`);
      box.append(element('span', 'battle-player-name', `${player?.name || 'Waiting for a friend'}${index === seat ? ' (you)' : ''}`));
      if (scores) box.append(element('strong', '', scores[index]));
      if (container.id === 'battle-scores') box.append(element('span', 'battle-presence', state.connected?.[index] ? 'Connected' : 'Disconnected'));
      return box;
    }));
  }

  function render() {
    if (!active) return;
    renderConnection();
    if (publicResult) { panel('results'); renderResults(publicResult); return; }
    if (!state) { renderSetup(); return; }
    if (state.phase === 'expired') {
      panel('setup');
      $('setup-note').textContent = 'This waiting room has expired. Start a new battle from Home.';
      $('join').hidden = $('create').hidden = true;
      return;
    }
    if (state.phase === 'lobby') {
      panel('lobby');
      $('share-link').value = shareLink();
      $('players').replaceChildren(...state.players.map((player, index) => element('li', '', player
        ? `${player.name}${index === state.seat ? ' (you)' : ''} · ${player.ready ? 'Ready' : state.connected?.[index] ? 'Not ready yet' : 'Disconnected'}`
        : 'Waiting for a friend…')));
      $('ready').disabled = state.players[state.seat]?.ready || client.status !== 'connected';
      $('ready').textContent = state.players[state.seat]?.ready ? 'Ready—waiting for your friend' : 'I’m ready';
    } else if (state.phase === 'countdown') {
      panel('countdown');
    } else {
      panel('game');
      renderRound();
    }
  }

  function renderRound() {
    const length = WORD_LENGTHS[state.index];
    const result = state.results.find(value => value.round === state.index);
    const outcome = roundFeedback(result, state.seat, pending);
    const appearance = result ? outcome.appearance : invalid ? 'invalid' : '';
    const answer = pending || (result ? result.answers.find(Boolean) || result.target : invalid || entryWord(state.tiles, selected));
    renderPlayers($('scores'), state.players, state.scores, state.seat);
    $('round').textContent = `Word ${String(state.index + 1).padStart(2, '0')} / ${WORD_LENGTHS.length}`;
    $('length').textContent = `${length} letters`;
    $('progress').replaceChildren(...WORD_LENGTHS.map((_, index) => {
      const round = state.results[index];
      const kind = !round ? index === state.index ? 'current' : '' : round.outcome === 'tie' ? 'tied' : round.winner === state.seat ? 'solved' : 'missed';
      const cell = element('li', `progress-cell ${kind}`, round ? round.outcome === 'tie' ? '=' : round.winner === state.seat ? '✓' : '×' : String(index + 1).padStart(2, '0'));
      cell.setAttribute('aria-label', `Round ${index + 1}: ${round ? round.outcome === 'tie' ? 'tie' : round.winner === state.seat ? 'won' : round.outcome === 'timeout' ? 'timeout' : 'lost' : index === state.index ? 'current' : 'upcoming'}`);
      if (!round && index === state.index) cell.setAttribute('aria-current', 'step');
      return cell;
    }));
    renderAnswer($('answer'), { word: answer, length, appearance, label: 'Answer' });
    $('feedback').className = `feedback ${appearance}`;
    $('feedback').textContent = result ? outcome.text : invalid ? INVALID_FEEDBACK_TEXT : '';
    $('reveal').textContent = result ? `Answer: ${[...new Set(result.answers.filter(Boolean).length ? result.answers.filter(Boolean) : [result.target])].join(' / ').toUpperCase()}` : '';
    renderTiles($('tiles'), state.tiles, selected, canInput());
    $('shuffle').disabled = !canInput() || state.shuffleUsed;
    $('shuffle').textContent = state.shuffleUsed ? 'Shuffle used' : 'Shuffle · 1';
    $('clear').disabled = !canInput() || (!selected.length && !invalid);
  }

  function renderResults(result) {
    const key = JSON.stringify(result.results);
    if (key === lastResultsKey) return;
    lastResultsKey = key;
    $('results-title').textContent = result.winner === null ? 'An even match.' : `${result.players[result.winner].name} wins!`;
    renderPlayers($('final-scores'), result.players, result.scores, state?.seat);
    $('review').replaceChildren(...result.results.map(round => {
      const row = element('li', 'battle-review-row');
      const words = [...new Set([round.target, ...round.answers.filter(Boolean)])].join(' / ').toUpperCase();
      row.append(element('span', 'review-number', String(round.round + 1).padStart(2, '0')),
        element('span', 'battle-review-word', words),
        element('span', 'battle-review-outcome', round.outcome === 'tie' ? 'Tie' : round.winner === null ? 'Time’s up' : `${result.players[round.winner].name} won`));
      return row;
    }));
  }

  function tick() {
    if (!active) return;
    if (state?.phase === 'countdown') $('count').textContent = Math.max(0, Math.ceil((state.startAt - client.serverNow()) / 1000));
    if (state?.phase === 'playing' || state?.phase === 'reveal') {
      const remaining = state.phase === 'playing' ? Math.max(0, state.deadline - client.serverNow()) : 0;
      const previous = $('seconds').textContent;
      const seconds = renderTimer({ timer: $('timer'), seconds: $('seconds'), fill: $('fill') }, remaining);
      if (seconds === 0 && previous !== '0') renderRound();
    }
    frame = requestAnimationFrame(tick);
  }

  async function copyLink(button) {
    try { await navigator.clipboard.writeText(shareLink()); button.textContent = 'Copied!'; }
    catch { $('message').textContent = `Copy this link: ${shareLink()}`; }
  }

  function leave() {
    operation += 1;
    active = false;
    client.disconnect();
    cancelAnimationFrame(frame);
    clearEntry();
    $('area').hidden = true;
    setHash(null);
    onExit();
  }

  $('form').addEventListener('submit', startOrJoin);
  $('open').addEventListener('click', setup);
  $('home').addEventListener('click', leave);
  $('new').addEventListener('click', setup);
  $('ready').addEventListener('click', () => client.ready());
  $('copy').addEventListener('click', event => copyLink(event.currentTarget));
  $('copy-results').addEventListener('click', event => copyLink(event.currentTarget));
  $('retry').addEventListener('click', () => roomId ? openRoom(roomId) : setup());
  $('join-open').addEventListener('click', () => {
    const id = roomFromLink($('link').value.trim());
    if (id) openRoom(id); else $('message').textContent = 'Paste a Battle Words room link.';
  });
  $('tiles').addEventListener('click', event => {
    const tile = event.target.closest('button[data-tile]');
    if (tile) select(Number(tile.dataset.tile));
  });
  $('clear').addEventListener('click', () => { if (canInput()) { selected = []; invalid = ''; render(); } });
  $('shuffle').addEventListener('click', () => {
    if (!canInput() || state.shuffleUsed) return;
    selected = [];
    invalid = '';
    shuffleWaiting = true;
    client.shuffle(state.index);
    render();
  });
  document.addEventListener('keydown', event => {
    if (!canInput()) return;
    const action = readGameKey(event, $('tiles'));
    if (!action) return;
    if (action.method === 'backspace') { selected.pop(); invalid = ''; render(); }
    else {
      const tile = tileForLetter(state.tiles, selected, action.value);
      if (tile) select(tile.id);
    }
  });
  for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', () => { if (active) render(); });
  window.addEventListener('hashchange', () => {
    const id = roomFromLink(location.href);
    if (id) openRoom(id); else if (active) leave();
  });
  window.addEventListener('pageshow', event => { if (event.persisted && active && roomId && !publicResult) openRoom(roomId); });
  window.addEventListener('pagehide', () => { if (active) client.disconnect(); });
  return {
    get active() { return active; },
    setBank(value) { bank = value; if (active) render(); },
    start() { const id = roomFromLink(location.href); if (id) openRoom(id); },
  };
}
