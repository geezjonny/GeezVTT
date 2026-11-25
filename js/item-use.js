import { consumableDefinition, consumableCost, throwItem } from './consumables.js';
import { applyConsumableEffect as applyConsumable } from './consumables.js';
import { takeTurnAction } from './initiative-model.js';
export { applyConsumable };
import { isGM, canControlPC } from './session-role.js';
import { encodeKey, encodeTree, decodeTree } from './firebase-codec.js';
import { updateConditionally } from './firebase-update.js';

export function requestItemUse(token, action) {
  if (!canControlPC(token)) return Promise.reject(new Error('Select a character you control.'));
  const floor = document.getElementById('floor'), requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const received = event => {
      if (event.detail.requestId !== requestId) return;
      clearTimeout(timer); floor.removeEventListener('session-item-result', received);
      if (event.detail.error) reject(new Error(event.detail.error)); else resolve(import('./pc-inventory.js').then(({readPC}) => readPC(token)));
    };
    const timer = setTimeout(() => {
      floor.removeEventListener('session-item-result', received);
      reject(new Error('Item response timed out; check the bag before retrying.'));
    }, 25000);
    floor.addEventListener('session-item-result', received);
    floor.dispatchEvent(new CustomEvent('session-action', { detail: { ...action, type: 'item-use', command: action.type === 'throw' ? 'throw' : 'consume', requestId,
      tokenId: token.id, turnId: floor.tabletopMap?.initiative?.turn?.id ?? null } }));
  });
}
export async function resolveItemUse(token, action, reference) {
  if (!isGM || !token || !['consume','throw'].includes(action.command) || typeof action.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(action.requestId)) throw new Error('Invalid item request.');
  const floor = document.getElementById('floor'), scene = floor.sceneDocument, floorIndex = floor.activeFloorIndex;
  const base = window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, ''), url = `${base}/v2/worlds/gaia.json`;
  const sourceKey = encodeKey(token.npcId.slice(3)), rolls = {};
  const effectKey = crypto.randomUUID(), dropId = crypto.randomUUID();
  const current = () => floor.sceneDocument === scene && floor.activeFloorIndex === floorIndex;
  await floor.flushSharedTabletop();
  floor.compartmentBusy = true;
  try {
    let savedMap;
    const result = await updateConditionally(url, world => {
      savedMap = null;
      if (!current()) throw new Error('Scene changed; reopen the bag.');
      const live = world?.vtt?.live;
      if (!live || live.sceneId !== action.sceneId) throw new Error('Shared scene changed or unavailable.');
      const source = decodeTree(world.entities?.[sourceKey]);
      if (source?.kind !== 'pc' || !source.data || source.data._sheetsDeleted) throw new Error('PC unavailable.');
      const receipt = world.vtt.itemUses?.[action.requestId];
      if (receipt) {
        if (receipt.tokenId !== token.id) throw new Error('Item request conflict.');
        return { result: { pc: source.data, text: receipt.text }, write: null };
      }
      const map = live.map, actor = map.tokens?.find(value => value.id === token.id && value.npcId === token.npcId);
      if (!actor || actor.hidden) throw new Error('Source token unavailable.');
      const turn = map.initiative?.turn;
      if (live.initiative && (!turn || turn.id !== action.turnId || turn.tokenId !== actor.id)) throw new Error('Wait for your turn.');
      const item = source.data.inventory?.[action.key];
      if (!item) throw new Error('Item is no longer in this bag.');
      const definition = consumableDefinition(item, reference);
      const cost = action.command === 'throw' ? 'attack' : consumableCost(source.data, definition || {label:item.name});
      if (live.initiative && turn[cost]) throw new Error(`Your ${cost} is already spent.`);
      let text, target, targetKey;
      if (action.command === 'throw') {
        const drop = throwItem(source.data, { ...action, effectKey, dropId }, actor, map, reference);
        map.props ||= []; map.props.push(drop); text = `Threw ${item.name}.`;
      } else {
        targetKey = typeof action.to === 'string' ? encodeKey(action.to) : null;
        target = targetKey ? decodeTree(world.entities?.[targetKey]) : null;
        const targetToken = map.tokens?.find(value => value.npcId === `v2:${action.to}` && !value.hidden);
        if (targetKey === sourceKey) target = source;
        if (target?.kind !== 'pc' || !target.data || target.data._sheetsDeleted || !targetToken) throw new Error('Target PC is unavailable on this floor.');
        if (actor.id !== targetToken.id && Math.hypot(actor.x - targetToken.x, actor.y - targetToken.y) > 1 + (actor.size + targetToken.size) / 2) throw new Error('Move within 5 feet of the target.');
        text = applyConsumable(source.data, target.data, { ...action, effectKey }, reference, rolls).label;
        world.entities[targetKey] = encodeTree(target);
        for (const value of map.tokens || []) if (value.npcId === `v2:${action.to}`) value.hp = target.data.combat?.hp_current ?? value.hp;
      }
      if (live.initiative) {
        if(cost==='attack') {
          if(!takeTurnAction(map,actor.id,turn.id,'attack')) throw new Error('No attacks remaining.');
        } else turn[cost] = true;
      }
      world.entities[sourceKey] = encodeTree(source);
      world.vtt.itemUses = { ...world.vtt.itemUses, [action.requestId]: { tokenId: token.id, text } };
      if (!current()) throw new Error('Scene changed; reopen the bag.');
      savedMap = map;
      return { result: { pc: source.data, text }, write: world };
    }, 'Inventory changed elsewhere; try again.', { raw: true });
    if (savedMap && current()) floor.dispatchEvent(new CustomEvent('tabletop-item-saved', { detail: savedMap }));
    return result;
  } finally { floor.compartmentBusy = false; }
}
