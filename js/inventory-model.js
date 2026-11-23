export const EQUIPMENT_SLOTS = { helmet: 'Helmet', armor: 'Armor', shield: 'Shield', main_hand: 'Weapon' };
const norm = value => String(value || '').trim().toLowerCase();
export function fitsEquipment(slot, item, reference = {}) {
  const data = reference[norm(item.name)] || {}, category = norm(item.category || data.equipment_category?.name);
  const shield = data.armor_category === 'Shield' || /\bshield\b/i.test(item.name);
  if (slot === 'helmet') return /\b(helm|helmet|hat|cap|crown|circlet|hood|mask|headband|coif|diadem)\b/i.test(item.name) && !data.weapon_category;
  if (slot === 'shield') return shield;
  if (slot === 'armor') return !shield && (!!data.armor_category || category === 'armor' || /\b(armor|mail|leather|plate|breastplate|padded|hide)\b/i.test(item.name));
  // shortcut: custom gear uses names/categories; add explicit slot tags if ambiguous gear needs overrides.
  if (slot === 'main_hand') return !!data.weapon_category || /weapons?/.test(category) || /\b(sword|longsword|shortsword|rapier|dagger|axe|greataxe|handaxe|battleaxe|bow|longbow|shortbow|crossbow|spear|pike|glaive|halberd|mace|maul|club|hammer|warhammer|flail|whip|trident|quarterstaff|scimitar|sickle|lance|javelin|dart|sling)\b/i.test(item.name);
  return false;
}
export function equippedName(pc, slot) {
  const eq = pc.equipped || {};
  return slot === 'shield' && eq.shield === true ? eq.shield_name || 'Shield' : eq[slot] || (slot === 'main_hand' ? eq.weapon : '') || '';
}
export function itemEquipped(pc, item, reference = {}) {
  return Object.keys(EQUIPMENT_SLOTS).some(slot => {
    if (slot === 'shield' && pc.equipped?.shield === true && !pc.equipped.shield_name) return fitsEquipment('shield', item, reference);
    return norm(equippedName(pc, slot)) === norm(item.name);
  });
}
export function changeInventory(entities, sourceId, action, reference = {}) {
  const entity = Object.hasOwn(entities, sourceId) ? entities[sourceId] : null;
  if (entity?.kind !== 'pc' || !entity.data || entity.data._sheetsDeleted) throw new Error('PC unavailable.');
  const pc = entity.data;
  if (action.type === 'equip') {
    if (!Object.hasOwn(EQUIPMENT_SLOTS, action.slot)) throw new Error('Invalid equipment slot.');
    const item = action.key && Object.hasOwn(pc.inventory || {}, action.key) ? pc.inventory[action.key] : null;
    if (action.key && (!item || Number(item.qty ?? 1) <= 0 || !fitsEquipment(action.slot, item, reference))) throw new Error('Choose an appropriate item from the bag.');
    pc.equipped ||= {};
    pc.equipped[action.slot] = action.slot === 'shield' ? !!item : item?.name || null;
    if (action.slot === 'shield') pc.equipped.shield_name = item?.name || null;
    if (action.slot === 'main_hand') delete pc.equipped.weapon;
    return;
  }
  const item = Object.hasOwn(pc.inventory || {}, action.key) ? pc.inventory[action.key] : null;
  if (!item || typeof item.name !== 'string') throw new Error('Item is no longer in this bag.');
  if (action.type === 'add') {
    const qty = Number(item.qty ?? 1);
    if (!Number.isSafeInteger(qty) || qty < 0 || qty >= 9999) throw new Error('Quantity must stay within 0–9999.');
    item.qty = qty + 1;
    return;
  }
  if (!['remove', 'transfer'].includes(action.type)) throw new Error('Invalid bag action.');
  if (itemEquipped(pc, item, reference)) throw new Error('Unequip this item before removing or transferring it.');
  if (action.type === 'transfer') {
    if (action.to === sourceId) throw new Error('Choose another PC.');
    const target = Object.hasOwn(entities, action.to) ? entities[action.to] : null;
    if (target?.kind !== 'pc' || !target.data || target.data._sheetsDeleted) throw new Error('Recipient PC unavailable.');
    // Keyed objects preserve sparse array inventories and existing recipient items.
    if (typeof action.targetKey !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(action.targetKey)) throw new Error('Invalid transfer key.');
    target.data.inventory = { ...target.data.inventory };
    if (Object.hasOwn(target.data.inventory, action.targetKey)) throw new Error('Recipient already has this item key.');
    target.data.inventory[action.targetKey] = item;
  }
  delete pc.inventory[action.key];
}
