import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = new EventTarget();
window.GEEZ_FIREBASE_CONFIG = { databaseURL: 'https://example.test' };
const sources = [];
globalThis.EventSource = class extends EventTarget {
  constructor(url) { super(); this.url = url; sources.push(this); }
  close() { this.closed = true; }
};
const { watchTabletop } = await import('../js/tabletop-stream.js');
const emit = (type, message) => sources.at(-1).dispatchEvent(new MessageEvent(type, { data: JSON.stringify(message) }));

test('presence, scene, live state and actions share a single connection and receive only their own updates', () => {
  const calls = { presence: [], scene: [], live: [], actions: [] };
  const stops = Object.keys(calls).map(path => watchTabletop(path, value => calls[path].push(structuredClone(value))));
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, 'https://example.test/v2/worlds/gaia/vtt.json');
  emit('put', { path: '/', data: { presence: { player: { character: 'Seris' } }, scene: { id: 'map' }, live: { sceneId: 'map' } } });
  assert.equal(calls.scene[0].id, 'map');
  assert.equal(calls.actions[0], null);
  emit('patch', { path: '/presence/player', data: { character: 'Liora' } });
  assert.equal(calls.presence.at(-1).player.character, 'Liora');
  assert.equal(calls.scene.length, 1);
  assert.equal(calls.live.length, 1);
  emit('patch', { path: '/', data: { 'actions/roll': { type: 'dice' }, 'live/sceneId': 'next' } });
  assert.equal(calls.actions.at(-1).roll.type, 'dice');
  assert.equal(calls.live.at(-1).sceneId, 'next');
  emit('put', { path: '/presence/player', data: null });
  assert.deepEqual(calls.presence.at(-1), {});
  for (const stop of stops) stop();
  assert.equal(sources[0].closed, true);
});
test('new subscribers receive cached data and disconnect errors reach every subscriber', async () => {
  const errors = [], values = [];
  const stop = watchTabletop('scene', () => {}, message => errors.push(message));
  emit('put', { path: '/', data: { live: { sceneId: 'cached' } } });
  const stopLive = watchTabletop('live', value => values.push(value), message => errors.push(message));
  await Promise.resolve();
  assert.equal(values[0].sceneId, 'cached');
  sources.at(-1).dispatchEvent(new Event('error'));
  assert.equal(errors.length, 2);
  stop(); stopLive();
});
