import { crosses, segments } from './map-editor-model.js';

export function characterVision(pc) {
  const distance = (value, fallback = 0) => {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) && number >= 0 ? Math.min(number, 10000) : fallback;
  };
  const senses = pc.senses || {};
  return { sight: distance(pc.vision?.sight ?? senses.sight, 120),
    darkvision: distance(pc.vision?.darkvision ?? senses.darkvision),
    blindsight: distance(pc.vision?.blindsight ?? senses.blindsight),
    truesight: distance(pc.vision?.truesight ?? senses.truesight) };
}
export function visionAt(map, point, viewers) {
  return visionTest(map, viewers)(point);
}
export function visionTest(map, viewers) {
  const barriers = [...(map.walls || []).map(wall => wall.points || wall), ...(map.doors || []).filter(door => door.type !== 'window' && !door.open).map(door => door.points)].flatMap(segments);
  const clear = (a, b) => {
    // Stop just before the surface so doors and walls do not hide themselves.
    const inset = Math.min(1, 1e-7 / (Math.hypot(b.x - a.x, b.y - a.y) || 1));
    const end = { x: b.x + (a.x - b.x) * inset, y: b.y + (a.y - b.y) * inset };
    return !barriers.some(([c, d]) => crosses(a, end, c, d));
  };
  return point => {
    const lit = !['night', 'dusk'].includes(map.environment?.time) || (map.lights || []).some(light => !light.hidden && !light.off && (light.intensity ?? 1) > 0 && (light.opacity ?? 1) > 0 && Math.hypot(light.x - point.x, light.y - point.y) <= light.range && clear(light, point));
    return viewers.some(token => {
    const range = Math.hypot(token.x - point.x, token.y - point.y) * 5, vision = characterVision({ vision: token.vision });
    return range <= token.size * 2.5 || clear(token, point) && (range <= Math.max(vision.darkvision, vision.blindsight, vision.truesight) || lit && range <= vision.sight);
    });
  };
}
