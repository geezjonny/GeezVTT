import { objectColors, visualEffects } from './object-appearance.js';

export const PROPS = {
  crystalObelisk: {name:'Crystal obelisk',width:1,depth:1,color:'#aa83f5',path:'M12 1l6 6v13l-6 3-6-3V7Z M12 1v22M6 7l6 4 6-4M3 20v3h18v-3'},
  tree: {"name":"Tree","width":2,"depth":2,"color":"#648448","path":"M12 2C5 0 1 6 4 10c-5 5 0 12 6 10 5 5 14-1 10-6 5-6-1-14-8-12Z M12 7v15"},
  pine: {"name":"Pine tree","width":1.6,"depth":1.6,"color":"#486239","path":"m12 1-7 8h3l-5 6h4l-5 6h20l-5-6h4l-5-6h3Z"},
  bush: {"name":"Bush","width":1,"depth":0.9,"color":"#648448","path":"M4 19C-2 14 2 7 7 8c0-8 11-8 12 0 7 0 6 12-1 12Z"},
  stump: {"name":"Tree stump","width":0.8,"depth":0.8,"color":"#a97848","path":"M5 7c0-6 14-6 14 0v11l3 3-7-1-3 2-4-2-6 1 3-4Z M5 7c0 5 14 5 14 0"},
  log: {"name":"Fallen log","width":1.8,"depth":0.55,"color":"#90613c","path":"M4 5h16c4 0 4 14 0 14H4c-4 0-4-14 0-14Z M4 5c4 0 4 14 0 14 M8 9h12M8 15h11"},
  rock: {"name":"Rock","width":0.7,"depth":0.6,"color":"#939087","path":"m3 8 8-5 9 4 2 10-9 5-11-6Z M3 8l8 5 9-6m-9 6 2 9"},
  boulder: {"name":"Boulder","width":1.6,"depth":1.3,"color":"#777875","path":"m2 9 5-7 12 2 4 10-6 8-12-3Z M7 2l3 9 9-7m-9 7 7 11"},
  rubble: {"name":"Rubble pile","width":1.5,"depth":1.2,"color":"#9ca3af","path":"m2 15 5-5 5 5-3 6H3Zm9-10 6-3 5 6-5 5-6-2Zm3 11 5-3 4 5-2 4h-7Z"},
  barrel: {"name":"Barrel","width":0.75,"depth":0.75,"color":"#a97848","path":"M6 3q6-3 12 0 6 9 0 18-6 3-12 0-6-9 0-18Z M4 7h16M4 17h16M9 3v18M15 3v18"},
  sack: {"name":"Sack","width":0.7,"depth":0.65,"color":"#c1a578","path":"m8 2 4 2 5-2-2 6c10 10 6 15-3 15S-1 18 9 8Z M8 8h8"},
  cart: {"name":"Cart","width":1.4,"depth":2.6,"color":"#90613c","path":"M5 3h14v13H5Z M8 3v13M12 3v13M16 3v13M2 6v8M22 6v8M7 16v7M17 16v7M2 10h3m14 0h3"},
  tent: {"name":"Tent","width":2,"depth":2,"color":"#c1a578","path":"m12 2 10 19H2Z M12 2v19m0-10-6 10m6-10 6 10"},
  campfire: {"name":"Campfire","width":1,"depth":1,"color":"#ffb34d","path":"m3 18 18 4M3 22l18-4 M8 15C2 10 12 7 10 2c11 7 13 17 3 16-3 0-5-1-5-3Z","light":{"range":4,"color":"#ffb34d"}},
  candle: {"name":"Candle","width":0.3,"depth":0.3,"color":"#ffe6bf","path":"M8 11h8v11H8Z M12 10C4 9 12 2 12 1c0 3 8 8 0 9Z","light":{"range":2,"color":"#ffe6bf"}},
  fairyLights: {"name":"Fairy lights","width":2,"depth":0.4,"color":"#ffe6bf","path":"M1 6q11 16 22 0M4 10v6m5-2v6m6-6v6m5-10v6 M2 16h4m1 4h4m2 0h4m1-4h4","light":{"range":3,"color":"#ffe6bf"}},
  fireflies: {"name":"Fireflies","width":1.3,"depth":1.3,"color":"#c8eb72","path":"M5 3v4M3 5h4M17 6v4m-2-2h4M10 13v4m-2-2h4M19 18v4m-2-2h4","light":{"range":2,"color":"#c8eb72"}},
  signpost: {"name":"Signpost","width":1,"depth":0.35,"color":"#a97848","path":"M11 2v20h2V2 M3 4h15l4 4-4 4H3Z"},
  gravestone: {"name":"Gravestone","width":0.8,"depth":0.35,"color":"#9ca3af","path":"M5 22V8a7 7 0 0 1 14 0v14Z M9 9h6m-3-3v9M8 18h8"},
  crate: { name: 'Crate', width: .9, depth: .9, color: '#a97848', path: 'M3 3h18v18H3Z M3 8h18M3 16h18M8 3v18M16 3v18M4 4l16 16M20 4 4 20' },
  tripwire: { name: 'Tripwire', width: 1, depth: .12, color: '#c4c9cf', path: 'M2 6v12M22 6v12M2 12h20' },
  pressurePlate: { name: 'Pressure plate', width: 1, depth: 1, color: '#a9adb3', path: 'M2 2h20v20H2Z M5 5h14v14H5Z M9 12h6m-3-3v6' },
  lever: { name: 'Lever', width: .6, depth: .6, color: '#c19a64', path: 'M3 18h18v4H3Z M10 18 16 6M13 3l7 3-2 5-7-3Z' },
  button: { name: 'Button', width: .5, depth: .5, color: '#d66d59', path: 'M2 2h20v20H2Z M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0' },
  stairs: { name: 'Stairs', width: 1, depth: 2, color: '#a9adb3', path: 'M3 2h18v20H3Z M3 6h18M3 10h18M3 14h18M3 18h18M12 19V4m-3 3 3-3 3 3' },
  ladder: { name: 'Ladder', width: .65, depth: .8, color: '#bb8b55', path: 'M5 2v20M19 2v20M5 5h14M5 10h14M5 15h14M5 20h14' },
  chest: { name: 'Chest', width: 1, depth: .65, color: '#b58347', path: 'M2 7q0-4 4-4h12q4 0 4 4v14H2Z M2 9h20M6 3v18M18 3v18M10 8h4v6h-4Z' },
  bones: { name: 'Bones', width: .9, depth: .8, color: '#e3d8b7', path: 'M5 8Q1 8 3 4q2-3 4 0l10 12q4-1 4 2 0 4-4 2L5 8 M19 8q4 0 2-4-2-3-4 0L7 16q-4-1-4 2 0 4 4 2L19 8 M9 4q0-3 3-3t3 3v4H9Z' },
  torch: { name: 'Torch', light: { range: 4, color: '#ffb34d' }, width: .4, depth: .65, color: '#ffb34d', path: 'M10 12h4l-1 10h-2Z M7 10C3 6 12 5 11 1c8 5 9 8 5 11Q11 15 7 10Z M8 13h8' },
  brazier: { name: 'Brazier', light: { range: 4, color: '#ffb34d' }, width: .8, depth: .8, color: '#f5a34e', path: 'M3 12h18l-3 7H6Z M7 19l-2 3M17 19l2 3M12 19v4 M7 11C4 7 12 5 10 1c7 4 2 6 7 5q5 4-1 6' },
  table: { name: 'Table', width: 1.6, depth: .9, color: '#ac7d50', path: 'M2 3h20v18H2Z M7 3v18M12 3v18M17 3v18 M3 4h2v2H3ZM19 4h2v2h-2ZM3 18h2v2H3ZM19 18h2v2h-2Z' },
  chair: { name: 'Chair', width: .65, depth: .7, color: '#b58a5a', path: 'M4 3h16v5H4Z M5 8v13M19 8v13M5 11h14v9H5Z M9 3v5M15 3v5' },
  cobweb: { name: 'Cobweb', width: 1.2, depth: 1.2, color: '#d6d9db', path: 'M2 2l20 20M12 2v20M2 12h20M22 2 2 22 M5 5q7 3 14 0-3 7 0 14-7-3-14 0 3-7 0-14Z M8 8q4 2 8 0-2 4 0 8-4-2-8 0 2-4 0-8Z' }
};

export const PROP_CATEGORIES = {
  'Nature': ['tree','pine','bush','stump','log'],
  'Rocks & Rubble': ['rock','boulder','rubble'],
  'Furniture': ['table','chair'],
  'Storage & Supplies': ['crate','chest','barrel','sack'],
  'Travel & Camp': ['cart','tent','stairs','ladder'],
  'Lights & Fire': ['campfire','brazier','torch','candle','fairyLights','fireflies'],
  'Decor & Landmarks': ['signpost','gravestone','crystalObelisk'],
  'Dungeon & Ruins': ['bones','cobweb','tripwire','pressurePlate','lever','button']
};

export function propAppearance(object) {
  const kind = typeof object.icon === 'string' && object.icon.startsWith('prop:') ? object.icon.slice(5) : '';
  return Object.hasOwn(PROPS, kind) ? { x: object.x, y: object.y, kind, size: object.size || 1, rotation: 0 } : null;
}

export function propProperties(kind, size = 1, rotation = 0) {
  if (!Object.hasOwn(PROPS, kind)) throw new Error('Choose a prop from the palette.');
  if (!Number.isFinite(size) || size < .25 || size > 20) throw new Error('Prop size must be between 0.25 and 20.');
  if (!Number.isFinite(rotation)) throw new Error('Enter a rotation in degrees.');
  return { kind, size: kind === 'pressurePlate' ? 1 : size, rotation: ((rotation % 360) + 360) % 360 };
}

export function importedProps(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  return value.flatMap(prop => {
    try {
      if (!prop || !Number.isFinite(prop.x) || !Number.isFinite(prop.y)) return [];
      const properties = propProperties(prop.kind, prop.size, prop.rotation);
      const id = typeof prop.id === 'string' && prop.id ? prop.id : crypto.randomUUID();
      if (ids.has(id)) return [];
      ids.add(id);
      if (prop.kind === 'tripwire' && prop.length != null && (!Number.isFinite(prop.length) || prop.length < .01 || prop.length > 10000)) return [];
      return [{ id, x: prop.x, y: prop.y, ...properties,...(prop.colors!==undefined?{colors:objectColors(prop.colors)}:{}),...(prop.visualEffects!==undefined?{visualEffects:visualEffects(prop.visualEffects)}:{}), ...(typeof prop.name==='string'?{name:prop.name.slice(0,100)}:{}), ...(prop.kind === 'tripwire' ? { length: prop.length ?? 1 } : {}), hidden: prop.hidden === true, locked: prop.locked === true, open: prop.locked !== true && prop.open === true, contents: importedItems(prop.contents), ...(propAppearance(prop)?{icon:prop.icon}:{}) }];
    } catch { return []; }
  });
}

export function propCorners(prop) {
  const { width, depth } = propDimensions(prop), angle = prop.rotation * Math.PI / 180;
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y]) => {
    x *= width * prop.size / 2; y *= depth * prop.size / 2;
    return { x: prop.x + x * Math.cos(angle) - y * Math.sin(angle), y: prop.y + x * Math.sin(angle) + y * Math.cos(angle) };
  });
}

export function propDistance(prop, point) {
  const angle = -prop.rotation * Math.PI / 180, dx = point.x - prop.x, dy = point.y - prop.y;
  const { width, depth } = propDimensions(prop);
  return Math.hypot(Math.max(0, Math.abs(dx * Math.cos(angle) - dy * Math.sin(angle)) - width * prop.size / 2),
    Math.max(0, Math.abs(dx * Math.sin(angle) + dy * Math.cos(angle)) - depth * prop.size / 2));
}

export function propDimensions(prop) {
  return prop.kind === 'tripwire' ? { width: prop.length ?? 1, depth: .12 } : PROPS[prop.kind];
}

export const hasCompartment = prop => !!prop && (['chest','crate','barrel','sack','cart'].includes(prop.kind) || Array.isArray(prop.contents) && prop.contents.length > 0);

export function importedItems(value) {
  if(!Array.isArray(value)) return [];
  const ids=new Set();
  return value.flatMap(item=>{
    if(!item || typeof item.id!=='string' || !item.id || item.id.length>100 || /[.#$\[\]\/]/.test(item.id) || ids.has(item.id) || typeof item.name!=='string' || !item.name.trim() || item.name.length>100) return [];
    if (item.qty != null && (!Number.isSafeInteger(item.qty) || item.qty < 0 || item.qty > 9999)) return [];
    if (item.weight != null && (typeof item.weight !== 'number' || !Number.isFinite(item.weight) || item.weight < 0 || item.weight > 999999)) return [];
    if (item.coin != null && !['cp', 'sp', 'ep', 'gp', 'pp'].includes(item.coin)) return [];
    ids.add(item.id); return [{...item,id:item.id,name:item.name.trim()}];
  });
}
