import { crosses, distance, segments } from './map-editor-model.js';

export function crossesWindow(token, destination, doors) {
  return doors.filter(door => door.type === 'window').some(door => segments(door.points).some(([a, b]) =>
    crosses(token, destination, a, b) || Math.min(distance(token, a, b), distance(destination, a, b),
      distance(a, token, destination), distance(b, token, destination)) < token.size / 2));
}

export function tokenProperties(name, size, hp) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) throw new Error('Enter a name of 1–100 characters.');
  if (!Number.isFinite(size) || size < .5 || size > 20 || !Number.isInteger(size * 2)) throw new Error('Size must be 0.5–20 grid squares, in half-square steps.');
  if (!Number.isSafeInteger(hp) || hp < 0 || hp > 999999) throw new Error('HP must be a whole number from 0 to 999999.');
  return { name: name.trim(), size, hp };
}

export function npcCatalog(entities, legacy) {
  const npcs = [], mirrored = new Set();
  const add = (id, name, data) => {
    if (!data || typeof data !== 'object') return;
    const sizes = { tiny: .5, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };
    const rawSize = data.size ?? data.basic?.size;
    const size = sizes[String(rawSize).toLowerCase()] ?? Number(rawSize);
    const hp = Number(data.combat?.hp_current ?? data.combat?.hp_max ?? 0);
    npcs.push({ npcId: id, name: (typeof name === 'string' && name.trim() ? name.trim() : id).slice(0, 100),
      size: Number.isFinite(size) && size >= .5 && size <= 20 && Number.isInteger(size * 2) ? size : 1,
      hp: Number.isSafeInteger(hp) && hp >= 0 && hp <= 999999 ? hp : 0 });
  };
  for (const [id, entity] of Object.entries(entities || {})) {
    if (entity?.kind !== 'npc') continue;
    for (const source of [entity.source?.id, ...(Array.isArray(entity.source?.mirrors) ? entity.source.mirrors : [])]) {
      if (typeof source === 'string' && source.startsWith('characters/npcs/')) mirrored.add(source.slice('characters/npcs/'.length));
    }
    if (!entity.data?._sheetsDeleted) add(`v2:${id}`, entity.name, entity.data);
  }
  for (const [id, npc] of Object.entries(legacy || {})) {
    if (!mirrored.has(id) && !npc?._sheetsDeleted) add(`legacy:${id}`, npc?.name, npc);
  }
  return npcs.sort((a, b) => a.name.localeCompare(b.name));
}

export function importedTokens(value, width, height) {
  if (!Array.isArray(value)) return [];
  return value.flatMap(token => {
    try {
      const props = tokenProperties(token?.name, token?.size, token?.hp);
      if (!Number.isFinite(token.x) || !Number.isFinite(token.y) || token.x < 0 || token.y < 0 || token.x > width || token.y > height) return [];
      return [{ id: crypto.randomUUID(), ...props, x: token.x, y: token.y,
        ...(typeof token.npcId === 'string' ? { npcId: token.npcId } : {}) }];
    } catch { return []; }
  });
}
