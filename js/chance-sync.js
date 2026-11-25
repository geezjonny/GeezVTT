import { isGM, playerIdentity, canControlPC } from './session-role.js';
import { encodeKey, decodeTree } from './firebase-codec.js';
import { updateConditionally } from './firebase-update.js';
import { watchTabletop } from './tabletop-stream.js';
import { readPC } from './pc-inventory.js';
import { offerChance, receiveChanceCard, finishChance, validChanceRecord } from './chance-model.js';

const base = `${window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, '')}/v2/worlds/gaia/vtt/chance`;
async function change(pcId, edit) {
  if (typeof pcId !== 'string' || !/^[^.#$\[\]/\s]{1,200}$/.test(pcId) || ['__proto__', 'prototype', 'constructor'].includes(pcId)) throw new Error('Choose a linked character.');
  return updateConditionally(`${base}/${encodeKey(pcId)}.json`, record => {
    if (record && record.pcId !== pcId) throw new Error('Character record does not match.');
    const next = edit(record);
    return { result: next, write: next === record ? null : next };
  }, 'The draw changed elsewhere. Check its result and try again.');
}
export async function pushChance(offer) {
  if (!isGM) throw new Error('Only the GM can push a draw.');
  await readPC({ npcId: `v2:${offer.pcId}` });
  return change(offer.pcId, record => offerChance(record, offer));
}
export async function pickChance(pcId, handId, choice) {
  if (isGM || playerIdentity?.pcId !== pcId || !canControlPC({ npcId: `v2:${pcId}` })) throw new Error('Sign in as this character to choose a card.');
  const url = `${window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, '')}/v2/worlds/gaia.json`;
  return updateConditionally(url, world => {
    const previous = Object.hasOwn(world?.vtt?.chance || {}, pcId) ? world.vtt.chance[pcId] : null;
    const result = receiveChanceCard(world, pcId, handId, choice);
    return { result, write: result === previous ? null : world };
  }, 'The character or draw changed elsewhere. Check the result and try again.');
}
export function closeChance(pcId, handId, phase) {
  if (!isGM) throw new Error('Only the GM can finish a draw.');
  return change(pcId, record => finishChance(record, handId, phase));
}
export function watchChance(onValue, onError) {
  return watchTabletop('chance', raw => {
    const records = decodeTree(raw) || {};
    onValue(Object.fromEntries(Object.entries(records).filter(([id, record]) => record?.pcId === id && validChanceRecord(record))));
  }, onError);
}
