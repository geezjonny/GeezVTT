import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initiativeState, initiativeOrder } from '../js/initiative-model.js';

test('initiative sorts scores, preserves ties and rejects missing, duplicate or invalid entries', () => {
  const tokens = ['a', 'b', 'c'].map(id => ({ id }));
  const state = initiativeState({ entries: [
    { id: 'a', score: 5 }, { id: 'b', score: 20 }, { id: 'c', score: 20 },
    { id: 'b', score: 30 }, { id: 'missing', score: 10 }, { id: 'a', score: Infinity }
  ], currentId: 'c' }, tokens);
  assert.deepEqual(state.entries.map(entry => entry.id), ['b', 'c', 'a']);
  assert.deepEqual(initiativeOrder(state).map(entry => entry.id), ['c', 'a', 'b']);
  state.currentId = 'a';
  assert.deepEqual(initiativeOrder(state).map(entry => entry.id), ['a', 'b', 'c']);
  assert.deepEqual(initiativeState(state, []), { entries: [], currentId: null });
  assert.deepEqual(initiativeOrder(initiativeState(null, tokens)), []);
});
