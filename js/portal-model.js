import { propAppearance } from './prop-model.js';
import { objectColors, visualEffects } from './object-appearance.js';

// These paired endpoints also provide the connection model for stairs.
export const PORTAL_ICONS = { portal: 'P', stairsUp: '↗', stairsDown: '↘', ladder: '☷', doorway: '▣', magic: '✦' };

export function importedPortals(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  return value.flatMap(portal => {
    if (!portal || typeof portal.id !== 'string' || !portal.id || ids.has(portal.id) ||
        typeof portal.pairId !== 'string' || !portal.pairId ||
        !Number.isFinite(portal.x) || !Number.isFinite(portal.y)) return [];
    ids.add(portal.id);
    return [{ id: portal.id, pairId: portal.pairId, x: portal.x, y: portal.y, ...(portal.colors!==undefined?{colors:objectColors(portal.colors)}:{}),...(portal.visualEffects!==undefined?{visualEffects:visualEffects(portal.visualEffects)}:{}), ...(Number.isFinite(portal.size) && portal.size >= .25 && portal.size <= 20 ? {size:portal.size} : {}),
      ...(portal.hidden === true ? { hidden: true } : {}),
      ...(Object.hasOwn(PORTAL_ICONS, portal.icon) || propAppearance(portal) ? { icon: portal.icon } : {}) }];
  });
}

export function portalDestination(entries, source) {
  const matches = entries.filter(({ portal }) => portal.pairId === source.pairId);
  return matches.length === 2 && matches.filter(({ portal }) => portal.id === source.id).length === 1
    ? matches.find(({ portal }) => portal.id !== source.id) : undefined;
}
