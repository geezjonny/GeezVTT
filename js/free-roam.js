// Free-roam movement for players: while the GM has Free roam on (and initiative is off), held WASD / arrow keys move the
// selected PC smoothly in 2D, 3D and first person. The player's client predicts the motion locally (same wall/door rules as the
// GM's check in player-actions.js) and streams its position as `move` actions; the GM's client validates and applies them.
// Turn-based play (one cell per keypress, or initiative) is untouched and lives in vtt-controls.js.
import { isGM, canControlPC } from './session-role.js';
import { firstPersonYaw, previewToken } from './map-view-toggle.js';
import { canStand, FREE_ROAM_ENABLED } from './player-actions.js';

const floor = document.getElementById('floor');
const CELLS_PER_SECOND = 4, SEND_EVERY = 60, HOLD_MAX = 4000; // HOLD_MAX: longest we wait for the GM to confirm where we stopped
const WASD = { KeyW: [0, -1], KeyA: [-1, 0], KeyS: [0, 1], KeyD: [1, 0] };
const ARROWS = { ArrowUp: [0, -1], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowRight: [1, 0] };
const held = new Set();
let raf = 0, last = 0, lastSent = 0, pos = null, idleSince = 0, sentPos = null;

const roaming = () => FREE_ROAM_ENABLED && !isGM && floor.freeRoam === true && !floor.initiativeActive && !!floor.tabletopMap;
const character = () => floor.tabletopMap?.tokens.find(t => t.id === floor.selectedTokenId && t.kind === 'pc' && canControlPC(t));

function direction() {
  const yaw = firstPersonYaw();
  let x = 0, y = 0;
  for (const code of held) { const v = WASD[code] || (yaw !== null && ARROWS[code]); if (v) { x += v[0]; y += v[1]; } }
  const len = Math.hypot(x, y);
  if (!len) return null;
  x /= len; y /= len;
  // First person: keys are relative to where the camera looks (same rotation as cameraStep, without snapping to 90 degrees).
  return yaw === null ? { x, y } : { x: x * Math.cos(yaw) + y * Math.sin(yaw), y: y * Math.cos(yaw) - x * Math.sin(yaw) };
}

function show(token) { // update the local view of the token without waiting for the GM
  token.x = pos.x; token.y = pos.y;
  floor.roamPos = { id: token.id, x: pos.x, y: pos.y }; // read by applySharedMap so GM echoes don't yank the token back
  document.querySelector(`#tokens [data-token-id="${CSS.escape(token.id)}"]`)?.setAttribute('transform', `translate(${pos.x} ${pos.y})`);
  previewToken(token.id, pos);
}

const caughtUp = token => floor.roamEcho?.id === token.id && Math.hypot(floor.roamEcho.x - pos.x, floor.roamEcho.y - pos.y) < .03;
function frame(now) {
  raf = 0;
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  const token = roaming() && character();
  if (!token) { held.clear(); pos = null; floor.roamPos = null; return; }
  const dir = direction();
  if (dir && token.speed !== 0) {
    if (!pos) pos = { x: token.x, y: token.y }; // start from the GM-confirmed position
    const d = CELLS_PER_SECOND * dt, map = floor.tabletopMap;
    const tries = [{ x: pos.x + dir.x * d, y: pos.y + dir.y * d }, { x: pos.x + dir.x * d, y: pos.y }, { x: pos.x, y: pos.y + dir.y * d }]; // full step, then slide along a wall
    const to = tries.find(p => (p.x !== pos.x || p.y !== pos.y) && canStand(map, token.size, pos, p));
    if (to) pos = to;
    show(token);
    idleSince = now;
    if (now - lastSent >= SEND_EVERY && (!sentPos || sentPos.x !== pos.x || sentPos.y !== pos.y)) {
      lastSent = now; sentPos = { ...pos };
      floor.dispatchEvent(new CustomEvent('session-action', { detail: { type: 'move', free: true, tokenId: token.id, x: pos.x, y: pos.y, dx: 0, dy: 0 } }));
    }
  } else if (pos && now - idleSince <= HOLD_MAX && !caughtUp(token)) {
    show(token); // keep our position on screen until the GM has confirmed it (or HOLD_MAX passes), so the token doesn't jump back
    if (sentPos && (sentPos.x !== pos.x || sentPos.y !== pos.y)) {
      sentPos = { ...pos };
      floor.dispatchEvent(new CustomEvent('session-action', { detail: { type: 'move', free: true, tokenId: token.id, x: pos.x, y: pos.y, dx: 0, dy: 0 } }));
    }
  } else if (pos) { // confirmed, or the GM never caught up (move rejected): trust the GM's position again
    const echo = floor.roamEcho;
    if (echo?.id === token.id && !caughtUp(token)) { pos = { x: echo.x, y: echo.y }; show(token); }
    pos = null; sentPos = null; floor.roamPos = null; floor.roamEcho = null;
  }
  if (held.size || pos) raf = requestAnimationFrame(frame);
}
const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };

const typing = e => e.target.isContentEditable || e.target.closest?.('input, textarea, select, button, .editor-titlebar');
document.addEventListener('keydown', e => {
  if (!roaming() || e.ctrlKey || e.metaKey || e.altKey || typing(e) || !(WASD[e.code] || ARROWS[e.code])) return;
  if (ARROWS[e.code] && firstPersonYaw() === null) return; // arrows only move you in first person, as in turn-based play
  if (!character()) return;
  e.preventDefault(); held.add(e.code); start();
});
document.addEventListener('keyup', e => held.delete(e.code));
window.addEventListener('blur', () => held.clear());
floor.addEventListener('roam-changed', () => { held.clear(); pos = null; floor.roamPos = null; });
