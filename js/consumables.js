import { segments, crosses } from './map-editor-model.js';
import { itemEquipped } from './inventory-model.js';
import { carryingLoad, itemWeight } from './inventory-weight.js';
import { characterStats } from './equipment-modifiers.js';
import { buildExpressionRoll } from './dice-roll.js';
import { applyTrapDamage } from './trigger-model.js';
import { changeEffects } from './effects-model.js';

export const rulesEdition = pc => String(pc.rules_edition ?? pc.edition ?? '2024') === '2014' ? '2014' : '2024';
export function consumableDefinition(item, reference = {}) {
  if (!item) return null;
  if (item.consumable?.kind === 'healing' || item.consumable?.kind === 'damage') return { ...item.consumable, label: item.name };
  const name = item.name.trim().toLowerCase().replace(/^potion of healing \((greater|superior|supreme)\)$/, 'potion of $1 healing');
  const healing = { 'potion of healing': '2d4+2', 'potion of greater healing': '4d4+4', 'potion of superior healing': '8d4+8', 'potion of supreme healing': '10d4+20' };
  if (healing[name]) return { kind: 'healing', dice: healing[name], label: item.name, healingPotion: true };
  if(name==='potion of poison') return {kind:'damage',dice:'3d6',label:item.name,poisonPotion:true};
  if (!name.startsWith('potion of ')) return null;
  const strength = { 'hill giant': 21, 'stone giant': 23, 'frost giant': 23, 'fire giant': 25, 'cloud giant': 27, 'storm giant': 29 };
  const giant = Object.entries(strength).find(([giant]) => name === `potion of ${giant} strength`);
  const modifiers = giant ? [{ target: 'str', operation: 'set', value: giant[1] }] : name === 'potion of speed' ? [{ target: 'speed', operation: 'multiply', value: 2 }, { target: 'ac', operation: 'add', value: 2 }] : [];
  const resistance = /^potion of (acid|cold|fire|force|lightning|necrotic|poison|psychic|radiant|thunder) resistance$/.exec(name)?.[1];
  const durations = { 'potion of animal friendship': 60, 'potion of clairvoyance': 10, 'potion of diminution': 240, 'potion of climbing': 60, 'potion of flying': 60, 'potion of gaseous form': 60, 'potion of growth': 240, 'potion of heroism': 60, 'potion of invisibility': 60, 'potion of mind reading': 10, 'potion of resistance': 60, 'potion of invulnerability': 1, 'potion of speed': 1, 'potion of water breathing': 1440 };
  const minutes = giant || resistance ? 60 : durations[name];
  if (!minutes) return null;
  const description = item.desc || reference[name]?.desc || '';
  return { kind: 'effect', label: item.name, modifiers, duration_minutes: minutes, description,
    ...(name === 'potion of flying' ? { fly: 60 } : {}), ...(name === 'potion of climbing' ? { climb: true } : {}),
    ...(name === 'potion of invisibility' ? { invisible: true } : {}), ...(name === 'potion of heroism' ? { tempHP: 10, bless: true } : {}),
    ...(name === 'potion of growth' ? { growth: true } : {}), ...(name === 'potion of water breathing' ? { waterBreathing: true } : {}),
    ...(resistance || name === 'potion of resistance' ? { resistance: resistance || item.resistance || null } : {}),
    ...(name === 'potion of invulnerability' ? { resistance: 'all' } : {}) };
}
export function consumableCost(pc, definition) {
  return rulesEdition(pc) === '2024' && (definition.healingPotion || /^potion of /i.test(definition.label)) ? 'bonus' : 'action';
}
export function applyConsumableEffect(source, target, action, reference = {}, result = {}) {
  const item = source.inventory?.[action.key];
  if (!item || !Number.isSafeInteger(item.qty ?? 1) || (item.qty ?? 1) < 1) throw new Error('No items remaining.');
  if (itemEquipped(source, item, reference)) throw new Error('Unequip the item before using it.');
  if (action.id) {
    changeEffects(source, { type: 'activate', id: action.id, inventoryKey: action.key, targetEffectId: `effects:${action.effectKey}` }, target);
    return { label: item.name };
  }
  const definition = consumableDefinition(item, reference);
  if (!definition) throw new Error('This item has no automatic use effect.');
  if(definition.poisonPotion && rulesEdition(source)==='2024') definition.dice='4d6';
  if (definition.kind === 'healing' || definition.kind === 'damage') {
    const roll = result.roll ||= buildExpressionRoll(definition.dice);
    if (!Number.isSafeInteger(roll.total) || roll.total < 0) throw new Error('Consumable amount must be nonnegative.');
    if (definition.kind === 'damage') applyTrapDamage(target, roll.total);
    else {
      const max = characterStats(target, reference).hpMax, hp = Number(target.combat?.hp_current ?? 0);
      if (!Number.isSafeInteger(hp) || hp < 0 || !Number.isFinite(max)) throw new Error('Target HP unavailable.');
      target.combat ||= {}; target.combat.hp_current = Math.max(hp,Math.min(max, hp + roll.total));
    }
    item.qty = (item.qty ?? 1) - 1;
    return { label: `${definition.label}: ${roll.label} = ${roll.total}${definition.poisonPotion ? '; DC 13 CON save' : ''}` };
  }
  if (definition.label.toLowerCase()==='potion of growth') definition.duration_minutes = rulesEdition(source)==='2024' ? 10 : (result.duration ||= buildExpressionRoll('1d4').total * 60);
  if (definition.label.toLowerCase()==='potion of diminution') definition.duration_minutes = result.duration ||= buildExpressionRoll('1d4').total * 60;
  if (definition.label.toLowerCase()==='potion of resistance' && !definition.resistance) definition.resistance = result.resistance ||= ['acid','cold','fire','force','lightning','necrotic','poison','psychic','radiant','thunder'][buildExpressionRoll('1d10').total-1];
  if (definition.modifiers.some(mod => mod.target==='str' && mod.operation==='set' && characterStats(target,reference).stats.str >= mod.value)) definition.modifiers=[];
  const id = `effects:${action.effectKey}`;
  const existing = Object.entries(target.effects || {}).find(([, effect]) => effect?.label === definition.label && effect.spentConsumable);
  const effectKey = existing?.[0] || action.effectKey;
  target.effects ||= {};
  target.effects[effectKey] = { ...definition, mode: 'activated', consume: false, inventoryKey: '', max: 0, current: 0, recharge: 'none', spentConsumable: true, category: 'Potion' };
  target.activeEffects ||= {};
  target.activeEffects[existing ? `effects:${effectKey}` : id] = { remainingMinutes: definition.duration_minutes };
  if (definition.tempHP) { target.combat ||= {}; target.combat.temp_hp = Math.max(Number(target.combat.temp_hp || 0), definition.tempHP); }
  item.qty = (item.qty ?? 1) - 1;
  return { label: definition.label };
}
export function throwItem(pc, action, source, map, reference = {}) {
  const item = pc.inventory?.[action.key], strength = characterStats(pc, reference).stats.str;
  if (!item || !Number.isSafeInteger(item.qty ?? 1) || (item.qty ?? 1) < 1) throw new Error('No items remaining.');
  if (itemEquipped(pc, item, reference)) throw new Error('Unequip the item before throwing it.');
  const weight = itemWeight(item, reference);
  if (weight === null) throw new Error('Set the item weight before throwing it.');
  // shortcut: D&D leaves maximum throwable weight to the DM; use carrying capacity as the weight limit until the table chooses a throwing-weight rule.
  if (weight > carryingLoad({...pc,inventory:{},coin_purse:{}},strength,reference).capacity) throw new Error('Not strong enough to throw this item.');
  if (![action.x, action.y].every(Number.isFinite) || action.x < 0 || action.y < 0 || action.x > map.width || action.y > map.height) throw new Error('Choose a destination within the map.');
  const barriers=[...(map.walls || []),...(map.doors || []).filter(door=>door.type==='window' || !door.open).map(door=>door.points)].flatMap(wall=>segments(wall.points || wall));
  if(barriers.some(([a,b])=>crosses(source,action,a,b))) throw new Error('A wall or closed door blocks this throw.');
  const range = item.range || reference[item.name.toLowerCase()]?.throw_range || { normal: 20, long: 60 };
  const feet = Math.hypot(action.x - source.x, action.y - source.y) * 5;
  if (feet > Number(range.long ?? 60)) throw new Error(`Throw is beyond ${range.long ?? 60} feet.`);
  const { qty, ...entry } = item;
  item.qty = (item.qty ?? 1) - 1;
  return { id: action.dropId, kind: 'crate', name: item.name, x: action.x, y: action.y, size: .25, rotation: 0, open: true, locked: false, hidden: false,
    contents: [{ ...entry, id: action.effectKey, qty: 1 }] };
}
