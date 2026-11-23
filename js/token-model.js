import { crosses, distance, segments } from './map-editor-model.js';
import { equippedAC } from './equipment-modifiers.js';

export const TOKEN_ICONS = ['Generic', 'Fighter', 'Hunter', 'Druid', 'Wizard', 'Sorcerer', 'Bard', 'Monk', 'Rogue', 'Barbarian', 'Cleric', 'Paladin', 'Ranger', 'Warlock', 'Artificer', 'Lark', 'Liora', 'Ashara', 'Rurik', 'Seris'];
export const TOKEN_SYMBOLS = { lark: '♬', liora: '➹', ashara: '☀', rurik: '🍺', seris: '⚔', fighter: '⚔', hunter: '➶', druid: '❧', wizard: '✦', sorcerer: 'ϟ', bard: '♫', monk: '☯', rogue: '†', barbarian: '⚒', cleric: '✚', paladin: '⛨', ranger: '➹', warlock: '☾', artificer: '⚙' };

export function tokenIcon(value) {
  return TOKEN_ICONS.some(label => label.toLowerCase() === value) ? value : 'generic';
}

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

function pcStats(hpMax, ac) {
  const number = value => value == null || value === '' ? NaN : Number(value);
  hpMax = number(hpMax); ac = number(ac);
  return { kind: 'pc', hpMax: Number.isSafeInteger(hpMax) && hpMax > 0 && hpMax <= 999999 ? hpMax : null,
    ac: Number.isSafeInteger(ac) && ac >= 0 && ac <= 999 ? ac : null };
}

export function pcTokenStatus(token) {
  if (token.kind !== 'pc') return null;
  const fraction = token.hpMax > 0 ? Math.max(0, Math.min(1, token.hp / token.hpMax)) : 0;
  return { fraction, color: fraction > .5 ? '#55c779' : fraction > .25 ? '#efbf50' : '#e26262',
    label: `${token.hp}/${token.hpMax ?? '—'} · AC ${token.ac ?? '—'}` };
}

export function npcCatalog(entities, legacy) {
  const npcs = [], mirrored = new Set();
  const add = (id, name, data, kind) => {
    if (!data || typeof data !== 'object') return;
    const sizes = { tiny: .5, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };
    const rawSize = data.size ?? data.basic?.size;
    const size = sizes[String(rawSize).toLowerCase()] ?? Number(rawSize);
    const hp = Number(data.combat?.hp_current ?? data.combat?.hp_max ?? 0);
    npcs.push({ npcId: id, name: (typeof name === 'string' && name.trim() ? name.trim() : id).slice(0, 100),
      size: Number.isFinite(size) && size >= .5 && size <= 20 && Number.isInteger(size * 2) ? size : 1,
      hp: Number.isSafeInteger(hp) && hp >= 0 && hp <= 999999 ? hp : 0,
      ...(kind === 'pc' ? pcStats(data.combat?.hp_max, equippedAC(data)) : {}) });
  };
  for (const [id, entity] of Object.entries(entities || {})) {
    if (!['npc', 'pc'].includes(entity?.kind)) continue;
    for (const source of [entity.source?.id, ...(Array.isArray(entity.source?.mirrors) ? entity.source.mirrors : [])]) {
      if (typeof source === 'string' && source.startsWith('characters/npcs/')) mirrored.add(source.slice('characters/npcs/'.length));
    }
    if (!entity.data?._sheetsDeleted) add(`v2:${id}`, entity.name, entity.data, entity.kind);
  }
  for (const [id, npc] of Object.entries(legacy || {})) {
    if (!mirrored.has(id) && !npc?._sheetsDeleted) add(`legacy:${id}`, npc?.name, npc);
  }
  return npcs.sort((a, b) => a.name.localeCompare(b.name));
}

export function importedTokens(value, width, height) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  return value.flatMap(token => {
    try {
      const props = tokenProperties(token?.name, token?.size, token?.hp);
      if (!Number.isFinite(token.x) || !Number.isFinite(token.y) || token.x < 0 || token.y < 0 || token.x > width || token.y > height) return [];
      const id = typeof token.id === 'string' && token.id.length > 0 && token.id.length <= 100 && !ids.has(token.id) ? token.id : crypto.randomUUID();
      ids.add(id);
      return [{ id, ...props, x: token.x, y: token.y,
        ...(token.icon !== undefined ? { icon: tokenIcon(token.icon) } : {}),
        ...(Number.isFinite(token.rotation) ? { rotation: ((token.rotation % 360) + 360) % 360 } : {}),
        ...(token.kind === 'pc' ? pcStats(token.hpMax, token.ac) : {}),
        ...(typeof token.npcId === 'string' ? { npcId: token.npcId } : {}) }];
    } catch { return []; }
  });
}
