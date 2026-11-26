// Camera, effects, per-token vision and all canvas rendering.
import { doorStart, linkLever, sel, shownAt, snapPt, tool, wallChain } from './stealth2-editor.js';
import { HG } from './stealth2-guards.js';
import {
  LIGHTB, SIGHT, blocked, canHear, canSnuff, castPoly, chestLocked, derive, doorOpen, findById, isLinked, isOut, lightAlpha, lightKind,
  lightLevel, lightOn, lightPoly, nearestUsable, perceptionScore, propRect, refreshGeo, sightThreat, tokenPos
} from './stealth2-model.js';
import { dragGhost, mouseW, selGuard } from './stealth2-play.js';
import {
  FLOOR_STYLES, GUARDS_SYNC, L, LIGHT_KINDS, M, NOISE, PLAYERS, PROP_KINDS, P_RAD, bgImg, clamp, cv, editing, isGM, isHost, keys, me, now,
  roomName
} from './stealth2-state.js';
import { tokenPicture } from './minigame-tokens.js';
import { PROPS } from './prop-model.js';

/* ===================================================================
   CAMERA
   =================================================================== */
export const ctx = cv.getContext("2d");
export const dk = document.createElement("canvas"), dctx = dk.getContext("2d");
export let CW = 800, CH = 600, DPR = 1, camInit = false, follow = true;
export function setFollow(value) { follow = value; }
export const cam = { x:12, y:8, z:40 };
export function resize() {
  DPR = devicePixelRatio || 1;
  CW = innerWidth; CH = innerHeight;
  cv.width = dk.width = Math.round(CW * DPR); cv.height = dk.height = Math.round(CH * DPR);
  cv.style.width = CW + "px"; cv.style.height = CH + "px";
}
addEventListener("resize", resize);
export function fitCamera() {
  if (!M) return;
  camInit = true;
  cam.z = clamp(Math.min((CW - 40) / M.w, (CH - 40) / M.h), 8, 90);
  cam.x = M.w / 2; cam.y = M.h / 2;
  if (me && !isGM) cam.z = Math.max(cam.z, 56);
}
export const toWorld = (sx, sy) => ({ x:(sx - CW / 2) / cam.z + cam.x, y:(sy - CH / 2) / cam.z + cam.y });
export function worldTransform(c) { c.setTransform(DPR * cam.z, 0, 0, DPR * cam.z, DPR * (CW / 2 - cam.x * cam.z), DPR * (CH / 2 - cam.y * cam.z)); }
cv.addEventListener("wheel", e => {
  e.preventDefault();
  const r = cv.getBoundingClientRect(), before = toWorld(e.clientX - r.left, e.clientY - r.top);
  cam.z = clamp(cam.z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 6, 140);
  const after = toWorld(e.clientX - r.left, e.clientY - r.top);
  cam.x += before.x - after.x; cam.y += before.y - after.y;
}, {passive:false});

/* ===================================================================
   FX
   =================================================================== */
export const rings = [], floats = [];
export function addRing(x, y, r, color, bold) { rings.push({x, y, r, color, bold, born:performance.now()}); }
export function addFloat(x, y, text, color) { floats.push({x, y, text, color, born:performance.now()}); }
export const stepPulse = {};

/* ===================================================================
   SMOOTHING (remote tokens)
   =================================================================== */
export const smooth = {};
export function smoothed(id, o, dt) {
  let s = smooth[id];
  if (!s || Math.hypot(s.x - o.x, s.y - o.y) > 3) s = smooth[id] = {x:o.x, y:o.y, a:o.a || 0};
  const k = Math.min(1, dt * 12);
  s.x += (o.x - s.x) * k; s.y += (o.y - s.y) * k;
  let d = (o.a || 0) - s.a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  s.a += d * k;
  return s;
}

/* ===================================================================
   PER-TOKEN VISION (players see only what their own token sees)
   =================================================================== */
export let playerView = false;                 // GM with a test character can preview the player's view
export const VIEW_MAX = 40;                     // squares
export function togglePlayerView() { playerView = !playerView; }
export const seesAll = () => isGM && !(me && playerView && !L.edit);
// Squares my character sees without any light: darkvision (feet / 5), or a couple of squares right around them.
const darkRange = () => Math.max(2, (me.dv || 0) / 5);
export let visPoly = null, explored = null, exploredKey = "", lastExplore = 0;
export function updateVision() {
  if (seesAll() || !me) { visPoly = null; return; }
  refreshGeo();
  visPoly = castPoly(me.x, me.y, 0, Math.PI * 2, 200, VIEW_MAX, LIGHTB);
  const k = M.w + "x" + M.h + "|" + roomName;
  if (k !== exploredKey) { exploredKey = k; explored = new Uint8Array(M.w * M.h); }
  if (performance.now() - lastExplore > 250) {
    lastExplore = performance.now();
    const dvr = darkRange(), reach = Math.max(16, dvr);
    let x1 = M.w, y1 = M.h, x2 = 0, y2 = 0;
    for (const p of visPoly) { x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]); x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]); }
    x1 = Math.max(x1, me.x - reach); y1 = Math.max(y1, me.y - reach); x2 = Math.min(x2, me.x + reach); y2 = Math.min(y2, me.y + reach);
    for (let y = Math.max(0, Math.floor(y1)); y <= Math.min(M.h - 1, Math.floor(y2)); y++)
      for (let x = Math.max(0, Math.floor(x1)); x <= Math.min(M.w - 1, Math.floor(x2)); x++) {
        const i = y * M.w + x; if (explored[i]) continue;
        const cx = x + .5, cy = y + .5;
        if (pointInPoly(cx, cy, visPoly) && (Math.hypot(cx - me.x, cy - me.y) <= dvr || lightLevel(cx, cy) > .45)) explored[i] = 1;
      }
  }
}
export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Can my token see this point? (line of sight + light, or darkvision range)
export function iCanSee(x, y) {
  if (seesAll() || !me) return true;
  const d = Math.hypot(x - me.x, y - me.y);
  if (d > VIEW_MAX) return false;
  if (d > 0.5 && blocked(LIGHTB, me.x, me.y, x, y)) return false;
  return d <= darkRange() || lightLevel(x, y) > .45;
}
export function drawFog() {
  if (!visPoly) return;
  dctx.setTransform(1, 0, 0, 1, 0, 0);
  dctx.clearRect(0, 0, dk.width, dk.height);
  dctx.fillStyle = "rgba(6,5,8,.97)"; dctx.fillRect(0, 0, dk.width, dk.height);
  worldTransform(dctx);
  dctx.globalCompositeOperation = "destination-out";
  // explored but not currently visible: dimmed memory
  dctx.fillStyle = "rgba(0,0,0,.32)";
  dctx.beginPath();
  for (let y = 0; y < M.h; y++) for (let x = 0; x < M.w; x++) if (explored[y * M.w + x]) dctx.rect(x - .01, y - .01, 1.02, 1.02);
  dctx.fill();
  // what I can see right now
  dctx.fillStyle = "rgba(0,0,0,1)";
  dctx.beginPath(); dctx.moveTo(visPoly[0][0], visPoly[0][1]); for (const p of visPoly) dctx.lineTo(p[0], p[1]); dctx.closePath(); dctx.fill();
  dctx.globalCompositeOperation = "source-over";
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(dk, 0, 0); ctx.restore();
}

/* ===================================================================
   DRAW
   =================================================================== */
export const px = n => n / cam.z;  // screen pixels → world units
export function font(sz, weight) { ctx.font = `${weight || 400} ${px(sz)}px system-ui,sans-serif`; }
export let threat = 0; // how close any guard is to seeing my character (0..1), for the eye on screen
export function drawWorld(dt) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#15191f"; ctx.fillRect(0, 0, cv.width, cv.height);
  worldTransform(ctx);
  // floors
  for (const k in M.floors) {
    const st = M.floors[k]; if (bgImg && st !== "shadow") continue;
    const [x, y] = k.split("_").map(Number);
    ctx.fillStyle = bgImg ? "rgba(10,8,14,.55)" : FLOOR_STYLES[st] || "#333";
    ctx.fillRect(x, y, 1.02, 1.02);
  }
  if (!bgImg && !Object.keys(M.floors).length) { ctx.fillStyle = "#2a2622"; ctx.fillRect(0, 0, M.w, M.h); }
  if (bgImg) ctx.drawImage(bgImg, 0, 0, M.w, M.h);
  if (M.grid || editing()) {
    ctx.strokeStyle = "rgba(255,255,255,.06)"; ctx.lineWidth = px(1); ctx.beginPath();
    for (let x = 0; x <= M.w; x++) { ctx.moveTo(x, 0); ctx.lineTo(x, M.h); }
    for (let y = 0; y <= M.h; y++) { ctx.moveTo(0, y); ctx.lineTo(M.w, y); }
    ctx.stroke();
  }
  derive();
  // props
  for (const p of M.props) {
    const k = PROP_KINDS[p.kind] || PROP_KINDS.crate;
    const opened = p.kind === "chest" && L.chests[p.id];
    ctx.fillStyle = opened ? "#5a4a35" : k.fill;
    ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = px(1.5);
    if (k.round) { ctx.beginPath(); ctx.ellipse(p.x, p.y, p.w / 2, p.h / 2, 0, 0, 7); ctx.fill(); ctx.stroke(); }
    else { const r = propRect(p); ctx.fillRect(r[0], r[1], p.w, p.h); ctx.strokeRect(r[0], r[1], p.w, p.h); }
    if (p.kind === "crate") { ctx.beginPath(); ctx.moveTo(p.x - p.w / 2, p.y - p.h / 2); ctx.lineTo(p.x + p.w / 2, p.y + p.h / 2); ctx.moveTo(p.x + p.w / 2, p.y - p.h / 2); ctx.lineTo(p.x - p.w / 2, p.y + p.h / 2); ctx.stroke(); }
    if (p.kind === "matches") { // a matchbox and a couple of loose matches on the table
      ctx.fillStyle = "#b8433a"; ctx.fillRect(p.x - .26, p.y - .17, .34, .24);
      ctx.strokeStyle = "#e8d3a0"; ctx.lineWidth = px(2); ctx.beginPath(); ctx.moveTo(p.x + .13, p.y + .2); ctx.lineTo(p.x + .34, p.y - .08); ctx.moveTo(p.x - .12, p.y + .26); ctx.lineTo(p.x + .2, p.y + .24); ctx.stroke();
      ctx.fillStyle = "#e24b4a"; for (const [mx, my] of [[.34, -.08], [.2, .24]]) { ctx.beginPath(); ctx.arc(p.x + mx, p.y + my, .045, 0, 7); ctx.fill(); }
    }
    if (p.kind === "chest") {
      ctx.strokeStyle = "#e0c070"; ctx.lineWidth = px(1.5); ctx.beginPath(); ctx.moveTo(p.x - p.w / 2, p.y - p.h * .1); ctx.lineTo(p.x + p.w / 2, p.y - p.h * .1); ctx.stroke();
      if (chestLocked(p) && !opened) { ctx.fillStyle = "#e0c070"; ctx.fillRect(p.x - .07, p.y - .02, .14, .16); }
    }
  }
  // doors
  for (const d of M.doors) {
    const open = doorOpen(d), linked = isLinked(d.id);
    ctx.lineCap = "butt";
    if (open) {
      ctx.strokeStyle = linked ? "rgba(159,179,200,.35)" : "rgba(160,110,60,.6)"; ctx.lineWidth = px(2); ctx.setLineDash([px(4), px(4)]);
      ctx.beginPath(); ctx.moveTo(d.a[0], d.a[1]); ctx.lineTo(d.b[0], d.b[1]); ctx.stroke(); ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = linked ? "#9fb3c8" : "#a0682e"; ctx.lineWidth = Math.max(px(5), .14);
      ctx.beginPath(); ctx.moveTo(d.a[0], d.a[1]); ctx.lineTo(d.b[0], d.b[1]); ctx.stroke();
      if (linked) { // bars
        ctx.strokeStyle = "#1c2430"; ctx.lineWidth = px(1.5); ctx.beginPath();
        for (let i = 1; i < 5; i++) { const t = i / 5, x = d.a[0] + (d.b[0] - d.a[0]) * t, y = d.a[1] + (d.b[1] - d.a[1]) * t; ctx.moveTo(x - .04, y - .04); ctx.lineTo(x + .04, y + .04); }
        ctx.stroke();
      }
    }
  }
  // windows and walls (visible when there's no image, or to the GM)
  if (!bgImg || seesAll()) {
    ctx.strokeStyle = "rgba(170,225,255,.9)"; ctx.lineWidth = Math.max(px(2), .06); ctx.lineCap = "butt"; ctx.setLineDash([px(7), px(3)]);
    ctx.beginPath(); for (const w of M.windows) { ctx.moveTo(w.a[0], w.a[1]); ctx.lineTo(w.b[0], w.b[1]); } ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = bgImg ? "rgba(120,200,255,.55)" : "#8a7f72"; ctx.lineWidth = bgImg ? px(2) : Math.max(px(4), .12); ctx.lineCap = "round";
    ctx.beginPath(); for (const w of M.walls) { ctx.moveTo(w.a[0], w.a[1]); ctx.lineTo(w.b[0], w.b[1]); } ctx.stroke();
  }
  // levers
  for (const l of M.levers) {
    const on = !!L.levers[l.id];
    ctx.fillStyle = "#555"; ctx.fillRect(l.x - .22, l.y + .05, .44, .14);
    ctx.strokeStyle = on ? "#e0a243" : "#b8ab98"; ctx.lineWidth = px(3); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(l.x, l.y + .1); ctx.lineTo(l.x + (on ? .2 : -.2), l.y - .2); ctx.stroke();
    ctx.fillStyle = on ? "#e0a243" : "#b8ab98"; ctx.beginPath(); ctx.arc(l.x + (on ? .2 : -.2), l.y - .2, .07, 0, 7); ctx.fill();
  }
  for (const l of M.lights) drawLightSource(l);
  // darkness + lights
  drawDarkness();
  updateVision();
  drawFog();
  // GM / editor overlays
  if (seesAll()) drawGmOverlays();
  // guard vision cones
  const everyGuard = guardViews(dt);
  // Guards I can't see still count: the eye is the warning.
  const watching = g => g.st !== "alert" && !isOut(g.st) && !(g.st === "distract" && me && g.focus === me.id);
  threat = me ? Math.max(0, ...everyGuard.filter(watching).map(g => sightThreat(g, g.def, me))) : 0;
  const guards = everyGuard.filter(g => iCanSee(g.x, g.y));
  for (const g of guards) if (!isOut(g.st)) drawCone(g);
  // footstep noise rings (everyone sees how loud everyone is)
  const t = performance.now();
  for (const [id, p] of Object.entries(PLAYERS)) {
    const pp = (me && id === me.id) ? me : p; if (!pp || !pp.mv) continue;
    const loud = pp.md !== "sneak", period = loud ? 450 : 750;
    if (!stepPulse[id] || t - stepPulse[id] > period) { stepPulse[id] = t; addRing(pp.x, pp.y, NOISE[pp.md] || NOISE.normal, loud ? "#e24b4a" : "#e0a243"); }
  }
  // Guard footsteps: only the ones my character can hear, seen or not. The GM's overview shows them all.
  if (!L.paused) for (const g of everyGuard) {
    const rushing = g.st === "invest" || g.st === "chase";
    if (!g.mv || !(seesAll() || (me && canHear(me, perceptionScore(me, now()), g, rushing)))) continue;
    const key = "guard:" + g.def.id, period = rushing ? 380 : 560;
    if (!stepPulse[key] || t - stepPulse[key] > period) { stepPulse[key] = t; addRing(g.x, g.y, rushing ? 2.4 : 1.7, "#ffa53d", true); }
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i], age = (t - r.born) / 900; if (age > 1) { rings.splice(i, 1); continue; }
    ctx.strokeStyle = ctx.fillStyle = r.color; ctx.globalAlpha = (1 - age) * (r.bold ? .95 : .55); ctx.lineWidth = px(r.bold ? 3 : 1.5);
    ctx.beginPath(); ctx.arc(r.x, r.y, Math.max(.05, r.r * age), 0, 7); ctx.stroke();
    if (r.bold) { ctx.beginPath(); ctx.arc(r.x, r.y, .12, 0, 7); ctx.fill(); } // where the step landed
    ctx.globalAlpha = 1;
  }
  // tokens
  for (const tk of M.tokens) {
    let pos = tokenPos(tk); if (dragGhost && dragGhost.hit.id === tk.id) pos = dragGhost;
    if (!iCanSee(pos.x, pos.y)) continue;
    ctx.fillStyle = tk.color || "#ddd"; ctx.beginPath(); ctx.arc(pos.x, pos.y, .34, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = px(1.5); ctx.stroke();
    label(tk.name, pos.x, pos.y + .42, "#efe6d8");
  }
  for (const g of guards) drawGuard(g);
  for (const [id, p] of Object.entries(PLAYERS)) {
    if (!p) continue;
    if (me && id === me.id) continue;
    let pos = smoothed(id, p, dt);
    if (dragGhost && dragGhost.hit.id === id) pos = dragGhost;
    drawPlayer(p, pos, false);
  }
  if (me) drawPlayer(me, me, true);
  // floating text
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i], age = (t - f.born) / 1800; if (age > 1) { floats.splice(i, 1); continue; }
    ctx.globalAlpha = 1 - age; font(13, 600); ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(0,0,0,.7)"; ctx.fillText(f.text, f.x + px(1), f.y - age * .5 + px(1));
    ctx.fillStyle = f.color || "#efe6d8"; ctx.fillText(f.text, f.x, f.y - age * .5); ctx.globalAlpha = 1;
  }
  drawPrompt();
}
export function label(text, x, y, color) {
  font(11, 500); ctx.textAlign = "center"; ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(0,0,0,.7)"; ctx.fillText(text, x + px(1), y + px(1));
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}
// Torches and braziers use the tabletop's prop icons. The curved part of each icon is the flame.
const lightShapes = {};
function lightShape(kind) {
  if (lightShapes[kind]) return lightShapes[kind];
  const parts = PROPS[kind].path.split(/ (?=M)/);
  return lightShapes[kind] = { base: new Path2D(parts.filter(p => !p.includes("C")).join(" ")), flame: new Path2D(parts.filter(p => p.includes("C")).join(" ")) };
}
export function drawLightSource(l) {
  const kind = lightKind(l);
  if (kind === "glow") return;
  const { width, depth } = PROPS[kind], scale = LIGHT_KINDS[kind].scale, w = width * scale, h = depth * scale, shape = lightShape(kind), lit = lightOn(l);
  ctx.fillStyle = "rgba(21,25,31,.7)"; ctx.beginPath(); ctx.arc(l.x, l.y, Math.max(w, h) * .55, 0, 7); ctx.fill();
  ctx.save();
  ctx.translate(l.x - w / 2, l.y - h / 2); ctx.scale(w / 24, h / 24);
  ctx.lineWidth = 2; ctx.lineCap = ctx.lineJoin = "round";
  ctx.strokeStyle = lit ? "#c19a64" : "#7d848d"; ctx.stroke(shape.base);
  if (lit) {
    const flicker = 1 + Math.sin(performance.now() / 90 + l.x * 7 + l.y * 3) * .06;
    ctx.translate(12, 12); ctx.scale(1, flicker); ctx.translate(-12, -12);
    const color = l.color || PROPS[kind].light.color;
    ctx.fillStyle = hexA(color, .75); ctx.fill(shape.flame); ctx.strokeStyle = color; ctx.stroke(shape.flame);
  }
  ctx.restore();
}
export function drawDarkness() {
  const amb = M.dark * (seesAll() ? 0.5 : 0.88);
  dctx.setTransform(1, 0, 0, 1, 0, 0);
  dctx.clearRect(0, 0, dk.width, dk.height);
  dctx.fillStyle = `rgba(4,3,8,${amb})`; dctx.fillRect(0, 0, dk.width, dk.height);
  worldTransform(dctx);
  dctx.globalCompositeOperation = "destination-out";
  for (const l of M.lights) {
    if (!lightOn(l)) continue;
    const poly = lightPoly(l);
    const g = dctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
    g.addColorStop(0, "rgba(0,0,0,1)"); g.addColorStop(0.6, "rgba(0,0,0,.75)"); g.addColorStop(1, "rgba(0,0,0,0)");
    dctx.fillStyle = g; dctx.beginPath(); dctx.moveTo(poly[0][0], poly[0][1]); for (const p of poly) dctx.lineTo(p[0], p[1]); dctx.closePath(); dctx.fill();
  }
  dctx.globalCompositeOperation = "source-over";
  // shadow floors stay dark even in light
  dctx.fillStyle = `rgba(4,3,8,${seesAll() ? .25 : .45})`;
  for (const k in M.floors) if (M.floors[k] === "shadow") { const [x, y] = k.split("_").map(Number); dctx.fillRect(x, y, 1.02, 1.02); }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(dk, 0, 0); ctx.restore();
  // warm tint
  ctx.globalCompositeOperation = "lighter";
  for (const l of M.lights) {
    if (!lightOn(l)) continue;
    const poly = lightPoly(l), g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
    g.addColorStop(0, hexA(l.color, .14)); g.addColorStop(1, hexA(l.color, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(poly[0][0], poly[0][1]); for (const p of poly) ctx.lineTo(p[0], p[1]); ctx.closePath(); ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}
export function hexA(hex, a) { const h = (hex || "#ffcf8a").replace("#", ""); const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
export function guardViews(dt) {
  const out = [];
  for (const def of M.guards) {
    let s;
    if (isHost() && HG) { const g = HG.find(x => x.id === def.id); if (!g) continue; s = {x:g.x, y:g.y, a:g.a, st:g.st, info:g.info, mv:g.mv, focus:g.focus}; }
    else { const raw = GUARDS_SYNC[def.id]; if (!raw) { s = {x:def.x, y:def.y, a:def.face * Math.PI / 180, st:"home", info:""}; } else { const sm = smoothed("g" + def.id, raw, dt); s = {...raw, x:sm.x, y:sm.y, a:sm.a}; } }
    if (s.st !== "gone") out.push({...s, def});
  }
  return out;
}
export function drawCone(g) {
  refreshGeo();
  const half = g.def.fov * Math.PI / 360, R = g.def.sight;
  const poly = castPoly(g.x, g.y, g.a - half, g.a + half, 36, R, SIGHT);
  const warn = g.st === "invest" || g.st === "look", alert = g.st === "alert";
  const col = alert ? "226,75,74" : warn ? "224,162,67" : "226,75,74";
  const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, R);
  grad.addColorStop(0, `rgba(${col},${alert ? .4 : .28})`); grad.addColorStop(.35, `rgba(${col},${alert ? .3 : .2})`); grad.addColorStop(1, `rgba(${col},.04)`);
  ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(g.x, g.y);
  for (const p of poly) ctx.lineTo(p[0], p[1]);
  ctx.closePath(); ctx.fill();
}
// A round picture, centre-cropped.
function portrait(art, x, y, R, grey) {
  const side = Math.min(art.naturalWidth, art.naturalHeight);
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.clip(); if (grey) ctx.filter = "grayscale(1)";
  ctx.drawImage(art, (art.naturalWidth - side) / 2, (art.naturalHeight - side) / 2, side, side, x - R, y - R, R * 2, R * 2);
  ctx.restore();
}
export function drawGuard(g) {
  // The plain disc stands in until the picture loads.
  const art = tokenPicture({kind:"token", image:`servant${g.def.art}.png`}), R = art ? P_RAD * 1.3 : .34;
  const disc = radius => { ctx.beginPath(); ctx.arc(g.x, g.y, radius, 0, 7); };
  if (isOut(g.st)) { // knocked out: greyed. Dead: greyed and faded.
    const dead = g.st === "dead";
    ctx.globalAlpha = dead ? .55 : .85;
    ctx.fillStyle = dead ? "#4a2426" : "#6d5a5a"; disc(R); ctx.fill();
    if (art) portrait(art, g.x, g.y, R, true);
    ctx.strokeStyle = dead ? "#ff7b7b" : "#b4c0ce"; ctx.lineWidth = px(2); disc(R); ctx.stroke();
    ctx.globalAlpha = 1;
    label(g.def.name + (dead ? " (dead)" : " (down)"), g.x, g.y + R + .06, "#c9b8b8");
    font(13, 700); ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillStyle = dead ? "#ff7b7b" : "#b4c0ce"; ctx.fillText(dead ? "✕" : "z z", g.x, g.y - R);
    return;
  }
  ctx.fillStyle = "#c23b3a"; disc(R); ctx.fill();
  if (art) portrait(art, g.x, g.y, R);
  // A red rim marks a guard; amber while the GM has them selected.
  ctx.strokeStyle = g.def.id === selGuard ? "#e0a243" : "#c23b3a"; ctx.lineWidth = px(g.def.id === selGuard ? 3.5 : 2.5); disc(R); ctx.stroke();
  // Facing: a short pointer on the rim, so it doesn't cross the face.
  const dx = Math.cos(g.a), dy = Math.sin(g.a);
  ctx.strokeStyle = "#ffd9d0"; ctx.lineWidth = px(3); ctx.beginPath(); ctx.moveTo(g.x + dx * R, g.y + dy * R); ctx.lineTo(g.x + dx * (R + .16), g.y + dy * (R + .16)); ctx.stroke();
  label(g.def.name, g.x, g.y + R + .06, "#f2c4bd");
  if (g.info) { font(18, 800); ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillStyle = g.info === "!" ? "#e24b4a" : "#e0a243"; ctx.fillText(g.info, g.x, g.y - R - .04); }
}
export function drawPlayer(p, pos, mine) {
  ctx.globalAlpha = lightAlpha(pos.x, pos.y);
  const color = p.caught ? "#77736c" : p.color || "#8f87e6", art = tokenPicture({kind:"pc", name:p.name});
  const R = art ? P_RAD * 1.3 : P_RAD; // portraits are drawn a little larger than the collision circle so they read
  const disc = radius => { ctx.beginPath(); ctx.arc(pos.x, pos.y, radius, 0, 7); };
  ctx.fillStyle = color; disc(R); ctx.fill();
  if (art) {
    portrait(art, pos.x, pos.y, R, p.caught); // greyed while caught
    ctx.strokeStyle = color; ctx.lineWidth = px(2); disc(R); ctx.stroke();
  } else { ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = px(1.5); ctx.stroke(); }
  if (mine) { ctx.strokeStyle = "#fff"; ctx.lineWidth = px(1.2); disc(R + px(1.6)); ctx.stroke(); }
  // Facing: a short pointer on the rim, so it doesn't cross the portrait.
  const dx = Math.cos(pos.a || 0), dy = Math.sin(pos.a || 0);
  ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = px(2.5); ctx.beginPath(); ctx.moveTo(pos.x + dx * R, pos.y + dy * R);
  ctx.lineTo(pos.x + dx * (R + .14), pos.y + dy * (R + .14)); ctx.stroke();
  ctx.globalAlpha = 1;
  label(p.name + (p.caught ? " (caught)" : ""), pos.x, pos.y + R + .1, "#efe6d8");
}
export function drawGmOverlays() {
  derive();
  // links
  if (editing() || selGuard === null) {
    ctx.setLineDash([px(4), px(4)]); ctx.lineWidth = px(1.2);
    for (const l of M.levers) for (const t of l.targets) {
      const f = findById(t); if (!f) continue;
      const o = f.o, tx = o.a ? (o.a[0] + o.b[0]) / 2 : o.x, ty = o.a ? (o.a[1] + o.b[1]) / 2 : o.y;
      ctx.strokeStyle = l.id === linkLever ? "rgba(224,162,67,.95)" : editing() ? "rgba(224,162,67,.55)" : "rgba(224,162,67,.18)";
      ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(tx, ty); ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  // guard paths
  for (const g of M.guards) {
    if (g.mode !== "patrol" || !g.path.length) continue;
    const s = sel && sel.o === g;
    ctx.strokeStyle = s ? "rgba(226,75,74,.9)" : editing() ? "rgba(226,75,74,.45)" : "rgba(226,75,74,.15)"; ctx.lineWidth = px(s ? 2 : 1.2);
    ctx.setLineDash([px(6), px(4)]); ctx.beginPath();
    g.path.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    if (g.path.length > 2) ctx.closePath();
    ctx.stroke(); ctx.setLineDash([]);
    if (editing()) g.path.forEach((p, i) => {
      ctx.fillStyle = s ? "#e24b4a" : "rgba(226,75,74,.5)"; ctx.beginPath(); ctx.arc(p[0], p[1], .14, 0, 7); ctx.fill();
      if (s) { font(10, 700); ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(i + 1, p[0], p[1]); }
    });
  }
  // investigate targets (host)
  if (HG && !editing()) for (const g of HG) if ((g.st === "invest" || g.st === "chase") && g.target) {
    ctx.strokeStyle = "rgba(224,162,67,.6)"; ctx.setLineDash([px(4), px(4)]); ctx.lineWidth = px(1.5);
    ctx.beginPath(); ctx.moveTo(g.x, g.y); ctx.lineTo(g.target.x, g.target.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(g.target.x, g.target.y, .18, 0, 7); ctx.stroke();
  }
  // light bulbs, spawns, cells
  for (const l of M.lights) {
    if (lightKind(l) === "glow") {
      ctx.fillStyle = lightOn(l) ? l.color : "#444"; ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.lineWidth = px(1.5);
      ctx.beginPath(); ctx.arc(l.x, l.y, .13, 0, 7); ctx.fill(); ctx.stroke();
    }
  }
  for (const s of M.spawns) {
    ctx.strokeStyle = s.kind === "cell" ? "#9fb3c8" : "#3fb899"; ctx.lineWidth = px(2);
    ctx.beginPath(); ctx.arc(s.x, s.y, .3, 0, 7); ctx.stroke();
    font(9, 700); ctx.fillStyle = ctx.strokeStyle; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(s.kind === "cell" ? "CELL" : "START", s.x, s.y);
  }
  if (!editing()) return;
  // selection
  const at = sel && shownAt(sel.k, sel.o);
  if (sel && at) {
    const o = sel.o; ctx.strokeStyle = "#e0a243"; ctx.lineWidth = px(2.5);
    if (o.a) { ctx.beginPath(); ctx.moveTo(o.a[0], o.a[1]); ctx.lineTo(o.b[0], o.b[1]); ctx.stroke(); [o.a, o.b].forEach(p => { ctx.beginPath(); ctx.arc(p[0], p[1], .1, 0, 7); ctx.stroke(); }); }
    else if (sel.k === "props") { const r = propRect(o, .06); ctx.strokeRect(r[0], r[1], r[2] - r[0], r[3] - r[1]); }
    else { ctx.beginPath(); ctx.arc(at.x, at.y, .48, 0, 7); ctx.stroke(); }
  }
  // tool previews
  if (mouseW) {
    const fake = {altKey:keys.alt};
    if (tool === "wall" && wallChain) { const s = snapPt(mouseW, fake); ctx.strokeStyle = "rgba(120,200,255,.8)"; ctx.lineWidth = px(2); ctx.beginPath(); ctx.moveTo(wallChain[0], wallChain[1]); ctx.lineTo(s[0], s[1]); ctx.stroke(); }
    if (tool === "door" && doorStart) { const s = snapPt(mouseW, fake); ctx.strokeStyle = "#a0682e"; ctx.lineWidth = px(4); ctx.beginPath(); ctx.moveTo(doorStart[0], doorStart[1]); ctx.lineTo(s[0], s[1]); ctx.stroke(); }
    if (tool === "wall" || tool === "door") { const s = snapPt(mouseW, fake); ctx.fillStyle = "rgba(120,200,255,.9)"; ctx.beginPath(); ctx.arc(s[0], s[1], .08, 0, 7); ctx.fill(); }
    if (tool === "floor") { ctx.strokeStyle = "rgba(224,162,67,.8)"; ctx.lineWidth = px(1.5); ctx.strokeRect(Math.floor(mouseW.x), Math.floor(mouseW.y), 1, 1); }
  }
}
export function drawPrompt() {
  if (!me || L.paused || editing()) return;
  const it = nearestUsable(me.x, me.y, 1.2, me.match); if (!it) return;
  derive();
  let txt = "";
  if (it.type === "lever") txt = `E: ${L.levers[it.o.id] ? "push back" : "pull"} ${it.o.name || "lever"}`;
  if (it.type === "door") txt = isLinked(it.o.id) ? "Lever-controlled" : doorOpen(it.o) ? "E: close door" : "E: open door";
  if (it.type === "light") txt = canSnuff(it.o) ? `E: put out ${lightKind(it.o)}` : me.match ? `E: light ${lightKind(it.o)}` : "Needs a match";
  if (it.type === "matches") txt = "E: take a match";
  if (it.type === "chest") txt = chestLocked(it.o) ? "Locked chest" : L.chests[it.o.id] ? "E: look inside" : "E: open chest";
  font(12, 600); ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  const w = ctx.measureText(txt).width + px(14), x = me.x, y = me.y - .5;
  ctx.fillStyle = "rgba(20,17,15,.88)"; ctx.fillRect(x - w / 2, y - px(20), w, px(20));
  ctx.fillStyle = "#e0a243"; ctx.fillText(txt, x, y - px(4));
}
