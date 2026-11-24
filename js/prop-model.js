export const PROPS = {
  crate: { name: 'Crate', width: .9, depth: .9, color: '#a97848', path: 'M3 3h18v18H3Z M3 8h18M3 16h18M8 3v18M16 3v18M4 4l16 16M20 4 4 20' },
  tripwire: { name: 'Tripwire', width: 1, depth: .12, color: '#c4c9cf', path: 'M2 6v12M22 6v12M2 12h20' },
  pressurePlate: { name: 'Pressure plate', width: 1, depth: 1, color: '#a9adb3', path: 'M2 2h20v20H2Z M5 5h14v14H5Z M9 12h6m-3-3v6' },
  lever: { name: 'Lever', width: .6, depth: .6, color: '#c19a64', path: 'M3 18h18v4H3Z M10 18 16 6M13 3l7 3-2 5-7-3Z' },
  button: { name: 'Button', width: .5, depth: .5, color: '#d66d59', path: 'M2 2h20v20H2Z M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0' },
  stairs: { name: 'Stairs', width: 1, depth: 2, color: '#a9adb3', path: 'M3 2h18v20H3Z M3 6h18M3 10h18M3 14h18M3 18h18M12 19V4m-3 3 3-3 3 3' },
  ladder: { name: 'Ladder', width: .65, depth: .8, color: '#bb8b55', path: 'M5 2v20M19 2v20M5 5h14M5 10h14M5 15h14M5 20h14' },
  chest: { name: 'Chest', width: 1, depth: .65, color: '#b58347', path: 'M2 7q0-4 4-4h12q4 0 4 4v14H2Z M2 9h20M6 3v18M18 3v18M10 8h4v6h-4Z' },
  bones: { name: 'Bones', width: .9, depth: .8, color: '#e3d8b7', path: 'M5 8Q1 8 3 4q2-3 4 0l10 12q4-1 4 2 0 4-4 2L5 8 M19 8q4 0 2-4-2-3-4 0L7 16q-4-1-4 2 0 4 4 2L19 8 M9 4q0-3 3-3t3 3v4H9Z' },
  torch: { name: 'Torch', width: .4, depth: .65, color: '#ffb34d', path: 'M10 12h4l-1 10h-2Z M7 10C3 6 12 5 11 1c8 5 9 8 5 11Q11 15 7 10Z M8 13h8' },
  brazier: { name: 'Brazier', width: .8, depth: .8, color: '#f5a34e', path: 'M3 12h18l-3 7H6Z M7 19l-2 3M17 19l2 3M12 19v4 M7 11C4 7 12 5 10 1c7 4 2 6 7 5q5 4-1 6' },
  table: { name: 'Table', width: 1.6, depth: .9, color: '#ac7d50', path: 'M2 3h20v18H2Z M7 3v18M12 3v18M17 3v18 M3 4h2v2H3ZM19 4h2v2h-2ZM3 18h2v2H3ZM19 18h2v2h-2Z' },
  chair: { name: 'Chair', width: .65, depth: .7, color: '#b58a5a', path: 'M4 3h16v5H4Z M5 8v13M19 8v13M5 11h14v9H5Z M9 3v5M15 3v5' },
  cobweb: { name: 'Cobweb', width: 1.2, depth: 1.2, color: '#d6d9db', path: 'M2 2l20 20M12 2v20M2 12h20M22 2 2 22 M5 5q7 3 14 0-3 7 0 14-7-3-14 0 3-7 0-14Z M8 8q4 2 8 0-2 4 0 8-4-2-8 0 2-4 0-8Z' }
};

export function propAppearance(object) {
  const kind = typeof object.icon === 'string' && object.icon.startsWith('prop:') ? object.icon.slice(5) : '';
  return Object.hasOwn(PROPS, kind) ? { x: object.x, y: object.y, kind, size: object.size || 1, rotation: 0 } : null;
}

export function propProperties(kind, size = 1, rotation = 0) {
  if (!Object.hasOwn(PROPS, kind)) throw new Error('Choose a prop from the palette.');
  if (!Number.isFinite(size) || size < .25 || size > 20) throw new Error('Prop size must be between 0.25 and 20.');
  if (!Number.isFinite(rotation)) throw new Error('Enter a rotation in degrees.');
  return { kind, size, rotation: ((rotation % 360) + 360) % 360 };
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
      return [{ id, x: prop.x, y: prop.y, ...properties, ...(typeof prop.name==='string'?{name:prop.name.slice(0,100)}:{}), ...(prop.kind === 'tripwire' ? { length: prop.length ?? 1 } : {}), hidden: prop.hidden === true, locked: prop.locked === true, open: prop.locked !== true && prop.open === true, contents: importedItems(prop.contents), ...(propAppearance(prop)?{icon:prop.icon}:{}) }];
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

export const hasCompartment = prop => !!prop && (['chest','crate'].includes(prop.kind) || Array.isArray(prop.contents) && prop.contents.length > 0);

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
