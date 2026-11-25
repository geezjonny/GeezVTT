import { createGame, ZOMBIES } from './horde-model.js';
import { doorIsOpen, hitsWall, lineOfSight, world } from './walk-model.js';
import { npcPath, walkable } from './walk-ai-model.js';

export const HORDE_UNIT = 256;
export const zombieType = token => token?.npcId?.startsWith('horde:') && ZOMBIES[token.npcId.slice(6)] ? token.npcId.slice(6) : null;
export const toHorde = p => ({ x: Math.round(p.x * HORDE_UNIT), y: Math.round(p.y * HORDE_UNIT) });
export const toWalk = p => ({ x: p.x / HORDE_UNIT, y: p.y / HORDE_UNIT });

export function createEncounter(pcs) {
  const game = createGame({ seed: 1, speed: 4, participants: pcs });
  Object.assign(game, { manual: true, phase: 'wave', wave: 1, placements: {}, teleports: {} });
  return game;
}

export function syncEncounter(game, pcs, tokens) {
  const fresh = createEncounter(pcs), previous = new Map(game.players.map(p => [p.pcId, p]));
  if (game.players.map(p => p.pcId).join(',') !== fresh.players.map(p => p.pcId).join(',')) { game.arrows = []; game.log = []; }
  game.players = fresh.players.map(p => previous.get(p.pcId) || p);
  for (const p of game.players) {
    const pc = pcs.find(pc => pc.pcId === p.pcId), pos = toHorde(pc.pos);
    Object.assign(p, pos, { ox: pos.x, oy: pos.y, dx: 0, dy: 0 });
  }
  const placed = tokens.filter(t => zombieType(t) && !t.walkDeleted && !t.hidden && t.hp > 0), ids = new Set(placed.map(t => t.id));
  game.zombies = game.zombies.filter(z => ids.has(z.tokenId));
  for (const id of Object.keys(game.placements)) if (!ids.has(id)) delete game.placements[id];
  for (const token of placed) {
    const signature = JSON.stringify([token.x, token.y, token.hp, token.walkMovedAt || 0, token.npcId]);
    if (game.placements[token.id] !== signature) {
      game.zombies = game.zombies.filter(z => z.tokenId !== token.id);
      const type = zombieType(token), pos = toHorde(token), words = ZOMBIES[type].words;
      const used = new Set(game.zombies.map(z => z.word));
      const word = words.find(w => !used.has(w)) || words[game.nextId % words.length];
      game.zombies.push({ id: game.nextId++, tokenId: token.id, type, ...pos, ox: pos.x, oy: pos.y,
        hp: token.hp, max: token.hp, pending: 0, word, cool: 0, frozen: 0, slow: 0, boss: false });
      game.placements[token.id] = signature;
    }
    const z = game.zombies.find(z => z.tokenId === token.id);
    if (!z) continue;
    const ai = token.walkAI;
    z.awake ||= !ai || ai.door < 0 || doorIsOpen(ai.door);
    const chained = world.chains.some(c => c.id === ai?.chain && c.locked);
    if (ai?.chain && !chained) z.awake = true;
    if (!z.awake || chained || ai?.disabled) z.frozen = Math.max(z.frozen, 2);
  }
}

export function walkHordeArena() {
  const routes = new Map();
  const blocked = (x, y) => x < 0 || y < 0 || x > world.w * HORDE_UNIT || y > world.h * HORDE_UNIT || hitsWall(x / HORDE_UNIT, y / HORDE_UNIT);
  return {
    gate: null, blocked,
    safe(p) { return { x: p.ox, y: p.oy }; },
    move(from, to) {
      const p = { x: from.x, y: from.y }, count = Math.max(1, Math.ceil(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) / 32));
      for (let i = 1; i <= count; i++) {
        const x = Math.round(from.x + (to.x - from.x) * i / count), y = Math.round(from.y + (to.y - from.y) * i / count);
        if (!blocked(x, p.y)) p.x = x;
        if (!blocked(p.x, y)) p.y = y;
      }
      return p;
    },
    clear(a, b) { const p = toWalk(a), q = toWalk(b); return lineOfSight(p.x, p.y, q.x, q.y); },
    roam(from, dx, dy) {
      const p = toWalk(from), goal = { x: Math.max(.5, Math.min(world.w - .5, p.x + dx * .75)), y: Math.max(.5, Math.min(world.h - .5, p.y + dy * .75)) };
      return hitsWall(goal.x, goal.y) ? { x: from.x, y: from.y } : toHorde(goal);
    },
    waypoint(from, to) {
      const a = toWalk(from), b = toWalk(to), key = `${b.x.toFixed(1)},${b.y.toFixed(1)}`;
      let route = routes.get(from.id);
      if (!route || route.key !== key || route.age++ > 30 || route.points.length && !walkable(a, route.points[0])) {
        route = { key, age: 0, points: npcPath(a, b) }; routes.set(from.id, route);
      }
      while (route.points.length && Math.hypot(a.x - route.points[0].x, a.y - route.points[0].y) < .12) route.points.shift();
      return route.points.length ? toHorde(route.points[0]) : { x: from.x, y: from.y };
    }
  };
}

export function decodeEncounter(value) {
  if (typeof value !== 'string' || value.length > 2000000) return null;
  try {
    const game = JSON.parse(value);
    if (!game?.manual || game.phase !== 'wave' || !Number.isSafeInteger(game.tick) || game.tick < 0 ||
        !Array.isArray(game.players) || game.players.length > 12 || !Array.isArray(game.zombies) || game.zombies.length > 5000 ||
        !Array.isArray(game.arrows) || !Array.isArray(game.log) || !game.placements || !game.teleports) return null;
    if (![...game.players, ...game.zombies].every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.hp) && Number.isFinite(p.max))) return null;
    return game;
  } catch { return null; }
}
