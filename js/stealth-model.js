// Map document, lever/door state, geometry and collision. No DOM access, so Node tests can import it.
import { HEARING, L, LIGHT_KINDS, M, PROP_KINDS, clamp, mapVer, uid } from './stealth-state.js';

/* ===================================================================
   DEMO MAP (used when a room has no map yet)
   =================================================================== */
export function demoMap() {
  const m = blankMap(24, 16);
  const W = (x1, y1, x2, y2) => m.walls.push({id:uid(), a:[x1,y1], b:[x2,y2]});
  // outer walls
  W(0,0,24,0); W(24,0,24,16); W(24,16,0,16); W(0,16,0,0);
  // left room / right side split, with two wooden doors
  W(8,0,8,3); W(8,4,8,13); W(8,14,8,16);
  const d1 = {id:uid(), a:[8,3], b:[8,4], open:false, name:"North door"};
  const d2 = {id:uid(), a:[8,13], b:[8,14], open:false, name:"South door"};
  // right side split by a wall with an iron gate in the middle
  W(8,8,15,8); W(17,8,24,8);
  const gate = {id:uid(), a:[15,8], b:[17,8], open:false, name:"Iron gate"};
  // cell in the bottom-left corner
  W(0,12,1.5,12); W(2.5,12,4,12); W(4,12,4,16);
  const cellGate = {id:uid(), a:[1.5,12], b:[2.5,12], open:false, name:"Cell gate"};
  m.doors.push(d1, d2, gate, cellGate);
  // props
  const P = (kind, x, y, extra) => { const k = PROP_KINDS[kind]; const p = {id:uid(), kind, x, y, w:k.w, h:k.h, tall:k.tall, loot:"", locked:false, ...extra}; m.props.push(p); return p; };
  P("crate", 13.5, 3.5); P("crate", 13.5, 4.5); P("crate", 12.5, 4.5);
  P("table", 19, 4.5); P("barrel", 10.5, 14.5); P("barrel", 11.3, 14.9); P("bookshelf", 12, 9.25);
  P("pillar", 16, 12); P("bed", 5.5, 2);
  const chest = P("chest", 22, 14.8, {loot:"50 gp, a silver key and a sealed letter from the Warden.", locked:true});
  P("chest", 1.5, 1.5, {loot:"A moth-eaten cloak. Nothing else."});
  // levers + links
  m.levers.push({id:uid(), x:6.5, y:6.5, name:"Gate lever", targets:[gate.id]});
  m.levers.push({id:uid(), x:22.5, y:1.5, name:"Strongbox lever", targets:[chest.id]});
  m.levers.push({id:uid(), x:6.5, y:10.5, name:"Cell lever", targets:[cellGate.id]});
  // lights
  m.lights.push({id:uid(), kind:"brazier", x:4, y:5, r:5, color:"#ffcf8a", on:true});
  m.lights.push({id:uid(), kind:"brazier", x:17, y:3, r:5.5, color:"#ffcf8a", on:true});
  m.lights.push({id:uid(), kind:"torch", x:21, y:11, r:4, color:"#ffcf8a", on:true});
  m.lights.push({id:uid(), kind:"torch", x:11, y:12, r:3, color:"#ffcf8a", on:true});
  // guards
  m.guards.push({id:uid(), name:"Brom", pp:12, sight:6, speed:1.6, fov:70, mode:"patrol", x:10.5, y:2.5, face:0, sweep:90,
                 path:[[10.5,2.5],[22.5,2.5],[22.5,6.5],[10.5,6.5]]});
  m.guards.push({id:uid(), name:"Hilda", pp:14, sight:6, speed:1.6, fov:70, mode:"survey", x:21.5, y:11.5, face:180, sweep:110, path:[]});
  // spawns and cell
  m.spawns.push({id:uid(), x:2.5, y:5.5, kind:"spawn"}, {id:uid(), x:3.5, y:6.5, kind:"spawn"}, {id:uid(), x:2.5, y:7.5, kind:"spawn"});
  m.spawns.push({id:uid(), x:2, y:14, kind:"cell"});
  // floors
  for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) m.floors[x + "_" + y] = x < 8 ? "wood" : "stone";
  for (let y = 12; y < 16; y++) for (let x = 0; x < 4; x++) m.floors[x + "_" + y] = "dirt";
  for (let y = 12; y < 15; y++) for (let x = 13; x < 16; x++) m.floors[x + "_" + y] = "shadow";
  for (let y = 9; y < 11; y++) for (let x = 9; x < 11; x++) m.floors[x + "_" + y] = "shadow";
  m.title = "The Warden's Keep";
  return m;
}
export function blankMap(w, h) {
  return { v:1, title:"Untitled", w, h, dark:0.55, grid:true,
    walls:[], doors:[], lights:[], levers:[], props:[], guards:[], tokens:[], spawns:[], floors:{} };
}
export function normalizeMap(m) {
  const b = blankMap(m.w || 20, m.h || 15);
  for (const k in b) if (m[k] == null) m[k] = b[k];
  m.levers.forEach(l => l.targets = l.targets || []);
  m.guards.forEach(g => { g.path = g.path || []; g.fov = g.fov || 70; g.sight = g.sight || 6; g.speed = g.speed || 1.6; });
  return m;
}

/* ===================================================================
   DERIVED STATE: links, doors, lights, chests
   =================================================================== */
export let linksTo = {}, derivedVer = -1;
export function derive() {
  if (derivedVer === mapVer) return;
  derivedVer = mapVer; linksTo = {};
  for (const l of M.levers) for (const t of l.targets) (linksTo[t] = linksTo[t] || []).push(l.id);
}
export const isLinked = id => !!(linksTo[id] && linksTo[id].length);
export const allOn = id => isLinked(id) && linksTo[id].every(l => !!L.levers[l]);
export const lightKind = l => Object.hasOwn(LIGHT_KINDS, l.kind) ? l.kind : 'torch'; // older maps and imports have none
export const canSnuff = l => lightKind(l) !== 'glow' && lightOn(l);
// The live value that leaves a light dark, whether or not a lever is also flipping it.
export const snuffedValue = l => { derive(); return allOn(l.id); };
// A lever-linked thing flips from its starting state when ALL its levers are on.
export function doorOpen(d) { derive(); return isLinked(d.id) ? (!!d.open !== allOn(d.id)) : (L.doors[d.id] != null ? !!L.doors[d.id] : !!d.open); }
export function lightOn(l) { derive(); const base = L.lights[l.id] != null ? !!L.lights[l.id] : !!l.on; return isLinked(l.id) ? (base !== allOn(l.id)) : base; }
export function chestLocked(c) { derive(); return isLinked(c.id) ? (!!c.locked !== allOn(c.id)) : (!!c.locked && !L.unlock[c.id]); }
export function nearestUsable(x, y, range) {
  let best = null, bd = range;
  const consider = (type, o, px, py) => { const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = {type, o}; } };
  for (const l of M.levers) consider("lever", l, l.x, l.y);
  for (const d of M.doors) { const c = closestOnSeg(x, y, d.a[0], d.a[1], d.b[0], d.b[1]); consider("door", d, c[0], c[1]); }
  for (const p of M.props) if (p.kind === "chest") { const c = [clamp(x, p.x - p.w / 2, p.x + p.w / 2), clamp(y, p.y - p.h / 2, p.y + p.h / 2)]; consider("chest", p, c[0], c[1]); }
  for (const l of M.lights) if (canSnuff(l)) consider("light", l, l.x, l.y);
  return best;
}
export function tokenPos(t) { return L.tokens[t.id] || {x:t.x, y:t.y}; }
export function findById(id) {
  for (const k of ["walls","doors","lights","levers","props","guards","tokens","spawns"]) { const o = M[k].find(x => x.id === id); if (o) return {o, k}; }
  return null;
}

/* ===================================================================
   GEOMETRY
   =================================================================== */
export function segX(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax, ry = by - ay, sx_ = dx - cx, sy_ = dy - cy, den = rx * sy_ - ry * sx_;
  if (Math.abs(den) < 1e-12) return false;
  const qx = cx - ax, qy = cy - ay, t = (qx * sy_ - qy * sx_) / den, u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
export function rayHit(ox, oy, dx, dy, s) {
  const ex = s[2] - s[0], ey = s[3] - s[1], den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const qx = s[0] - ox, qy = s[1] - oy, t = (qx * ey - qy * ex) / den, u = (qx * dy - qy * dx) / den;
  return (t >= 0 && u >= 0 && u <= 1) ? t : Infinity;
}
export function closestOnSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1) : 0;
  return [x1 + dx * t, y1 + dy * t];
}
export const distToSeg = (px, py, x1, y1, x2, y2) => { const c = closestOnSeg(px, py, x1, y1, x2, y2); return Math.hypot(px - c[0], py - c[1]); };
export function propRect(p, grow) { const g = grow || 0; return [p.x - p.w / 2 - g, p.y - p.h / 2 - g, p.x + p.w / 2 + g, p.y + p.h / 2 + g]; }
export function propEdges(p) {
  const [x1, y1, x2, y2] = propRect(p, PROP_KINDS[p.kind] && PROP_KINDS[p.kind].round ? -p.w * 0.12 : 0);
  return [[x1,y1,x2,y1],[x2,y1,x2,y2],[x2,y2,x1,y2],[x1,y2,x1,y1]];
}
export function lineHitsRect(ax, ay, bx, by, r) {
  const inside = (x, y) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
  if (inside(ax, ay) || inside(bx, by)) return true;
  return segX(ax,ay,bx,by,r[0],r[1],r[2],r[1]) || segX(ax,ay,bx,by,r[2],r[1],r[2],r[3]) || segX(ax,ay,bx,by,r[2],r[3],r[0],r[3]) || segX(ax,ay,bx,by,r[0],r[3],r[0],r[1]);
}

// Blocker segment lists, rebuilt when the map or any door changes.
export let geoKey = "", SIGHT = [], MOVE = [], LIGHTB = [], lightPolys = {};
export function refreshGeo() {
  const k = mapVer + "|" + M.doors.map(d => doorOpen(d) ? 1 : 0).join("");
  if (k === geoKey) return;
  geoKey = k; lightPolys = {};
  const walls = M.walls.map(w => [w.a[0], w.a[1], w.b[0], w.b[1]]);
  const closed = M.doors.filter(d => !doorOpen(d)).map(d => [d.a[0], d.a[1], d.b[0], d.b[1]]);
  MOVE = walls.concat(closed);
  LIGHTB = MOVE;
  SIGHT = MOVE.slice();
  for (const p of M.props) if (p.tall) SIGHT.push(...propEdges(p));
}
export function blocked(segs, ax, ay, bx, by) {
  for (const s of segs) if (segX(ax, ay, bx, by, s[0], s[1], s[2], s[3])) return true;
  return false;
}
export function castPoly(ox, oy, a0, a1, rays, R, segs) {
  const pts = [];
  for (let i = 0; i <= rays; i++) {
    const a = a0 + (a1 - a0) * i / rays, dx = Math.cos(a), dy = Math.sin(a);
    let t = R;
    for (const s of segs) { const h = rayHit(ox, oy, dx, dy, s); if (h < t) t = h; }
    pts.push([ox + dx * t, oy + dy * t]);
  }
  return pts;
}
export function lightPoly(l) {
  refreshGeo();
  const k = l.id + "|" + l.x + "|" + l.y + "|" + l.r;
  if (!lightPolys[k]) lightPolys[k] = castPoly(l.x, l.y, 0, Math.PI * 2, 120, l.r, LIGHTB);
  return lightPolys[k];
}
// How well lit a point is: 0 = pitch black, 1 = bright.
export function lightLevel(x, y) {
  let lvl = 1 - M.dark;
  for (const l of M.lights) {
    if (!lightOn(l)) continue;
    const d = Math.hypot(x - l.x, y - l.y);
    if (d < l.r && !blocked(LIGHTB, l.x, l.y, x, y)) lvl = Math.max(lvl, 1 - 0.55 * d / l.r);
  }
  if (M.floors[Math.floor(x) + "_" + Math.floor(y)] === "shadow") lvl *= 0.4;
  return clamp(lvl, 0, 1);
}

/* ===================================================================
   SIGHT (g is a guard's pose {x, y, a}; def is its map entry; p is a point)
   =================================================================== */
const TOUCH = 0.9;               // this close, a guard notices you whatever way they face
const NEAR_RANGE = 4;            // squares beyond sight range where the warning starts
const NEAR_ANGLE = Math.PI / 2;  // radians outside the view cone where the warning starts
// Darkness shortens how far a guard can see someone.
export const sightRange = (def, p) => def.sight * (0.35 + 0.65 * lightLevel(p.x, p.y));
function angleOff(g, p) {
  const d = Math.atan2(p.y - g.y, p.x - g.x) - g.a;
  return Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
}
export function guardSees(g, def, p) {
  const d = Math.hypot(p.x - g.x, p.y - g.y);
  return d < TOUCH || (d < sightRange(def, p) && angleOff(g, p) <= def.fov * Math.PI / 360 && !blocked(SIGHT, g.x, g.y, p.x, p.y));
}
// 0 = no danger, 1 = seen. Climbs as p gets close to being in range and inside the view cone, or right next to the guard.
export function sightThreat(g, def, p) {
  if (guardSees(g, def, p)) return 1;
  if (blocked(SIGHT, g.x, g.y, p.x, p.y)) return 0;
  const d = Math.hypot(p.x - g.x, p.y - g.y);
  const byRange = clamp(1 - (d - sightRange(def, p)) / NEAR_RANGE, 0, 1);
  const byAngle = clamp(1 - (angleOff(g, p) - def.fov * Math.PI / 360) / NEAR_ANGLE, 0, 1);
  const byTouch = clamp(1 - (d - TOUCH) / 2, 0, 1);
  return Math.min(0.9, Math.max(byRange * byAngle, byTouch));
}
// Token opacity: faint in the dark or on shadow floor, solid in full light.
export function lightAlpha(x, y) {
  const dim = 1 - M.dark;
  if (dim >= 0.85) return 1;
  return 0.35 + 0.65 * clamp((lightLevel(x, y) - dim) / (0.85 - dim), 0, 1);
}

/* ===================================================================
   HEARING GUARDS
   =================================================================== */
export const hearingRange = (score, rushing) => Math.max(0, score - HEARING.offset + (rushing ? HEARING.rushBonus : 0));
// My passive Perception, or a better Listen roll while it lasts.
export const perceptionScore = (pc, time) => pc.listen && pc.listen.until > time ? Math.max(pc.passive, pc.listen.score) : pc.passive;
export function canHear(listener, score, source, rushing) {
  let range = hearingRange(score, rushing);
  if (blocked(LIGHTB, listener.x, listener.y, source.x, source.y)) range *= 0.5;
  return range > 0 && Math.hypot(source.x - listener.x, source.y - listener.y) <= range;
}

/* ===================================================================
   MOVEMENT / COLLISION
   =================================================================== */
export function resolveCircle(o, r) {
  for (let it = 0; it < 3; it++) {
    for (const s of MOVE) {
      if (Math.min(s[0], s[2]) - r > o.x || Math.max(s[0], s[2]) + r < o.x || Math.min(s[1], s[3]) - r > o.y || Math.max(s[1], s[3]) + r < o.y) continue;
      const c = closestOnSeg(o.x, o.y, s[0], s[1], s[2], s[3]), dx = o.x - c[0], dy = o.y - c[1], d = Math.hypot(dx, dy);
      if (d < r && d > 1e-6) { o.x += dx / d * (r - d); o.y += dy / d * (r - d); }
    }
    for (const p of M.props) {
      const k = PROP_KINDS[p.kind] || {};
      if (k.round) {
        const R = p.w / 2 + r, dx = o.x - p.x, dy = o.y - p.y, d = Math.hypot(dx, dy);
        if (d < R && d > 1e-6) { o.x = p.x + dx / d * R; o.y = p.y + dy / d * R; }
      } else {
        const [x1, y1, x2, y2] = propRect(p);
        const cx = clamp(o.x, x1, x2), cy = clamp(o.y, y1, y2), dx = o.x - cx, dy = o.y - cy, d = Math.hypot(dx, dy);
        if (d < r) {
          if (d > 1e-6) { o.x += dx / d * (r - d); o.y += dy / d * (r - d); }
          else { // inside: push out the nearest side
            const opts = [[o.x - x1, -1, 0], [x2 - o.x, 1, 0], [o.y - y1, 0, -1], [y2 - o.y, 0, 1]].sort((a, b) => a[0] - b[0])[0];
            o.x += opts[1] * (opts[0] + r); o.y += opts[2] * (opts[0] + r);
          }
        }
      }
    }
  }
  o.x = clamp(o.x, r, M.w - r); o.y = clamp(o.y, r, M.h - r);
}
export function moveCircle(o, dx, dy, r) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.08));
  for (let i = 0; i < steps; i++) { o.x += dx / steps; o.y += dy / steps; resolveCircle(o, r); }
}
