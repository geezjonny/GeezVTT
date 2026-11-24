export const PROP_COLORS = {leaves:'#486b37',cloth:'#c1a578',wax:'#eee0b4',wood:'#90613c',trim:'#c19a64',metal:'#4c535d',stone:'#888b91',bone:'#dfd3ad',coal:'#29252a',flame:'#ff8a25',core:'#ffe29a',web:'#d6d9db',crystal:'#aa83f5'};
export const COLOR_LABELS = {base:'Color',leaves:'Foliage',wood:'Wood / trunk',trim:'Trim / cut wood',metal:'Metal',stone:'Stone',cloth:'Fabric',wax:'Wax',bone:'Bone',coal:'Dark details',flame:'Flame',core:'Glow',web:'Web',crystal:'Crystal'};
export const OBJECT_EFFECTS = {fairy:'Fairy particles',glow:'Glow',ablaze:'Ablaze'};
export const visualEffects = value => [...new Set((Array.isArray(value)?value:[]).filter(effect=>Object.hasOwn(OBJECT_EFFECTS,effect)))];
export const PROP_COLOR_PARTS = {
  tree:['leaves','wood'],pine:['leaves','wood'],bush:['leaves'],stump:['wood','trim'],log:['wood','trim'],rock:['stone'],boulder:['stone'],rubble:['stone'],
  barrel:['wood','metal','trim'],sack:['cloth','wood'],cart:['wood','trim','metal'],tent:['cloth','wood'],campfire:['wood','flame','core'],candle:['wax','flame','core'],
  fairyLights:['wood','metal','core'],fireflies:['core'],signpost:['wood','trim'],gravestone:['stone','coal'],crystalObelisk:['crystal','stone'],
  crate:['wood','trim'],tripwire:['metal','stone'],pressurePlate:['stone','metal','trim'],lever:['stone','metal','trim'],button:['stone','wood','trim'],
  stairs:['stone','trim'],ladder:['wood','trim'],chest:['wood','trim','metal'],bones:['bone','coal'],torch:['wood','metal','flame','core'],brazier:['metal','coal','flame','core'],
  table:['wood','trim'],chair:['wood','trim'],cobweb:['web']
};
export function objectColors(raw) {
  if(!raw || typeof raw!=='object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([key,value])=>Object.hasOwn(COLOR_LABELS,key) && typeof value==='string' && /^#[0-9a-f]{6}$/i.test(value)));
}
export const objectLightColor = light => objectColors(light?.colors).base || light?.color;
