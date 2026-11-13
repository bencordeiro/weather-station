import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/theme.js', import.meta.url), 'utf8');

function themePage({ preference, systemDark = false, storageBlocked = false } = {}) {
  const saved = new Map(preference === undefined ? [] : [['shelburne-theme', preference]]);
  class Button extends EventTarget {
    constructor(id) { super(); this.id = id; this.attributes = new Map(); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    click() { this.dispatchEvent(new Event('click')); }
  }
  const buttons = [new Button('theme-light'), new Button('theme-dark')];
  const document = new EventTarget();
  document.readyState = 'loading';
  document.documentElement = { dataset: {} };
  document.querySelectorAll = () => document.readyState === 'loading' ? [] : buttons;
  document.getElementById = id => buttons.find(button => button.id === id);
  const meta = new Map();
  document.querySelector = () => ({ setAttribute: (key, value) => meta.set(key, value) });
  const system = new EventTarget();
  system.matches = systemDark;
  const window = new EventTarget();
  window.matchMedia = () => system;
  let changes = 0;
  window.addEventListener('weather-theme-change', () => changes++);
  const localStorage = {
    getItem(key) { if (storageBlocked) throw new Error('Storage blocked'); return saved.get(key) ?? null; },
    setItem(key, value) { if (storageBlocked) throw new Error('Storage blocked'); saved.set(key, value); },
  };
  runInNewContext(source, { window, document, localStorage, Event });
  const initialTheme = document.documentElement.dataset.theme;
  document.readyState = 'interactive';
  document.dispatchEvent(new Event('DOMContentLoaded'));
  return {
    root: document.documentElement, initialTheme, meta, saved,
    press: mode => buttons.find(button => button.id === `theme-${mode}`).click(),
    pressed: mode => buttons.find(button => button.id === `theme-${mode}`).attributes.get('aria-pressed'),
    changes: () => changes,
    changeSystem(value) {
      system.matches = value;
      const event = new Event('change'); event.matches = value; system.dispatchEvent(event);
    },
  };
}

test('first visit uses system dark preference before the page finishes loading', () => {
  const page = themePage({ systemDark: true });
  assert.equal(page.initialTheme, 'dark');
  assert.equal(page.root.dataset.theme, 'dark');
  assert.equal(page.pressed('dark'), 'true');
  assert.equal(page.pressed('light'), 'false');
});

test('explicit light preference overrides a dark system preference', () => {
  const page = themePage({ preference: 'light', systemDark: true });
  assert.equal(page.initialTheme, 'light');
  assert.equal(page.pressed('light'), 'true');
});

test('theme buttons update appearance, accessible selection, browser colour, and chart notification', () => {
  const page = themePage();
  const before = page.changes();
  page.press('dark');
  assert.equal(page.root.dataset.theme, 'dark');
  assert.equal(page.pressed('dark'), 'true');
  assert.equal(page.pressed('light'), 'false');
  assert.equal(page.meta.get('content'), '#242424');
  assert.equal(page.saved.get('shelburne-theme'), 'dark');
  assert.equal(page.changes(), before + 1);
  page.press('light');
  assert.equal(page.root.dataset.theme, 'light');
  assert.equal(page.pressed('light'), 'true');
});

test('theme selection survives a new page load', () => {
  const first = themePage();
  first.press('dark');
  const next = themePage({ preference: first.saved.get('shelburne-theme') });
  assert.equal(next.initialTheme, 'dark');
  assert.equal(next.pressed('dark'), 'true');
});

test('theme selection works when browser storage is disabled', () => {
  const page = themePage({ storageBlocked: true });
  assert.equal(page.root.dataset.theme, 'light');
  assert.doesNotThrow(() => page.press('dark'));
  assert.equal(page.root.dataset.theme, 'dark');
  assert.equal(page.pressed('dark'), 'true');
});

test('system theme changes apply until the visitor makes an explicit choice', () => {
  const page = themePage();
  page.changeSystem(true);
  assert.equal(page.root.dataset.theme, 'dark');
  page.press('light');
  page.changeSystem(true);
  assert.equal(page.root.dataset.theme, 'light');
});

test('invalid stored values fall back to the system theme', () => {
  assert.equal(themePage({ preference: 'unexpected', systemDark: true }).initialTheme, 'dark');
});
