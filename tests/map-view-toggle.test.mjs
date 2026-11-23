import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = (await readFile(new URL('../js/map-view-toggle.js', import.meta.url), 'utf8'))
  .replaceAll('export function ', 'function ')
  .replace(/import\('\.\/map-view-3d\.js[^']*'\)/, 'Promise.resolve({ createMapView3D: () => renderer })');

function setup(renderer) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      dataset: {}, attributes: {}, listeners: {}, disabled: false, classList: { add() {} },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); },
      async click() { if (!this.disabled) for (const callback of this.listeners.click || []) await callback(); }
    });
    return elements.get(id);
  };
  element('#floor').tabletopMap = {};
  runInNewContext(source, { document: { querySelector: element }, renderer });
  return element;
}

test('the view button cycles 3D, first person, 2D, then 3D', async () => {
  let firstPerson, active;
  const element = setup({
    setMap() {}, setLayers() {},
    setFirstPerson(on) { firstPerson = on; }, setActive(on) { active = on; }
  });
  const button = element('#toggle-3d');
  for (const mode of ['3d', 'first', '2d', '3d']) {
    await button.click();
    assert.equal(button.dataset.view, mode);
    assert.equal(button.disabled, false);
    assert.equal(firstPerson, mode === 'first');
    assert.equal(active, mode !== '2d');
    assert.equal(element('#map-view').hidden, mode !== '2d');
  }
});

test('an older renderer recovers to 2D without crashing the error handler', async () => {
  let destroyed = false;
  const element = setup({ setMap() {}, setLayers() {}, setActive() {}, destroy() { destroyed = true; } });
  const button = element('#toggle-3d');
  await button.click();
  await button.click();
  assert.equal(button.dataset.view, '2d');
  assert.equal(button.disabled, false);
  assert.equal(element('#view-3d').hidden, true);
  assert.equal(destroyed, true);
  assert.match(element('#status').textContent, /Reload the page/);
});
