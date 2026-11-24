import { hasCompartment } from './prop-model.js';
import { characterStats } from './equipment-modifiers.js';
import { applyConsumable, requestItemUse } from './item-use.js';
import { changeInventory } from './inventory-model.js';
import { useSpell } from './spell-model.js';
import { changeSpellSlot } from './sheet-rolls.js';
import { changeEffects } from './effects-model.js';
import { changeCombat } from './sheet-combat.js';
import { changeFeat } from './feats-model.js';
import { isGM, canControlPC } from './session-role.js';
import { encodeKey, encodeTree, decodeTree } from './firebase-codec.js';
import { equipmentTurnCost } from './initiative-model.js';
import { takeCompartmentItems } from './compartment-model.js';
import { applyTrapDamage } from './trigger-model.js';
const base=window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/,'');
const entityPath=(token,control=true)=>{
  if(control && !canControlPC(token)) throw new Error('Sign in as this PC to control it.');
  if(!token?.npcId?.startsWith('v2:')) throw new Error('Select a linked PC.');
  return `v2/worlds/gaia/entities/${encodeURIComponent(token.npcId.slice(3))}`;
};
function ensureCanCarry(pc, reference) {
  if(characterStats(pc,reference).load.overCapacity) throw new Error('This would exceed carrying capacity.');
}
export async function readPC(token) {
  const response=await fetch(`${base}/${entityPath(token,false)}.json`,{signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error(`Firebase returned ${response.status}`);
  const entity=decodeTree(await response.json());
  if(entity?.kind!=='pc' || !entity.data || entity.data._sheetsDeleted) throw new Error('PC unavailable.');
  return entity.data;
}
export async function castPCSpell(token, key, level, reference) {
  let cast;
  const pc = await updatePCSheet(token, pc => { cast = useSpell(pc, key, level, reference); });
  return { pc, cast };
}
export async function updatePCSpellSlot(token, level, pip) {
  return updatePCSheet(token, pc => changeSpellSlot(pc, level, pip));
}
export async function updatePCCombat(token, action) {
  if (action.type === 'base-stat' && !isGM) throw new Error('Only the GM can change ability scores.');
  if (!isGM && (action.type === 'edition' || action.type === 'ac-mode' || (action.type === 'set' && ['ac', 'speed', 'hp_max'].includes(action.field)))) throw new Error('Only the GM can change base AC, speed, or maximum HP.');
  return updatePCSheet(token, pc => changeCombat(pc, action));
}
export async function damagePCFromTrap(token, amount) {
  if (!isGM) throw new Error('Trap damage must go through the GM session.');
  return updatePCSheet(token, pc => applyTrapDamage(pc, amount));
}
export async function updatePCEffects(token, action) {
  if(action.type==='activate') {
    const pc=await readPC(token), [group,key]=String(action.id).split(':');
    const effect=pc[group]?.[key];
    if(effect?.consume) return consumePCItem(token,{type:'consume',id:action.id,key:effect.inventoryKey,to:token.npcId.slice(3)});
  }
  return updatePCSheet(token, pc => changeEffects(pc, action));
}
export async function consumePCItem(token, action) {
  entityPath(token);
  if (globalThis.document?.getElementById('floor')?.tabletopMap) return requestItemUse(token, action);
  const liveResponse=await fetch(`${base}/v2/worlds/gaia/vtt/live.json`,{signal:AbortSignal.timeout(15000)});
  if(!liveResponse.ok) throw new Error(`Firebase returned ${liveResponse.status}`);
  if((await liveResponse.json())?.initiative) throw new Error('Use the VTT inventory during initiative.');
  if (typeof action.key !== 'string' || !action.key) throw new Error('Choose a source item.');
  const sourceId = token.npcId.slice(3), targetEffectId = `effects:${crypto.randomUUID()}`, rolls = {};
  const url = `${base}/v2/worlds/gaia/entities.json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { headers: { 'X-Firebase-ETag': 'true' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
    const entities = decodeTree(await response.json()), etag = response.headers.get('ETag');
    if (!etag) throw new Error('Firebase did not return a version; no changes saved.');
    const source = Object.hasOwn(entities || {}, sourceId) ? entities[sourceId] : null;
    const target = typeof action.to === 'string' && Object.hasOwn(entities || {}, action.to) ? entities[action.to] : null;
    if (source?.kind !== 'pc' || !source.data || source.data._sheetsDeleted || target?.kind !== 'pc' || !target.data || target.data._sheetsDeleted) throw new Error('Source or target PC unavailable.');
    applyConsumable(source.data, target.data, {...action,effectKey:targetEffectId.slice(8)}, {}, rolls);
    const saved = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': etag },
      body: JSON.stringify(encodeTree(entities)), signal: AbortSignal.timeout(15000) });
    if (saved.status === 412) continue;
    if (!saved.ok) throw new Error(`Firebase returned ${saved.status}`);
    return source.data;
  }
  throw new Error('Characters changed elsewhere. Reopen Use and try again.');
}
export async function updatePCFeat(token, action) {
  return updatePCSheet(token, pc => changeFeat(pc, action));
}
async function updatePCSheet(token, change) {
  const url = `${base}/${entityPath(token)}.json`;
  const response = await fetch(url, { headers: { 'X-Firebase-ETag': 'true' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
  const entity = decodeTree(await response.json()), etag = response.headers.get('ETag');
  if (entity?.kind !== 'pc' || !entity.data || entity.data._sheetsDeleted) throw new Error('PC unavailable.');
  if (!etag) throw new Error('Firebase did not return a version; no changes saved.');
  change(entity.data);
  const saved = await fetch(url, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': etag },
    body: JSON.stringify(encodeTree(entity)), signal: AbortSignal.timeout(15000)
  });
  if (saved.status === 412) throw new Error('Character changed elsewhere. Try again.');
  if (!saved.ok) throw new Error(`Firebase returned ${saved.status}`);
  return entity.data;
}
export function pcInventory(pc) {
  return Object.entries(pc.inventory || {}).flatMap(([id,item])=>item && typeof item.name==='string'?[{...item,id}]:[]);
}
export async function updatePCInventory(token, action, reference, combatTurn = null) {
  if (!isGM && ['add', 'edit'].includes(action.type)) throw new Error('Only the GM can add or edit items.');
  const floor = globalThis.document?.getElementById('floor');
  if (action.type === 'equip' && floor?.initiativeActive && !combatTurn) {
    entityPath(token);
    const requestId = crypto.randomUUID();
    await new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer);
        floor.removeEventListener('session-equipment-result', received);
        if (error) reject(new Error(error)); else resolve();
      };
      const received = event => {
        if (event.detail.requestId === requestId) finish(event.detail.error);
      };
      const timer = setTimeout(() => finish('Equipment response timed out; check the bag before retrying.'), 25000);
      floor.addEventListener('session-equipment-result', received);
      floor.dispatchEvent(new CustomEvent('session-action', { detail: {
        type: 'equip', requestId, tokenId: token.id, turnId: floor.tabletopMap?.initiative?.turn?.id,
        slot: action.slot, key: action.key
      } }));
    });
    return readPC(token);
  }
  if (action.type === 'transfer') action = { ...action, targetKey: crypto.randomUUID() };
  const sourcePath = entityPath(token), id = token.npcId.slice(3);
  const path = action.type === 'transfer' ? 'v2/worlds/gaia/entities' : sourcePath;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`${base}/${path}.json`, { headers: { 'X-Firebase-ETag': 'true' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
    const etag = response.headers.get('ETag');
    if (!etag) throw new Error('Firebase did not return a version; no changes saved.');
    const value = decodeTree(await response.json());
    const entities = action.type === 'transfer' ? value || {} : { [id]: value };
    let cost;
    if (combatTurn) {
      if (floor?.tabletopMap !== combatTurn.map || !floor.initiativeActive || combatTurn.map.initiative?.turn?.id !== combatTurn.turnId) throw new Error('Map or turn changed; try again.');
      cost = equipmentTurnCost(combatTurn.map, token.id, entities[id]?.data || {}, action);
    }
    changeInventory(entities, id, action, reference);
    if(['add','coin','transfer'].includes(action.type)) ensureCanCarry(entities[action.type==='transfer'?action.to:id].data,reference);
    // Transfer both bags together; reject concurrent equipment or inventory changes.
    const saved = await fetch(`${base}/${path}.json`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': etag },
      body: JSON.stringify(encodeTree(action.type === 'transfer' ? entities : entities[id])), signal: AbortSignal.timeout(15000)
    });
    if (saved.status === 412) continue;
    if (!saved.ok) throw new Error(`Firebase returned ${saved.status}`);
    if (cost) {
      const turn = combatTurn.map.initiative?.turn;
      if (turn?.id !== combatTurn.turnId) throw new Error('Equipment saved, but the turn changed; ask the GM to adjust action use.');
      if (cost.item) turn.item = true;
      if (cost.action) turn.action = true;
    }
    return entities[id].data;
  }
  throw new Error('Inventory changed elsewhere. Try again.');
}
export async function addPCInventoryItem(token, item, qty, key) {
  if (!isGM) throw new Error('Only the GM can add items.');
  if (typeof item?.name !== 'string' || !item.name.trim()) throw new Error('Choose an SRD item.');
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > 9999) throw new Error('Quantity must be 1–9999.');
  if (typeof key !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(key)) throw new Error('Invalid inventory key.');
  if (item.weight != null && (typeof item.weight !== 'number' || !Number.isFinite(item.weight) || item.weight < 0 || item.weight > 999999)) throw new Error('Weight must be 0–999999 lb.');
  await readPC(token);
  const entry = { name: item.name, qty, category: item.equipment_category?.name || item.gear_category?.name || '',
    ...(item.weight != null ? { weight: item.weight } : {}),
    ...(item.armor_class ? { armor_class: item.armor_class, armor_category: item.armor_category } : {}),
    desc: [...(item.desc || []), ...(item.special || [])].join('\n\n') };
  return updatePCSheet(token, pc => {
    if(Object.hasOwn(pc.inventory || {},key)) {
      if(JSON.stringify(pc.inventory[key])!==JSON.stringify(entry)) throw new Error('Inventory key conflict.');
      return;
    }
    pc.inventory={...pc.inventory,[key]:entry};
    ensureCanCarry(pc,{[item.name.toLowerCase()]:item});
  });
}
export async function takeChestItems(token, chest, itemId, props, requestId, reference = {}) {
  if (!isGM) throw new Error('Compartment transfers must go through the GM session.');
  entityPath(token);
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(requestId)) throw new Error('Invalid transfer request.');
  const floor = document.getElementById('floor'), url = `${base}/v2/worlds/gaia.json`, keys = Object.create(null);
  const currentMap = () => floor.tabletopMap?.props === props && props.includes(chest) && chest.open && !chest.locked;
  let sceneId;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!currentMap()) throw new Error('Map changed; reopen the compartment.');
    const response = await fetch(url, { headers: { 'X-Firebase-ETag': 'true' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
    const world = await response.json(), etag = response.headers.get('ETag');
    if (!etag) throw new Error('Firebase did not return a version; no items taken.');
    if (!currentMap()) throw new Error('Map changed; reopen the compartment.');
    const live = world?.vtt?.live;
    if (!live?.sceneId || sceneId && live.sceneId !== sceneId) throw new Error('Shared scene changed; reopen the compartment.');
    sceneId = live.sceneId;
    const shared = live.map?.props?.find(prop => prop.id === chest.id);
    if (!shared || !hasCompartment(shared) || shared.hidden || shared.locked || !shared.open) throw new Error('Compartment is unavailable or not yet synced.');
    const receipt = world.vtt.loot?.[requestId];
    if (receipt) {
      if (receipt.pc !== token.npcId || receipt.chestId !== chest.id) throw new Error('Transfer request conflict.');
      return shared.contents || [];
    }
    const sharedToken = live.map.tokens?.find(entry => entry.id === token.id && entry.npcId === token.npcId && entry.kind === 'pc');
    if (!sharedToken || ![shared.x, shared.y, sharedToken.x, sharedToken.y, sharedToken.size].every(Number.isFinite) || sharedToken.size <= 0 ||
        Math.hypot(shared.x - sharedToken.x, shared.y - sharedToken.y) > sharedToken.size / 2 + 1) throw new Error('Move the selected PC next to the compartment.');
    const entityId = encodeKey(token.npcId.slice(3));
    const entity = Object.hasOwn(world.entities || {}, entityId) ? decodeTree(world.entities[entityId]) : null;
    if (entity?.kind !== 'pc' || !entity.data || entity.data._sheetsDeleted) throw new Error('PC unavailable.');
    for (const item of shared.contents || []) keys[item.id] ||= crypto.randomUUID();
    takeCompartmentItems(entity.data, shared, itemId, keys);
    ensureCanCarry(entity.data,reference);
    world.entities[entityId] = encodeTree(entity);
    world.vtt.loot = { ...world.vtt.loot, [requestId]: { pc: token.npcId, chestId: chest.id } };
    if (!currentMap()) throw new Error('Map changed; reopen the compartment.');
    // The common world ETag keeps the compartment, bag, and retry receipt atomic.
    const saved = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': etag },
      body: JSON.stringify(world), signal: AbortSignal.timeout(15000) });
    if (saved.status === 412) continue;
    if (!saved.ok) throw new Error(`Firebase returned ${saved.status}`);
    return shared.contents;
  }
  throw new Error('Inventory changed elsewhere; reopen the compartment.');
}
