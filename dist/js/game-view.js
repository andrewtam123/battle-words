/** Shared puzzle controls. Each mode owns its lifecycle, clock and feedback outcome. */
import { ROUND_MS } from './game-core.js';

export const INVALID_FEEDBACK_MS = 650;
export const INVALID_FEEDBACK_TEXT = 'Not in the word bank. Try again.';

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderAnswer(container, { word, length, appearance, label = 'Your answer' }) {
  container.className = `answer-slots ${appearance}`;
  container.setAttribute('aria-label', word ? `${label}: ${word.toUpperCase()}` : `Your answer, ${length} letters`);
  container.replaceChildren(...Array.from({ length }, (_, index) =>
    element('span', `answer-slot${word[index] ? ' filled' : ''}`, word[index]?.toUpperCase() || '')));
}

export function renderTiles(container, tiles, selectedIds, enabled) {
  const focused = document.activeElement;
  const activeTile = container.contains(focused) ? focused?.dataset.tile : undefined;
  container.style.setProperty('--tile-columns', Math.ceil(tiles.length / 2));
  container.replaceChildren(...tiles.map(tile => {
    const position = selectedIds.indexOf(tile.id);
    const button = element('button', `letter-tile${position >= 0 ? ' selected' : ''}`, tile.letter.toUpperCase());
    button.type = 'button';
    button.dataset.tile = tile.id;
    button.setAttribute('aria-label', `Letter ${tile.letter.toUpperCase()}, tile ${tile.id + 1}${position >= 0 ? `, selected at position ${position + 1}` : ''}`);
    button.setAttribute('aria-pressed', String(position >= 0));
    button.disabled = !enabled;
    if (position >= 0) {
      const marker = element('span', 'tile-position', position + 1);
      marker.setAttribute('aria-hidden', 'true');
      button.append(marker);
    }
    return button;
  }));
  if (activeTile !== undefined && enabled) {
    container.querySelector(`[data-tile="${activeTile}"]`)?.focus({ preventScroll: true });
  }
}

export function renderTimer({ timer, seconds, fill }, remainingMs) {
  const remaining = Math.max(0, Math.min(ROUND_MS, remainingMs));
  const count = Math.ceil(remaining / 1000);
  if (seconds.textContent !== String(count)) {
    seconds.textContent = count;
  }
  const label = `${count} seconds remaining`;
  if (timer.getAttribute('aria-label') !== label) timer.setAttribute('aria-label', label);
  const urgent = remaining <= 10000;
  timer.classList.toggle('urgent', urgent);
  fill.classList.toggle('urgent', urgent);
  fill.style.transform = `scaleX(${remaining / ROUND_MS})`;
  return count;
}

/** Call only when the mode accepts input; preserve native controls outside the letter tiles. */
export function readGameKey(event, tiles) {
  const target = event.target;
  if (event.defaultPrevented || event.isComposing || event.metaKey || event.altKey ||
      target?.isContentEditable || target?.closest?.('input, textarea, select')) return null;

  let method;
  if (event.key === ' ' && !event.ctrlKey && !event.shiftKey) {
    const control = target?.closest?.('button, a[href], summary, [role="button"], [role="link"]');
    if (control && !(control.matches('button[data-tile]') && tiles.contains(control))) return null;
    method = 'shuffle';
  } else if (event.key === 'Backspace') {
    if (event.ctrlKey && event.shiftKey) return null;
    method = event.ctrlKey ? 'clear' : 'backspace';
  } else if (!event.ctrlKey && /^[a-z]$/i.test(event.key)) {
    method = 'typeLetter';
  } else {
    return null;
  }

  const shortcut = method === 'shuffle' || method === 'clear';
  if (event.repeat && !shortcut) return null;
  event.preventDefault();
  // Holding a shortcut must not repeat its action or start scrolling the page.
  if (event.repeat) return null;
  const focused = document.activeElement;
  if (focused?.matches('button[data-tile]') && tiles.contains(focused)) focused.blur();
  return { method, value: event.key };
}
