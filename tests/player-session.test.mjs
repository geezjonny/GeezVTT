import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlayer, ownsPC, activePresence, PRESENCE_TIMEOUT } from '../js/player-session-model.js';

const entities = {
  seris: { kind: 'pc', name: 'Seris', campaign: 'daddies', data: {} },
  other: { kind: 'pc', name: 'Seris', campaign: 'disney', data: {} },
  npc: { kind: 'npc', name: 'Lark', campaign: 'daddies', data: {} },
  deleted: { kind: 'pc', name: 'Ashara', campaign: 'daddies', data: { _sheetsDeleted: true } }
};
test('sign-in resolves a unique live PC within the chosen campaign', () => {
  const player = resolvePlayer(entities, 'daddies', 'Seris');
  assert.deepEqual(player, { campaign: 'daddies', character: 'Seris', pcId: 'seris' });
  assert.equal(resolvePlayer(entities, 'disney', 'Seris').pcId, 'other');
  assert.throws(() => resolvePlayer(entities, 'daddies', 'Ashara'), /not found/);
  assert.throws(() => resolvePlayer(entities, 'daddies', 'Lark'), /not found/);
  assert.throws(() => resolvePlayer(entities, 'unknown', 'Seris'), /Choose/);
  assert.throws(() => resolvePlayer({ ...entities, duplicate: entities.seris }, 'daddies', 'Seris'), /Multiple/);
});
test('ownership follows the Firebase ID, never a copied token name', () => {
  const player = resolvePlayer(entities, 'daddies', 'Seris');
  assert.equal(ownsPC(player, { npcId: 'v2:seris' }), true);
  assert.equal(ownsPC(player, { npcId: 'v2:other', name: 'Seris' }), false);
  assert.equal(ownsPC(player, { npcId: 'legacy:seris' }), false);
  assert.equal(ownsPC(null, { npcId: 'v2:seris' }), false);
  assert.equal(ownsPC(player, null), false);
});
test('presence expires and rejects invalid identities and timestamps', () => {
  const player = { ...resolvePlayer(entities, 'daddies', 'Seris'), lastSeen: 100000 };
  assert.equal(activePresence(player, 100100), true);
  assert.equal(activePresence(player, 100000 + PRESENCE_TIMEOUT), false);
  assert.equal(activePresence({ ...player, lastSeen: '100000' }, 100100), false);
  assert.equal(activePresence({ ...player, pcId: '../other' }, 100100), false);
});
