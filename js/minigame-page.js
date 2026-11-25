// Top-down minigame: the signed-in PC moves with WASD or the arrow keys; the GM (?gm=jonny) builds the map; everything syncs over Firebase.
import { playerIdentity, isGM, sessionClient } from './session-role.js';
import { parseDD2VTT } from '../legacy/js/geometry.js';
import { drawScene, drawLighting, drawVision } from './minigame-draw.js';
const LIGHTING_ON = false; // the darkness/light-pool overlay is switched off for now; set true to bring it back
import { syncMinigame } from './minigame-sync.js';
import { mountEditor, normalizeMap } from './minigame-editor.js';

const canvas = document.getElementById('map'), ctx = canvas.getContext('2d');
const CELL = 64; // world px per grid cell; the camera does all fitting and zooming
const KEYS = { w: [0, -1], arrowup: [0, -1], s: [0, 1], arrowdown: [0, 1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0] };
const held = new Set();
const me = { x: CELL * 2, y: CELL * 2 };
let last = performance.now(), lastSend = 0, beat = 0, sentAt = { x: NaN, y: NaN };
const R = () => scale * 0.4; // token is ~0.8 cell wide
let raw = null, geo = null;
const scale = CELL; // px per grid cell (constant)
const view = { grid: true }; // toggled from the editor's toolbar

const status = document.getElementById('map-status');
// Camera: view = world * cam.z + (cam.x, cam.y), in canvas (device) pixels. Wheel zooms at the cursor; right- or middle-drag pans.
const cam = { x: 0, y: 0, z: 1 };
// Canvas backing store follows the window and the device pixel ratio so lines stay crisp.
let dpr = 1;
function resize() {
  dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
new ResizeObserver(resize).observe(canvas);
function fitView() { // centre the whole map in the window with a margin
  if (!geo) return;
  resize();
  const mw = geo.mapSize.x * scale, mh = geo.mapSize.y * scale, pad = 0.9;
  cam.z = Math.min(canvas.width / mw, canvas.height / mh) * pad;
  cam.x = (canvas.width - mw * cam.z) / 2; cam.y = (canvas.height - mh * cam.z) / 2;
}
function setMap(r, { fit = true } = {}) {
  const g = parseDD2VTT(normalizeMap(r));
  if (!(g.mapSize.x > 0 && g.mapSize.y > 0)) throw new Error('No map size in file');
  const first = !geo || geo.mapSize.x !== g.mapSize.x || geo.mapSize.y !== g.mapSize.y;
  raw = r; geo = g;
  if (fit && first) { fitView(); me.x = g.mapSize.x * scale / 2; me.y = g.mapSize.y * scale / 2; }
  report();
}
let publishTimer = null;
const publishSoon = () => { // GM only: send the edited map to everyone, debounced so drags don't flood Firebase
  if (!isGM || !raw) return;
  clearTimeout(publishTimer);
  publishTimer = setTimeout(() => { publishTimer = null; sync.publishMap(raw).catch(e => { status.textContent = `Sync failed: ${e.message}`; }); }, 300);
};
const others = new Map(); // other players' tokens: id -> { name, x, y (grid units), key, seen (ms) }
const STALE = 15000;
const sync = syncMinigame({
  onPlayers(players) {
    const now = performance.now();
    for (const [id, p] of Object.entries(players)) {
      if (id === sessionClient || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const key = `${p.x},${p.y},${p.beat}`, old = others.get(id);
      others.set(id, { name: String(p.name || '?'), x: p.x, y: p.y, key, seen: old?.key === key ? old.seen : now });
    }
    for (const id of others.keys()) if (!(id in players)) others.delete(id);
  },
  onMap(r) { if (publishTimer) return; try { setMap(r); }  catch (e) { status.textContent = `Sync failed: ${e.message}`; } }, // keep unsent GM edits over an incoming map
  onState({ doors, levers }) {
    if (!geo) return;
    for (const [i, closed] of Object.entries(doors)) if (geo.doors[i]) geo.doors[i].closed = raw.portals[i].closed = !!closed;
    for (const [i, on] of Object.entries(levers)) if (raw.geezvtt_editor.levers[i]) raw.geezvtt_editor.levers[i].on = !!on;
  },
  onError: m => { status.textContent = m; }
});
const report = () => { status.textContent = `${geo.walls.filter(w => !w.perimeter).length} walls · ${geo.doors.length} doors · ${geo.lights.length} lights`; };
document.getElementById('map-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    let r = JSON.parse(await file.text());
    if (Array.isArray(r.floors)) r = r.floors[r.activeFloorIndex || 0]?.map || r; // .geezvtt scene: use its active floor
    setMap(r); publishSoon();
  } catch (error) { status.textContent = `Import failed: ${error.message}`; }
});


const toCanvas = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height]; };
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const [px, py] = toCanvas(e), z = Math.min(8 * dpr, Math.max(0.05 * dpr, cam.z * Math.exp(-e.deltaY * 0.0015)));
  if (!isGM && playerIdentity) { cam.z = z; return; } // players zoom around their token; the follow camera keeps it centred
  cam.x = px - (px - cam.x) * z / cam.z; cam.y = py - (py - cam.y) * z / cam.z; cam.z = z;
}, { passive: false });
// Suppress the browser's right-click menu everywhere on the page (the VTT supplies its own), but keep it for text fields.
document.addEventListener('contextmenu', e => { if (!e.target.closest('input, textarea, [contenteditable]')) e.preventDefault(); });
let pan = null, panDist = 0, panButton = 2;
canvas.addEventListener('mousedown', e => { if (e.button === 2 || e.button === 1) { e.preventDefault(); if (!isGM && playerIdentity) return; // no manual panning while following
 pan = toCanvas(e); panDist = 0; panButton = e.button; } });
addEventListener('mousemove', e => { if (!pan) return; const p = toCanvas(e); panDist += Math.abs(p[0] - pan[0]) + Math.abs(p[1] - pan[1]); cam.x += p[0] - pan[0]; cam.y += p[1] - pan[1]; pan = p; });
addEventListener('mouseup', e => {
  if (e.button !== panButton || !pan) return;
  if (panButton === 2 && panDist < 4 && isGM && geo && !editor.contextMenu(e)) lockDoorAt(...toCanvas(e)); // right-click without dragging
  pan = null;
});
// GM: right-click a door to lock or unlock it.
function lockDoorAt(cx, cy) {
  const x = (cx - cam.x) / cam.z, y = (cy - cam.y) / cam.z;
  let best = -1, bd = scale * 0.5;
  geo.doors.forEach((d, i) => { const dist = distToSeg(x, y, d); if (!isWindow(i) && dist < bd) { best = i; bd = dist; } });
  if (best < 0) return;
  const p = raw.portals[best]; p.geezvtt_locked = !p.geezvtt_locked;
  status.textContent = p.geezvtt_locked ? 'Door locked.' : 'Door unlocked.'; publishSoon();
}

const editor = mountEditor({
  canvas, cam, view, status,
  getMap: () => ({ raw, scale }),
  setRaw: r => { setMap(r); publishSoon(); },
  rebuild: () => { geo = parseDD2VTT(raw); report(); }, // re-derive geometry without publishing
  changed: () => { geo = parseDD2VTT(raw); report(); publishSoon(); },
  fit: fitView, importFile: () => document.getElementById('map-file').click(),
  inGame: () => !!playerIdentity
});

// Collision: walls, windows and closed doors block; press Space near a door to open/close it (locked doors stay shut).
const isWindow = i => raw.portals?.[i]?.geezvtt_type === 'window' || geo.doors[i].isWindow;
const blockers = () => [...geo.walls, ...geo.doors.filter((d, i) => d.closed || isWindow(i))];
function distToSeg(px, py, a) {
  const dx = (a.x2 - a.x1) * scale, dy = (a.y2 - a.y1) * scale, x = a.x1 * scale, y = a.y1 * scale;
  const t = Math.max(0, Math.min(1, ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - x - t * dx, py - y - t * dy);
}
const blocked = (x, y, R) => geo && blockers().some(seg => distToSeg(x, y, seg) < R);
function toggleDoor() {
  if (!geo) return;
  const reach = scale * 1.2, status = document.getElementById('map-status'), levers = raw.geezvtt_editor?.levers || [];
  let best = -1, bd = reach, lever = -1, ld = reach;
  geo.doors.forEach((d, i) => { const dist = distToSeg(me.x, me.y, d); if (!isWindow(i) && dist < bd) { best = i; bd = dist; } });
  levers.forEach((v, i) => { const dist = Math.hypot(me.x - v.x * scale, me.y - v.y * scale); if (dist < ld) { lever = i; ld = dist; } });
  if (lever >= 0 && ld <= bd) { // a lever beats a door at equal distance; it works its linked door even if locked
    const v = levers[lever], d = geo.doors[v.door];
    if (!d) { status.textContent = 'The lever does nothing.'; return; }
    if (!d.closed && distToSeg(me.x, me.y, d) < R()) { status.textContent = 'Something is in the way.'; return; }
    d.closed = raw.portals[v.door].closed = !d.closed; v.on = !d.closed; status.textContent = 'You pull the lever.';
    sync.setDoor(v.door, d.closed); sync.setLever(lever, v.on); return;
  }
  if (best < 0) return;
  if (raw.portals?.[best]?.geezvtt_locked && geo.doors[best].closed) { status.textContent = 'The door is locked.'; return; }
  const d = geo.doors[best];
  if (!d.closed && distToSeg(me.x, me.y, d) < R()) { status.textContent = 'Something is in the way.'; return; }
  d.closed = raw.portals[best].closed = !d.closed; status.textContent = d.closed ? 'Door closed.' : 'Door opened.'; sync.setDoor(best, d.closed);
}

addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'home' && !e.target.closest?.('input,select,textarea')) { fitView(); return; }
  if (k === ' ' && !e.target.closest?.('input,select,textarea,button')) e.preventDefault();
  if (k === ' ' && !e.repeat && !e.target.closest?.('input,select,textarea,button')) { toggleDoor(); return; }
  if (!(k in KEYS) || e.target.closest?.('input,select,textarea')) return;
  e.preventDefault(); held.add(k);
});
addEventListener('keyup', e => held.delete(e.key.toLowerCase()));
addEventListener('blur', () => held.clear());

function drawToken(x, y, name, color) {
  const px = n => n * dpr / cam.z; // constant on-screen sizes
  ctx.fillStyle = color; ctx.strokeStyle = '#0b1220'; ctx.lineWidth = px(2);
  ctx.beginPath(); ctx.arc(x, y, R(), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.font = `600 ${px(12)}px system-ui`; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#0b1220'; ctx.lineWidth = px(3); ctx.strokeText(name, x, y - R() - px(5));
  ctx.fillStyle = '#f1f5f9'; ctx.fillText(name, x, y - R() - px(5));
  ctx.fillStyle = '#0b1220'; ctx.font = `700 ${R() * 0.9}px system-ui`; ctx.textBaseline = 'middle';
  ctx.fillText(String(name).charAt(0).toUpperCase(), x, y + R() * 0.05); ctx.textBaseline = 'alphabetic';
}
addEventListener('pagehide', () => { if (playerIdentity) sync.leave(sessionClient); });

let followed = false;
function frame(t) {
  const dt = Math.min(50, t - last) / 1000; last = t;
  const SPEED = scale * 5; // walks 5 cells/s
  let dx = 0, dy = 0;
  for (const k of held) { dx += KEYS[k][0]; dy += KEYS[k][1]; }
  const len = Math.hypot(dx, dy) || 1; // normalise so diagonals are not faster
  const r = R(), stuck = blocked(me.x, me.y, r), W = geo ? geo.mapSize.x * scale : 1e9, H = geo ? geo.mapSize.y * scale : 1e9, nx = Math.min(W - r, Math.max(r, me.x + dx / len * SPEED * dt));
  if (stuck || !blocked(nx, me.y, r)) me.x = nx; // axes resolved separately so the token slides along walls
  const ny = Math.min(H - r, Math.max(r, me.y + dy / len * SPEED * dt));
  if (stuck || !blocked(me.x, ny, r)) me.y = ny;
  if (playerIdentity && geo && t - lastSend > 100 && (me.x !== sentAt.x || me.y !== sentAt.y || t - lastSend > 5000)) {
    lastSend = t; sentAt = { x: me.x, y: me.y };
    sync.setPlayer(sessionClient, { name: playerIdentity.character, x: +(me.x / scale).toFixed(3), y: +(me.y / scale).toFixed(3), beat: ++beat });
  }
  if (geo && !isGM && playerIdentity) { // players: the camera follows their token (zoom stays under their control)
    if (!followed) { followed = true; cam.z = Math.min(8 * dpr, canvas.width / (14 * scale)); } // first follow: about 14 cells across
    const k = 1 - Math.exp(-dt * 12); // light smoothing
    cam.x += (canvas.width / 2 - me.x * cam.z - cam.x) * k; cam.y += (canvas.height / 2 - me.y * cam.z - cam.y) * k;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(cam.z, 0, 0, cam.z, cam.x, cam.y);
  if (geo) {
    drawScene(ctx, raw, geo, scale, cam.z, isGM, view);
    for (const o of others.values()) { // drawn before lighting and fog so players only see tokens they can actually see
      if (t - o.seen > STALE) continue;
      drawToken(o.x * scale, o.y * scale, o.name, '#f59e0b');
    }
    if (!editor.active()) { // lighting and fog are off while building so the GM can see
      if (LIGHTING_ON) drawLighting(ctx, raw, geo, scale, cam);
      if (!isGM) drawVision(ctx, raw, geo, scale, cam, [me]); // players see only what their token has line of sight to; ?gm=jonny sees everything
    }
  }
  if (raw) editor.drawOverlay(ctx, scale, cam.z, dpr);
  if (playerIdentity) drawToken(me.x, me.y, playerIdentity.character, '#38bdf8');
  else if (!isGM || !raw) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#94a3b8'; ctx.font = `${16 * dpr}px system-ui`; ctx.textAlign = 'center';
    ctx.fillText(raw ? 'Sign in to play' : isGM ? 'Import or create a map to begin' : 'Waiting for the GM to share a map…', canvas.width / 2, canvas.height / 2);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
