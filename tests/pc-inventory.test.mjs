import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BARK_ARM } from '../js/effects-model.js';
import { decodeTree } from '../js/firebase-codec.js';

globalThis.window = { GEEZ_FIREBASE_CONFIG: { databaseURL: 'https://example.test' } };
globalThis.location = { search: '?gm=jonny' };
const { addPCInventoryItem, updatePCInventory, updatePCSpellSlot, updatePCCombat, updatePCEffects, updatePCFeat, castPCSpell, consumePCItem, takeChestItems } = await import('../js/pc-inventory.js');
const token = { npcId: 'v2:pc1' };
const item = { name: 'Torch', equipment_category: { name: 'Adventuring Gear' }, desc: ['Light.'], special: ['Burns.'] };

test('targeted item use conditionally saves consumption and the recipient together', async () => {
  const original = globalThis.fetch;
  let writes = 0, last;
  globalThis.fetch = async (url, options = {}) => {
    if (url === 'https://example.test/v2/worlds/gaia/vtt/live.json') return { ok: true, json: async () => ({}) };
    assert.equal(url, 'https://example.test/v2/worlds/gaia/entities.json');
    if (options.method === 'PUT') {
      writes++;
      assert.equal(options.headers['If-Match'], 'item-version');
      last = decodeTree(JSON.parse(options.body));
      return { ok: true };
    }
    return { ok: true, headers: { get: () => 'item-version' }, json: async () => ({
      pc1: { kind: 'pc', data: { inventory: { potion: { name: 'Potion', qty: 2 } }, effects: { potion: { ...BARK_ARM, consume: true, inventoryKey: 'potion' } } } },
      target: { kind: 'pc', data: { combat: { ac: 10, hp_current: 5 } } },
      untouched: { kind: 'npc', data: { name: 'Preserved' } }
    }) };
  };
  try {
    await consumePCItem(token, { key: 'potion', id: 'effects:potion', to: 'target' });
    assert.equal(writes, 1);
    assert.equal(last.pc1.data.inventory.potion.qty, 1);
    assert.equal(last.pc1.data.activeEffects, undefined);
    assert.equal(Object.values(last.target.data.activeEffects)[0].remainingMinutes, 60);
    assert.equal(last.target.data.combat.hp_current, 5);
    assert.equal(last.untouched.data.name, 'Preserved');
    await assert.rejects(consumePCItem(token, { key: 'potion', id: 'effects:potion', to: 'untouched' }), /PC unavailable/);
    assert.equal(writes, 1);
  } finally { globalThis.fetch = original; }
});

test('compartment transfers retry fresh state and receipts prevent repeated requests taking twice', async () => {
  const originalFetch = globalThis.fetch, originalDocument = globalThis.document;
  const chest = { id: 'chest', kind: 'crate', x: 0, y: 0, open: true, contents: [{ id: 'potion', name: 'Potion', qty: 3, weight: .5, desc: 'Keep metadata.' }] };
  const props = [chest], selected = { ...token, id: 'token', kind: 'pc', x: 0, y: 0, size: 1 };
  let world = { settings: { keep: true }, entities: { pc1: { kind: 'pc', data: { inventory: { old: { name: 'Old' } } } } },
    vtt: { live: { sceneId: 'scene', map: { props: structuredClone(props), tokens: [selected] } } } };
  let writes = 0, reads = 0;
  globalThis.document = { getElementById: () => ({ tabletopMap: { props } }) };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://example.test/v2/worlds/gaia.json');
    if (options.method === 'PUT') {
      writes++;
      assert.equal(options.headers['If-Match'], `version-${reads}`);
      if (writes === 1) {
        world.vtt.live.map.props[0].contents[0].qty = 2;
        world.entities.pc1.data.notes = 'Concurrent edit';
        return { ok: false, status: 412 };
      }
      world = JSON.parse(options.body);
      return { ok: true };
    }
    reads++;
    return { ok: true, headers: { get: () => `version-${reads}` }, json: async () => structuredClone(world) };
  };
  try {
    const contents = await takeChestItems(selected, chest, 'potion', props, 'request');
    assert.equal(writes, 2);
    assert.equal(contents[0].qty, 1);
    assert.equal(world.settings.keep, true);
    assert.equal(world.entities.pc1.data.notes, 'Concurrent edit');
    const bag = decodeTree(world.entities.pc1).data.inventory;
    const taken = Object.values(bag).find(item => item.name === 'Potion');
    assert.equal(taken.qty, 1);
    assert.equal(taken.weight, .5);
    assert.equal(taken.desc, 'Keep metadata.');
    assert.equal(bag.old.name, 'Old');
    assert.equal((await takeChestItems(selected, chest, 'potion', props, 'request'))[0].qty, 1);
    assert.equal(writes, 2);
    world.vtt.live.map.props[0].locked = true;
    await assert.rejects(takeChestItems(selected, chest, null, props, 'next-request'), /unavailable/);
    assert.equal(writes, 2);
  } finally { globalThis.fetch = originalFetch; globalThis.document = originalDocument; }
});

test('feat use saves the current charge count with a conditional write', async () => {
  const original = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://example.test/v2/worlds/gaia/entities/pc1.json');
    if (options.method === 'PUT') {
      writes++;
      assert.equal(options.headers['If-Match'], 'feat-version');
      const entity = decodeTree(JSON.parse(options.body));
      assert.equal(entity.data.abilities.wind.current, 1);
      assert.equal(entity.data.abilities.wind.effect_desc, 'Heal.');
      return { ok: true };
    }
    return { ok: true, headers: { get: () => 'feat-version' }, json: async () => ({ kind: 'pc', data: {
      abilities: { wind: { label: 'Second Wind', max: 2, current: 2, effect_desc: 'Heal.' } }
    } }) };
  };
  try {
    await updatePCFeat(token, { type: 'use', id: 'abilities:wind' });
    assert.equal(writes, 1);
  } finally { globalThis.fetch = original; }
});

test('combat equipment retries recheck the latest gear and spend turn resources only after a successful save', async () => {
  const originalFetch = globalThis.fetch, originalDocument = globalThis.document;
  const combatToken = { ...token, id: 'pc1' };
  const map = { initiative: { currentId: 'pc1', turn: { id: 'turn', tokenId: 'pc1', item: false, action: false } } };
  const floor = { initiativeActive: true, tabletopMap: map };
  globalThis.document = { getElementById: () => floor };
  let reads = 0, writes = 0;
  globalThis.fetch = async (url, options) => {
    if (options.method === 'PUT') {
      writes++;
      assert.equal(map.initiative.turn.item, false);
      assert.equal(map.initiative.turn.action, false);
      return { ok: writes > 1, status: writes === 1 ? 412 : 200 };
    }
    reads++;
    return { ok: true, headers: { get: () => `version-${reads}` }, json: async () => ({ kind: 'pc', data: {
      inventory: { sword: { name: 'Sword', category: 'Weapon', qty: 1 } },
      equipped: reads > 1 ? { main_hand: 'Longbow' } : {}
    } }) };
  };
  try {
    await updatePCInventory(combatToken, { type: 'equip', slot: 'main_hand', key: 'sword' }, {}, { map, turnId: 'turn' });
    assert.equal(writes, 2);
    assert.equal(map.initiative.turn.item, true);
    assert.equal(map.initiative.turn.action, true);
    await assert.rejects(updatePCInventory(combatToken, { type: 'equip', slot: 'main_hand', key: 'sword' }, {}, { map, turnId: 'stale' }), /Map or turn changed/);
    assert.equal(writes, 2);
  } finally { globalThis.fetch = originalFetch; globalThis.document = originalDocument; }
});

test('coin changes retry against the latest balance and return the saved sheet', async () => {
  const original = globalThis.fetch;
  let reads = 0, writes = 0;
  globalThis.fetch = async (url, options) => {
    if (options.method === 'PUT') {
      writes++;
      assert.equal(options.headers['If-Match'], `version-${reads}`);
      const entity = JSON.parse(options.body);
      assert.equal(entity.data.coin_purse.gp, reads === 1 ? 11 : 12);
      assert.equal(entity.data.coin_purse.sp, 3);
      assert.equal(entity.data.combat.hp_current, 10);
      return { ok: writes > 1, status: writes === 1 ? 412 : 200 };
    }
    reads++;
    return { ok: true, headers: { get: () => `version-${reads}` }, json: async () => ({ kind: 'pc', data: {
      coin_purse: { gp: reads === 1 ? 10 : 11, sp: 3 }, combat: { hp_current: 10 }
    } }) };
  };
  try {
    const pc = await updatePCInventory(token, { type: 'coin', coin: 'gp', delta: 1 });
    assert.equal(pc.coin_purse.gp, 12);
    assert.equal(writes, 2);
  } finally { globalThis.fetch = original; }
});

test('GM combat edits save with a version and preserve unrelated character data', async () => {
  const original = globalThis.fetch;
  let conflict = false, last;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://example.test/v2/worlds/gaia/entities/pc1.json');
    if (options.method === 'PUT') {
      assert.equal(options.headers['If-Match'], 'combat-version');
      last = JSON.parse(options.body);
      assert.equal(last.data.combat.hp_current, 10);
      assert.equal(last.data.inventory.item.name, 'Torch');
      return { ok: !conflict, status: conflict ? 412 : 200 };
    }
    return { ok: true, headers: { get: () => 'combat-version' }, json: async () => ({ kind: 'pc', data: {
      combat: { hp_current: 10, exhaustion: 0, conditions: { '%EMPTY': 'array' } }, inventory: { item: { name: 'Torch' } }
    } }) };
  };
  try {
    await updatePCCombat(token, { type: 'set', field: 'ac', value: 18 });
    assert.equal(last.data.combat.ac, 18);
    await updatePCCombat(token, { type: 'condition', name: 'Poisoned', enabled: true });
    assert.deepEqual(last.data.combat.conditions, ['Poisoned']);
    await updatePCCombat(token, { type: 'exhaustion', delta: 1 });
    assert.equal(last.data.combat.exhaustion, 1);
    conflict = true;
    await assert.rejects(updatePCCombat(token, { type: 'set', field: 'temp_hp', value: 3 }), /changed elsewhere/);
  } finally { globalThis.fetch = original; }
});

test('spell slots save conditionally and reject conflicting sheet edits', async () => {
  const original = globalThis.fetch;
  let conflict = false, writes = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://example.test/v2/worlds/gaia/entities/pc1.json');
    if (options.method === 'PUT') {
      writes++;
      assert.equal(options.headers['If-Match'], 'pc-version');
      const entity = JSON.parse(options.body);
      assert.equal(entity.data.spellcasting.slots_used['%31'], 1);
      assert.equal(entity.data.combat.hp_current, 10);
      return { ok: !conflict, status: conflict ? 412 : 200 };
    }
    assert.equal(options.headers['X-Firebase-ETag'], 'true');
    return { ok: true, headers: { get: () => 'pc-version' }, json: async () => ({ kind: 'pc', data: {
      combat: { hp_current: 10 }, spellcasting: { slots: { '%31': 2 }, slots_used: { '%31': 0 } }
    } }) };
  };
  try {
    const pc = await updatePCSpellSlot(token, 1, 0);
    assert.equal(pc.spellcasting.slots_used[1], 1);
    conflict = true;
    await assert.rejects(updatePCSpellSlot(token, 1, 0), /changed elsewhere/);
    assert.equal(writes, 4, 'one save, then three attempts that all lose the race');
  } finally { globalThis.fetch = original; }
});

test('slot saves reject missing versions, deleted PCs and denied writes', async () => {
  const original = globalThis.fetch;
  let etag = null, deleted = false, writes = 0;
  globalThis.fetch = async (url, options) => {
    if (options.method === 'PUT') { writes++; return { ok: false, status: 403 }; }
    return { ok: true, headers: { get: () => etag }, json: async () => ({ kind: 'pc', data: {
      _sheetsDeleted: deleted, spellcasting: { slots: { 1: 2 } }
    } }) };
  };
  try {
    await assert.rejects(updatePCSpellSlot(token, 1, 0), /no changes saved/);
    etag = 'version'; deleted = true;
    await assert.rejects(updatePCSpellSlot(token, 1, 0), /PC unavailable/);
    assert.equal(writes, 0);
    deleted = false;
    await assert.rejects(updatePCSpellSlot(token, 1, 0), /403/);
    assert.equal(writes, 1);
  } finally { globalThis.fetch = original; }
});

test('adding an SRD item writes only its stable bag key with quantity and description', async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (options?.method === 'PUT') return { ok: true, status: 200 };
    return { ok: true, headers: { get: () => 'v1' }, json: async () => ({ kind: 'pc', data: {} }) };
  };
  try {
    await addPCInventoryItem(token, item, 3, 'retry-key');
    await addPCInventoryItem(token, item, 3, 'retry-key');
    const writes = calls.filter(call => call.options?.method === 'PUT');
    assert.equal(writes.length, 2);
    assert.equal(writes[0].url, 'https://example.test/v2/worlds/gaia/entities/pc1.json');
    assert.equal(writes[0].options.headers['If-Match'], 'v1');
    assert.equal(writes[1].url, writes[0].url);
    assert.deepEqual(decodeTree(JSON.parse(writes[0].options.body)).data.inventory['retry-key'], { name: 'Torch', qty: 3, category: 'Adventuring Gear', desc: 'Light.\n\nBurns.' });
  } finally { globalThis.fetch = original; }
});

test('invalid additions and unavailable PCs never write, and Firebase errors are reported', async () => {
  const original = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (url, options) => {
    if (options?.method === 'PUT') writes++;
    return { ok: true, headers: { get: () => 'v1' }, json: async () => ({ kind: 'npc', data: {} }) };
  };
  try {
    for (const qty of [0, -1, 1.5, 10000, NaN]) await assert.rejects(addPCInventoryItem(token, item, qty, 'key'), /Quantity/);
    await assert.rejects(addPCInventoryItem(token, {}, 1, 'key'), /SRD/);
    await assert.rejects(addPCInventoryItem(token, item, 1, 'bad/key'), /key/);
    await assert.rejects(addPCInventoryItem(token, item, 1, 'key'), /PC unavailable/);
    assert.equal(writes, 0);
    globalThis.fetch = async (url, options) => options?.method === 'PUT'
      ? { ok: false, status: 403 } : { ok: true, headers: { get: () => 'v1' }, json: async () => ({ kind: 'pc', data: {} }) };
    await assert.rejects(addPCInventoryItem(token, item, 1, 'key'), /403/);
  } finally { globalThis.fetch = original; }
});

test('a concurrent equip prevents removal when the conditional write is retried', async () => {
  const original = globalThis.fetch;
  let reads = 0, writes = 0;
  globalThis.fetch = async (url, options) => {
    if (options.method === 'PUT') { writes++; assert.equal(options.headers['If-Match'], 'version-1'); return { ok: false, status: 412 }; }
    reads++;
    return { ok: true, headers: { get: () => `version-${reads}` }, json: async () => ({ kind: 'pc', data: {
      inventory: { item: { name: 'Sword', qty: 1 } }, equipped: reads > 1 ? { main_hand: 'Sword' } : {}
    } }) };
  };
  try {
    await assert.rejects(updatePCInventory(token, { type: 'remove', key: 'item' }), /Unequip/);
    assert.equal(reads, 2); assert.equal(writes, 1);
  } finally { globalThis.fetch = original; }
});

test('transfer saves both bags atomically with an ETag and retains unrelated entities', async () => {
  const original = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://example.test/v2/worlds/gaia/entities.json');
    if (options.method === 'PUT') {
      writes++;
      assert.equal(options.headers['If-Match'], 'world-version');
      const entities = JSON.parse(options.body);
      assert.deepEqual(decodeTree(entities.pc1.data.inventory), { item: { name: 'Torch', qty: 1, notes: 'Gift' } });
      assert.deepEqual(Object.values(entities.pc2.data.inventory), [{ name: 'Torch', qty: 2, notes: 'Gift' }]);
      assert.equal(entities.npc.name, 'Shopkeeper');
      return { ok: true };
    }
    return { ok: true, headers: { get: () => 'world-version' }, json: async () => ({
      pc1: { kind: 'pc', data: { inventory: { item: { name: 'Torch', qty: 3, notes: 'Gift' } } } },
      pc2: { kind: 'pc', data: {} }, npc: { kind: 'npc', name: 'Shopkeeper' }
    }) };
  };
  try { await updatePCInventory(token, { type: 'transfer', key: 'item', to: 'pc2', qty: 2 }); assert.equal(writes, 1); }
  finally { globalThis.fetch = original; }
});


test('effect activation saves uses, item consumption and active state in one conditional write', async () => {
  const original = globalThis.fetch;
  let conflict = false, writes = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url === 'https://example.test/v2/worlds/gaia/vtt/live.json') return { ok: true, json: async () => ({}) };
    if (options.method === 'PUT') {
      writes++;
      assert.equal(options.headers['If-Match'], 'effects-version');
      if (conflict) return { ok: false, status: 412 };
      assert.ok(url.endsWith('/entities/pc1.json'), 'self use saves only your own record');
      const { data: pc } = decodeTree(JSON.parse(options.body));
      assert.equal(pc.inventory.potion.qty, 0);
      assert.equal(Object.values(pc.activeEffects)[0].remainingMinutes, 60);
      assert.equal(pc.combat.hp_current, 25);
      return { ok: true, status: 200 };
    }
    const entity = { kind: 'pc', data: {
      combat: { hp_current: 25 }, inventory: { potion: { name: 'Potion', qty: 1 } },
      effects: { bark: { ...BARK_ARM, current: 2, consume: true, inventoryKey: 'potion' } }
    } };
    return { ok: true, headers: { get: () => 'effects-version' }, json: async () => url.endsWith('/entities/pc1.json') ? entity : { pc1: entity } };
  };
  try {
    await updatePCEffects(token, { type: 'activate', id: 'effects:bark' });
    assert.equal(writes, 1);
    conflict = true;
    await assert.rejects(updatePCEffects(token, { type: 'activate', id: 'effects:bark' }), /changed elsewhere/);
    assert.equal(writes, 4);
  } finally { globalThis.fetch = original; }
});


test('spell use spends one pip conditionally, preserves other sheet data and rejects exhausted slots', async () => {
  const original = globalThis.fetch;
  let writes = 0, used = 0, conflict = false;
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') {
      writes++;
      assert.equal(options.headers['If-Match'], 'cast-version');
      const data = decodeTree(JSON.parse(options.body)).data;
      assert.equal(data.spellcasting.slots_used[1], 1);
      assert.equal(data.inventory.potion.qty, 2);
      assert.equal(data.combat.hp_current, 25);
      return { ok: !conflict, status: conflict ? 412 : 200 };
    }
    return { ok: true, headers: { get: () => 'cast-version' }, json: async () => ({ kind: 'pc', data: {
      combat: { hp_current: 25 }, inventory: { potion: { name: 'Potion', qty: 2 } },
      spellcasting: { spell_save_dc: 13, slots: { 1: 1 }, slots_used: { 1: used },
        spells: { flame: { name: 'Custom flame', level: 1, damage: '1d6', save_stat: 'dex' } } }
    } }) };
  };
  try {
    const result = await castPCSpell(token, 'flame', 1, {});
    assert.equal(result.pc.spellcasting.slots_used[1], 1);
    assert.equal(result.cast.rolls[0].expression, '1d6');
    assert.match(result.cast.message, /DC 13/);
    conflict = true;
    await assert.rejects(castPCSpell(token, 'flame', 1, {}), /changed elsewhere/);
    used = 1;
    await assert.rejects(castPCSpell(token, 'flame', 1, {}), /No spell slot/);
    assert.equal(writes, 4);
  } finally { globalThis.fetch = original; }
});

test('a conflicting save re-reads the sheet and retries instead of failing', async () => {
  const original = globalThis.fetch;
  let reads = 0, writes = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') { writes++; return { ok: writes > 1, status: writes > 1 ? 200 : 412 }; }
    reads++;
    return { ok: true, headers: { get: () => `v${reads}` }, json: async () => ({ kind: 'pc', data: { combat: { hp_current: 10 + reads } } }) };
  };
  try {
    const pc = await updatePCCombat(token, { type: 'set', field: 'hp_current', value: 3 });
    assert.equal(pc.combat.hp_current, 3);
    assert.equal(reads, 2);
    assert.equal(writes, 2);
  } finally { globalThis.fetch = original; }
});
