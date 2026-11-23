import { ITEM_STATS, ITEM_SKILLS } from './item-modifiers.js';
import { itemEquipped } from './inventory-model.js';

export const EFFECT_TARGETS = [...ITEM_STATS, 'ac', 'speed', 'hp_max', 'initiative', 'attack_bonus', 'damage_bonus', 'spell_attack', 'spell_dc',
  ...ITEM_STATS.map(key => `save:${key}`), ...ITEM_SKILLS.map(key => `skill:${key}`)];
export const BARK_ARM = {
  label: 'Bark Arm', consume: false, inventoryKey: '', category: 'Ability', mode: 'activated', max: 2, current: 2, recharge: 'daily', duration_minutes: 60,
  modifiers: [{ target: 'ac', operation: 'add', value: 2 }, { target: 'str', operation: 'add', value: 2 },
    { target: 'con', operation: 'add', value: 2 }, { target: 'dex', operation: 'multiply', value: .5 },
    { target: 'speed', operation: 'multiply', value: .5 }]
};
export function effectDefinitions(pc) {
  return ['effects', 'abilities'].flatMap(group => Object.entries(pc[group] || {}).filter(([, value]) => value && typeof value === 'object' && typeof value.label === 'string' && value.label.trim())
    .map(([key, value]) => ({ ...value, id: `${group}:${key}` })));
}
function location(id) {
  const match = typeof id === 'string' && /^(effects|abilities):([^.#$\[\]/]{1,200})$/.exec(id);
  if (!match || ['__proto__', 'constructor', 'prototype'].includes(match[2])) throw new Error('Invalid effect.');
  return match.slice(1);
}
export function validateEffect(value) {
  if (typeof value?.label !== 'string' || !value.label.trim() || value.label.length > 100) throw new Error('Enter an effect name of 1–100 characters.');
  if (!['activated', 'passive', 'equipped'].includes(value.mode)) throw new Error('Choose how this effect is applied.');
  if (!['none', 'daily', 'short_rest', 'long_rest', 'short_or_long_rest'].includes(value.recharge)) throw new Error('Choose a recharge.');
  if (!Number.isSafeInteger(value.max) || value.max < 0 || value.max > 999 || !Number.isSafeInteger(value.duration_minutes) || value.duration_minutes < 0 || value.duration_minutes > 525600) throw new Error('Invalid uses or duration.');
  if (!Array.isArray(value.modifiers) || !value.modifiers.length || value.modifiers.length > 100) throw new Error('Add 1–100 modifiers.');
  const modifiers = value.modifiers.map(modifier => {
    if (!EFFECT_TARGETS.includes(modifier?.target) || !['add', 'multiply', 'set'].includes(modifier.operation) ||
        !Number.isFinite(modifier.value) || modifier.value < (modifier.operation === 'add' ? -999 : 0) ||
        modifier.value > (modifier.operation === 'multiply' ? 10 : 999999)) throw new Error('Invalid modifier target, operation, or value.');
    return { target: modifier.target, operation: modifier.operation, value: modifier.value };
  });
  if (typeof (value.inventoryKey ?? '') !== 'string' || typeof value.consume !== 'boolean') throw new Error('Invalid item source.');
  if ((value.mode === 'equipped' || value.consume) && !value.inventoryKey) throw new Error('Choose the source item.');
  if (value.consume && value.mode !== 'activated') throw new Error('Only activated effects can consume an item.');
  return { label: value.label.trim(), category: String(value.category || 'Ability').slice(0, 50), mode: value.mode,
    max: value.max, recharge: value.recharge, duration_minutes: value.duration_minutes, modifiers,
    inventoryKey: value.inventoryKey || '', consume: value.consume };
}
export function appliedEffects(pc, reference = {}) {
  return effectDefinitions(pc).filter(effect => {
    if (!Array.isArray(effect.modifiers)) return false;
    const item = Object.hasOwn(pc.inventory || {}, effect.inventoryKey) ? pc.inventory[effect.inventoryKey] : null;
    if (effect.mode === 'passive') return true;
    if (effect.mode === 'equipped') return item && Number(item.qty ?? 1) > 0 && itemEquipped(pc, item, reference);
    const active = pc.activeEffects?.[effect.id];
    return active && (active.remainingMinutes === -1 || Number.isFinite(active.remainingMinutes) && active.remainingMinutes > 0);
  });
}
export function applyModifiers(base, target, modifiers) {
  if (base == null || !Number.isFinite(Number(base))) return null;
  const values = modifiers.filter(modifier => modifier.target === target && Number.isFinite(modifier.value));
  const sets = values.filter(modifier => modifier.operation === 'set').map(modifier => modifier.value);
  const start = sets.length ? Math.max(...sets) : Number(base);
  const added = values.filter(modifier => modifier.operation === 'add').reduce((sum, modifier) => sum + modifier.value, 0);
  const factor = values.filter(modifier => modifier.operation === 'multiply').reduce((product, modifier) => product * modifier.value, 1);
  return Math.max(target === 'ac' || target === 'speed' || target === 'hp_max' || ITEM_STATS.includes(target) ? 0 : -999999,
    Math.min(999999, Math.floor((start + added) * factor)));
}
export function changeEffects(pc, action) {
  if (action.type === 'advance') {
    if (!Number.isSafeInteger(action.minutes) || action.minutes < 1 || action.minutes > 525600) throw new Error('Advance 1–525600 game minutes.');
    for (const [id, active] of Object.entries(pc.activeEffects || {})) {
      if (active && Number.isFinite(active.remainingMinutes) && active.remainingMinutes >= 0) {
        active.remainingMinutes -= action.minutes;
        if (active.remainingMinutes <= 0) delete pc.activeEffects[id];
      }
    }
    return;
  }
  if (action.type === 'reset') {
    if (!['daily', 'short_rest', 'long_rest'].includes(action.recharge)) throw new Error('Choose a rest or new day.');
    for (const effect of effectDefinitions(pc)) {
      if (effect.recharge === action.recharge || effect.recharge === 'short_or_long_rest' && action.recharge !== 'daily' || effect.recharge === 'short_rest' && action.recharge === 'long_rest') {
        const [group, key] = location(effect.id);
        if (Number.isSafeInteger(effect.max) && effect.max >= 0) pc[group][key].current = effect.max;
      }
    }
    changeEffects(pc, { type: 'advance', minutes: { daily: 1440, short_rest: 60, long_rest: 480 }[action.recharge] });
    return;
  }
  const [group, key] = location(action.id);
  const existing = Object.hasOwn(pc[group] || {}, key) ? pc[group][key] : null;
  if (action.type === 'save') {
    const effect = validateEffect(action.value);
    if (effect.inventoryKey && !Object.hasOwn(pc.inventory || {}, effect.inventoryKey)) throw new Error('Source item is unavailable.');
    pc[group] ||= {};
    pc[group][key] = { ...existing, ...effect, current: effect.max === 0 ? 0 : Math.max(0, Math.min(effect.max, existing?.max > 0 && Number.isSafeInteger(existing?.current) ? existing.current : effect.max)) };
    return;
  }
  if (!existing) throw new Error('Effect is unavailable.');
  if (action.type === 'end') { if (pc.activeEffects) delete pc.activeEffects[action.id]; return; }
  if (action.type === 'delete') {
    if (group !== 'effects') throw new Error('Existing abilities cannot be deleted here.');
    delete pc[group][key];
    if (pc.activeEffects) delete pc.activeEffects[action.id];
    return;
  }
  if (action.type !== 'activate') throw new Error('Invalid effect action.');
  const effect = validateEffect({ ...existing, mode: existing.mode || 'activated', consume: existing.consume === true });
  if (effect.mode !== 'activated') throw new Error('This effect applies automatically.');
  if (appliedEffects(pc).some(active => active.label.trim().toLowerCase() === effect.label.toLowerCase())) throw new Error('Effect is already active.');
  const current = existing.current ?? effect.max;
  if (effect.max > 0 && (!Number.isSafeInteger(current) || current <= 0 || current > effect.max)) throw new Error('No uses remaining.');
  const item = Object.hasOwn(pc.inventory || {}, effect.inventoryKey) ? pc.inventory[effect.inventoryKey] : null;
  if (effect.consume && (!item || !Number.isSafeInteger(item.qty ?? 1) || (item.qty ?? 1) < 1)) throw new Error('No source items remaining.');
  if (effect.consume && itemEquipped(pc, item)) throw new Error('Unequip the source item before consuming it.');
  if (effect.max > 0) existing.current = current - 1;
  if (effect.consume) item.qty = (item.qty ?? 1) - 1;
  pc.activeEffects ||= {};
  pc.activeEffects[action.id] = { remainingMinutes: effect.duration_minutes || -1 };
}
