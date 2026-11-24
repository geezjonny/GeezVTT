import { COIN_TYPES } from './inventory-model.js';

export function itemWeight(item, reference = {}) {
  const value = item.weight ?? reference[String(item.name).trim().toLowerCase()]?.weight;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function carryingLoad(pc, strength, reference = {}) {
  let weight = 0, unknown = 0;
  for (const item of Object.values(pc.inventory || {})) {
    if (!item?.name) continue;
    const qty = Number(item.qty ?? 1);
    if (qty === 0) continue;
    const unit = itemWeight(item, reference);
    if (!Number.isSafeInteger(qty) || qty < 0 || unit === null) unknown++;
    else weight += qty * unit;
  }
  for (const key of Object.keys(COIN_TYPES)) {
    const coins = Number(pc.coin_purse?.[key] ?? 0);
    if (Number.isSafeInteger(coins) && coins >= 0) weight += coins / 50;
    else unknown++;
  }
  const size = String(pc.size ?? pc.basic?.size ?? 'medium').toLowerCase();
  const factor = { tiny: .5, small: 1, medium: 1, large: 2, huge: 4, gargantuan: 8 }[size] ?? 1;
  const capacity = Number.isFinite(strength) && strength >= 0 ? strength * 15 * factor : null;
  return { weight: Math.round(weight * 100) / 100, capacity, unknown, overCapacity: capacity !== null && weight > capacity };
}
