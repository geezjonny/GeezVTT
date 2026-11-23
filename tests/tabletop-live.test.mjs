import { test } from 'node:test';
import assert from 'node:assert/strict';
import { livePatch } from '../js/tabletop-live-model.js';
import { applyFirebaseEvent } from '../js/firebase-events.js';

test('movement sends tokens without resending walls, floors and props', () => {
  const before = { sceneId: 'scene', initiative: false, map: { tokens: [{ id: 'pc', x: 1, y: 1 }], walls: [[{ x: 0, y: 0 }, { x: 4, y: 0 }]], props: [], floors: [] } };
  const after = structuredClone(before);
  after.map.tokens[0].x = 2;
  const patch = livePatch(before, after);
  assert.deepEqual(Object.keys(patch), ['map/tokens']);
  assert.deepEqual(applyFirebaseEvent(before, 'patch', { path: '/', data: patch }), after);
});
test('live patches preserve clears, removed fields and initiative changes', () => {
  const before = { initiative: false, map: { tokens: [{ id: 'pc' }], props: ['old'] } };
  const after = { initiative: true, map: { tokens: [] } };
  assert.deepEqual(livePatch(before, after), { initiative: true, 'map/tokens': [], 'map/props': null });
  assert.deepEqual(livePatch(after, after), {});
});
