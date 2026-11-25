import { crosses, distance, segments } from './map-editor-model.js';
import { remainingMovement } from './initiative-model.js';

export function playerDestination(map, token, dx, dy, initiative) {
  if (token?.overCapacity || token?.hidden) return null;
  if (initiative) {
    if (!token || !Number.isInteger(dx) || !Number.isInteger(dy)) return null;
    return reachableCells(map, token).get(`${token.x + dx},${token.y + dy}`) || null;
  }
  if (token?.speed === 0 || token?.kind !== 'pc' || ![[1,0],[-1,0],[0,1],[0,-1]].some(step => step[0] === dx && step[1] === dy)) return null;
  const next = { x: token.x + dx, y: token.y + dy };
  if (next.x < token.size / 2 || next.y < token.size / 2 || next.x > map.width - token.size / 2 || next.y > map.height - token.size / 2) return null;
  const barriers = [...map.walls, ...map.doors.filter(door => door.type === 'window' || !door.open).map(door => door.points)].flatMap(segments);
  if (barriers.some(([a,b]) => crosses(token, next, a, b) || distance(next, a, b) < token.size / 2)) return null;
  return next;
}

// Free-roam movement: can a token of this size stand at `to` after moving from `from`? Walls, windows and closed doors block.
export function canStand(map, size, from, to) {
  if (to.x < size / 2 || to.y < size / 2 || to.x > map.width - size / 2 || to.y > map.height - size / 2) return false;
  const barriers = [...map.walls, ...map.doors.filter(door => door.type === 'window' || !door.open).map(door => door.points)].flatMap(segments);
  return !barriers.some(([a, b]) => crosses(from, to, a, b) || distance(to, a, b) < size / 2);
}

// Free roam is switched off for now (turn-based only). Set true to bring back the GM's Movement button and smooth player movement.
export const FREE_ROAM_ENABLED = false;

// GM side of a free-roam move to an absolute point. Players send positions many times a second, so only short hops are accepted.
export const FREE_ROAM_MAX_HOP = 3;
export function freeDestination(map, token, x, y) {
  if (token?.kind !== 'pc' || token.overCapacity || token.hidden || token.speed === 0 || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const to = { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
  if (Math.hypot(to.x - token.x, to.y - token.y) > FREE_ROAM_MAX_HOP) return null;
  return canStand(map, token.size, token, to) ? to : null;
}

export function nearbyDoor(map, token) {
  if (token?.kind !== 'pc') return -1;
  let index = -1, nearest = token.size / 2 + 1;
  map.doors.forEach((door, i) => {
    if (door.hidden || door.type === 'window' || door.locked) return;
    const d = Math.min(...segments(door.points).map(([a,b]) => distance(token, a, b)));
    if (d <= nearest) { nearest = d; index = i; }
  });
  return index;
}

// shortcut: ordinary terrain and 5-ft diagonals; add terrain costs and special movement when supported by maps.
export function reachableCells(map, token) {
  const cells = new Map();
  const budget = remainingMovement(map, token);
  if (!token || budget < 5 || map.initiative?.currentId !== token.id) return cells;
  const barriers = [...map.walls, ...map.doors.filter(door => door.type === 'window' || !door.open).map(door => door.points)].flatMap(segments);
  const steps = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  const queue = [{ x: token.x, y: token.y, cost: 0 }];
  const visited = new Set([`${token.x},${token.y}`]);
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i];
    if (from.cost + 5 > budget) continue;
    for (const [dx, dy] of steps) {
      const next = { x: from.x + dx, y: from.y + dy, cost: from.cost + 5 };
      const key = `${next.x},${next.y}`;
      if (visited.has(key) || next.x < token.size / 2 || next.y < token.size / 2 ||
          next.x > map.width - token.size / 2 || next.y > map.height - token.size / 2) continue;
      if (barriers.some(([a,b]) => crosses(from, next, a, b) ||
          Math.min(distance(next,a,b), distance(a,from,next), distance(b,from,next)) < token.size / 2 - 1e-9)) continue;
      next.path = [...(from.path || []), { x: next.x, y: next.y }];
      visited.add(key); cells.set(key, next); queue.push(next);
    }
  }
  return cells;
}
