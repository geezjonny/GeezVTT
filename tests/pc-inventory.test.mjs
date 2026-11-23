import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { GEEZ_FIREBASE_CONFIG: { databaseURL: 'https://example.test' } };
const { addPCInventoryItem } = await import('../js/pc-inventory.js');
const token = { npcId: 'v2:pc1' };
const item = { name: 'Torch', equipment_category: { name: 'Adventuring Gear' }, desc: ['Light.'], special: ['Burns.'] };

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
