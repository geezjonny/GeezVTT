// minigame2: free movement on a top-down map. Pure helpers (no DOM, no Firebase) so they can be tested.
import { importedProps } from './prop-model.js';
import { importedTokens, walkAIProperties } from './token-model.js';
export const TILE_W = 48, TILE_H = 48;     // one tile drawn as a square, in pixels
export const SPEED = 4;                    // tiles per second
export const RADIUS = 0.35;                // body radius in tiles

// The current map, in tile units: its size, wall segments [x1,y1,x2,y2] and doors [x1,y1,x2,y2]. Filled by setWorld.
// `open` holds the indices (into doors) of the doors that are currently open; every door starts closed.
// `swing` is each door's animated progress, 0 (shut) to 1 (fully open); a door blocks until it reaches 1.
// `triggers` are the levers and pressure plates the GM placed: { id, kind, x, y, doors: [door indices], on }.
export const world = { w: 10, h: 10, walls: [], doors: [], floors: [], props: [], tokens: [], chains: [], wallMaterials: [], doorMaterials: [], open: new Set(), swing: new Map(), triggers: [] };

// Keep only the geometry of a .dd2vtt: size, line_of_sight polylines as segments, portals as door segments. The image is dropped.
export function buildWorld(dd) {
  const size = dd?.resolution?.map_size, w = size?.x, h = size?.y;
  if (!(w > 0 && h > 0)) throw new Error('That map file has no size.');
  const ok = p => Number.isFinite(p?.x) && Number.isFinite(p?.y);
  const walls = [], doors = [];
  for (const line of [...(dd.line_of_sight || []), ...(dd.objects_line_of_sight || [])])
    for (let i = 1; i < line.length; i++) if (ok(line[i - 1]) && ok(line[i])) walls.push([line[i - 1].x, line[i - 1].y, line[i].x, line[i].y]);
  for (const { bounds } of dd.portals || []) if (ok(bounds?.[0]) && ok(bounds?.[1])) doors.push([bounds[0].x, bounds[0].y, bounds[1].x, bounds[1].y]);
  return { w, h, walls, doors };
}
export const setWorld = dd => {
  Object.assign(world, buildWorld(dd), { floors: [], props: [], tokens: [], chains: [], open: new Set(), swing: new Map(), triggers: [] });
  world.wallMaterials = world.walls.map(() => 'stone');
  world.doorMaterials = world.doors.map(() => 'wood');
  return world;
};

// Reject the whole edit if geometry is malformed: dropping a door would change every trigger's door indices.
export function cleanMapEdit(raw, w, h) {
  if (!raw || raw.version !== 1) return null;
  w = raw.w ?? w; h = raw.h ?? h;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1 || w > 4096 || h > 4096) return null;
  const result = { w, h };
  const point = (x, y) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= w && y <= h;
  for (const name of ['walls', 'doors']) {
    const items = raw[name] ?? [];
    if (!Array.isArray(items) || items.length > 20000 || items.some(s => !Array.isArray(s) || s.length !== 4 || !point(s[0], s[1]) || !point(s[2], s[3]) || s[0] === s[2] && s[1] === s[3])) return null;
    result[name] = items.map(s => [...s]);
    const materials = raw[name === 'walls' ? 'wallMaterials' : 'doorMaterials'] ?? [];
    if (!Array.isArray(materials)) return null;
    result[name === 'walls' ? 'wallMaterials' : 'doorMaterials'] = items.map((_, i) => typeof materials[i] === 'string' ? materials[i] : name === 'walls' ? 'stone' : 'wood');
  }
  const floors = raw.floors ?? [];
  if (!Array.isArray(floors) || floors.length > 100000 || floors.some(t => !t || !point(t.x, t.y) || typeof t.material !== 'string')) return null;
  result.floors = floors.map(t => ({ x: t.x, y: t.y, material: t.material }));
  const chains = raw.chains ?? [], ids = new Set();
  if (!Array.isArray(chains) || chains.length > 5000) return null;
  for (const chain of chains) {
    if (!chain || typeof chain.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(chain.id) || ids.has(chain.id) || !point(chain.x, chain.y) || typeof chain.locked !== 'boolean') return null;
    ids.add(chain.id);
  }
  result.chains = chains.map(c => ({ id: c.id, x: c.x, y: c.y, locked: c.locked }));
  for (const name of ['props', 'tokens']) {
    const objects = raw[name] ?? [];
    if (!Array.isArray(objects) || objects.length > 5000 || objects.some(o => !o || typeof o.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(o.id) || !point(o.x, o.y))) return null;
    const clean = name === 'props' ? importedProps(objects) : importedTokens(objects, w, h);
    if (clean.length !== objects.length || clean.some((o, i) => o.id !== objects[i].id)) return null;
    if (name === 'tokens' && clean.some(t => t.walkAI && t.walkAI.door >= result.doors.length)) return null;
    if (name === 'tokens' && clean.some(t => t.walkAI?.chain && !ids.has(t.walkAI.chain))) return null;
    result[name] = clean;
  }
  return result;
}

// A shared lever/plate record is usable if it has a known kind, sits on the map and links only to real doors. Returns a clean copy or null.
export function cleanTrigger(id, raw, map = world) {
  if (typeof id !== 'string' || !raw || !['lever', 'plate'].includes(raw.kind) || !Number.isFinite(raw.x) || !Number.isFinite(raw.y) ||
      raw.x < 0 || raw.x > map.w || raw.y < 0 || raw.y > map.h) return null;
  const doors = [...new Set(Object.values(raw.doors || {}).filter(d => Number.isInteger(d) && d >= 0 && d < map.doors.length))].slice(0, 20);
  const chainIds = new Set((map.chains || []).map(c => c.id));
  const chains = [...new Set(Object.values(raw.chains || {}).filter(id => chainIds.has(id)))].slice(0, 100);
  return { id, kind: raw.kind, x: raw.x, y: raw.y, doors, on: !!raw.on, ...(chains.length ? { chains } : {}) };
}
// The lever or plate closest to a point within `reach` tiles (optionally of one kind), or null.
export function nearestTrigger(x, y, reach, kind) {
  let best = null, found = reach;
  for (const t of world.triggers) { const d = Math.hypot(t.x - x, t.y - y); if ((!kind || t.kind === kind) && d <= found) { found = d; best = t; } }
  return best;
}
export function moveTrigger(id, x, y, snap = true) {
  const trigger = world.triggers.find(t => t.id === id);
  if (!trigger || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (snap) { x = Math.floor(x) + 0.5; y = Math.floor(y) + 0.5; }
  if (x < 0 || y < 0 || x > world.w || y > world.h || hitsWall(x, y) || world.triggers.some(t => t !== trigger && Math.hypot(t.x - x, t.y - y) < 0.1)) return false;
  trigger.x = x; trigger.y = y;
  const prop = world.props.find(p => p.id === id);
  if (prop) { prop.x = x; prop.y = y; }
  return true;
}
export function syncPropTrigger(prop) {
  const kind = ['lever', 'button'].includes(prop.kind) ? 'lever' : ['pressurePlate', 'tripwire'].includes(prop.kind) ? 'plate' : null;
  const existing = world.triggers.find(t => t.id === prop.id);
  if (existing) Object.assign(existing, { x: prop.x, y: prop.y, kind: kind || existing.kind });
  else if (kind) world.triggers.push({ id: prop.id, kind, x: prop.x, y: prop.y, doors: [], on: false });
}
export function movePlacedObject(layer, id, x, y, snap = true) {
  if (!['props', 'tokens', 'chains'].includes(layer) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  const object = world[layer].find(o => o.id === id);
  if (!object) return false;
  if (snap) { x = Math.floor(x) + 0.5; y = Math.floor(y) + 0.5; }
  if (x < 0 || y < 0 || x > world.w || y > world.h) return false;
  object.x = x; object.y = y;
  if (layer === 'props') syncPropTrigger(object);
  return true;
}
export function removeWalkTokens(ids) {
  const removed = new Set(ids);
  // PCs have automatic stand-ins; retain a map-only removal marker so those do not respawn.
  world.tokens = world.tokens.filter(token => {
    if (!removed.has(token.id)) return true;
    if (token.kind === 'pc') { token.walkDeleted = true; return true; }
    return false;
  });
}
export function activateNPCAI(token, disposition) {
  if (!token || token.kind === 'pc' || token.walkDeleted) throw new Error('Choose an NPC token.');
  token.walkAI = walkAIProperties({ door: -1, chain: token.walkAI?.chain ?? null, disposition });
  token.hp = Math.max(1, token.hp);
}
export function connectNPCChain(chainId, tokenId) {
  const chain = world.chains.find(c => c.id === chainId), token = world.tokens.find(t => t.id === tokenId);
  if (!chain || !token || token.kind === 'pc' || token.walkDeleted) throw new Error('Connect chains to an NPC token.');
  if (token.walkAI?.chain === chainId) { token.walkAI.chain = null; return false; }
  activateNPCAI(token, token.walkAI?.disposition || 'enemy');
  token.walkAI.chain = chainId;
  return true;
}
// Doors wired to a lever or plate can't be opened by hand and don't shut by themselves.
export const lockedDoors = () => new Set(world.triggers.flatMap(t => t.doors));

// Grid position -> screen position (before the camera), and back.
export const project = (gx, gy) => ({ x: gx * TILE_W, y: gy * TILE_H });
export const unproject = (sx, sy) => ({ x: sx / TILE_W, y: sy / TILE_H });

// WASD and the arrows move on the screen: up is up-screen.
const SCREEN = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export const KEY_TO_MOVE = { w: 'up', s: 'down', a: 'left', d: 'right', arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right' };
export function direction(pressed) {
  let x = 0, y = 0;
  for (const move of pressed) { const v = SCREEN[move]; if (v) { x += v[0]; y += v[1]; } }
  const length = Math.hypot(x, y);
  return length ? { x: x / length, y: y / length } : { x: 0, y: 0 };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function segmentDistance(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1, len = dx * dx + dy * dy;
  const t = len ? clamp(((px - x1) * dx + (py - y1) * dy) / len, 0, 1) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
// A door can be walked through only once it has swung fully open.
export const doorIsOpen = i => (world.swing.get(i) ?? (world.open.has(i) ? 1 : 0)) >= 1;
// Does a body centred here touch a wall or a door that is not fully open? shortcut: linear scan, fine for a few hundred segments.
export const hitsWall = (x, y) => world.walls.some(s => segmentDistance(x, y, s) < RADIUS) ||
  world.doors.some((s, i) => !doorIsOpen(i) && segmentDistance(x, y, s) < RADIUS);
// Is anyone within `reach` tiles of this door? Used to keep it open until everyone has gone through.
export const doorOccupied = (i, points, reach = 1.5) => points.some(p => segmentDistance(p.x, p.y, world.doors[i]) <= reach);
// The closest door within `reach` tiles of a point (open or closed), or -1.
export function nearestDoor(x, y, reach = 1) {
  let best = -1, found = reach;
  world.doors.forEach((s, i) => { const d = segmentDistance(x, y, s); if (d <= found) { found = d; best = i; } });
  return best;
}
// Would closing this door catch a body standing in it?
export const doorBlocked = (i, x, y) => segmentDistance(x, y, world.doors[i]) < RADIUS + 0.1;

// --- vision: what a character can see from a point. Walls, the map edge and doors that are not fully open all block sight.
export const VISION = 8;   // tiles
const blockers = (x, y, radius) => [
  ...world.walls, ...world.doors.filter((_, i) => !doorIsOpen(i)),
  [0, 0, world.w, 0], [world.w, 0, world.w, world.h], [world.w, world.h, 0, world.h], [0, world.h, 0, 0]
].filter(s => segmentDistance(x, y, s) <= radius);
// Distance along a ray (unit direction dx,dy) to the nearest blocker, or `max`.
function rayDistance(ox, oy, dx, dy, segments, max) {
  let best = max;
  for (const [x1, y1, x2, y2] of segments) {
    const ex = x2 - x1, ey = y2 - y1, den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((x1 - ox) * ey - (y1 - oy) * ex) / den, u = ((x1 - ox) * dy - (y1 - oy) * dx) / den;
    if (t >= 0 && t < best && u >= 0 && u <= 1) best = t;
  }
  return best;
}
// The lit area as a polygon of map points: rays at every wall end (just either side) plus a ring of rays for the round edge.
export function visionPolygon(x, y, radius = VISION) {
  const segments = blockers(x, y, radius), angles = [];
  // Every angle goes into the same (-PI, PI] range, or the sort would not walk around the player in order and the shape would cross itself.
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  for (let i = 0; i < 90; i++) angles.push(wrap(i * Math.PI / 45));
  for (const [x1, y1, x2, y2] of segments) for (const [px, py] of [[x1, y1], [x2, y2]]) {
    if (Math.hypot(px - x, py - y) > radius) continue;
    const a = Math.atan2(py - y, px - x); angles.push(wrap(a - 1e-4), a, wrap(a + 1e-4));
  }
  return angles.sort((a, b) => a - b).map(a => {
    const d = rayDistance(x, y, Math.cos(a), Math.sin(a), segments, radius);
    return { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d };
  });
}
// Can someone at (x1,y1) see a body at (x2,y2)? A body peeking a little past a blocker still counts.
export function lineOfSight(x1, y1, x2, y2, radius = VISION) {
  const d = Math.hypot(x2 - x1, y2 - y1);
  if (d > radius) return false;
  if (d < 1e-6) return true;
  return rayDistance(x1, y1, (x2 - x1) / d, (y2 - y1) / d, blockers(x1, y1, radius), d) >= d - 0.3;
}

// Axes move separately, so a blocked body slides along the wall. `blocked` is optional (spectators fly through walls).
// A body already inside a wall (a door closed on it) may move freely until it is out.
export function move(position, dir, seconds, speed = SPEED, blocked = null) {
  if (blocked?.(position.x, position.y)) blocked = null;
  const nx = clamp(position.x + dir.x * speed * seconds, RADIUS, world.w - RADIUS);
  const x = blocked?.(nx, position.y) ? position.x : nx;
  const ny = clamp(position.y + dir.y * speed * seconds, RADIUS, world.h - RADIUS);
  return { x, y: blocked?.(x, ny) ? position.y : ny };
}

// Where a new player appears: near the middle, spread out by seat, pushed outward until the spot is clear of walls.
export function spawn(seat) {
  for (let k = 0; k < 400; k++) {
    const angle = (seat + k) * 2.399, ring = 1 + (seat % 3) * 0.7 + k * 0.1;
    const x = world.w / 2 + Math.cos(angle) * ring, y = world.h / 2 + Math.sin(angle) * ring;
    if (x >= RADIUS && y >= RADIUS && x <= world.w - RADIUS && y <= world.h - RADIUS && !hitsWall(x, y)) return { x, y };
  }
  return { x: world.w / 2, y: world.h / 2 };
}

// Other players are shown smoothing toward their last reported position instead of jumping.
export function smooth(shown, target, seconds, rate = 12) {
  const k = 1 - Math.exp(-rate * seconds);
  return { x: shown.x + (target.x - shown.x) * k, y: shown.y + (target.y - shown.y) * k };
}

// A shared record is usable if it is complete, on the map, and recently seen.
export function validWalker(value, now, maxAge = 15000) {
  return !!value && typeof value.pcId === 'string' && typeof value.name === 'string' && value.name.length <= 40 &&
    Number.isFinite(value.x) && Number.isFinite(value.y) && value.x >= 0 && value.x <= world.w && value.y >= 0 && value.y <= world.h &&
    Number.isFinite(value.seen) && now - value.seen <= maxAge && now - value.seen >= -maxAge;
}
export const hpFraction = (hp, max) => Number.isFinite(hp) && Number.isFinite(max) && max > 0 ? clamp(hp / max, 0, 1) : null;
