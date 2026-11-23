import { changeInventory } from './inventory-model.js';
const base=window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/,'');
const entityPath=token=>{
  if(!token?.npcId?.startsWith('v2:')) throw new Error('Select a linked PC.');
  return `v2/worlds/gaia/entities/${encodeURIComponent(token.npcId.slice(3))}`;
};
export async function readPC(token) {
  const response=await fetch(`${base}/${entityPath(token)}.json`,{signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error(`Firebase returned ${response.status}`);
  const entity=await response.json();
  if(entity?.kind!=='pc' || !entity.data || entity.data._sheetsDeleted) throw new Error('PC unavailable.');
  return entity.data;
}
export function pcInventory(pc) {
  return Object.entries(pc.inventory || {}).flatMap(([id,item])=>item && typeof item.name==='string'?[{...item,id}]:[]);
}
export async function updatePCInventory(token, action, reference) {
  if (action.type === 'transfer') action = { ...action, targetKey: crypto.randomUUID() };
  const sourcePath = entityPath(token), id = token.npcId.slice(3);
  const path = action.type === 'transfer' ? 'v2/worlds/gaia/entities' : sourcePath;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`${base}/${path}.json`, { headers: { 'X-Firebase-ETag': 'true' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
    const etag = response.headers.get('ETag');
    if (!etag) throw new Error('Firebase did not return a version; no changes saved.');
    const value = await response.json();
    const entities = action.type === 'transfer' ? value || {} : { [id]: value };
    changeInventory(entities, id, action, reference);
    // Transfer both bags together; reject concurrent equipment or inventory changes.
    const saved = await fetch(`${base}/${path}.json`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': etag },
      body: JSON.stringify(action.type === 'transfer' ? entities : entities[id]), signal: AbortSignal.timeout(15000)
    });
    if (saved.status === 412) continue;
    if (!saved.ok) throw new Error(`Firebase returned ${saved.status}`);
    return;
  }
  throw new Error('Inventory changed elsewhere. Try again.');
}
export async function addPCInventoryItem(token, item, qty, key) {
  if (typeof item?.name !== 'string' || !item.name.trim()) throw new Error('Choose an SRD item.');
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > 9999) throw new Error('Quantity must be 1–9999.');
  if (typeof key !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(key)) throw new Error('Invalid inventory key.');
  await readPC(token);
  const entry = { name: item.name, qty, category: item.equipment_category?.name || item.gear_category?.name || '',
    desc: [...(item.desc || []), ...(item.special || [])].join('\n\n') };
  // A new stable key preserves existing bag items and makes a failed request safe to retry.
  const response = await fetch(`${base}/${entityPath(token)}/data/inventory/${key}.json`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry), signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
}
export async function takeChestItem(token,chest,item,props) {
  const receiptPath=`v2/worlds/gaia/vtt/loot/${encodeURIComponent(item.id)}`;
  const receipt=await fetch(`${base}/${receiptPath}.json`,{signal:AbortSignal.timeout(15000)});
  if(!receipt.ok) throw new Error(`Firebase returned ${receipt.status}`);
  if(await receipt.json()) return;
  await readPC(token);
  if(document.getElementById('floor').tabletopMap?.props!==props) throw new Error('Map changed; reopen the chest.');
  const patch={};
  patch[receiptPath]={pc:token.npcId,name:item.name};
  patch[`${entityPath(token)}/data/inventory/${encodeURIComponent(item.id)}`]={name:item.name,qty:1};
  patch[`v2/worlds/gaia/vtt/live/map/props/${props.indexOf(chest)}/contents`]=chest.contents.filter(entry=>entry.id!==item.id);
  // Write loot removal and inventory addition together, with a stable key for retries.
  const response=await fetch(`${base}/.json`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch),signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new Error(`Firebase returned ${response.status}`);
}
