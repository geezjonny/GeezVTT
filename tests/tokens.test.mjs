import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenProperties, npcCatalog, importedTokens } from '../js/token-model.js';

test('token properties accept zero HP and half-square sizes and reject invalid edits', () => {
  assert.deepEqual(tokenProperties(' Goblin ', .5, 0), { name: 'Goblin', size: .5, hp: 0 });
  for (const props of [[' ', 1, 1], ['x', .75, 1], ['x', Infinity, 1], ['x', 21, 1], ['x', 1, -1], ['x', 1, 1.5]]) {
    assert.throws(() => tokenProperties(...props));
  }
});

test('NPC catalog combines current and legacy records without duplicating mirrors', () => {
  const entities = {
    goblin: { kind: 'npc', name: 'Goblin', source: { id: 'characters/npcs/old' }, data: { combat: { hp_current: 0, hp_max: 7 }, size: 'Small' } },
    pc: { kind: 'pc', name: 'Player', data: {} },
    removed: { kind: 'npc', source: { mirrors: ['characters/npcs/removed'] }, data: { _sheetsDeleted: true } }
  };
  const result = npcCatalog(entities, { old: { name: 'Duplicate' }, removed: { name: 'Deleted' }, ogre: { name: 'Ogre', size: 'Large', combat: { hp_max: 59 } }, invalid: null });
  assert.deepEqual(result, [
    { npcId: 'v2:goblin', name: 'Goblin', size: 1, hp: 0 },
    { npcId: 'legacy:ogre', name: 'Ogre', size: 2, hp: 59 }
  ]);
});

test('saved tokens retain editable data while invalid imported tokens are ignored', () => {
  const token = { name: 'Guard', size: 2, hp: 11, x: 3, y: 4, npcId: 'legacy:guard' };
  const result = importedTokens([token, { ...token, x: -1 }, { ...token, hp: 'bad' }, null], 10, 10);
  assert.equal(result.length, 1);
  const { id, ...saved } = result[0];
  assert.equal(typeof id, 'string');
  assert.deepEqual(saved, token);
  assert.deepEqual(importedTokens({}, 10, 10), []);
});
