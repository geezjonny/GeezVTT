import { EQUIPMENT_SLOTS, equippedName, fitsEquipment } from './inventory-model.js';
import { ITEM_STATS, ITEM_SKILLS } from './item-modifiers.js';

export function equippedModifiers(pc, reference = {}) {
  const items = Object.values(pc.inventory || {}).filter(item => item && typeof item.name === 'string' && Number(item.qty ?? 1) > 0);
  const equipped = new Set();
  for (const slot of Object.keys(EQUIPMENT_SLOTS)) {
    const name = equippedName(pc, slot).toLowerCase();
    const item = items.find(item => name && item.name.toLowerCase() === name) ||
      (slot === 'shield' && pc.equipped?.shield === true && !pc.equipped.shield_name ? items.find(item => fitsEquipment('shield', item, reference)) : null);
    if (item) equipped.add(item);
  }
  const result = { ac: 0, stats: {}, skills: {} };
  const bonus = value => Number.isSafeInteger(value) && Math.abs(value) <= 999 ? value : 0;
  for (const item of equipped) {
    result.ac += bonus(item.modifiers?.ac);
    for (const [group, keys] of [['stats', ITEM_STATS], ['skills', ITEM_SKILLS]]) {
      for (const key of keys) result[group][key] = (result[group][key] || 0) + bonus(item.modifiers?.[group]?.[key]);
    }
  }
  return result;
}

export function equippedAC(pc) {
  const base = pc.combat?.ac ?? pc.combat?.armor_class ?? pc.ac;
  return base == null || base === '' ? base : Number(base) + equippedModifiers(pc).ac;
}
