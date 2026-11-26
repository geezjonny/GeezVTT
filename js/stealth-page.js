// Entry point for stealth.html: pick a PC in the lobby, start the session, run the main loop.
import { refreshStealthButton } from './stealth-dice.js';
import { CH, CW, DPR, cam, ctx, drawWorld, follow, resize } from './stealth-draw.js';
import { hostTick } from './stealth-guards.js';
import { drawHUD } from './stealth-hud.js';
import { demoMap, refreshGeo } from './stealth-model.js';
import { Net, loadBg, setMap } from './stealth-net.js';
import { loadStealthPCs } from './stealth-pcs.js';
import { updatePlayer } from './stealth-play.js';
import { $, L, M, PLAYERS, clamp, editing, isHost, me, myId, now, setHost, setSession, solo, uid } from './stealth-state.js';
import { isGM as urlGM, playerIdentity } from './session-role.js';
import { tokenImage, tokenImages } from './token-art.js';

/* ===================================================================
   LOBBY
   =================================================================== */
export const params = new URLSearchParams(location.search);
export let pcs = [];
const stored = key => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Storage may be disabled. */ } };
export const chosenPC = () => pcs.find(pc => pc.id === $('inPC').value) || null;
const signed = n => `${n >= 0 ? '+' : ''}${n}`;
const campaignLabel = name => name.charAt(0).toUpperCase() + name.slice(1);

// One list of every PC, grouped by campaign.
function fillCharacters() {
  const wanted = stored('mg2_pc') || playerIdentity?.pcId;
  const campaigns = [...new Set(pcs.map(pc => pc.campaign))].sort();
  $('inPC').replaceChildren(new Option('Choose character', ''), ...campaigns.map(campaign => {
    const group = document.createElement('optgroup');
    group.label = campaignLabel(campaign);
    group.append(...pcs.filter(pc => pc.campaign === campaign).map(pc => new Option(pc.name, pc.id)));
    return group;
  }));
  $('inPC').value = pcs.some(pc => pc.id === wanted) ? wanted : '';
  $('inPC').disabled = !pcs.length;
  showPreview();
}
function showPreview() {
  const pc = chosenPC(), box = $('pcPreview');
  box.classList.toggle('hidden', !pc);
  $('btnJoin').disabled = !urlGM && !pc; // the GM joins without a token
  if (!pc) return;
  const art = $('pcArt');
  art.style.borderColor = pc.color;
  art.style.visibility = '';
  art.src = tokenImage({ name: pc.name });
  $('pcName').textContent = pc.name;
  const stealth = pc.stealth ? `Stealth ${signed(pc.stealth.bonus)}${pc.stealth.disadvantage ? ' (disadvantage)' : ''}` : 'No Stealth bonus';
  $('pcFacts').textContent = `${pc.darkvision ? `Darkvision ${pc.darkvision} ft` : 'No darkvision'} · ${stealth} · Passive Perception ${pc.passive}`;
}
async function loadCharacters() {
  $('pcStatus').textContent = 'Loading characters…';
  $('btnRetry').classList.add('hidden');
  try {
    // Token art is optional: without the catalog, pictures fall back to <name>.png.
    [pcs] = await Promise.all([loadStealthPCs(), tokenImages().catch(() => [])]);
    $('pcStatus').textContent = pcs.length ? '' : 'No characters found.';
  } catch (error) {
    $('pcStatus').textContent = `Couldn't load characters: ${error.message}`;
    $('btnRetry').classList.remove('hidden');
  }
  fillCharacters();
}

/* ===================================================================
   START
   =================================================================== */
let started = false;
export function start(isSolo) {
  if (started || (isSolo && !urlGM)) return;
  const pc = chosenPC();
  const room = ($('inRoom').value.trim() || 'table1').replace(/[.#$\[\]\/]/g, '');
  if (!isSolo) {
    if (typeof firebase === 'undefined') { $('err').textContent = "Couldn't load Firebase. Check your connection."; return; }
    if (!urlGM && !pc) { $('err').textContent = 'Choose your character first.'; return; }
  }
  store('mg2_room', room);
  if (pc) store('mg2_pc', pc.id);
  const gm = isSolo || urlGM;
  let device = stored('mg2_id') || `p${uid()}`;
  store('mg2_id', device);
  // A player's id is their PC id, so rejoining replaces their own token instead of adding another.
  const id = isSolo ? device : gm ? `gm_${device}` : pc.id;
  const token = gm && !isSolo ? null : {
    id, name: pc?.name || 'Adventurer', color: pc?.color || '#8f87e6', dv: pc?.darkvision || 0, stealth: pc?.stealth || null,
    passive: pc?.passive ?? 10, perception: pc?.perception || null, listen: null, listenReady: 0,
    x: 1, y: 1, a: 0, md: 'normal', mv: false, caught: false, cx: 0, cy: 0, lastCmd: 0
  };
  setSession({ me: token, myId: id, isGM: gm, solo: isSolo, roomName: room });
  resize();
  if (isSolo) {
    let map = null, image = null;
    try { map = JSON.parse(localStorage.getItem('mg2_map')); image = localStorage.getItem('mg2_img'); } catch { /* No saved map. */ }
    setHost({ id, gm: true });
    setMap(map || demoMap()); // also puts the new token on a spawn point
    loadBg(image);
    L.paused = false;
  } else {
    try { Net.connect(room); } catch (error) { $('err').textContent = `Firebase error: ${error.message}`; return; }
    setTimeout(() => Net.claimHost(gm), 700);
  }
  started = true;
  document.activeElement?.blur();
  $('lobby').classList.add('hidden');
  refreshStealthButton();
  requestAnimationFrame(loop);
}

/* ===================================================================
   LOOP
   =================================================================== */
let last = performance.now(), lastPush = 0, lastPacked = '';
function loop(t) {
  const dt = clamp((t - last) / 1000, 0, 0.05); last = t;
  if (M) {
    refreshGeo();
    if (me && !L.paused && !L.edit) updatePlayer(dt);
    if (me) {
      const p = { id: me.id, name: me.name, color: me.color, x: +me.x.toFixed(2), y: +me.y.toFixed(2), a: +me.a.toFixed(2), md: me.md, mv: me.mv && !L.paused, caught: me.caught,
        stealth: me.stealth?.bonus ?? null, dis: !!me.stealth?.disadvantage };
      const packed = JSON.stringify(p);
      if (solo) PLAYERS[myId] = p;
      else if (packed !== lastPacked && now() - lastPush > 100) { lastPush = now(); lastPacked = packed; Net.player(p); }
      if (follow && !editing()) { const k = Math.min(1, dt * 6); cam.x += (me.x - cam.x) * k; cam.y += (me.y - cam.y) * k; }
    }
    if (isHost()) hostTick(dt);
    drawWorld(dt);
  } else {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.fillStyle = '#15191f'; ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = '#b4c0ce'; ctx.font = '15px system-ui'; ctx.textAlign = 'center'; ctx.fillText('Waiting for the GM to load a map…', CW / 2, CH / 2);
  }
  drawHUD(dt);
  requestAnimationFrame(loop);
}

/* ===================================================================
   PAGE WIRING
   =================================================================== */
// A clicked button keeps keyboard focus, so Space (sneak) would press it again. Keyboard presses keep focus.
document.addEventListener('click', event => { if (event.detail > 0) event.target.closest('button')?.blur(); });
if (urlGM) $('tabletop').href = 'index.html?gm=jonny';
$('inRoom').value = params.get('room') || stored('mg2_room') || '';
// The URL decides the role: stealth.html is a player, stealth.html?gm=jonny is the GM. The offline sandbox is a GM tool.
$('btnSolo').classList.toggle('hidden', !urlGM);
$('lblPC').textContent = urlGM ? 'Choose character (sandbox only)' : 'Choose character';
$('btnJoin').textContent = urlGM ? 'Join room as GM' : 'Join room';
$('intro').textContent = urlGM
  ? 'Build or import the map, place guards, levers and chests, then pause whenever someone gets spotted.'
  : 'Pick your character and enter the room code. Move with WASD or the arrow keys.';
$('inPC').addEventListener('change', showPreview);
$('pcArt').addEventListener('error', () => { $('pcArt').style.visibility = 'hidden'; });
$('btnRetry').addEventListener('click', loadCharacters);
$('btnSolo').addEventListener('click', () => start(true));
$('btnJoin').addEventListener('click', () => start(false));
$('inRoom').addEventListener('keydown', event => { if (event.key === 'Enter' && !$('btnJoin').disabled) start(false); });
showPreview();
loadCharacters();
