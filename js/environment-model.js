import { crosses, segments } from './map-editor-model.js';

export const TIMES = {
  original: { color: '#ffe6c4', ambient: .8, sun: 2.5, tint: 'transparent' },
  day: { color: '#fff4df', ambient: .8, sun: 2.5, tint: 'transparent' },
  dawn: { color: '#ffb980', ambient: .35, sun: 1.2, tint: '#d77d4933' },
  dusk: { color: '#ff9966', ambient: .2, sun: .7, tint: '#532d7355' },
  night: { color: '#91b8ff', ambient: .12, sun: .2, tint: '#07132b99' }
};
// Bound fog geometry on large maps; ordinary maps use one-square cells.
export const fogSize = map => Math.max(1, Math.ceil(Math.max(map.width, map.height) / 128));
export function environmentSettings(raw, map) {
  const size = fogSize(map), cols = Math.ceil(map.width / size), rows = Math.ceil(map.height / size);
  return {
    time: Object.hasOwn(TIMES, raw?.time) ? raw.time : 'original',
    weather: ['clear', 'rain', 'snow'].includes(raw?.weather) ? raw.weather : 'clear',
    fog: { covered: raw?.fog?.covered === true, cells: [...new Set((Array.isArray(raw?.fog?.cells) ? raw.fog.cells : []).filter(key => {
      if (typeof key !== 'string' || !/^\d+,\d+$/.test(key)) return false;
      const [x, y] = key.split(',').map(Number);
      return x < cols && y < rows && key === `${x},${y}`;
    }))] }
  };
}
export function fogRectangles(map) {
  const fog = map.environment.fog, cells = new Set(fog.cells), size = fogSize(map), rectangles = [];
  const lights = (map.lights || []).filter(light => Number.isFinite(light.x) && Number.isFinite(light.y) &&
    Number.isFinite(light.range) && light.range > 0 && (light.intensity ?? 1) > 0 && (light.opacity ?? 1) > 0);
  const barriers = [...(map.walls || []), ...(map.doors || []).filter(door => door.type !== 'window' && !door.open).map(door => door.points)].flatMap(segments);
  const lit = (x, y) => {
    const center = { x: Math.min((x + .5) * size, (x * size + map.width) / 2), y: Math.min((y + .5) * size, (y * size + map.height) / 2) };
    return lights.some(light => Math.hypot(center.x - light.x, center.y - light.y) <= light.range &&
      !barriers.some(([a, b]) => crosses(light, center, a, b)));
  };
  for (let y = 0; y < Math.ceil(map.height / size); y++) {
    let start = null;
    const cols = Math.ceil(map.width / size);
    for (let x = 0; x <= cols; x++) {
      const hidden = x < cols && fog.covered !== cells.has(`${x},${y}`) && !lit(x, y);
      if (hidden && start === null) start = x;
      if (!hidden && start !== null) {
        rectangles.push({ x: start * size, y: y * size, width: Math.min(x * size, map.width) - start * size, height: Math.min(size, map.height - y * size) });
        start = null;
      }
    }
  }
  return rectangles;
}
