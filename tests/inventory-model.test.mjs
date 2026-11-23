import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeInventory, fitsEquipment, itemEquipped } from '../js/inventory-model.js';

const reference = {
  sword: { weapon_category: 'Martial' },
  'chain mail': { armor_category: 'Heavy' },
  shield: { armor_category: 'Shield' }
};
const world = () => ({
  a: { kind: 'pc', data: { inventory: { weapon: { name: 'Sword', qty: 1 }, gear: { name: 'Shield', qty: 1 } } } },
  b: { kind: 'pc', data: { inventory: [{ name: 'Torch', qty: 2 }] } }
});

test('equipment filters bag items and preserves the legacy shield and weapon schema', () => {
  assert.equal(fitsEquipment('helmet', { name: 'Helm of Brilliance' }, reference), true);
  assert.equal(fitsEquipment('armor', { name: 'Shield' }, reference), false);
  assert.equal(fitsEquipment('main_hand', { name: 'Torch' }, reference), false);
  const entities = world();
  changeInventory(entities, 'a', { type: 'equip', slot: 'shield', key: 'gear' }, reference);
  assert.equal(entities.a.data.equipped.shield, true);
  assert.equal(entities.a.data.equipped.shield_name, 'Shield');
  assert.throws(() => changeInventory(entities, 'a', { type: 'equip', slot: 'armor', key: 'weapon' }, reference), /appropriate/);
  changeInventory(entities, 'a', { type: 'equip', slot: 'main_hand', key: 'weapon' }, reference);
  assert.equal(entities.a.data.equipped.main_hand, 'Sword');
  entities.a.data.equipped.weapon = 'Sword';
  changeInventory(entities, 'a', { type: 'equip', slot: 'main_hand', key: '' }, reference);
  assert.equal(entities.a.data.equipped.main_hand, null);
  assert.equal(entities.a.data.equipped.weapon, undefined);
});

test('equipped items cannot be removed or transferred until unequipped', () => {
  const entities = world();
  entities.a.data.equipped = { weapon: 'Sword', shield: true };
  assert.equal(itemEquipped(entities.a.data, entities.a.data.inventory.gear, reference), true);
  for (const type of ['remove', 'transfer']) {
    assert.throws(() => changeInventory(entities, 'a', { type, key: 'weapon', to: 'b', targetKey: 'new-key' }, reference), /Unequip/);
    assert.throws(() => changeInventory(entities, 'a', { type, key: 'gear', to: 'b', targetKey: 'new-key' }, reference), /Unequip/);
  }
  changeInventory(entities, 'a', { type: 'equip', slot: 'main_hand', key: '' }, reference);
  changeInventory(entities, 'a', { type: 'transfer', key: 'weapon', to: 'b', targetKey: 'new-key' }, reference);
  assert.equal(entities.a.data.inventory.weapon, undefined);
  assert.equal(entities.b.data.inventory['new-key'].name, 'Sword');
  assert.equal(entities.b.data.inventory[0].name, 'Torch');
});

test('bag add increases quantity, transfer preserves metadata and rejects invalid recipients', () => {
  const entities = world();
  entities.a.data.inventory.weapon.notes = 'Engraved';
  changeInventory(entities, 'a', { type: 'add', key: 'weapon' });
  assert.equal(entities.a.data.inventory.weapon.qty, 2);
  assert.throws(() => changeInventory(entities, 'a', { type: 'transfer', key: 'weapon', to: 'a' }), /another/);
  assert.throws(() => changeInventory(entities, 'a', { type: 'transfer', key: 'weapon', to: 'missing' }), /unavailable/);
  changeInventory(entities, 'a', { type: 'transfer', key: 'weapon', to: 'b', targetKey: 'new-key' });
  assert.deepEqual(entities.b.data.inventory['new-key'], { name: 'Sword', qty: 2, notes: 'Engraved' });
  assert.throws(() => changeInventory(entities, 'a', { type: 'transfer', key: 'weapon', to: 'b', targetKey: 'retry-key' }), /no longer/);
  changeInventory(entities, 'b', { type: 'remove', key: 'new-key' });
  assert.equal(entities.b.data.inventory['new-key'], undefined);
});
