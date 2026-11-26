// Player movement and use, keyboard, and play-mode pointer controls.
import { closeMenu, guardAt, openGmMenu, openMenu, targetAt, taunt } from './stealth2-actions.js';
import { rollListen } from './stealth2-dice.js';
import { addFloat, cam, playerView, setFollow, toWorld } from './stealth2-draw.js';
import { cancelTool, deleteObj, editDown, editMove, editUp, endWallChain, sel, updateGmHint } from './stealth2-editor.js';
import { HG, gmGuard, goHome, togglePause } from './stealth2-guards.js';
import {
  canSnuff, chestLocked, derive, distToSeg, doorOpen, hearingRange, isLinked, isOut, lightKind, litValue, moveCircle, nearestUsable,
  perceptionScore, propRect, refreshGeo, resolveCircle, snuffedValue, tokenPos
} from './stealth2-model.js';
import { Net } from './stealth2-net.js';
import { $, HEARING, L, LIGHT_KINDS, M, PLAYERS, P_RAD, SPEED, cv, editing, isGM, keys, me, now } from './stealth2-state.js';

export function respawn() {
  if (!me || !M) return;
  const sp = M.spawns.filter(s => s.kind === "spawn");
  const s = sp.length ? sp[Math.floor(Math.random() * sp.length)] : {x:M.w / 2, y:M.h / 2};
  me.x = s.x + (Math.random() - .5) * .4; me.y = s.y + (Math.random() - .5) * .4; me.caught = false; me.match = false;
  refreshGeo(); resolveCircle(me, P_RAD);
  setFollow(true);
}
export function applyCmd(c) {
  if (!me || c.t === me.lastCmd) return;
  me.lastCmd = c.t;
  if (c.respawn) { respawn(); return; }
  if (c.x != null) { me.x = c.x; me.y = c.y; }
  if (c.caught != null) { me.caught = c.caught; me.cx = me.x; me.cy = me.y; if (c.caught) me.match = false; }
}

/* ===================================================================
   INPUT
   =================================================================== */
export function toggleSneak() {
  if (me) me.md = me.md === "sneak" ? "normal" : "sneak";
}
const MOVE_KEYS = ["w","a","s","d","arrowup","arrowleft","arrowdown","arrowright"];
// Stand still and roll Perception: for a few seconds a good roll hears farther than passive Perception.
export function listen() {
  if (!me || !M || L.paused) return;
  const t = now(), say = text => addFloat(me.x, me.y - .7, text, "#ffa53d");
  if (MOVE_KEYS.some(k => keys[k])) return say("Stand still to listen");
  if (t < me.listenReady) return say(`Listen again in ${Math.ceil((me.listenReady - t) / 1000)}s`);
  const score = rollListen();
  me.listen = { score, until: t + HEARING.listenMs };
  me.listenReady = t + HEARING.cooldownMs;
  say(`Listening… ${hearingRange(perceptionScore(me, t)) * 5} ft`);
}
export const typing = e => ["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName);
addEventListener("keydown", e => {
  if (typing(e)) return;
  const k = e.key.toLowerCase();
  if (k === " " && e.target.closest?.("button, a")) return; // Space on a keyboard-focused button presses it
  if (!keys[k]) {
    if (k === " ") toggleSneak();
    if (k === "e") interact();
    if (k === "q") listen();
    if (k === "t") taunt();
    if (k === "p" && isGM) togglePause();
    if (k === "escape") { cancelTool(); closeMenu(); selGuard = null; updateGmHint(); }
    if ((k === "delete" || k === "backspace") && editing() && sel) { deleteObj(sel); e.preventDefault(); }
  }
  keys[k] = true;
  if (k === " " || MOVE_KEYS.includes(k)) e.preventDefault();
});
addEventListener("keyup", e => { keys[e.key.toLowerCase()] = false; });
addEventListener("blur", () => { for (const k in keys) keys[k] = false; });

/* ===================================================================
   PLAYER
   =================================================================== */
export function updatePlayer(dt) {
  if (!me) return;
  let dx = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
  let dy = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
  me.mv = !!(dx || dy);
  if (me.mv) {
    const len = Math.hypot(dx, dy); dx /= len; dy /= len;
    me.a = Math.atan2(dy, dx);
    me.listen = null; // footsteps drown it out
    setFollow(true);
    const sp = SPEED[me.md] * dt;
    moveCircle(me, dx * sp, dy * sp, P_RAD);
  }
  if (me.caught && Math.hypot(me.x - me.cx, me.y - me.cy) > 2.5) { me.caught = false; Net.fx(me.x, me.y - .6, me.name + " is loose!", "#3fb899"); }
}
export function interact() {
  if (!me || !M || L.paused) return;
  const it = nearestUsable(me.x, me.y, 1.2, me.match); if (!it) return;
  const o = it.o;
  if (it.type === "lever") {
    Net.live("levers/" + o.id, L.levers[o.id] ? null : true);
    Net.noise({x:o.x, y:o.y, r:3});
  } else if (it.type === "door") {
    derive();
    if (isLinked(o.id)) { Net.fx(me.x, me.y - .6, "It won't budge. There must be a lever.", "#a89a87"); return; }
    const open = doorOpen(o);
    if (open && distToSeg(me.x, me.y, o.a[0], o.a[1], o.b[0], o.b[1]) < P_RAD + .05) return; // standing in the doorway
    Net.live("doors/" + o.id, !open);
    const mx = (o.a[0] + o.b[0]) / 2, my = (o.a[1] + o.b[1]) / 2;
    Net.noise({x:mx, y:my, r:3.5});
  } else if (it.type === "light") {
    const kind = lightKind(o);
    if (canSnuff(o)) {
      Net.live("lights/" + o.id, snuffedValue(o));
      Net.noise({x:o.x, y:o.y, r:LIGHT_KINDS[kind].noise}); // the hiss can give you away
      Net.fx(o.x, o.y - .6, me.name + " puts out the " + kind, "#b4c0ce");
    } else if (me.match) {
      me.match = false; // one match, one light
      Net.live("lights/" + o.id, litValue(o));
      Net.noise({x:o.x, y:o.y, r:1.5});
      Net.fx(o.x, o.y - .6, me.name + " lights the " + kind, "#e0a243");
    } else addFloat(o.x, o.y - .6, "You need a match", "#a89a87");
  } else if (it.type === "matches") {
    me.match = true;
    addFloat(me.x, me.y - .7, "You take a match", "#e0a243");
  } else if (it.type === "chest") {
    if (chestLocked(o)) { Net.fx(o.x, o.y - .6, "Locked", "#e24b4a"); return; }
    const first = !L.chests[o.id];
    if (first) { Net.live("chests/" + o.id, me.name); Net.noise({x:o.x, y:o.y, r:2}); Net.fx(o.x, o.y - .6, me.name + " opened a chest", "#e0a243"); }
    $("lootTitle").textContent = first ? "You open the chest" : "Opened by " + L.chests[o.id];
    $("lootText").textContent = o.loot || "Empty.";
    $("lootBox").classList.remove("hidden");
  }
}
$("lootClose").onclick = () => $("lootBox").classList.add("hidden");

/* ===================================================================
   POINTER: play-mode GM controls + editor
   =================================================================== */
export let ptr = null; // {sx, sy, wx, wy, btn, moved, hit, start}
export let selGuard = null;
cv.addEventListener("pointerdown", e => {
  if (!M) return;
  closeMenu();
  cv.setPointerCapture(e.pointerId);
  const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, w = toWorld(sx, sy);
  ptr = { sx, sy, lx:sx, ly:sy, wx:w.x, wy:w.y, btn:e.button, moved:false, hit:null, pan:false, shift:e.shiftKey, alt:e.altKey };
  if (e.button === 1 || e.button === 2) {
    if (editing() && e.button === 2 && endWallChain()) return;
    ptr.pan = true; return;
  }
  if (editing()) { editDown(w, e); return; }
  if (isGM && !playerView) ptr.hit = hitPlay(w.x, w.y); // in Player view the GM acts as their character
  if (!ptr.hit) ptr.pan = true;
});
cv.addEventListener("pointermove", e => {
  const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, w = toWorld(sx, sy);
  mouseW = w;
  if (!ptr) return;
  if (Math.hypot(sx - ptr.sx, sy - ptr.sy) > 4) ptr.moved = true;
  if (ptr.pan) { if (ptr.moved) { cam.x -= (sx - ptr.lx) / cam.z; cam.y -= (sy - ptr.ly) / cam.z; setFollow(false); } ptr.lx = sx; ptr.ly = sy; return; }
  ptr.lx = sx; ptr.ly = sy;
  if (editing()) { editMove(w, e); return; }
  if (ptr.hit && ptr.moved) dragPlay(ptr.hit, w);
});
cv.addEventListener("pointerup", e => {
  if (!ptr) return;
  const r = cv.getBoundingClientRect(), w = toWorld(e.clientX - r.left, e.clientY - r.top);
  const p = ptr; ptr = null;
  // A still right-click on a guard is the GM's say over them, unless the GM is acting as their character.
  if (isGM && p.btn === 2 && !p.moved && (editing() || !playerView)) {
    const target = guardAt(w); if (target) { openGmMenu(target, e.clientX, e.clientY); return; }
  }
  // A still right-click always offers my character's actions; so does a left-click when I'm not using GM controls.
  const asCharacter = !editing() && !p.moved && me && (p.btn === 2 || (p.btn === 0 && p.pan && (!isGM || playerView)));
  if (asCharacter) { const target = targetAt(w); if (target) { openMenu(target, e.clientX, e.clientY); return; } }
  if (p.pan) {
    if (!p.moved && !editing() && isGM && !playerView && selGuard && p.btn === 0) sendGuard(w);
    return;
  }
  if (editing()) { editUp(w, p); return; }
  if (p.hit && !p.moved) clickPlay(p.hit, w);
  if (p.hit && p.moved) endDragPlay(p.hit, w);
});
export let mouseW = null;

export function hitPlay(x, y) {
  // GM can grab players, guards, tokens; click levers, doors, chests, lights
  for (const [id, p] of Object.entries(PLAYERS)) if (p && Math.hypot(p.x - x, p.y - y) < .45) return {type:"player", id};
  if (HG) for (const g of HG) if (g.st !== "gone" && Math.hypot(g.x - x, g.y - y) < .5) return {type:"guard", id:g.id};
  for (const t of M.tokens) { const pos = tokenPos(t); if (Math.hypot(pos.x - x, pos.y - y) < .45) return {type:"token", id:t.id}; }
  for (const l of M.levers) if (Math.hypot(l.x - x, l.y - y) < .4) return {type:"lever", id:l.id};
  for (const l of M.lights) if (Math.hypot(l.x - x, l.y - y) < .35) return {type:"light", id:l.id};
  for (const p of M.props) if (p.kind === "chest") { const rr = propRect(p, .1); if (x >= rr[0] && x <= rr[2] && y >= rr[1] && y <= rr[3]) return {type:"chest", id:p.id}; }
  for (const d of M.doors) if (distToSeg(x, y, d.a[0], d.a[1], d.b[0], d.b[1]) < .3) return {type:"door", id:d.id};
  return null;
}
export let dragGhost = null;
export function dragPlay(hit, w) {
  if (hit.type === "guard" && HG) { const g = HG.find(x => x.id === hit.id); if (g) { g.x = w.x; g.y = w.y; g.path = null; g.held = true; } }
  else if (hit.type === "player" || hit.type === "token") dragGhost = {x:w.x, y:w.y, hit};
}
export function endDragPlay(hit, w) {
  dragGhost = null;
  if (hit.type === "player") Net.cmd(hit.id, {x:w.x, y:w.y});
  if (hit.type === "token") Net.live("tokens/" + hit.id, {x:+w.x.toFixed(2), y:+w.y.toFixed(2)});
  if (hit.type === "guard" && HG) {
    const g = HG.find(x => x.id === hit.id); if (!g) return;
    g.held = false;
    if (!isOut(g.st)) { goHome(g); g.st = "look"; g.lookT = 1.5; } // a body just moves
  }
}
export function clickPlay(hit, w) {
  derive();
  if (hit.type === "guard") {
    const st = HG.find(g => g.id === hit.id)?.st;
    if (st === "down") gmGuard(hit.id, "wake"); // click a knocked-out guard to wake them
    if (isOut(st)) return;
  }
  if (hit.type === "guard") { selGuard = selGuard === hit.id ? (goHome(HG.find(g => g.id === hit.id)), null) : hit.id; updateGmHint(); return; }
  if (selGuard) { sendGuard(w); return; }
  if (hit.type === "lever") Net.live("levers/" + hit.id, L.levers[hit.id] ? null : true);
  if (hit.type === "door") { const d = M.doors.find(x => x.id === hit.id); if (isLinked(d.id)) Net.fx(w.x, w.y - .4, "Lever-controlled", "#a89a87"); else Net.live("doors/" + d.id, !doorOpen(d)); }
  if (hit.type === "chest") { const c = M.props.find(x => x.id === hit.id); if (isLinked(c.id)) Net.fx(w.x, w.y - .4, "Lever-controlled", "#a89a87"); else { Net.live("unlock/" + c.id, L.unlock[c.id] ? null : true); Net.fx(c.x, c.y - .6, L.unlock[c.id] ? "Locked" : "Unlocked", "#e0a243"); } }
  if (hit.type === "light") { const l = M.lights.find(x => x.id === hit.id); Net.live("lights/" + l.id, !lightOnBase(l)); }
}
export function lightOnBase(l) { return L.lights[l.id] != null ? !!L.lights[l.id] : !!l.on; }
export function clearSelGuard() { selGuard = null; updateGmHint(); }
export function sendGuard(w) {
  const g = HG && HG.find(x => x.id === selGuard);
  if (g && !isOut(g.st)) { goHome(g); g.st = "invest"; g.target = {x:w.x, y:w.y}; Net.fx(g.x, g.y - .7, "Going to check", "#e0a243"); }
  selGuard = null; updateGmHint();
}
