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
