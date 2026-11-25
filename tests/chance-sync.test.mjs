import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offerChance, receiveChanceCard } from '../js/chance-model.js';
import { encodeTree, decodeTree } from '../js/firebase-codec.js';

globalThis.window = { GEEZ_FIREBASE_CONFIG: { databaseURL: 'https://example.test' }, addEventListener() {}, dispatchEvent() {} };
globalThis.location = { search: '' };
const { setPlayerIdentity } = await import('../js/session-role.js');
const { pickChance, pushChance, closeChance } = await import('../js/chance-sync.js');
setPlayerIdentity({ campaign: 'disney', character: 'Liora', pcId: 'pc-1' });
const offered = () => offerChance(null, { id: 'hand-1', pcId: 'pc-1', name: 'Liora', createdAt: 100,
  cards: [[1, 1, 1], [8, 6, 13], [50, 50, 50]] });

test('a conflicting pick returns the first committed result without a second write or count increase', async () => {
  const original = globalThis.fetch;
  let stored = { entities: { 'pc-1': { kind: 'pc', data: { name: 'Liora', notes: 'Keep this' } } }, vtt: { chance: { 'pc-1': offered() } } }, reads = 0, writes = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://example.test/v2/worlds/gaia.json');
    if (options.method === 'PUT') {
      writes++;
      assert.equal(options.headers['If-Match'], 'version-1');
      const attempted = decodeTree(JSON.parse(options.body));
      assert.equal(attempted.vtt.chance['pc-1'].drawCount, 1);
      assert.equal(attempted.vtt.chance['pc-1'].hand.chosen, 0);
      assert.equal(attempted.entities['pc-1'].data.inventory['chance-hand-1'].category, 'Card');
      assert.equal(attempted.entities['pc-1'].data.equipped.card_key, 'chance-hand-1');
      receiveChanceCard(stored, 'pc-1', 'hand-1', 2);
      return { ok: false, status: 412 };
    }
    reads++;
    return { ok: true, headers: { get: () => `version-${reads}` }, json: async () => encodeTree(structuredClone(stored)) };
  };
  try {
    const result = await pickChance('pc-1', 'hand-1', 0);
    assert.equal(result.hand.chosen, 2);
    assert.equal(result.drawCount, 1);
    assert.equal(reads, 2);
    assert.equal(writes, 1);
  } finally { globalThis.fetch = original; }
});

test('a signed-in player cannot select another character or issue dealer actions', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('Unexpected request'); };
  try {
    await assert.rejects(pickChance('pc-2', 'hand-1', 0), /Sign in as this character/);
    await assert.rejects(pushChance({ pcId: 'pc-1' }), /Only the GM/);
    assert.throws(() => closeChance('pc-1', 'hand-1', 'handled'), /Only the GM/);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = original; }
});
