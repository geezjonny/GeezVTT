import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.location = { search: '' };
globalThis.window = new EventTarget();
window.GEEZ_FIREBASE_CONFIG = { databaseURL: 'https://example.test' };
const { setPlayerIdentity, canControlPC } = await import('../js/session-role.js');
const { readPC, updatePCSpellSlot, updatePCInventory, updatePCCombat, updatePCEffects, castPCSpell } = await import('../js/pc-inventory.js');

test('players can read another PC while every sheet mutation remains owner-only', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async url => {
    requests++; assert.equal(url, 'https://example.test/v2/worlds/gaia/entities/liora.json');
    return { ok: true, json: async () => ({ kind: 'pc', data: { name: 'Liora' } }) };
  };
  try {
    setPlayerIdentity({ campaign: 'daddies', character: 'Seris', pcId: 'seris' });
    assert.equal((await readPC({ npcId: 'v2:liora' })).name, 'Liora');
    assert.equal(canControlPC({ npcId: 'v2:liora' }), false);
    await assert.rejects(updatePCSpellSlot({ npcId: 'v2:liora' }, 1, 0), /Sign in/);
    await assert.rejects(updatePCInventory({ npcId: 'v2:liora' }, { type: 'remove', key: 'item' }), /Sign in/);
    await assert.rejects(updatePCCombat({ npcId: 'v2:liora' }, { type: 'set', field: 'hp_current', value: 1 }), /Sign in/);
    await assert.rejects(updatePCEffects({ npcId: 'v2:liora' }, { type: 'activate', id: 'effects:bark' }), /Sign in/);
    await assert.rejects(castPCSpell({ npcId: 'v2:liora' }, 'spell', 1, {}), /Sign in/);
    assert.equal(requests, 1);
  } finally { globalThis.fetch = original; }
});

test('the signed-in player can save their own spell pips in Gaia format', async () => {
  const original = globalThis.fetch;
  setPlayerIdentity({ campaign: 'daddies', character: 'Seris', pcId: 'seris' });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://example.test/v2/worlds/gaia/entities/seris.json');
    if (options.method === 'PUT') {
      const entity = JSON.parse(options.body);
      assert.equal(entity.data.spellcasting.slots_used['%31'], 1);
      assert.equal(options.headers['If-Match'], 'version');
      return { ok: true };
    }
    return { ok: true, headers: { get: () => 'version' }, json: async () => ({ kind: 'pc', data: {
      spellcasting: { slots: { '%31': 2 }, slots_used: { '%31': 0 } }
    } }) };
  };
  try {
    const pc = await updatePCSpellSlot({ npcId: 'v2:seris' }, 1, 0);
    assert.equal(pc.spellcasting.slots_used[1], 1);
  } finally { globalThis.fetch = original; }
});
