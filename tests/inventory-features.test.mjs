import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemWeight, carryingLoad } from '../js/inventory-weight.js';
import { validateItemEdit } from '../js/item-modifiers.js';
import { sheetHTML } from '../js/sheet-view.js';
import { importedItems, importedProps } from '../js/prop-model.js';
import { takeCompartmentItems } from '../js/compartment-model.js';
import { LOOT_TIERS, generateLoot } from '../js/loot-model.js';
import { BARK_ARM, changeEffects } from '../js/effects-model.js';
import { characterStats } from '../js/equipment-modifiers.js';

test('carried weight includes stacks and coins, resolves reference weights, and flags unknown weights', () => {
  const reference = { torch: { weight: 1 } };
  const pc = { inventory: { torch: { name: 'Torch', qty: 3 }, custom: { name: 'Custom', weight: .5, qty: 2 },
    unknown: { name: 'Unknown' }, empty: { name: 'Empty', qty: 0 } }, coin_purse: { gp: 50 } };
  assert.deepEqual(carryingLoad(pc, 12, reference), { weight: 5, capacity: 180, unknown: 1, overCapacity: false });
  assert.equal(itemWeight({ name: 'Torch', weight: 0 }, reference), 0);
  assert.equal(itemWeight({ name: 'Torch', weight: -1 }, reference), null);
  assert.equal(carryingLoad({ ...pc, size: 'Tiny' }, 12, reference).capacity, 90);
  assert.equal(carryingLoad({ ...pc, size: 'Large' }, 12, reference).capacity, 360);
  assert.equal(carryingLoad({ inventory: { heavy: { name: 'Heavy', qty: 2, weight: 100 } } }, 10).overCapacity, true);
  assert.match(sheetHTML({ stats: { str: 12 }, ...pc }, 'Inventory', reference), /5 \+ unknown \/ 180/);
  assert.match(sheetHTML(pc, 'Inventory', reference), /Weight unknown/);
});

test('weight edits accept zero and reference fallback, and reject invalid weights', () => {
  const item = { name: 'Custom', category: 'Consumable', qty: 1, desc: '' };
  assert.equal(validateItemEdit({ ...item, weight: 0 }, item).weight, 0);
  assert.equal(validateItemEdit({ ...item, weight: null }, item).weight, null);
  for (const weight of [-1, Infinity, '2', 1000000]) assert.throws(() => validateItemEdit({ ...item, weight }, item), /Weight/);
});

test('compartments round-trip stack metadata and take one before taking the rest', () => {
  const item = { id: 'potion', name: 'Potion', qty: 3, weight: .5, category: 'Consumable', desc: 'A custom potion.', modifiers: { ac: 2 } };
  const [chest] = importedProps([{ id: 'chest', kind: 'chest', x: 0, y: 0, size: 1, rotation: 0, open: true, contents: [item] }]);
  assert.deepEqual(chest.contents, [item]);
  const pc = { inventory: { old: { name: 'Old item', qty: 1 } } };
  takeCompartmentItems(pc, chest, 'potion', { potion: 'first' });
  assert.equal(chest.contents[0].qty, 2);
  assert.equal(pc.inventory.first.qty, 1);
  assert.equal(pc.inventory.first.weight, .5);
  assert.deepEqual(pc.inventory.first.modifiers, item.modifiers);
  takeCompartmentItems(pc, chest, null, { potion: 'remainder' });
  assert.deepEqual(chest.contents, []);
  assert.equal(pc.inventory.remainder.qty, 2);
  assert.equal(pc.inventory.old.name, 'Old item');
  assert.throws(() => takeCompartmentItems(pc, chest, 'potion', { potion: 'again' }), /No items/);
  assert.equal(importedItems([{ ...item, qty: -1 }]).length, 0);
  assert.equal(importedItems([{ ...item, weight: -1 }]).length, 0);
});

test('taking coin stacks credits denominations and invalid balances leave contents intact', () => {
  const chest = { contents: [{ id: 'gold', name: 'Gold coins', coin: 'gp', qty: 20, weight: .02 }, { id: 'torch', name: 'Torch', qty: 2, weight: 1 }] };
  const pc = { coin_purse: { gp: 10, sp: 2 } };
  takeCompartmentItems(pc, chest, 'gold', { gold: 'one' });
  assert.equal(pc.coin_purse.gp, 11);
  assert.equal(chest.contents[0].qty, 19);
  takeCompartmentItems(pc, chest, null, { gold: 'rest', torch: 'gear' });
  assert.deepEqual(pc.coin_purse, { gp: 30, sp: 2 });
  assert.equal(pc.inventory.gear.qty, 2);
  assert.deepEqual(chest.contents, []);
  const badChest = { contents: [{ id: 'bad', name: 'Coins', coin: 'gp', qty: 1 }] };
  const badPC = { coin_purse: { gp: -1 } }, original = structuredClone(badChest);
  assert.throws(() => takeCompartmentItems(badPC, badChest, null, { bad: 'bad-key' }), /coin balance/);
  assert.deepEqual(badChest, original);
});

test('every loot tier stays within its coin, gear, and rarity bounds', () => {
  const reference = Object.fromEntries([
    { name: 'Torch', cost: { quantity: 1, unit: 'cp' }, weight: 1, equipment_category: { name: 'Adventuring Gear' } },
    { name: 'Sword', cost: { quantity: 15, unit: 'gp' }, weight: 3, equipment_category: { name: 'Weapon' } },
    ...['Common', 'Uncommon', 'Rare', 'Very Rare', 'Legendary', 'Artifact', 'Varies'].map(name => ({ name, rarity: { name } }))
  ].map(item => [item.name.toLowerCase(), item]));
  for (let tier = 1; tier <= 4; tier++) {
    for (const value of [0, .5, .999999]) {
      const loot = generateLoot(tier, reference, () => value), rules = LOOT_TIERS[tier - 1];
      assert.equal(new Set(loot.map(item => item.id)).size, loot.length);
      assert.equal(importedItems(loot).length, loot.length);
      for (const item of loot) {
        if (item.coin) {
          const [min, max] = rules.coins[item.coin];
          assert.ok(item.qty >= min && item.qty <= max);
        } else if (item.rarity) assert.ok(rules.rarity.includes(item.rarity));
        else {
          const source = reference[item.name.toLowerCase()];
          assert.ok(source.cost.quantity * (source.cost.unit === 'cp' ? .01 : 1) * item.qty <= rules.gearLimit);
        }
      }
      assert.equal(loot.filter(item => item.rarity).length, 1);
    }
  }
  assert.throws(() => generateLoot(0, reference));
  assert.throws(() => generateLoot(1, {}), /unavailable/);
});

test('a targeted consumable spends the source stack and applies only to the recipient', () => {
  const source = { inventory: { potion: { name: 'Potion', qty: 2 } }, effects: { potion: { ...BARK_ARM, consume: true, inventoryKey: 'potion' } } };
  const target = { stats: { str: 10 }, combat: { ac: 10 } };
  const action = { type: 'activate', id: 'effects:potion', inventoryKey: 'potion', targetEffectId: 'effects:received' };
  changeEffects(source, action, target);
  assert.equal(source.inventory.potion.qty, 1);
  assert.equal(source.effects.potion.current, 1);
  assert.equal(source.activeEffects, undefined);
  assert.equal(target.inventory, undefined);
  assert.equal(target.activeEffects['effects:received'].remainingMinutes, 60);
  assert.equal(characterStats(target).ac, 12);
  assert.equal(characterStats(target).stats.str, 12);
  assert.throws(() => changeEffects(source, { ...action, targetEffectId: 'effects:second' }, target), /already active/);
  assert.equal(source.inventory.potion.qty, 1);
  changeEffects(target, { type: 'end', id: 'effects:received' });
  assert.throws(() => changeEffects(target, { type: 'activate', id: 'effects:received' }), /already been used/);
  assert.equal(characterStats(target).ac, 10);
});
