// Guard navigation and AI (run by the host browser) and the GM rulings.
import {
  LIGHTB, MOVE, blocked, derive, doorOpen, guardSees, isLinked, lightLevel, lineHitsRect, propRect, refreshGeo, segX
} from './stealth-model.js';
import { Net } from './stealth-net.js';
import { respawn } from './stealth-play.js';
import { GUARDS_SYNC, HOST, L, M, NOISE, PLAYERS, SPOT_COOLDOWN, clamp, isGM, isHost, mapVer, me, now, solo } from './stealth-state.js';

/* ===================================================================
   HOST: NAV GRID + GUARD AI
   Only one browser (the GM's, or a player if no GM) runs the guards.
   =================================================================== */
export let NAV = null, navVer = -1;
export const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
export function buildNav() {
  if (navVer === mapVer) return;
  navVer = mapVer;
  const W = M.w, H = M.h, n = W * H;
  // bucket walls by cell to keep edge checks fast on big dd2vtt maps
  const buckets = Array.from({length:n}, () => []);
  M.walls.forEach((w, i) => {
    const x1 = Math.floor(Math.min(w.a[0], w.b[0]) - .01), x2 = Math.floor(Math.max(w.a[0], w.b[0]) + .01);
    const y1 = Math.floor(Math.min(w.a[1], w.b[1]) - .01), y2 = Math.floor(Math.max(w.a[1], w.b[1]) + .01);
    for (let y = Math.max(0, y1); y <= Math.min(H - 1, y2); y++) for (let x = Math.max(0, x1); x <= Math.min(W - 1, x2); x++) buckets[y * W + x].push(i);
  });
  const solid = M.props.map(p => propRect(p, 0.15));
  const free = new Uint8Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const cx = x + .5, cy = y + .5;
    free[y * W + x] = solid.some(r => cx >= r[0] && cx <= r[2] && cy >= r[1] && cy <= r[3]) ? 0 : 1;
  }
  const edges = new Array(n);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, list = [];
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx; if (!free[j]) continue;
      const ax = x + .5, ay = y + .5, bx = nx + .5, by = ny + .5;
      const cells = new Set([i, j, y * W + nx, ny * W + x]);
      let hit = false;
      for (const c of cells) { for (const wi of buckets[c]) { const w = M.walls[wi]; if (segX(ax, ay, bx, by, w.a[0], w.a[1], w.b[0], w.b[1])) { hit = true; break; } } if (hit) break; }
      if (hit) continue;
      if (solid.some(r => lineHitsRect(ax, ay, bx, by, r))) continue;
      const doors = M.doors.filter(d => segX(ax, ay, bx, by, d.a[0], d.a[1], d.b[0], d.b[1])).map(d => d.id);
      list.push([j, doors.length ? doors : null]);
    }
    edges[i] = list;
  }
  NAV = { W, H, edges, free };
}
export function findPath(fx, fy, tx, ty) {
  buildNav(); derive();
  const W = NAV.W, H = NAV.H;
  const s = clamp(Math.floor(fy), 0, H - 1) * W + clamp(Math.floor(fx), 0, W - 1);
  const t = clamp(Math.floor(ty), 0, H - 1) * W + clamp(Math.floor(tx), 0, W - 1);
  const doorById = id => M.doors.find(d => d.id === id);
  const prev = new Int32Array(W * H).fill(-1); prev[s] = s;
  const q = [s]; let qi = 0;
  while (qi < q.length) {
    const i = q[qi++]; if (i === t) break;
    for (const [j, doors] of NAV.edges[i]) {
      if (prev[j] !== -1) continue;
      if (doors && doors.some(id => { const d = doorById(id); return d && isLinked(id) && !doorOpen(d); })) continue; // locked gates
      prev[j] = i; q.push(j);
    }
  }
  if (prev[t] === -1) return null;
  const path = []; let c = t;
  while (c !== s) { path.unshift([c % W + .5, Math.floor(c / W) + .5]); c = prev[c]; }
  if (path.length) path[path.length - 1] = [tx, ty]; else path.push([tx, ty]);
  return path;
}
export function clearForGuard(ax, ay, bx, by) {
  if (blocked(MOVE, ax, ay, bx, by)) return false;
  for (const p of M.props) if (lineHitsRect(ax, ay, bx, by, propRect(p, 0.2))) return false;
  return true;
}
export function closedDoorBetween(ax, ay, bx, by) {
  for (const d of M.doors) if (!doorOpen(d) && segX(ax, ay, bx, by, d.a[0], d.a[1], d.b[0], d.b[1])) return d;
  return null;
}

export let HG = null; // host guard runtime objects
export function buildGuards(fromSync) {
  HG = M.guards.map(def => {
    const s = fromSync && GUARDS_SYNC[def.id];
    return { id:def.id, def, x:s ? s.x : def.x, y:s ? s.y : def.y, a:s ? s.a : def.face * Math.PI / 180,
             st:"home", wi:0, path:null, target:null, doorT:0, lookT:0, timer:0, info:"", cool:{}, hearT:0, blockN:0 };
  });
  HG.forEach(g => { if (g.def.mode === "patrol" && g.def.path.length) { g.wi = nearestWay(g); } });
}
export function nearestWay(g) {
  let bi = 0, bd = 1e9;
  g.def.path.forEach((w, i) => { const d = Math.hypot(w[0] - g.x, w[1] - g.y); if (d < bd) { bd = d; bi = i; } });
  return bi;
}
export function turnToward(g, ang, dt, rate) {
  let d = ang - g.a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  const m = rate * dt; g.a += Math.abs(d) < m ? d : Math.sign(d) * m;
}
// Walk along g.path. Returns "done", "moving", "waiting" or "blocked".
export function followPath(g, dt, speed) {
  if (!g.path || !g.path.length) return "done";
  refreshGeo();
  while (g.path.length > 1 && clearForGuard(g.x, g.y, g.path[1][0], g.path[1][1])) g.path.shift();
  const [tx, ty] = g.path[0];
  const door = closedDoorBetween(g.x, g.y, tx, ty);
  if (door) {
    const mx = (door.a[0] + door.b[0]) / 2, my = (door.a[1] + door.b[1]) / 2;
    turnToward(g, Math.atan2(my - g.y, mx - g.x), dt, 6);
    derive();
    if (isLinked(door.id)) { g.path = null; return "blocked"; }
    g.doorT += dt; g.info = "…";
    if (g.doorT > 1.4) { g.doorT = 0; Net.live("doors/" + door.id, true); Net.fx(mx, my - .3, g.def.name + " opens the door", "#e24b4a"); }
    return "waiting";
  }
  g.doorT = 0;
  const dx = tx - g.x, dy = ty - g.y, d = Math.hypot(dx, dy), m = speed * dt;
  if (d > 0.01) turnToward(g, Math.atan2(dy, dx), dt, 7);
  if (d <= m) { g.x = tx; g.y = ty; g.path.shift(); return g.path.length ? "moving" : "done"; }
  g.x += dx / d * m; g.y += dy / d * m;
  return "moving";
}
export function goHome(g) { g.st = "home"; g.path = null; g.target = null; if (g.def.mode === "patrol" && g.def.path.length) g.wi = nearestWay(g); }
export let simTime = 0;
export function updateGuard(g, dt) {
  const def = g.def;
  g.info = (g.st === "invest" || g.st === "look") ? "?" : g.st === "alert" ? "!" : "";
  if (g.st === "alert") { g.timer -= dt; if (g.timer <= 0) goHome(g); return; }
  if (g.st === "look") { g.a += dt * 2.3; g.lookT -= dt; if (g.lookT <= 0) goHome(g); return; }
  if (g.st === "invest") {
    if (!g.path) { g.path = findPath(g.x, g.y, g.target.x, g.target.y); if (!g.path) { g.st = "look"; g.lookT = 2; return; } }
    const r = followPath(g, dt, def.speed * 1.6);
    if (r === "done") { g.st = "look"; g.lookT = 3; }
    if (r === "blocked") { g.st = "look"; g.lookT = 2; }
    return;
  }
  // home behaviour
  if (def.mode === "patrol" && def.path.length >= 2) {
    const w = def.path[g.wi % def.path.length];
    if (!g.path) {
      g.path = findPath(g.x, g.y, w[0], w[1]);
      if (!g.path) { g.timer += dt; if (g.timer > 1.5) { g.timer = 0; g.wi = (g.wi + 1) % def.path.length; } return; }
    }
    const r = followPath(g, dt, def.speed);
    if (r === "done") { g.wi = (g.wi + 1) % def.path.length; g.path = null; }
    if (r === "blocked") { g.wi = (g.wi + 1) % def.path.length; }
    return;
  }
  // survey / stand: go back to the post, then look
  const post = def.mode === "patrol" && def.path.length === 1 ? {x:def.path[0][0], y:def.path[0][1]} : {x:def.x, y:def.y};
  if (Math.hypot(g.x - post.x, g.y - post.y) > 0.15) {
    if (!g.path) { g.path = findPath(g.x, g.y, post.x, post.y); if (!g.path) return; }
    followPath(g, dt, def.speed);
    return;
  }
  g.path = null;
  const face = def.face * Math.PI / 180;
  if (def.mode === "survey") turnToward(g, face + Math.sin(simTime * 0.7 + hashNum(g.id)) * (def.sweep * Math.PI / 360), dt, 3);
  else turnToward(g, face, dt, 3);
}
export function hashNum(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return (h % 1000) / 100; }

export const activePlayers = () => Object.values(PLAYERS).filter(p => p && !p.caught && M);
export function hostSpotAndHear() {
  const t = now();
  for (const g of HG) {
    if (g.st === "alert") continue;
    for (const p of activePlayers()) {
      // sight
      if ((g.cool[p.id] || 0) <= t) {
        if (guardSees(g, g.def, p)) { spot(g, p); return; }
      }
      // hearing
      if (p.mv && g.hearT < t) {
        let r = NOISE[p.md] || NOISE.normal;
        if (blocked(LIGHTB, g.x, g.y, p.x, p.y)) r *= 0.5;
        if (Math.hypot(p.x - g.x, p.y - g.y) < r) {
          g.hearT = t + 3500;
          g.st = "invest"; g.target = {x:p.x, y:p.y}; g.path = null;
          Net.fx(g.x, g.y - .7, "Footsteps?", "#e0a243");
        }
      }
    }
  }
}
export function spot(g, p) {
  Net.live("spotted", {gid:g.id, gname:g.def.name, pp:g.def.pp || 0, pid:p.id, pname:p.name, x:p.x, y:p.y, light:Math.round(lightLevel(p.x, p.y) * 100), md:p.md, stealth:p.stealth ?? null, dis:!!p.dis});
  Net.live("paused", true);
}
export function hostNoise(n) {
  if (!HG || L.paused || L.edit) return;
  let best = null, bd = 1e9;
  for (const g of HG) {
    if (g.st === "alert") continue;
    let r = n.r; if (blocked(LIGHTB, g.x, g.y, n.x, n.y)) r *= 0.5;
    const d = Math.hypot(g.x - n.x, g.y - n.y);
    if (d < r && d < bd) { bd = d; best = g; }
  }
  if (best) { best.st = "invest"; best.target = {x:n.x, y:n.y}; best.path = null; Net.fx(best.x, best.y - .7, "Hm?", "#e0a243"); }
}
export let lastGuardPush = 0;
export function hostTick(dt) {
  if (!M) return;
  if (!HG) buildGuards(true);
  refreshGeo();
  if (!L.paused && !L.edit) {
    simTime += dt;
    for (const g of HG) {
      const { x, y } = g;
      updateGuard(g, dt);
      g.mv = Math.hypot(g.x - x, g.y - y) > 1e-4; // walking guards can be heard
    }
    hostSpotAndHear();
  } else for (const g of HG) g.mv = false;
  if (now() - lastGuardPush > (solo ? 0 : 120)) {
    lastGuardPush = now();
    const out = {};
    for (const g of HG) out[g.id] = {x:+g.x.toFixed(2), y:+g.y.toFixed(2), a:+g.a.toFixed(2), st:g.st, info:g.info, mv:!!g.mv};
    Net.guards(out);
  }
}

/* ===================================================================
   GM: PAUSE, SPOTTED RULINGS, RESET, PLAY-MODE CLICKS
   =================================================================== */
export function togglePause() {
  if (!isGM || L.edit) return;
  if (L.paused && L.spotted) { resolveSpot("notseen"); return; }
  Net.live("paused", !L.paused);
}
export function resolveSpot(kind) {
  const sp = L.spotted; if (!sp) return;
  const g = HG && HG.find(x => x.id === sp.gid);
  if (g) g.cool[sp.pid] = now() + SPOT_COOLDOWN;
  if (kind === "invest" && g) { g.st = "invest"; g.target = {x:sp.x, y:sp.y}; g.path = null; g.cool[sp.pid] = now() + 2500; }
  if (kind === "caught") {
    const cells = M.spawns.filter(s => s.kind === "cell");
    if (cells.length) { const c = cells[Math.floor(Math.random() * cells.length)]; Net.cmd(sp.pid, {x:c.x, y:c.y, caught:true}); }
    else Net.cmd(sp.pid, {caught:true});
    if (g) { g.st = "alert"; g.timer = 1.5; g.path = null; }
    Net.fx(sp.x, sp.y - .6, sp.pname + " was caught!", "#e24b4a");
  }
  Net.live("spotted", null);
  Net.live("paused", kind === "hold");
}
export function resetScene() {
  if (!isGM) return;
  Net.liveAll({levers:{}, doors:{}, chests:{}, unlock:{}, lights:{}, tokens:{}, paused:true, spotted:null, edit:L.edit});
  buildGuards(false);
  for (const pid in PLAYERS) Net.cmd(pid, {respawn:true});
  if (me) respawn();
  Net.clearDice();
}

export function onHost() {
  if (!HOST) { setTimeout(() => { if (!HOST) Net.claimHost(isGM); }, 300 + Math.random() * 700); return; }
  if (isGM && !isHost() && HOST.gm === false) Net.claimHost(true);
  if (isHost() && !HG && M) buildGuards(true);
  if (!isHost()) HG = null;
}
