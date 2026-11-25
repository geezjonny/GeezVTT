import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
const events = [];
globalThis.addEventListener = (type, listener) => events.push({ type, listener });
globalThis.dispatchEvent = event => { events.filter(e => e.type === event.type).forEach(e => e.listener(event)); return true; };
const { GRAPHICS, GRAPHICS_LEVELS, graphicsLevel, graphicsSettings, nextGraphicsLevel, normalizeGraphicsLevel, onGraphicsChange, setGraphicsLevel } = await import('../js/graphics-settings.js');

test('levels step low, medium, high and wrap; unknown values fall back', () => {
  assert.deepEqual(GRAPHICS_LEVELS, ['low', 'medium', 'high']);
  assert.equal(nextGraphicsLevel('low'), 'medium');
  assert.equal(nextGraphicsLevel('high'), 'low');
  assert.equal(nextGraphicsLevel('bogus'), 'low');
  assert.equal(normalizeGraphicsLevel('ultra'), 'high');
  assert.equal(normalizeGraphicsLevel('ultra', 'low'), 'low');
});

test('each step costs strictly less than the one above it', () => {
  for (const key of ['pixelRatio', 'sunShadowSize', 'pointShadows', 'weatherParticles']) {
    assert.ok(GRAPHICS.low[key] <= GRAPHICS.medium[key] && GRAPHICS.medium[key] <= GRAPHICS.high[key], key);
  }
  assert.equal(GRAPHICS.low.shadows, false);
  assert.equal(GRAPHICS.low.pointShadows, 0);
});

test('choice persists, notifies listeners and survives blocked storage', () => {
  assert.equal(graphicsLevel(), 'high');
  const seen = [];
  onGraphicsChange((settings, level) => seen.push([level, settings.weatherParticles]));
  assert.equal(setGraphicsLevel('low'), 'low');
  assert.equal(store.get('geezvtt.graphics'), 'low');
  assert.equal(graphicsSettings(), GRAPHICS.low);
  assert.equal(setGraphicsLevel('nonsense'), 'low');
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(setGraphicsLevel('medium'), 'medium');
  assert.deepEqual(seen[0], ['low', 50]);
});

test('a saved choice is loaded on startup, and a bad saved value falls back to the default', async () => {
  globalThis.localStorage = { getItem: () => 'low', setItem() {} };
  const saved = await import('../js/graphics-settings.js?saved');
  assert.equal(saved.graphicsLevel(), 'low');
  assert.equal(saved.graphicsSettings(), saved.GRAPHICS.low);

  globalThis.localStorage = { getItem: () => 'ultra', setItem() {} };
  globalThis.matchMedia = query => ({ matches: query === '(pointer: coarse)' });
  const touch = await import('../js/graphics-settings.js?touch');
  assert.equal(touch.graphicsLevel(), 'medium', 'touch devices start on medium');
  delete globalThis.matchMedia;
});
