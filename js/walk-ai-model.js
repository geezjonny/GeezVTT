import { doorIsOpen, hitsWall, lineOfSight, move, world } from './walk-model.js';

export const npcSpec = token => JSON.stringify([token.x, token.y, token.walkMovedAt || 0, token.walkAI]);
const point = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x <= world.w && p.y <= world.h;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const activeNPC = token => token.kind !== 'pc' && token.hp > 0 && !token.walkDeleted && !token.hidden && !!token.walkAI;

export function npcState(token, raw) {
  const spec = npcSpec(token);
  if (!raw || raw.spec !== spec || !point(raw)) return { x: token.x, y: token.y, spec, awake: false, exiting: token.walkAI.door >= 0, goal: null, captured: null, ignore: null, target: null, mode: 'waiting' };
  const id = value => typeof value === 'string' && value.length <= 150 ? value : null;
  return { x: raw.x, y: raw.y, spec, awake: raw.awake === true, exiting: raw.exiting === true, goal: point(raw.goal) ? { x: raw.goal.x, y: raw.goal.y } : null,
    captured: raw.mode === 'battle' && raw.awake === true ? id(raw.captured) : null, ignore: id(raw.ignore), target: id(raw.target), mode: ['waiting', 'wandering', 'seeking', 'battle', 'following', 'chained'].includes(raw.mode) ? raw.mode : 'waiting' };
}
export function walkable(a, b) {
  if (!point(a) || !point(b)) return false;
  const steps = Math.max(1, Math.ceil(distance(a, b) / 0.2));
  for (let i = 1; i <= steps; i++) if (hitsWall(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps)) return false;
  return true;
}
// Half-tile search is bounded so an unreachable destination cannot stall the GM's page.
export function npcPath(from, goal, limit = 2000) {
  if (!point(from) || !point(goal)) return [];
  if (walkable(from, goal)) return [goal];
  const start = { x: Math.round(from.x * 2) / 2, y: Math.round(from.y * 2) / 2 };
  if (!point(start) || !walkable(from, start)) return [];
  const key = p => `${p.x},${p.y}`, queue = [start], parents = new Map([[key(start), null]]);
  let end = null;
  for (let i = 0; i < queue.length && i < limit; i++) {
    const p = queue[i];
    if (distance(p, goal) <= 0.6 && walkable(p, goal)) { end = p; break; }
    const neighbors = [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]].map(([x, y]) => ({ x: p.x + x, y: p.y + y })).sort((a, b) => distance(a, goal) - distance(b, goal));
    for (const q of neighbors) {
      if (parents.has(key(q)) || !point(q) || !walkable(p, q)) continue;
      parents.set(key(q), p); queue.push(q);
    }
  }
  if (!end) return [];
  const path = [goal];
  for (let p = end; p; p = parents.get(key(p))) path.unshift(p);
  return path;
}
function toward(state, goal, seconds, routes, id) {
  // shortcut: all NPCs use the walker collision radius; add size-aware clearance for oversized NPCs.
  let route = routes.get(id);
  if (route?.wait > 0) { route.wait -= seconds; return state; }
  const key = `${goal.x.toFixed(1)},${goal.y.toFixed(1)}`;
  if (!route || route.key !== key || !route.points.length || !walkable(state, route.points[0])) {
    route = { key, points: npcPath(state, goal) }; route.wait = route.points.length ? 0 : 1; routes.set(id, route);
  }
  while (route.points.length && distance(state, route.points[0]) < 0.12) route.points.shift();
  const next = route.points[0];
  if (!next) return state;
  const d = distance(state, next);
  const p = move(state, { x: (next.x - state.x) / d, y: (next.y - state.y) / d }, Math.min(seconds, d / 2), 2, hitsWall);
  return { ...state, ...p };
}
function approach(state, pc, seconds, routes, id) {
  if (distance(state, pc) <= 1.4 && lineOfSight(state.x, state.y, pc.x, pc.y)) return state;
  return toward(state, pc, seconds, routes, id);
}
function exitPoint(token) {
  const door = world.doors[token.walkAI.door];
  if (!door) return { x: token.x, y: token.y };
  const [ax, ay, bx, by] = door, length = Math.hypot(bx - ax, by - ay), x = (ax + bx) / 2, y = (ay + by) / 2;
  if (length < 0.00001) return { x: token.x, y: token.y };
  const nx = -(by - ay) / length, ny = (bx - ax) / length;
  const side = (token.x - x) * nx + (token.y - y) * ny >= 0 ? 1 : -1;
  return { x: Math.max(0.5, Math.min(world.w - 0.5, x - nx * side * 0.5)), y: Math.max(0.5, Math.min(world.h - 0.5, y - ny * side * 0.5)) };
}
export function advanceNPC(token, raw, pcs, seconds, routes = new Map(), random = Math.random) {
  let state = npcState(token, raw);
  const chain = world.chains.find(c => c.id === token.walkAI.chain);
  state.awake ||= token.walkAI.door < 0 || doorIsOpen(token.walkAI.door);
  if (chain?.locked) return { ...state, mode: 'chained', captured: null, target: null };
  if (chain) { state.awake = true; state.exiting = false; }
  if (!state.awake) return { ...state, mode: 'waiting', captured: null };
  const visible = pc => lineOfSight(state.x, state.y, pc.x, pc.y);
  if (state.ignore && !pcs.some(p => p.pcId === state.ignore && visible(p))) state.ignore = null;
  const friendly = token.walkAI.disposition === 'friendly';
  const captive = pcs.find(p => p.pcId === state.captured);
  if (!friendly && captive) return approach({ ...state, mode: 'battle' }, captive, seconds, routes, token.id);
  state.captured = null;
  const seen = pcs.filter(p => p.pcId !== state.ignore && visible(p)).sort((a, b) => distance(state, a) - distance(state, b));
  if (!friendly && seen.length) return approach({ ...state, captured: seen[0].pcId, target: seen[0].pcId, mode: 'battle', goal: null }, seen[0], seconds, routes, token.id);
  const candidates = pcs.filter(p => p.pcId !== state.ignore).sort((a, b) => distance(state, a) - distance(state, b));
  const target = (friendly && candidates.find(p => p.pcId === state.target)) || candidates[0];
  state.mode = target ? friendly ? 'following' : 'seeking' : 'wandering'; state.target = target?.pcId || null;
  if (state.exiting) {
    const goal = exitPoint(token);
    if (distance(state, goal) > 0.15) return toward(state, goal, seconds, routes, token.id);
    state.exiting = false; state.goal = null;
  }
  if (target) {
    state.goal = null;
    return approach(state, target, seconds, routes, token.id);
  }
  if (!state.goal || distance(state, state.goal) < 0.3) {
    state.goal = null;
    for (let i = 0; i < 12; i++) {
      const p = { x: Math.max(0.5, Math.min(world.w - 0.5, state.x + (random() - 0.5) * 6)), y: Math.max(0.5, Math.min(world.h - 0.5, state.y + (random() - 0.5) * 6)) };
      if (!hitsWall(p.x, p.y) && distance(state, p) > 0.5) { state.goal = p; break; }
    }
  }
  if (state.goal) {
    const next = toward(state, state.goal, seconds, routes, token.id);
    if (distance(next, state) < 0.001) next.goal = null;
    return next;
  }
  return state;
}
