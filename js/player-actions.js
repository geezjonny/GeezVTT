import { crosses, distance, segments } from './map-editor-model.js';

export function playerDestination(map, token, dx, dy, initiative) {
  if (initiative || token?.kind !== 'pc' || ![[1,0],[-1,0],[0,1],[0,-1]].some(step => step[0] === dx && step[1] === dy)) return null;
  const next = { x: token.x + dx, y: token.y + dy };
  if (next.x < token.size / 2 || next.y < token.size / 2 || next.x > map.width - token.size / 2 || next.y > map.height - token.size / 2) return null;
  const barriers = [...map.walls, ...map.doors.filter(door => door.type === 'window' || !door.open).map(door => door.points)].flatMap(segments);
  if (barriers.some(([a,b]) => crosses(token, next, a, b) || distance(next, a, b) < token.size / 2)) return null;
  return next;
}

export function nearbyDoor(map, token) {
  if (token?.kind !== 'pc') return -1;
  let index = -1, nearest = token.size / 2 + 1;
  map.doors.forEach((door, i) => {
    if (door.type === 'window' || door.locked) return;
    const d = Math.min(...segments(door.points).map(([a,b]) => distance(token, a, b)));
    if (d <= nearest) { nearest = d; index = i; }
  });
  return index;
}
