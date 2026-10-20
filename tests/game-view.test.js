import test from 'node:test';
import assert from 'node:assert/strict';
import { readGameKey } from '../dist/js/game-view.js';

function node({ tag = 'div', parent = null, tile = false, href = false, role,
  contentEditable } = {}) {
  return {
    parent,
    blurred: false,
    get isContentEditable() {
      return contentEditable ?? parent?.isContentEditable ?? false;
    },
    matches(selector) {
      return selector.split(',').some(part => {
        switch (part.trim()) {
          case 'button[data-tile]': return tag === 'button' && tile;
          case 'a[href]': return tag === 'a' && href;
          case '[role="button"]': return role === 'button';
          case '[role="link"]': return role === 'link';
          default: return tag === part.trim();
        }
      });
    },
    closest(selector) {
      return this.matches(selector) ? this : parent?.closest(selector) ?? null;
    },
    contains(other) {
      for (let current = other; current; current = current.parent) {
        if (current === this) return true;
      }
      return false;
    },
    blur() { this.blurred = true; },
  };
}

function keyEvent(key, target, options = {}) {
  return {
    key, target, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
    repeat: false, isComposing: false, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    ...options,
  };
}

function setup(t) {
  const body = node({ tag: 'body' });
  const tiles = node({ parent: body });
  const tile = node({ tag: 'button', parent: tiles, tile: true });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const document = { activeElement: body };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
  return { body, tiles, tile, document };
}

test('keyboard maps Space to shuffle and Ctrl+Backspace to clear alongside existing input', t => {
  const { body, tiles } = setup(t);
  for (const [key, options, method] of [
    [' ', {}, 'shuffle'],
    ['Backspace', { ctrlKey: true }, 'clear'],
    ['Backspace', {}, 'backspace'],
    ['Backspace', { shiftKey: true }, 'backspace'],
    ['a', {}, 'typeLetter'],
    ['A', { shiftKey: true }, 'typeLetter'],
  ]) {
    const event = keyEvent(key, body, options);
    assert.deepEqual(readGameKey(event, tiles), { method, value: key });
    assert.equal(event.defaultPrevented, true);
  }
});

test('keyboard actions blur a focused letter tile but preserve other focus and Tab navigation', t => {
  const { body, tiles, tile, document } = setup(t);
  document.activeElement = tile;
  const marker = node({ tag: 'span', parent: tile });
  for (const [key, options] of [
    [' ', {}], ['Backspace', { ctrlKey: true }], ['Backspace', {}], ['a', {}],
  ]) {
    tile.blurred = false;
    assert.ok(readGameKey(keyEvent(key, marker, options), tiles));
    assert.equal(tile.blurred, true);
  }
  tile.blurred = false;
  const tab = keyEvent('Tab', tile);
  assert.equal(readGameKey(tab, tiles), null);
  assert.equal(tab.defaultPrevented, false);
  assert.equal(tile.blurred, false);

  const button = node({ tag: 'button', parent: body });
  document.activeElement = button;
  assert.equal(readGameKey(keyEvent('a', button), tiles).method, 'typeLetter');
  assert.equal(button.blurred, false);
  const otherTile = node({ tag: 'button', parent: body, tile: true });
  document.activeElement = otherTile;
  assert.equal(readGameKey(keyEvent('a', otherTile), tiles).method, 'typeLetter');
  assert.equal(otherTile.blurred, false);
});

test('Space keeps native behavior on other buttons, links and their descendants', t => {
  const { body, tiles, document } = setup(t);
  for (const properties of [
    { tag: 'button' }, { tag: 'a', href: true }, { tag: 'summary' },
    { role: 'button' }, { role: 'link' }, { tag: 'button', tile: true },
  ]) {
    const control = node({ parent: body, ...properties });
    const child = node({ parent: control });
    document.activeElement = control;
    for (const target of [control, child]) {
      for (const repeat of [false, true]) {
        const event = keyEvent(' ', target, { repeat });
        assert.equal(readGameKey(event, tiles), null);
        assert.equal(event.defaultPrevented, false);
        assert.equal(control.blurred, false);
      }
    }
  }
});

test('editable controls and inherited editable content retain native keyboard behavior', t => {
  const { body, tiles, document } = setup(t);
  const targets = ['input', 'textarea', 'select'].flatMap(tag => {
    const control = node({ tag, parent: body });
    return [control, node({ parent: control })];
  });
  for (const parent of [body, node({ contentEditable: true, parent: body })]) {
    const editable = node({ contentEditable: true, parent });
    targets.push(editable, node({ parent: editable }), node({ parent: node({ parent: editable }) }));
  }
  for (const target of targets) {
    document.activeElement = target;
    for (const [key, options] of [
      [' ', {}], ['Backspace', { ctrlKey: true }], ['Backspace', {}], ['a', {}],
    ]) {
      const event = keyEvent(key, target, options);
      assert.equal(readGameKey(event, tiles), null);
      assert.equal(event.defaultPrevented, false);
    }
  }
});

test('keyboard ignores composition, handled events and unsupported modifier combinations', t => {
  const { body, tiles, tile, document } = setup(t);
  document.activeElement = tile;
  const cases = [
    [' ', { shiftKey: true }],
    [' ', { ctrlKey: true }],
    ['Backspace', { ctrlKey: true, shiftKey: true }],
    ['a', { ctrlKey: true }],
    ['Tab', {}],
    ['Enter', {}],
    ['Escape', {}],
    ['Shift', {}],
  ];
  for (const key of [' ', 'Backspace', 'a']) {
    for (const modifier of ['metaKey', 'altKey', 'isComposing', 'defaultPrevented']) {
      cases.push([key, { [modifier]: true }]);
    }
  }
  for (const [key, options] of cases) {
    const event = keyEvent(key, body, options);
    assert.equal(readGameKey(event, tiles), null);
    assert.equal(event.defaultPrevented, options.defaultPrevented ?? false);
    assert.equal(tile.blurred, false);
  }
});

test('held shortcuts suppress native repeats without performing another action', t => {
  const { body, tiles, tile, document } = setup(t);
  document.activeElement = tile;
  for (const [key, options] of [[' ', {}], ['Backspace', { ctrlKey: true }]]) {
    const event = keyEvent(key, body, { repeat: true, ...options });
    assert.equal(readGameKey(event, tiles), null);
    assert.equal(event.defaultPrevented, true);
    assert.equal(tile.blurred, false);
  }
  for (const key of ['a', 'Backspace']) {
    const event = keyEvent(key, body, { repeat: true });
    assert.equal(readGameKey(event, tiles), null);
    assert.equal(event.defaultPrevented, false);
    assert.equal(tile.blurred, false);
  }
});
