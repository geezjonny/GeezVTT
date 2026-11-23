import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BARK_ARM } from '../js/effects-model.js';
import { decodeTree } from '../js/firebase-codec.js';

globalThis.window = { GEEZ_FIREBASE_CONFIG: { databaseURL: 'https://example.test' } };
globalThis.location = { search: '?gm=jonny' };
const { addPCInventoryItem, updatePCInventory, updatePCSpellSlot, updatePCCombat, updatePCEffects, castPCSpell } = await import('../js/pc-inventory.js');
const token = { npcId: 'v2:pc1' };
const item = { name: 'Torch', equipment_category: { name: 'Adventuring Gear' }, desc: ['Light.'], special: ['Burns.'] };

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
    assert.equal(writes, 2);
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
    return { ok: true, json: async () => ({ kind: 'pc', data: {} }) };
  };
  try {
    await addPCInventoryItem(token, item, 3, 'retry-key');
    await addPCInventoryItem(token, item, 3, 'retry-key');
    const writes = calls.filter(call => call.options?.method === 'PUT');
    assert.equal(writes.length, 2);
    assert.equal(writes[0].url, 'https://example.test/v2/worlds/gaia/entities/pc1/data/inventory/retry-key.json');
    assert.equal(writes[1].url, writes[0].url);
    assert.deepEqual(JSON.parse(writes[0].options.body), { name: 'Torch', qty: 3, category: 'Adventuring Gear', desc: 'Light.\n\nBurns.' });
  } finally { globalThis.fetch = original; }
});

test('invalid additions and unavailable PCs never write, and Firebase errors are reported', async () => {
  const original = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (url, options) => {
    if (options?.method === 'PUT') writes++;
    return { ok: true, json: async () => ({ kind: 'npc', data: {} }) };
  };
  try {
    for (const qty of [0, -1, 1.5, 10000, NaN]) await assert.rejects(addPCInventoryItem(token, item, qty, 'key'), /Quantity/);
    await assert.rejects(addPCInventoryItem(token, {}, 1, 'key'), /SRD/);
    await assert.rejects(addPCInventoryItem(token, item, 1, 'bad/key'), /key/);
    await assert.rejects(addPCInventoryItem(token, item, 1, 'key'), /PC unavailable/);
    assert.equal(writes, 0);
    globalThis.fetch = async (url, options) => options?.method === 'PUT'
      ? { ok: false, status: 403 } : { ok: true, json: async () => ({ kind: 'pc', data: {} }) };
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
      assert.deepEqual(decodeTree(entities.pc1.data.inventory), {});
      assert.deepEqual(Object.values(entities.pc2.data.inventory), [{ name: 'Torch', qty: 3, notes: 'Gift' }]);
      assert.equal(entities.npc.name, 'Shopkeeper');
      return { ok: true };
    }
    return { ok: true, headers: { get: () => 'world-version' }, json: async () => ({
      pc1: { kind: 'pc', data: { inventory: { item: { name: 'Torch', qty: 3, notes: 'Gift' } } } },
      pc2: { kind: 'pc', data: {} }, npc: { kind: 'npc', name: 'Shopkeeper' }
    }) };
  };
  try { await updatePCInventory(token, { type: 'transfer', key: 'item', to: 'pc2' }); assert.equal(writes, 1); }
  finally { globalThis.fetch = original; }
});


test('effect activation saves uses, item consumption and active state in one conditional write', async () => {
  const original = globalThis.fetch;
  let conflict = false, writes = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'PUT') {
      writes++;
      assert.equal(options.headers['If-Match'], 'effects-version');
      const entity = decodeTree(JSON.parse(options.body));
      assert.equal(entity.data.effects.bark.current, 1);
      assert.equal(entity.data.inventory.potion.qty, 0);
      assert.equal(entity.data.activeEffects['effects:bark'].remainingMinutes, 60);
      assert.equal(entity.data.combat.hp_current, 25);
      return { ok: !conflict, status: conflict ? 412 : 200 };
    }
    return { ok: true, headers: { get: () => 'effects-version' }, json: async () => ({ kind: 'pc', data: {
      combat: { hp_current: 25 }, inventory: { potion: { name: 'Potion', qty: 1 } },
      effects: { bark: { ...BARK_ARM, current: 2, consume: true, inventoryKey: 'potion' } }
    } }) };
  };
  try {
    await updatePCEffects(token, { type: 'activate', id: 'effects:bark' });
    conflict = true;
    await assert.rejects(updatePCEffects(token, { type: 'activate', id: 'effects:bark' }), /changed elsewhere/);
    assert.equal(writes, 2);
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
    assert.equal(writes, 2);
  } finally { globalThis.fetch = original; }
});
