// Guard navigation and AI (run by the host browser) and the GM rulings.
import {
  LIGHTB, MOVE, blocked, chaseSees, derive, doorOpen, guardNotices, guardSees, inEarshot, isLinked, isOut, lightKind, lightLevel, lightOn,
  lineHitsRect, litValue, postOf, propRect, refitGuard, refreshGeo, segX
} from './stealth2-model.js';
import { Net } from './stealth2-net.js';
import { respawn } from './stealth2-play.js';
import { ACT, GUARDS_SYNC, HOST, L, M, NOISE, PLAYERS, SPOT_COOLDOWN, clamp, isGM, isHost, mapVer, me, now, solo } from './stealth2-state.js';

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
  const lines = M.walls.concat(M.windows); // neither can be walked through
  lines.forEach((w, i) => {
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
      for (const c of cells) { for (const wi of buckets[c]) { const w = lines[wi]; if (segX(ax, ay, bx, by, w.a[0], w.a[1], w.b[0], w.b[1])) { hit = true; break; } } if (hit) break; }
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
function newGuard(def, s) {
  const g = { id:def.id, def, post:postOf(def), x:s ? s.x : def.x, y:s ? s.y : def.y, a:s ? s.a : def.face * Math.PI / 180,
              st:s && isOut(s.st) ? s.st : "home", wi:0, path:null, target:null, doorT:0, lookT:0, timer:0, info:"", cool:{}, hearT:0, blockN:0,
              focus:null, prey:null, lastSeen:0, repath:0, lightId:null, fooled:{}, held:false, seenLights:rememberLights() };
  if (def.mode === "patrol" && def.path.length) g.wi = nearestWay(g);
  return g;
}
// Start every guard afresh, or (fromSync) pick up where the last host left them.
export function buildGuards(fromSync) {
  HG = M.guards.map(def => newGuard(def, fromSync && GUARDS_SYNC[def.id]));
}
// The map changed mid-game: add and drop guards to match, and leave the rest where they are.
export function syncGuards() {
  if (!HG) return; // the next tick builds them
  const running = new Map(HG.map(g => [g.id, g]));
  HG = M.guards.map(def => {
    const g = running.get(def.id);
    if (!g) return newGuard(def);
    if (refitGuard(g, def) && def.path.length) g.wi = nearestWay(g);
    return g;
  });
  if (L.spotted && !M.guards.some(def => def.id === L.spotted.gid)) Net.live("spotted", null);
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
export function goHome(g) { g.st = "home"; g.path = null; g.target = null; g.focus = g.prey = g.lightId = null; if (g.def.mode === "patrol" && g.def.path.length) g.wi = nearestWay(g); }
export let simTime = 0;
export function updateGuard(g, dt) {
  const def = g.def;
  g.info = ["invest", "look", "relight"].includes(g.st) ? "?" : ["alert", "chase"].includes(g.st) ? "!" : g.st === "distract" ? "♪" : "";
  if (isOut(g.st)) { g.info = ""; return; }
  if (g.st === "distract") {
    const p = PLAYERS[g.focus];
    if (p) turnToward(g, Math.atan2(p.y - g.y, p.x - g.x), dt, 6);
    g.timer -= dt; if (g.timer <= 0) goHome(g);
    return;
  }
  if (g.st === "chase") { updateChase(g, dt); return; }
  if (g.st === "relight") { updateRelight(g, dt); return; }
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
// Run after the quarry: straight at them when the way is clear, by the nav grid when not.
export function startChase(g, pid) {
  const p = PLAYERS[pid]; if (!p) return;
  goHome(g);
  g.st = "chase"; g.prey = pid; g.target = {x:p.x, y:p.y}; g.lastSeen = simTime; g.repath = 0;
}
function updateChase(g, dt) {
  const p = PLAYERS[g.prey];
  if (!p || p.caught) { goHome(g); return; }
  if (chaseSees(g, g.def, p)) { g.lastSeen = simTime; g.target = {x:p.x, y:p.y}; }
  if ((simTime - g.lastSeen) * 1000 > ACT.loseMs) { // lost them: check the last place they were seen
    Net.fx(g.x, g.y - .7, "Where did they go?", "#e0a243");
    const last = g.target; goHome(g); g.st = "invest"; g.target = last; return;
  }
  if (Math.hypot(p.x - g.x, p.y - g.y) < ACT.grab && !blocked(MOVE, g.x, g.y, p.x, p.y) && (g.cool[p.id] || 0) <= now()) { raise(g, p, "reached"); return; }
  g.repath -= dt;
  if (g.repath <= 0 || !g.path || !g.path.length) {
    g.repath = 0.4;
    g.path = clearForGuard(g.x, g.y, g.target.x, g.target.y) ? [[g.target.x, g.target.y]] : findPath(g.x, g.y, g.target.x, g.target.y);
  }
  if (followPath(g, dt, ACT.chaseSpeed) === "blocked") g.path = null;
}

// What this guard believes each torch and brazier looks like.
function rememberLights() { return Object.fromEntries(M.lights.filter(l => lightKind(l) !== "glow").map(l => [l.id, lightOn(l)])); }
function noticeLights(g) {
  for (const l of M.lights) {
    if (lightKind(l) === "glow") continue;
    const on = lightOn(l);
    if (g.seenLights[l.id] === undefined) g.seenLights[l.id] = on;
    if (g.seenLights[l.id] === on || !guardNotices(g, g.def, l)) continue;
    if (on) { // someone lit it: take a look
      g.seenLights[l.id] = on;
      Net.fx(g.x, g.y - 1.15, "Who lit that?", "#e0a243");
      g.st = "invest"; g.target = {x:l.x, y:l.y}; g.path = null; return;
    }
    if (HG.some(other => other !== g && other.st === "relight" && other.lightId === l.id)) { g.seenLights[l.id] = on; continue; }
    // Memory is only updated once it is lit again, so an interrupted guard notices it again.
    Net.fx(g.x, g.y - 1.15, "Who put that out?", "#e0a243"); // above any "Hm?" from the noise
    g.st = "relight"; g.lightId = l.id; g.timer = 0; g.path = null; return;
  }
}
function updateRelight(g, dt) {
  const l = M.lights.find(light => light.id === g.lightId);
  if (!l || lightOn(l)) { if (l) g.seenLights[l.id] = true; goHome(g); return; }
  if (Math.hypot(l.x - g.x, l.y - g.y) <= 1.1) {
    turnToward(g, Math.atan2(l.y - g.y, l.x - g.x), dt, 6);
    g.timer += dt;
    if (g.timer * 1000 >= ACT.relightMs) {
      Net.live("lights/" + l.id, litValue(l));
      Net.fx(l.x, l.y - .6, g.def.name + " relights the " + lightKind(l), "#e0a243");
      g.seenLights[l.id] = true; goHome(g);
    }
    return;
  }
  if (!g.path) { g.path = findPath(g.x, g.y, l.x, l.y); if (!g.path) { g.seenLights[l.id] = false; g.st = "look"; g.lookT = 2; return; } }
  const r = followPath(g, dt, g.def.speed * 1.3);
  if (r === "blocked") { g.seenLights[l.id] = false; g.st = "look"; g.lookT = 2; }
  if (r === "done") g.path = null;
}

export function hashNum(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return (h % 1000) / 100; }

export const activePlayers = () => Object.values(PLAYERS).filter(p => p && !p.caught && M);
const busy = g => g.held || isOut(g.st) || g.st === "alert" || g.st === "chase"; // these don't look out for anyone else
export function hostSpotAndHear() {
  const t = now();
  for (const g of HG) {
    if (busy(g)) continue;
    for (const p of activePlayers()) {
      // sight (a distracted guard is looking right at the performer and doesn't mind them)
      if ((g.cool[p.id] || 0) <= t && !(g.st === "distract" && g.focus === p.id)) {
        if (guardSees(g, g.def, p)) { raise(g, p, "seen"); return; }
      }
      // hearing
      if (p.mv && g.hearT < t && g.st !== "distract") {
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
// Pause the game and ask the GM to rule. why: "seen", "fooled" (a distraction failed), "reached" or "attack".
export function raise(g, p, why, extra) {
  Net.live("spotted", {why, gid:g.id, gname:g.def.name, pp:g.def.pp || 0, pid:p.id, pname:p.name, x:p.x, y:p.y, light:Math.round(lightLevel(p.x, p.y) * 100), md:p.md, stealth:p.stealth ?? null, dis:!!p.dis, ...extra});
  Net.live("paused", true);
}

// A player's taunt, distraction or attack, carried out by whoever runs the guards.
export function hostAct(a) {
  if (!HG || L.paused) return;
  const p = PLAYERS[a.pid]; if (!p || p.caught) return;
  const say = (g, text, color) => Net.fx(g.x, g.y - .7, text, color || "#e0a243");
  if (a.type === "taunt") {
    // The chosen guard, or else the nearest one that can hear.
    const hearing = HG.filter(g => !isOut(g.st) && g.st !== "alert" && (!a.gid || g.id === a.gid) && inEarshot(p, g, ACT.tauntRange))
      .sort((x, y) => Math.hypot(x.x - p.x, x.y - p.y) - Math.hypot(y.x - p.x, y.y - p.y));
    if (!hearing.length) { Net.fx(p.x, p.y - .9, "No guard hears you", "#a89a87"); return; }
    startChase(hearing[0], p.id); say(hearing[0], "Hey! Get back here!", "#e24b4a");
    return;
  }
  const g = HG.find(x => x.id === a.gid); if (!g || isOut(g.st)) return;
  if (a.type === "distract") {
    if (g.st === "chase" || g.st === "alert") { say(g, "Not now!"); return; }
    if (!inEarshot(p, g, ACT.distractRange)) { Net.fx(p.x, p.y - .9, g.def.name + " can't hear you", "#a89a87"); return; }
    if ((g.fooled[p.id] || 0) > now()) { say(g, "Not that again."); return; }
    if (Number(a.total) >= (g.def.pp || 10)) {
      goHome(g); g.st = "distract"; g.focus = p.id; g.timer = ACT.distractMs / 1000;
      g.fooled[p.id] = now() + ACT.distractAgainMs;
      g.cool[p.id] = now() + ACT.distractMs + 1500; // a moment to slip away
      say(g, "Hm? What's this?", "#3fb899");
    } else raise(g, p, "fooled", {skill:String(a.skill), total:Number(a.total)});
    return;
  }
  if (a.type === "attack") {
    g.a = g.st === "distract" || a.unseen ? g.a : Math.atan2(p.y - g.y, p.x - g.x);
    raise(g, p, "attack", {weapon:String(a.weapon), total:Number(a.total), face:Number(a.face), damage:Number(a.damage), unseen:!!a.unseen});
  }
}
export function hostNoise(n) {
  if (!HG || L.paused) return;
  let best = null, bd = 1e9;
  for (const g of HG) {
    if (busy(g) || g.st === "distract") continue;
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
  if (!L.paused) { // the GM may be editing: the scene carries on unless it is paused
    simTime += dt;
    for (const g of HG) {
      if (L.paused) break; // a chasing guard just caught someone: one ruling at a time
      const { x, y } = g;
      if (g.held) { g.mv = false; continue; } // the GM is dragging them
      if (["home", "look", "invest"].includes(g.st)) noticeLights(g);
      updateGuard(g, dt);
      g.mv = Math.hypot(g.x - x, g.y - y) > 1e-4; // walking guards can be heard
    }
    if (!L.paused) hostSpotAndHear();
  } else for (const g of HG) g.mv = false;
  if (now() - lastGuardPush > (solo ? 0 : 120)) {
    lastGuardPush = now();
    const out = {};
    for (const g of HG) out[g.id] = {x:+g.x.toFixed(2), y:+g.y.toFixed(2), a:+g.a.toFixed(2), st:g.st, info:g.info, mv:!!g.mv, focus:g.focus};
    Net.guards(out);
  }
}

/* ===================================================================
   GM: PAUSE, SPOTTED RULINGS, RESET, PLAY-MODE CLICKS
   =================================================================== */
export function togglePause() {
  if (!isGM) return;
  if (L.paused && L.spotted) { if (L.spotted.why !== "attack") resolveSpot("notseen"); return; } // an attack needs a ruling
  Net.live("paused", !L.paused);
}
export function resolveSpot(kind) {
  const sp = L.spotted; if (!sp) return;
  const g = HG && HG.find(x => x.id === sp.gid), p = PLAYERS[sp.pid];
  const investigate = () => { goHome(g); g.st = "invest"; g.target = {x:sp.x, y:sp.y}; };
  if (g) g.cool[sp.pid] = now() + SPOT_COOLDOWN;
  if (kind === "notseen" && g && sp.why === "reached") { goHome(g); g.st = "look"; g.lookT = 2.5; Net.fx(g.x, g.y - .7, sp.pname + " breaks free!", "#3fb899"); }
  if (kind === "invest" && g) { investigate(); g.cool[sp.pid] = now() + 2500; }
  if (kind === "chase" && g && p) { startChase(g, sp.pid); g.cool[sp.pid] = now() + 800; Net.fx(g.x, g.y - .7, "Stop right there!", "#e24b4a"); }
  if (kind === "caught") {
    const cells = M.spawns.filter(s => s.kind === "cell");
    if (cells.length) { const c = cells[Math.floor(Math.random() * cells.length)]; Net.cmd(sp.pid, {x:c.x, y:c.y, caught:true}); }
    else Net.cmd(sp.pid, {caught:true});
    if (g) { goHome(g); g.st = "alert"; g.timer = 1.5; }
    Net.fx(sp.x, sp.y - .6, sp.pname + " was caught!", "#e24b4a");
  }
  // Attack rulings
  if (kind === "miss" && g) { investigate(); g.cool[sp.pid] = now() + 1200; }
  if (kind === "wounded" && g && p) { startChase(g, sp.pid); g.cool[sp.pid] = now() + 1200; Net.fx(g.x, g.y - .7, "Argh!", "#e24b4a"); }
  const downed = (kind === "down" || kind === "dead") && g;
  if (downed) { goHome(g); g.st = kind; Net.fx(g.x, g.y - .7, g.def.name + (kind === "dead" ? " is killed" : " goes down"), "#3fb899"); }
  Net.live("spotted", null);
  Net.live("paused", kind === "hold");
  if (downed) hostNoise({x:g.x, y:g.y, r:4}); // the thud, once play has resumed
}
// The GM's say-so over a guard, paused or not: "down", "dead", "gone" (off the field) or "wake".
// Nothing is announced, so players only learn of it by looking.
export function gmGuard(gid, verdict) {
  const g = isGM && HG?.find(x => x.id === gid); if (!g) return false;
  if (L.spotted?.gid === gid) Net.live("spotted", null); // nothing left to rule on
  goHome(g);
  if (verdict !== "wake") g.st = verdict;
  g.info = ""; g.mv = false; g.held = false;
  return true;
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
