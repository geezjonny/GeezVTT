// minigame2.html: shared top-down walking and GM map editing. See walk-model.js.
import { CAMPAIGNS, CHARACTERS, resolvePlayer } from './player-session-model.js';
import { isGM, playerIdentity, setPlayerIdentity } from './session-role.js';
import { buildExpressionRoll } from './dice-roll.js';
import { readPC } from './pc-inventory.js';
import { loadSheetReference } from './sheet-view.js';
import { sheetRolls } from './sheet-rolls.js';
import { personColors } from './horde-colors.js';
import { encodeKey } from './firebase-codec.js';
import { watchTabletop } from './tabletop-stream.js';
import { hordeBase, serverNow, syncClock } from './horde-sync.js';
import { MATERIAL_LAYERS, bucketCells, cutDoorOpening, distance, eraseStrokeIndices, floorBrushCells, inBox, paintFloorTiles } from './map-editor-model.js';
import { materialCanvas, materialURL } from './material-textures.js';
import { RADIUS, activateNPCAI, cleanMapEdit, connectNPCChain, movePlacedObject, moveTrigger, removeWalkTokens, syncPropTrigger } from './walk-model.js';
import { closeMapMenu, showMapMenu } from './map-object-menu.js';
import { readPuzzle, savePuzzle } from './walk-puzzle.js';
import { importedProps, propCorners, propDistance } from './prop-model.js';
import { importedTokens } from './token-model.js';
import { tokenImages } from './token-art.js';
import { drawWalkProp, drawWalkToken, loadWalkTokenSources, mountWalkObjects, refreshWalkAIDoors, selectWalkObject, walkObjectSettings } from './walk-objects.js';
import { createWalkAI } from './walk-ai.js';
import { KEY_TO_MOVE, TILE_H, TILE_W, cleanTrigger, direction, doorBlocked, doorIsOpen, doorOccupied, hitsWall, hpFraction, lineOfSight, lockedDoors, move, nearestDoor, nearestTrigger, project, setWorld, smooth, spawn, unproject, validWalker, VISION, visionPolygon, world } from './walk-model.js';

const $ = id => document.getElementById(id);
const canvas = $('walk-canvas'), ctx = canvas.getContext('2d');
const hordeMode = document.documentElement.dataset.walkSession === 'walk3';
const walkKey = hordeMode ? 'walk3' : 'walk';
const walkBase = `${hordeBase}/${walkKey}`;
let combat = null;
const walkPath = pcId => `${walkBase}/players/${encodeKey(pcId)}.json`;
const entitiesUrl = `${hordeBase.replace(/\/vtt$/, '')}/entities`;
const message = text => { if ($('walk-status').textContent !== text) $('walk-status').textContent = text; };

let me = null;                 // { pcId, name, seat, hp, max, pos } when playing as a character; null when spectating
let spectator = false;
let focus = { x: 5, y: 5 };    // where the camera looks (the player, or the spectator's own spot)
let currentMap = null, maps = [];   // maps: the .dd2vtt file names listed in battlemap/index.json
const mapPath = `${walkBase}/map.json`;
let paused = false;            // the GM can freeze everyone to narrate
let tool = null, selected = null;   // GM editing: 'lever' | 'plate' | 'connect' | 'remove', and the trigger picked for connecting
let origin = { x: 0, y: 0 };   // where the map's corner is on screen this frame, for turning clicks into map positions
let fitView = false, viewScale = 1;
let camera = null, zoom = 1, pan = null;
const canvasPoint = event => unproject(event.clientX / viewScale - origin.x, event.clientY / viewScale - origin.y);
function syncCamera() {
  viewScale = zoom;
  const c = project(camera.x, camera.y);
  origin = { x: canvas.clientWidth / (2 * zoom) - c.x, y: canvas.clientHeight / (2 * zoom) - c.y };
}
function freeCamera() {
  camera = unproject(canvas.clientWidth / (2 * viewScale) - origin.x, canvas.clientHeight / (2 * viewScale) - origin.y);
  zoom = viewScale; fitView = false;
  $('walk-fit').setAttribute('aria-pressed', 'false');
}
let roster = [], botSpots = new Map();   // the campaign's PCs; any nobody is playing stand in as idle bots at their start spots
const others = new Map();      // pcId -> { name, hp, max, shown, target }
const lastPositions = new Map(); // Idle stand-ins stay where the character was last seen.
const pressed = new Set();
let lastPost = 0, lastSent = '', lastHp = 0, stopWatch = null, joined = false;
let baseGeometry = null, sharedWalk = null, appliedEdit = '', loadingMap = 0;
let stroke = null, editWrites = 0, editQueue = Promise.resolve();
const unsavedEdits = new Map();
const geometry = () => Object.fromEntries(['w', 'h', 'walls', 'doors', 'floors', 'props', 'tokens', 'chains', 'wallMaterials', 'doorMaterials'].map(key => [key, structuredClone(world[key])]));
const geometryKey = data => JSON.stringify(['w', 'h', 'walls', 'doors', 'floors', 'props', 'tokens', 'chains', 'wallMaterials', 'doorMaterials'].map(key => key === 'tokens' ? importedTokens(data.tokens || [], data.w, data.h) : data[key] ?? []));
const objectLayer = name => ['props', 'tokens', 'chains'].includes(name);
const editableLayer = name => MATERIAL_LAYERS[name] || objectLayer(name);
const pcToken = pcId => world.tokens.find(t => t.kind === 'pc' && t.npcId === `v2:${pcId}`);
const tokenPosition = token => {
  if (combat?.isZombie(token)) return combat.position(token);
  const pcId = token.kind === 'pc' && token.npcId?.startsWith('v2:') ? token.npcId.slice(3) : null;
  return pcId ? (me?.pcId === pcId ? me.pos : others.get(pcId)?.shown || lastPositions.get(pcId) || token) : ai.position(token);
};
const pcStart = (pcId, seat) => {
  const token = pcToken(pcId);
  return token && (isGM || !hitsWall(token.x, token.y)) ? { x: token.x, y: token.y } : spawn(seat);
};
let undo = [], redo = [], chain = [], hover = null, paintAction = 'paint', suppressClick = false;
const selection = new Set();
const editState = () => ({ ...geometry(), triggers: structuredClone(world.triggers), open: [...world.open] });
const ai = createWalkAI({ mapKey: () => currentMap ? mapKey() : null, active: () => joined && !paused && !stroke, path: walkKey, exclude: token => !!combat?.isZombie(token), pcs: aiPCs, onError: message });
function aiPCs() {
  const pcs = new Map(roster.map(bot => [bot.pcId, { pcId: bot.pcId, name: bot.name, hp: bot.hp, ...(lastPositions.get(bot.pcId) || pcStart(bot.pcId, bot.seat)) }]));
  for (const [pcId, p] of others) pcs.set(pcId, { pcId, name: p.name, hp: p.hp, ...p.target });
  if (me) pcs.set(me.pcId, { pcId: me.pcId, name: me.name, hp: me.hp, ...me.pos });
  return [...pcs.values()].filter(pc => !pcToken(pc.pcId)?.walkDeleted && !pcToken(pc.pcId)?.hidden && !pcToken(pc.pcId)?.invisible && (pc.hp == null || pc.hp > 0));
}
function restoreEdit(state) {
  const previousTokens = new Map(world.tokens.map(t => [t.id, t]));
  const { open, ...data } = structuredClone(state);
  Object.assign(world, data, { open: new Set(open), swing: new Map() });
  for (const token of world.tokens) {
    const before = previousTokens.get(token.id);
    if (!before || before.x !== token.x || before.y !== token.y || before.walkMovedAt !== token.walkMovedAt) relocateToken(token);
  }
  pendingDoors.clear(); standingOn.clear(); selection.clear(); selected = null; botSpots.clear();
  if (me && (me.pos.x > world.w || me.pos.y > world.h || !isGM && hitsWall(me.pos.x, me.pos.y))) me.pos = spawn(me.seat);
}
function editButtons() {
  $('walk-undo').disabled = !undo.length; $('walk-redo').disabled = !redo.length;
  $('walk-apply').disabled = $('walk-delete').disabled = !selection.size;
  $('walk-paint-controls').hidden = !editableLayer(tool);
  $('walk-prop-controls').hidden = tool !== 'props'; $('walk-token-controls').hidden = tool !== 'tokens';
  $('walk-chain-controls').hidden = tool !== 'chains';
  if (hordeMode) $('walk-zombie-controls').hidden = tool !== 'zombies';
  refreshWalkAIDoors();
  document.querySelector('[data-paint-action="bucket"]').disabled = tool === 'walls' || objectLayer(tool);
  $('walk-spacing-label').hidden = !(paintAction === 'bucket' && tool === 'doors');
  document.querySelectorAll('[data-paint-action]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.paintAction === paintAction)));
}
function commitEdit(before) {
  if (JSON.stringify(before) === JSON.stringify(editState())) return;
  undo.push(before); if (undo.length > 50) undo.shift(); redo = [];
  editButtons(); saveMapEdit(true);
}
function editHistory(back) {
  cancelStroke(); chain = []; hover = null;
  const from = back ? undo : redo, to = back ? redo : undo;
  if (!from.length) return;
  to.push(editState()); restoreEdit(from.pop()); editButtons(); saveMapEdit(true);
}

// --- sharing positions: each page reports only its own circle; everyone reads everyone's
async function post(force = false) {
  if (!me || pcToken(me.pcId)?.walkDeleted) return;
  const now = performance.now(), key = `${me.pos.x.toFixed(2)},${me.pos.y.toFixed(2)},${me.hp},${me.max},${me.roll?.at}`;
  if (!force && (key === lastSent ? now - lastPost < 3000 : now - lastPost < 120)) return;
  lastPost = now; lastSent = key;
  try {
    const response = await fetch(walkPath(me.pcId), { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pcId: me.pcId, name: me.name, x: +me.pos.x.toFixed(3), y: +me.pos.y.toFixed(3), hp: me.hp ?? null, max: me.max ?? null, roll: me.roll ?? null, seen: { '.sv': 'timestamp' } }), signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
    message('');
  } catch (error) { message(`Sync problem: ${error.message}`); }
}
// --- the map: use the .dd2vtt geometry plus shared edits; discard its embedded picture
async function loadMap(file) {
  if (!maps.includes(file) || file === currentMap) return;
  if (currentMap && unsavedEdits.has(mapKey())) throw new Error('Save the current map edits before changing maps.');
  const request = ++loadingMap;
  const response = await fetch(`battlemap/${encodeURIComponent(file)}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Could not load ${file} (${response.status})`);
  const raw = await response.json();
  const editResponse = await fetch(`${walkBase}/edits/${file.replace(/[^A-Za-z0-9_-]/g, '_')}.json`, { signal: AbortSignal.timeout(8000) });
  if (!editResponse.ok) throw new Error(`Could not load map edits (${editResponse.status})`);
  let edits = await editResponse.json();
  if (hordeMode && edits == null) {
    const source = await fetch(`${hordeBase}/walk/edits/${file.replace(/[^A-Za-z0-9_-]/g, '_')}.json`, { signal: AbortSignal.timeout(8000) });
    if (!source.ok) throw new Error(`Could not load Walk map edits (${source.status})`);
    edits = await source.json();
  }
  if (request !== loadingMap) return;
  setWorld(raw); baseGeometry = geometry(); appliedEdit = ''; stroke = null; camera = null; zoom = 1; endPan();
  currentMap = file; $('walk-map').value = file; pendingDoors.clear(); pendingChains.clear(); botSpots.clear(); selected = null;
  ai.receive(null);
  others.clear(); lastPositions.clear();
  $('walk-puzzle-name').value = file.replace(/\.dd2vtt$/i, '');
  undo = []; redo = []; chain = []; hover = null; selection.clear(); editButtons();
  applyMapEdit(edits);
  if (hordeMode && edits != null) baseGeometry = geometry();
  combat?.reset();
  if (sharedWalk?.map === file) receive(sharedWalk);
  if (me && !isGM && hitsWall(me.pos.x, me.pos.y)) me.pos = spawn(me.seat);
  focus = me ? { ...me.pos } : { x: world.w / 2, y: world.h / 2 };
}
async function chooseMap(file) {
  await loadMap(file);
  await fetch(mapPath, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(file), signal: AbortSignal.timeout(8000) });
}
// --- doors: closed until someone within a tile presses Space; the open ones are shared per map
// Firebase keys cannot hold a dot, and "%2E" in a URL path is turned back into one, so the map name is reduced to safe characters.
const mapKey = () => currentMap.replace(/[^A-Za-z0-9_-]/g, '_');
const doorPath = index => `${walkBase}/doors/${mapKey()}/d${index}.json`; // "d" keeps Firebase from turning the list into an array
const SWING_SECONDS = 0.3;
// Our own toggles hold until the server shows the same state (or 3 s pass), so a stream update sent before our write landed cannot flip the door back mid-swing.
const pendingDoors = new Map();   // door index -> { open, until }
const pendingChains = new Map();
const everyone = () => [...(me && !pcToken(me.pcId)?.walkDeleted ? [me.pos] : []), ...[...others.entries()].filter(([id]) => !pcToken(id)?.walkDeleted).flatMap(([, o]) => [o.target, o.shown]), ...world.tokens.filter(t => t.kind !== 'pc' && !t.walkDeleted && (!combat?.isZombie(t) || combat.alive(t))).map(tokenPosition)];
// A door seen for the first time starts at rest (no swing on load). It blocks until fully open.
function stepDoors(dt) {
  world.doors.forEach((_, i) => {
    const target = world.open.has(i) ? 1 : 0, now = world.swing.get(i) ?? target;
    world.swing.set(i, now < target ? Math.min(target, now + dt / SWING_SECONDS) : Math.max(target, now - dt / SWING_SECONDS));
  });
}
function setDoor(index, opening) {
  world.open[opening ? 'add' : 'delete'](index);
  pendingDoors.set(index, { open: opening, until: performance.now() + 3000 });
  fetch(doorPath(index), opening ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: 'true' } : { method: 'DELETE' })
    .catch(error => message(`Sync problem: ${error.message}`));
}
// Doors shut behind you: once fully open and nobody is within a tile and a half, close. Every player's page does this; the writes are identical.
function autoClose() {
  if (!me || pcToken(me.pcId)?.walkDeleted) return;
  const points = everyone();
  const locked = lockedDoors();
  for (const index of world.open) if (!locked.has(index) && doorIsOpen(index) && !pendingDoors.has(index) && !doorOccupied(index, points)) setDoor(index, false);
}
function toggleDoor() {
  const index = nearestDoor(me.pos.x, me.pos.y);
  if (index < 0) return;
  if (lockedDoors().has(index)) { message('It will not budge. Something else controls it.'); return; }
  const opening = !world.open.has(index);
  if (!opening && everyone().some(p => doorBlocked(index, p.x, p.y))) { message('Something is in the way.'); return; }
  setDoor(index, opening);
}

// --- levers and plates: the GM places them and wires each to doors; using one toggles those doors
const triggerPath = id => `${walkBase}/triggers/${mapKey()}/${id}.json`;
const putJson = (url, body) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) })
  .catch(error => message(`Sync problem: ${error.message}`));
let triggersHold = 0;   // just after we edit, ignore stream copies of the list that were sent before our write landed
const saveTrigger = t => { triggersHold = performance.now() + 1500; return putJson(triggerPath(t.id), { kind: t.kind, x: t.x, y: t.y, doors: t.doors, on: t.on, ...(t.chains?.length ? { chains: t.chains } : {}) }); };
function setChain(id, locked) {
  const chain = world.chains.find(c => c.id === id);
  if (!chain) return;
  const before = chain.locked, hold = { locked, until: performance.now() + 3000 };
  chain.locked = locked; pendingChains.set(id, hold);
  fetch(`${walkBase}/chains/${mapKey()}/${id}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(locked), signal: AbortSignal.timeout(8000) })
    .then(response => { if (!response.ok) throw new Error(`Firebase returned ${response.status}`); })
    .catch(error => { if (pendingChains.get(id) === hold) { chain.locked = before; pendingChains.delete(id); } message(`Chains sync problem: ${error.message}`); });
}
function fire(t) {
  for (const index of t.doors) {
    const opening = !world.open.has(index);
    if (!opening && everyone().some(p => doorBlocked(index, p.x, p.y))) { message('Something is in the way.'); continue; }
    setDoor(index, opening);
  }
  for (const id of t.chains || []) { const chain = world.chains.find(c => c.id === id); if (chain) setChain(id, !chain.locked); }
  if (t.kind === 'lever') { t.on = !t.on; saveTrigger(t); }
}
const standingOn = new Set();   // plates our own character is on, so a plate fires once per step onto it
function checkPlates() {
  const now = new Set();
  const props = new Map(world.props.map(p => [p.id, p]));
  for (const t of world.triggers) if (t.kind === 'plate' && (props.has(t.id) ? propDistance(props.get(t.id), me.pos) <= RADIUS : Math.hypot(t.x - me.pos.x, t.y - me.pos.y) <= 0.5)) {
    now.add(t.id);
    if (!standingOn.has(t.id)) fire(t);
  }
  standingOn.clear(); now.forEach(id => standingOn.add(id));
}
// Connect chains to NPCs, and levers/plates to doors or chains. Repeating a link disconnects it.
function editClick(event) {
  if (!currentMap || stroke || pan || event.button !== 0) return;
  const p = canvasPoint(event), hit = nearestTrigger(p.x, p.y, 0.6);
  const before = editState();
  if (tool === 'zombies' && combat) {
    if (p.x < 0 || p.y < 0 || p.x > world.w || p.y > world.h || hitsWall(p.x, p.y)) return;
    world.tokens.push(combat.createZombie($('walk-zombie-kind').value, p, Number($('walk-zombie-door').value)));
    commitEdit(before);
  } else if (tool === 'lever' || tool === 'plate') {
    const x = Math.floor(p.x) + 0.5, y = Math.floor(p.y) + 0.5;
    if (hit || x < 0 || y < 0 || x > world.w || y > world.h || hitsWall(x, y)) return;
    const t = { id: `t${Date.now().toString(36)}`, kind: tool, x, y, doors: [], on: false };
    world.triggers.push(t); selected = t.id; commitEdit(before);
  } else if (tool === 'remove' && hit) {
    world.triggers = world.triggers.filter(t => t !== hit); if (selected === hit.id) selected = null;
    world.props = world.props.filter(p => p.id !== hit.id);
    commitEdit(before);
  } else if (tool === 'remove') {
    const placed = placedHit(p);
    if (placed) { removeObjects(placed.layer, [placed.index]); commitEdit(before); return; }
    const door = nearestDoor(p.x, p.y, 0.25);
    if (door >= 0) {
      removeObjects('doors', [door]);
      commitEdit(before); return;
    }
    const wall = world.walls.findIndex(([ax, ay, bx, by]) => distance(p, { x: ax, y: ay }, { x: bx, y: by }) <= 0.25);
    if (wall >= 0) { world.walls.splice(wall, 1); world.wallMaterials.splice(wall, 1); }
    else {
      const floor = world.floors.findIndex(t => Math.abs(t.x - p.x) <= 0.5 && Math.abs(t.y - p.y) <= 0.5);
      if (floor < 0) return;
      world.floors.splice(floor, 1);
    }
    commitEdit(before);
  } else if (tool === 'connect') {
    const door = nearestDoor(p.x, p.y, 0.6), picked = world.triggers.find(t => t.id === selected);
    const chain = placedHit(p, ['chains']), pickedChain = world.chains.find(c => c.id === selected), npc = placedHit(p, ['tokens']);
    if (pickedChain && npc) {
      const token = npc.object;
      if (token.kind === 'pc') { $('walk-editor-status').textContent = 'Connect chains to an NPC token.'; return; }
      const position = tokenPosition(token);
      Object.assign(before.tokens.find(t => t.id === token.id), { x: position.x, y: position.y });
      token.x = position.x; token.y = position.y; token.walkMovedAt = serverNow();
      connectNPCChain(pickedChain.id, token.id);
      selectWalkObject('tokens', token); commitEdit(before);
    }
    else if (chain && picked) {
      const links = picked.chains || [];
      picked.chains = links.includes(chain.object.id) ? links.filter(id => id !== chain.object.id) : [...links, chain.object.id];
      if (!picked.chains.length) delete picked.chains;
      commitEdit(before);
    }
    else if (chain) selected = chain.object.id;
    else if (hit) selected = hit.id;
    else if (door >= 0 && picked) { picked.doors = picked.doors.includes(door) ? picked.doors.filter(d => d !== door) : [...picked.doors, door]; commitEdit(before); }
    else selected = null;
  }
}
canvas.addEventListener('click', event => {
  if (suppressClick) { suppressClick = false; return; }
  if (isGM && tool) editClick(event);
});
function pickTool(next) {
  cancelStroke(); chain = []; hover = null; selection.clear(); tool = tool === next ? null : next; selected = null;
  if ((tool === 'walls' || objectLayer(tool)) && paintAction === 'bucket') paintAction = 'paint';
  editButtons();
  if (tool === 'zombies') {
    const select = $('walk-zombie-door'), value = select.value;
    select.replaceChildren(new Option('Start now', '-1'), ...world.doors.map((_, i) => new Option(`Door ${i + 1}`, String(i))));
    select.value = [...select.options].some(o => o.value === value) ? value : '-1';
  }
  if (tool === 'tokens') loadWalkTokenSources().catch(error => { $('walk-editor-status').textContent = error.message; });
  document.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
  const materials = MATERIAL_LAYERS[tool];
  $('walk-material-label').hidden = $('walk-materials').hidden = !materials;
  $('walk-materials').replaceChildren(); $('walk-material').replaceChildren();
  if (materials) {
    $('walk-material').append(...materials.map(name => new Option(name, name)));
    $('walk-material').value = tool === 'doors' ? 'wood' : 'stone';
    for (const material of materials) {
      const button = document.createElement('button'), swatch = document.createElement('span');
      button.type = 'button'; button.title = material; button.setAttribute('aria-label', material); button.dataset.material = material;
      swatch.className = 'material-swatch'; swatch.style.backgroundImage = `url("${materialURL(material)}")`; button.append(swatch);
      button.addEventListener('click', () => { $('walk-material').value = material; showMaterial(); });
      $('walk-materials').append(button);
    }
    showMaterial();
  }
}
if (isGM) {
  mountWalkObjects();
  const panel = $('walk-editor'), grip = $('walk-editor-titlebar');
  let panelDrag = null;
  const positionPanel = (left, top) => {
    panel.style.left = Math.max(0, Math.min(innerWidth - panel.offsetWidth, left)) + 'px';
    panel.style.top = Math.max(0, Math.min(innerHeight - Math.min(panel.offsetHeight, 40), top)) + 'px';
  };
  grip.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    event.preventDefault(); grip.focus(); pressed.clear();
    panelDrag = { id: event.pointerId, x: event.clientX - panel.offsetLeft, y: event.clientY - panel.offsetTop };
    grip.setPointerCapture(event.pointerId);
  });
  grip.addEventListener('pointermove', event => {
    if (panelDrag?.id === event.pointerId) positionPanel(event.clientX - panelDrag.x, event.clientY - panelDrag.y);
  });
  const endPanelDrag = () => {
    const id = panelDrag?.id; panelDrag = null;
    if (id != null && grip.hasPointerCapture(id)) grip.releasePointerCapture(id);
  };
  grip.addEventListener('pointerup', endPanelDrag);
  grip.addEventListener('pointercancel', endPanelDrag);
  grip.addEventListener('lostpointercapture', endPanelDrag);
  addEventListener('blur', endPanelDrag);
  grip.addEventListener('keydown', event => {
    if (event.target !== grip) return;
    const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
    if (delta) { event.preventDefault(); event.stopPropagation(); positionPanel(panel.offsetLeft + delta[0], panel.offsetTop + delta[1]); }
  });
  addEventListener('resize', () => { if (!panel.hidden) positionPanel(panel.offsetLeft, panel.offsetTop); });
  $('walk-gm').hidden = false;
  document.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => pickTool(b.dataset.tool)));
  $('walk-pause').addEventListener('click', () => { const next = !paused; putJson(`${walkBase}/paused.json`, next).then(() => { paused = next; showPause(); }); });
  const showEditor = open => {
    $('walk-editor').hidden = !open; $('walk-editor-toggle').setAttribute('aria-expanded', String(open));
    if (open) positionPanel(panel.offsetLeft, panel.offsetTop);
    if (!open) { cancelStroke(); chain = []; hover = null; selection.clear(); tool = null; selected = null; editButtons(); document.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', 'false')); }
  };
  $('walk-editor-toggle').addEventListener('click', () => showEditor($('walk-editor').hidden));
  $('walk-editor-close').addEventListener('click', () => showEditor(false));
  $('walk-material').addEventListener('change', showMaterial);
  $('walk-editor-save').addEventListener('click', () => { if (currentMap) saveMapEdit(true); });
  $('walk-puzzle-export').addEventListener('click', async () => {
    if (!currentMap) return;
    const button = $('walk-puzzle-export'); button.disabled = true;
    try {
      const name = $('walk-puzzle-name').value.trim();
      const raw = { format: 'geezpuzzle', version: 1, name, ...editState() };
      readPuzzle(raw);
      $('walk-editor-status').textContent = await savePuzzle(raw);
      loadPuzzleLibrary().catch(() => {});
    } catch (error) { if (error.name !== 'AbortError') $('walk-editor-status').textContent = `Export failed: ${error.message}`; }
    finally { button.disabled = false; }
  });
  $('walk-puzzle-import').addEventListener('click', () => { if (currentMap) $('walk-puzzle-file').click(); });
  $('walk-puzzle-file').addEventListener('change', async event => {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    const target = currentMap;
    try {
      if (!/\.geezpuzzle$/i.test(file.name) || file.size > 25 * 1024 * 1024) throw new Error('Choose a .geezpuzzle file under 25 MB.');
      const puzzle = readPuzzle(JSON.parse(await file.text()));
      if (currentMap !== target) throw new Error('Map changed; import the file again.');
      installPuzzle(puzzle);
    } catch (error) { $('walk-editor-status').textContent = `Import failed: ${error.message}`; }
  });
  $('walk-puzzles').addEventListener('change', async event => {
    const file = event.target.value;
    if (!file || !currentMap) return;
    const target = currentMap;
    event.target.disabled = true;
    try {
      const response = await fetch(`minigame/${encodeURIComponent(file)}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Could not load ${file} (${response.status})`);
      const text = await response.text();
      if (text.length > 25 * 1024 * 1024) throw new Error('Puzzle exceeds 25 MB.');
      if (currentMap !== target) throw new Error('Map changed; choose the puzzle again.');
      installPuzzle(readPuzzle(JSON.parse(text)));
    } catch (error) { $('walk-editor-status').textContent = `Import failed: ${error.message}`; }
    finally { event.target.disabled = false; event.target.value = ''; }
  });
  $('walk-undo').addEventListener('click', () => editHistory(true));
  $('walk-redo').addEventListener('click', () => editHistory(false));
  $('walk-apply').addEventListener('click', () => applySelection(false));
  $('walk-delete').addEventListener('click', () => applySelection(true));
  document.querySelectorAll('[data-paint-action]').forEach(button => button.addEventListener('click', () => {
    cancelStroke(); chain = []; hover = null; selection.clear(); paintAction = button.dataset.paintAction; editButtons();
  }));
}
function showMaterial() {
  $('walk-materials').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.material === $('walk-material').value)));
}
function installPuzzle(puzzle) {
  if (!isGM || !currentMap) return;
  cancelStroke(); endPan(); chain = []; hover = null;
  const before = editState();
  restoreEdit(puzzle.state); $('walk-puzzle-name').value = puzzle.name;
  camera = null; zoom = 1; fitView = true; $('walk-fit').setAttribute('aria-pressed', 'true');
  focus = me ? { ...me.pos } : { x: world.w / 2, y: world.h / 2 };
  if (JSON.stringify(before) === JSON.stringify(editState())) saveMapEdit(true);
  else commitEdit(before);
  ai.reset();
  editButtons();
}
async function loadPuzzleLibrary() {
  const response = await fetch('minigame/index.json', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Could not load puzzle library (${response.status})`);
  const entries = await response.json();
  if (!Array.isArray(entries)) throw new Error('Invalid puzzle library index.');
  $('walk-puzzles').replaceChildren(new Option('Choose puzzle', ''), ...entries.filter(e => typeof e?.file === 'string' && /^[^/\\\u0000-\u001f]+\.geezpuzzle$/i.test(e.file)).map(e => new Option(typeof e.name === 'string' ? e.name : e.file, e.file)));
}
function applyMapEdit(raw) {
  if (!baseGeometry || editWrites || stroke || unsavedEdits.has(mapKey())) return;
  const clean = raw == null ? structuredClone(baseGeometry) : cleanMapEdit(raw, baseGeometry.w, baseGeometry.h);
  if (!clean) { message('Invalid map edits; reload or repair the saved map.'); return; }
  const signature = geometryKey(clean);
  if (signature === appliedEdit) return;
  if (typeof raw?.name === 'string') $('walk-puzzle-name').value = raw.name.slice(0, 120);
  const resized = clean.w !== world.w || clean.h !== world.h;
  const previousTokens = new Map(world.tokens.map(t => [t.id, t]));
  Object.assign(world, clean); appliedEdit = signature; botSpots.clear();
  if (me && pcToken(me.pcId)?.walkDeleted) standingOn.clear();
  for (const token of world.tokens) {
    const before = previousTokens.get(token.id);
    if (token.kind === 'pc' && token.npcId?.startsWith('v2:') && (!before || before.x !== token.x || before.y !== token.y || before.walkMovedAt !== token.walkMovedAt)) {
      const pcId = token.npcId.slice(3), p = { x: token.x, y: token.y };
      if (me?.pcId === pcId) me.pos = { ...p };
      lastPositions.set(pcId, p);
    }
  }
  if (resized) {
    if (me && (me.pos.x > world.w || me.pos.y > world.h)) me.pos = spawn(me.seat);
    camera = null; zoom = 1; focus = me ? { ...me.pos } : { x: world.w / 2, y: world.h / 2 };
  }
  undo = []; redo = []; selection.clear(); chain = []; hover = null; editButtons();
}
function saveMapEdit(remapDoors = false) {
  const key = mapKey(), edit = { version: 1, name: $('walk-puzzle-name').value.trim(), ...geometry() };
  const signature = geometryKey(edit);
  const pending = {};
  unsavedEdits.set(key, pending);
  const patch = { [`edits/${key}`]: edit };
  if (remapDoors) {
    patch[`triggers/${key}`] = Object.fromEntries(world.triggers.map(t => [t.id, { kind: t.kind, x: t.x, y: t.y, doors: t.doors, on: t.on, ...(t.chains?.length ? { chains: t.chains } : {}) }]));
    patch[`doors/${key}`] = Object.fromEntries([...world.open].map(i => [`d${i}`, true]));
    patch[`chains/${key}`] = Object.fromEntries(world.chains.map(c => [c.id, c.locked]));
  }
  editWrites++; $('walk-editor-status').textContent = 'Saving…';
  editQueue = editQueue.then(async () => {
    const response = await fetch(`${walkBase}.json`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch), signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
    if (unsavedEdits.get(key) === pending) unsavedEdits.delete(key);
    if (key === mapKey()) appliedEdit = signature;
    $('walk-editor-status').textContent = editWrites > 1 ? 'Saving…' : 'Saved';
  }).catch(error => { $('walk-editor-status').textContent = `Not saved: ${error.message}`; }).finally(() => { editWrites--; });
}
const editPoint = event => {
  const p = canvasPoint(event);
  return { x: Math.max(0, Math.min(world.w, p.x)), y: Math.max(0, Math.min(world.h, p.y)) };
};
const layerObjects = name => name === 'tokens' ? world.tokens.map(t => ({ ...t, ...tokenPosition(t) })) : name === 'chains' ? world.chains.map(c => ({ ...c, size: 1 })) : name === 'floors' || name === 'props' ? world[name] : world[name].map(s => ({ points: [{ x: s[0], y: s[1] }, { x: s[2], y: s[3] }] }));
const objectDistance = (layer, object, p) => {
  if (object.walkDeleted) return Infinity;
  if (layer === 'chains') return Math.max(0, Math.hypot(object.x - p.x, object.y - p.y) - 0.4);
  if (layer === 'props') return propDistance(object, p);
  const position = tokenPosition(object);
  return Math.max(0, Math.hypot(position.x - p.x, position.y - p.y) - object.size * 0.4);
};
function placedHit(p, layers = ['tokens', 'props', 'chains']) {
  for (const layer of layers) for (let i = world[layer].length - 1; i >= 0; i--) {
    if (world[layer][i].walkDeleted) continue;
    if (objectDistance(layer, world[layer][i], p) <= 0.1) return { layer, index: i, object: world[layer][i] };
  }
  return null;
}
function snapPoint(event) {
  const p = editPoint(event);
  if (tool !== 'walls' && !$('walk-snap').checked) return p;
  const round = (v, max, step = 1) => Math.max(0, Math.min(Math.floor(max / step), Math.round(v / step))) * step;
  const x = round(p.x, world.w), y = round(p.y, world.h);
  if (tool !== 'walls' || !event.shiftKey) return { x, y };
  const a = { x: round(p.x, world.w, 0.5), y }, b = { x, y: round(p.y, world.h, 0.5) };
  return Math.hypot(p.x - a.x, p.y - a.y) <= Math.hypot(p.x - b.x, p.y - b.y) ? a : b;
}
function removeObjects(name, indices) {
  const removed = new Set(indices);
  if (name === 'tokens') { removeWalkTokens(world.tokens.filter((_, i) => removed.has(i)).map(t => t.id)); return; }
  if (name === 'chains') {
    const ids = new Set(world.chains.filter((_, i) => removed.has(i)).map(c => c.id));
    world.triggers.forEach(t => { if (t.chains) { t.chains = t.chains.filter(id => !ids.has(id)); if (!t.chains.length) delete t.chains; } });
    world.tokens.forEach(t => { if (t.walkAI && ids.has(t.walkAI.chain)) t.walkAI.chain = null; });
  }
  if (name === 'props') {
    const ids = new Set(world.props.filter((_, i) => removed.has(i)).map(p => p.id));
    world.triggers = world.triggers.filter(t => !ids.has(t.id));
  }
  if (name === 'doors') {
    const remap = new Map(); let next = 0;
    world.doors.forEach((_, i) => { if (!removed.has(i)) remap.set(i, next++); });
    world.triggers.forEach(t => { t.doors = t.doors.filter(i => remap.has(i)).map(i => remap.get(i)); });
    for (const token of world.tokens) if (token.walkAI && token.walkAI.door >= 0) {
      if (remap.has(token.walkAI.door)) token.walkAI.door = remap.get(token.walkAI.door);
      else delete token.walkAI;
    }
    world.open = new Set([...world.open].filter(i => remap.has(i)).map(i => remap.get(i)));
    world.swing.clear(); pendingDoors.clear();
  }
  world[name] = world[name].filter((_, i) => !removed.has(i));
  if (name === 'walls' || name === 'doors') {
    const materials = name === 'walls' ? 'wallMaterials' : 'doorMaterials';
    world[materials] = world[materials].filter((_, i) => !removed.has(i));
  }
}
function applySelection(erase, before = editState()) {
  if (!editableLayer(tool) || !selection.size) return;
  let settings;
  try { if (!erase && objectLayer(tool)) settings = walkObjectSettings(tool); }
  catch (error) { $('walk-editor-status').textContent = error.message; return; }
  if (erase) removeObjects(tool, selection);
  else for (const i of selection) {
    if (objectLayer(tool)) {
      const current = world[tool][i], value = { ...current, ...settings };
      if (tool === 'tokens' && current.kind !== 'pc' && (settings.hp === 0 || JSON.stringify(current.walkAI) !== JSON.stringify(settings.walkAI))) {
        const p = tokenPosition(current); value.x = p.x; value.y = p.y; value.walkMovedAt = serverNow();
        Object.assign(before.tokens.find(t => t.id === current.id), { x: p.x, y: p.y });
      }
      world[tool][i] = tool === 'chains' ? value : tool === 'props' ? importedProps([value])[0] : importedTokens([value], world.w, world.h)[0];
      if (tool === 'props') syncPropTrigger(world.props[i]);
    }
    else if (tool === 'floors') world.floors[i].material = $('walk-material').value;
    else world[tool === 'walls' ? 'wallMaterials' : 'doorMaterials'][i] = $('walk-material').value;
  }
  selection.clear(); commitEdit(before); editButtons();
}
function addMapSegment(name, a, b, material) {
  if (a.x === b.x && a.y === b.y) return;
  if (name === 'doors') {
    const walls = cutDoorOpening(world.walls.map((s, i) => ({ points: [{ x: s[0], y: s[1] }, { x: s[2], y: s[3] }], material: world.wallMaterials[i] || 'stone' })), [a, b]);
    world.walls = walls.map(w => w.points.flatMap(p => [p.x, p.y])); world.wallMaterials = walls.map(w => w.material);
  }
  world[name].push([a.x, a.y, b.x, b.y]);
  world[name === 'walls' ? 'wallMaterials' : 'doorMaterials'].push(material);
}
function fillArea(p, room = false) {
  if (tool === 'walls') return;
  const spacing = tool === 'floors' ? 1 : Number($('walk-spacing').value);
  if (!Number.isFinite(spacing) || spacing < 0.5 || spacing > 100) throw new Error('Fill spacing must be between 0.5 and 100 squares.');
  const model = { width: world.w, height: world.h, walls: layerObjects('walls'), doors: layerObjects('doors').map((d, i) => ({ ...d, open: !room && doorIsOpen(i) })) };
  const cells = bucketCells(model, p, spacing, 2000), before = editState(), material = $('walk-material').value;
  if (tool === 'floors') paintFloorTiles(world.floors, cells, material);
  else for (const c of cells) {
    if (world.doors.some(s => distance(c, { x: s[0], y: s[1] }, { x: s[2], y: s[3] }) < 0.01)) continue;
    addMapSegment('doors', { x: Math.max(0, c.x - 0.5), y: c.y }, { x: Math.min(world.w, c.x + 0.5), y: c.y }, material);
  }
  commitEdit(before);
}
function finishChain() {
  if (chain.length < 2) return;
  const before = editState(), material = $('walk-material').value;
  for (let i = 1; i < chain.length; i++) addMapSegment('walls', chain[i - 1], chain[i], material);
  chain = []; hover = null; commitEdit(before);
}
function paintStroke(p) {
  if (stroke.action === 'erase') {
    const indices = objectLayer(stroke.tool) ? world[stroke.tool].flatMap((o, i) => !o.walkDeleted && (distance(o, stroke.last, p) <= (o.size || 1) / 2 + 0.1 || objectDistance(stroke.tool, o, p) <= 0.1) ? [i] : []) : eraseStrokeIndices(layerObjects(stroke.tool), stroke.last, p, stroke.tool, 9 / (viewScale * TILE_W));
    removeObjects(stroke.tool, indices); stroke.last = p; return;
  }
  const cells = floorBrushCells(stroke.last, p).filter(t => t.x < world.w && t.y < world.h);
  paintFloorTiles(world.floors, cells, stroke.material); stroke.last = p;
}
function cancelStroke() {
  if (!stroke) return;
  const before = stroke.before; stroke = null; canvas.classList.remove('walk-moving'); restoreEdit(before); editButtons();
}
function dragTrigger(event) {
  if (!stroke.moved && Math.hypot(event.clientX - stroke.screen.x, event.clientY - stroke.screen.y) < 4) return;
  stroke.moved = true;
  const p = canvasPoint(event);
  moveTrigger(stroke.triggerId, stroke.position.x + p.x - stroke.start.x, stroke.position.y + p.y - stroke.start.y, $('walk-snap').checked);
}
function dragObject(event) {
  if (!stroke.moved && Math.hypot(event.clientX - stroke.screen.x, event.clientY - stroke.screen.y) < 4) return;
  if (!stroke.moved && stroke.layer === 'tokens') {
    const token = world.tokens.find(t => t.id === stroke.objectId) || stroke.objectSeed;
    if (token) {
      const before = stroke.before.tokens.find(t => t.id === token.id);
      if (before) Object.assign(before, stroke.position);
      else stroke.before.tokens.push({ ...structuredClone(token), ...stroke.position });
    }
  }
  stroke.moved = true;
  if (stroke.objectSeed && !world.tokens.some(t => t.id === stroke.objectId)) world.tokens.push(stroke.objectSeed);
  const p = canvasPoint(event);
  movePlacedObject(stroke.layer, stroke.objectId, stroke.position.x + p.x - stroke.start.x, stroke.position.y + p.y - stroke.start.y, $('walk-snap').checked);
  if (stroke.layer === 'tokens') {
    const token = world.tokens.find(t => t.id === stroke.objectId);
    token.walkMovedAt = serverNow(); relocateToken(token);
  }
}
function relocateToken(token) {
  if (token?.kind !== 'pc' || !token.npcId?.startsWith('v2:')) return;
  token.walkMovedAt = serverNow();
  const pcId = token.npcId.slice(3), p = { x: token.x, y: token.y };
  lastPositions.set(pcId, p);
  const other = others.get(pcId);
  if (other) { other.target = { ...p }; other.shown = { ...p }; }
  if (me?.pcId === pcId) me.pos = { ...p };
}
function placeObject(p) {
  const before = editState(), settings = walkObjectSettings(tool);
  if ($('walk-snap').checked) p = { x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 };
  if (p.x > world.w || p.y > world.h) return;
  const existing = tool === 'tokens' && settings.kind === 'pc' ? world.tokens.find(t => t.npcId === settings.npcId) : null;
  if (existing) Object.assign(before.tokens.find(t => t.id === existing.id), { x: tokenPosition(existing).x, y: tokenPosition(existing).y });
  const value = { ...settings, ...p, id: existing?.id || crypto.randomUUID() };
  const object = tool === 'chains' ? value : tool === 'props' ? importedProps([value])[0] : importedTokens([value], world.w, world.h)[0];
  if (!object) throw new Error('Invalid object settings.');
  if (existing) world.tokens[world.tokens.indexOf(existing)] = object;
  else world[tool].push(object);
  if (tool === 'props') syncPropTrigger(object);
  else relocateToken(object);
  selection.clear(); selection.add(world[tool].indexOf(object));
  commitEdit(before);
}
canvas.addEventListener('pointerdown', event => {
  if (event.button === 0) suppressClick = false;
  if (isGM && currentMap && !pan && event.button === 0 && !$('walk-editor').hidden && (!tool || tool === 'move' || objectLayer(tool) && ['paint', 'select'].includes(paintAction))) {
    const p = canvasPoint(event), hit = placedHit(p, objectLayer(tool) ? [tool] : ['tokens', 'props', 'chains']);
    if (hit) {
      cancelStroke(); selection.clear(); if (hit.layer === tool) selection.add(hit.index);
      selectWalkObject(hit.layer, hit.object);
      selected = world.triggers.some(t => t.id === hit.object.id) ? hit.object.id : null;
      const position = hit.layer === 'tokens' ? tokenPosition(hit.object) : hit.object;
      stroke = { id: event.pointerId, action: 'move-object', layer: hit.layer, objectId: hit.object.id, start: p, position: { x: position.x, y: position.y }, screen: { x: event.clientX, y: event.clientY }, before: editState(), moved: false };
      canvas.setPointerCapture(event.pointerId); canvas.classList.add('walk-moving'); editButtons(); return;
    }
    if (!tool || tool === 'move') {
      const actor = roster.find(bot => {
        if (pcToken(bot.pcId)?.walkDeleted) return false;
        const position = bot.pcId === me?.pcId ? me.pos : others.get(bot.pcId)?.shown || lastPositions.get(bot.pcId) || pcStart(bot.pcId, bot.seat);
        return Math.hypot(position.x - p.x, position.y - p.y) <= 0.45;
      });
      if (actor) {
        const position = actor.pcId === me?.pcId ? me.pos : others.get(actor.pcId)?.shown || lastPositions.get(actor.pcId) || pcStart(actor.pcId, actor.seat);
        const object = pcToken(actor.pcId) || importedTokens([{ id: crypto.randomUUID(), npcId: `v2:${actor.pcId}`, kind: 'pc', name: actor.name, size: 1, hp: Math.max(0, actor.hp || 0), ...position }], world.w, world.h)[0];
        stroke = { id: event.pointerId, action: 'move-object', layer: 'tokens', objectId: object.id, objectSeed: object, start: p, position: { ...position }, screen: { x: event.clientX, y: event.clientY }, before: editState(), moved: false };
        canvas.setPointerCapture(event.pointerId); canvas.classList.add('walk-moving'); return;
      }
    }
  }
  if (isGM && currentMap && !pan && event.button === 0 && !$('walk-editor').hidden && (!tool || ['move', 'lever', 'plate'].includes(tool) || MATERIAL_LAYERS[tool] && paintAction === 'select')) {
    const p = canvasPoint(event), hit = nearestTrigger(p.x, p.y, 0.6);
    if (hit) {
      cancelStroke(); selected = hit.id; selection.clear();
      stroke = { id: event.pointerId, action: 'move-trigger', triggerId: hit.id, start: p, position: { x: hit.x, y: hit.y }, screen: { x: event.clientX, y: event.clientY }, before: editState(), moved: false };
      canvas.setPointerCapture(event.pointerId); canvas.classList.add('walk-moving'); editButtons(); return;
    }
  }
  if (!isGM || !currentMap || pan || event.button !== 0 || !editableLayer(tool)) return;
  const raw = canvasPoint(event);
  if (raw.x < 0 || raw.y < 0 || raw.x > world.w || raw.y > world.h) return;
  if (objectLayer(tool) && paintAction === 'paint') {
    suppressClick = true;
    try { placeObject(raw); } catch (error) { $('walk-editor-status').textContent = error.message; }
    return;
  }
  if (paintAction === 'bucket' || paintAction === 'paint' && tool === 'floors' && event.shiftKey) {
    suppressClick = true;
    try { fillArea(raw, event.shiftKey); } catch (error) { $('walk-editor-status').textContent = error.message; }
    return;
  }
  const p = paintAction === 'paint' && tool !== 'floors' ? snapPoint(event) : editPoint(event);
  stroke = { id: event.pointerId, tool, action: paintAction, start: p, last: p, end: p, screen: { x: event.clientX, y: event.clientY }, material: $('walk-material').value, before: editState() };
  selection.clear(); editButtons();
  canvas.setPointerCapture(event.pointerId);
  if (paintAction === 'erase' || paintAction === 'paint' && tool === 'floors') paintStroke(p);
});
canvas.addEventListener('pointermove', event => {
  if (!stroke && chain.length && tool === 'walls') hover = snapPoint(event);
  if (!stroke || event.pointerId !== stroke.id) return;
  if (stroke.action === 'move-object') { dragObject(event); return; }
  if (stroke.action === 'move-trigger') { dragTrigger(event); return; }
  stroke.end = stroke.action === 'paint' && stroke.tool !== 'floors' ? snapPoint(event) : editPoint(event);
  if (stroke.action === 'erase' || stroke.action === 'paint' && stroke.tool === 'floors') paintStroke(stroke.end);
});
canvas.addEventListener('pointerup', event => {
  if (!stroke || event.pointerId !== stroke.id || event.button !== 0) return;
  if (stroke.action === 'move-object') {
    dragObject(event);
    const moved = stroke; stroke = null; canvas.classList.remove('walk-moving'); suppressClick = true;
    if (moved.moved) commitEdit(moved.before);
    return;
  }
  if (stroke.action === 'move-trigger') {
    dragTrigger(event);
    const moved = stroke; stroke = null; canvas.classList.remove('walk-moving');
    suppressClick = moved.moved;
    if (moved.moved) commitEdit(moved.before);
    return;
  }
  suppressClick = true;
  const s = stroke, a = s.start, b = s.action === 'paint' && s.tool !== 'floors' ? snapPoint(event) : editPoint(event);
  if (s.action === 'erase' || s.action === 'paint' && s.tool === 'floors') paintStroke(b);
  stroke = null;
  if (s.action === 'select' || s.action === 'replace') {
    const click = Math.hypot(event.clientX - s.screen.x, event.clientY - s.screen.y) < 4;
    const indices = click ? objectLayer(s.tool) ? world[s.tool].flatMap((o, i) => objectDistance(s.tool, o, b) <= 0.1 ? [i] : []).slice(-1) : eraseStrokeIndices(layerObjects(s.tool), b, b, s.tool, 9 / (viewScale * TILE_W)).slice(-1) : layerObjects(s.tool).flatMap((o, i) => !o.walkDeleted && inBox(o, a, b, s.tool === 'chains' ? 'floors' : s.tool) ? [i] : []);
    indices.forEach(i => selection.add(i));
    if (s.action === 'select' && selection.size === 1 && objectLayer(s.tool)) selectWalkObject(s.tool, world[s.tool][indices[0]]);
    if (s.action === 'replace') applySelection(false, s.before);
    editButtons(); return;
  }
  if (s.action === 'paint' && s.tool !== 'floors') {
    if (s.tool === 'walls' && Math.hypot(event.clientX - s.screen.x, event.clientY - s.screen.y) < 4) {
      if (!chain.length || Math.hypot(chain.at(-1).x - b.x, chain.at(-1).y - b.y) > 0.00001) chain.push(b);
      hover = b; return;
    }
    chain = []; hover = null; addMapSegment(s.tool, a, b, s.material);
  }
  commitEdit(s.before);
});
canvas.addEventListener('pointercancel', cancelStroke);
canvas.addEventListener('lostpointercapture', cancelStroke);
addEventListener('blur', cancelStroke);
addEventListener('keydown', event => {
  if (!isGM || !currentMap || dialog.open || event.target.isContentEditable || event.target.matches?.('input, textarea, select')) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && !event.altKey && ['z', 'y'].includes(key)) {
    event.preventDefault(); editHistory(key === 'z' && !event.shiftKey); return;
  }
  if (event.key === 'Escape') { cancelStroke(); chain = []; hover = null; selection.clear(); editButtons(); }
  else if (event.key === 'Enter' && chain.length) { event.preventDefault(); finishChain(); }
  else if (event.key === 'Backspace' && chain.length) { event.preventDefault(); chain.pop(); }
  else if (event.key === 'Delete' && selection.size) { event.preventDefault(); applySelection(true); }
});
canvas.addEventListener('wheel', event => {
  if (!isGM || !joined || !currentMap) return;
  event.preventDefault();
  cancelStroke();
  const anchor = canvasPoint(event);
  freeCamera();
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
  zoom = Math.max(0.01, Math.min(8, zoom * Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002)));
  syncCamera();
  const after = canvasPoint(event);
  camera.x += anchor.x - after.x; camera.y += anchor.y - after.y;
  syncCamera();
}, { passive: false });
canvas.addEventListener('contextmenu', event => { if (isGM) event.preventDefault(); });
function gmObjectMenu(event) {
  if (!isGM || !joined || !currentMap) return;
  const p = canvasPoint(event), file = currentMap, actions = [];
  const prop = placedHit(p, ['props']);
  const lever = (prop && world.triggers.find(t => t.id === prop.object.id && t.kind === 'lever')) || nearestTrigger(p.x, p.y, 0.6, 'lever');
  if (lever) actions.push({ label: lever.on ? 'Reset lever' : 'Activate lever', action: () => {
    if (!isGM || currentMap !== file) return;
    const trigger = world.triggers.find(t => t.id === lever.id);
    if (trigger) fire(trigger);
  } });
  const chain = placedHit(p, ['chains']);
  if (chain) actions.push({ label: chain.object.locked ? 'Unlock chains' : 'Lock chains', action: () => {
    if (isGM && currentMap === file) { const current = world.chains.find(c => c.id === chain.object.id); if (current) setChain(current.id, !current.locked); }
  } });
  const placed = placedHit(p, ['tokens']);
  const actor = !placed && roster.find(bot => {
    if (pcToken(bot.pcId)?.walkDeleted) return false;
    const position = bot.pcId === me?.pcId ? me.pos : others.get(bot.pcId)?.shown || lastPositions.get(bot.pcId) || pcStart(bot.pcId, bot.seat);
    return Math.hypot(position.x - p.x, position.y - p.y) <= 0.45;
  });
  const pcId = actor?.pcId || (placed?.object.kind === 'pc' && placed.object.npcId?.startsWith('v2:') ? placed.object.npcId.slice(3) : null);
  const captive = pcId || ai.status(placed?.object || {})?.captured;
  if (captive && ai.held(captive)) actions.push({ label: 'Release PC', action: () => { if (currentMap === file) ai.release(captive); } });
  if (placed && placed.object.kind !== 'pc') {
    const changeAI = disposition => {
      if (!isGM || currentMap !== file) return;
      const token = world.tokens.find(t => t.id === placed.object.id);
      if (!token || token.walkDeleted || token.kind === 'pc') return;
      const before = editState(), p = tokenPosition(token), hp = token.hp;
      Object.assign(before.tokens.find(t => t.id === token.id), { x: p.x, y: p.y });
      token.x = p.x; token.y = p.y; token.walkMovedAt = serverNow();
      if (disposition) activateNPCAI(token, disposition);
      else token.walkAI = { ...token.walkAI, disabled: true };
      selectWalkObject('tokens', token); commitEdit(before);
      if (disposition && hp <= 0) message('NPC AI activated with 1 HP.');
    };
    actions.push({ label: 'Activate AI…', action: () => {
      if (!isGM || currentMap !== file) return;
      showMapMenu(event.clientX, event.clientY, [
        { label: 'Enemy', action: () => changeAI('enemy') },
        { label: 'Friendly', action: () => changeAI('friendly') }
      ], canvas);
    } });
    if (placed.object.walkAI && !placed.object.walkAI.disabled) actions.push({ label: 'Deactivate AI', action: () => changeAI(null) });
  }
  if (placed && placed.object.kind !== 'pc') actions.push({ label: 'Set HP…', action: () => {
    if (!isGM || currentMap !== file) return;
    const token = world.tokens.find(t => t.id === placed.object.id);
    if (!token) return;
    const answer = prompt(`${token.name} HP`, String(token.hp));
    if (answer === null) return;
    const hp = Number(answer);
    if (!answer.trim() || !Number.isSafeInteger(hp) || hp < 0 || hp > 999999) { message('HP must be a whole number from 0 to 999999.'); return; }
    const before = editState();
    if (hp === 0) {
      const p = tokenPosition(token); Object.assign(before.tokens.find(t => t.id === token.id), { x: p.x, y: p.y });
      token.x = p.x; token.y = p.y; token.walkMovedAt = serverNow();
    }
    token.hp = hp; commitEdit(before);
  } });
  if (placed || actor) actions.push({ label: 'Delete token', action: () => {
    if (!isGM || currentMap !== file) return;
    const before = editState();
    let token = placed ? world.tokens.find(t => t.id === placed.object.id) : pcToken(actor.pcId);
    if (!token && actor) {
      const position = actor.pcId === me?.pcId ? me.pos : others.get(actor.pcId)?.shown || lastPositions.get(actor.pcId) || pcStart(actor.pcId, actor.seat);
      token = importedTokens([{ id: crypto.randomUUID(), npcId: `v2:${actor.pcId}`, kind: 'pc', name: actor.name, hp: Math.max(0, actor.hp || 0), size: 1, x: position.x, y: position.y }], world.w, world.h)[0];
      if (token) world.tokens.push(token);
    }
    if (token) { removeWalkTokens([token.id]); selection.clear(); commitEdit(before); }
  } });
  if (actions.length) { pressed.clear(); showMapMenu(event.clientX, event.clientY, actions, canvas); }
}
canvas.addEventListener('pointerdown', event => {
  if (!isGM || !joined || !currentMap || event.button !== 2) return;
  event.preventDefault(); closeMapMenu(); cancelStroke();
  pan = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
  canvas.setPointerCapture(event.pointerId); canvas.classList.add('walk-panning');
});
canvas.addEventListener('pointermove', event => {
  if (!pan || pan.id !== event.pointerId) return;
  if (!pan.moved) {
    if (Math.hypot(event.clientX - pan.startX, event.clientY - pan.startY) < 4) return;
    freeCamera(); pan.moved = true;
  }
  camera.x -= (event.clientX - pan.x) / (viewScale * TILE_W);
  camera.y -= (event.clientY - pan.y) / (viewScale * TILE_H);
  pan.x = event.clientX; pan.y = event.clientY; syncCamera();
});
function endPan() {
  const id = pan?.id; pan = null; canvas.classList.remove('walk-panning');
  if (id != null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
}
canvas.addEventListener('pointerup', event => {
  if (event.button !== 2 || event.pointerId !== pan?.id) return;
  const moved = pan.moved; endPan();
  if (!moved) gmObjectMenu(event);
});
canvas.addEventListener('pointercancel', endPan);
canvas.addEventListener('lostpointercapture', endPan);
addEventListener('blur', endPan);
function showPause() {
  $('walk-paused').hidden = !paused; $('walk-pause').setAttribute('aria-pressed', String(paused)); $('walk-pause').textContent = paused ? 'Resume' : 'Pause';
}
function receive(value) {
  sharedWalk = value;
  if (typeof value?.map === 'string' && value.map !== currentMap) loadMap(value.map).catch(error => message(error.message));
  if (currentMap) {
    applyMapEdit(value?.edits?.[mapKey()] ?? null);
    const open = new Set(Object.entries(value?.doors?.[mapKey()] || {}).filter(([, on]) => on).map(([key]) => Number(key.slice(1))));
    for (const [index, hold] of pendingDoors) {
      if (open.has(index) === hold.open || performance.now() > hold.until) pendingDoors.delete(index);
      else open[hold.open ? 'add' : 'delete'](index);
    }
    if (!editWrites && !unsavedEdits.has(mapKey())) world.open = open;
    if (!stroke && !editWrites && !unsavedEdits.has(mapKey()) && performance.now() > triggersHold) world.triggers = Object.entries(value?.triggers?.[mapKey()] || {}).map(([id, raw]) => cleanTrigger(id, raw)).filter(Boolean);
    if (!editWrites) for (const chain of world.chains) {
      const locked = value?.chains?.[mapKey()]?.[chain.id], hold = pendingChains.get(chain.id);
      if (hold && hold.locked !== locked && performance.now() < hold.until) { chain.locked = hold.locked; continue; }
      pendingChains.delete(chain.id);
      if (typeof locked === 'boolean') chain.locked = locked;
    }
    ai.receive(value?.ai?.[mapKey()] ?? null);
    combat?.receive(value?.combat?.[mapKey()] ?? null);
  }
  if ((value?.paused === true) !== paused) { paused = value?.paused === true; showPause(); }
  const records = value?.players || {}, now = serverNow(), seen = new Set();
  for (const record of Object.values(records)) {
    const placement = pcToken(record?.pcId);
    const position = placement?.walkMovedAt > record?.seen ? { x: placement.x, y: placement.y } : { x: record?.x, y: record?.y };
    if (validWalker(record, now, Infinity)) lastPositions.set(record.pcId, position);
    if (!validWalker(record, now) || me && record.pcId === me.pcId) continue;
    seen.add(record.pcId);
    const entry = others.get(record.pcId);
    const target = position, roll = validRoll(record.roll) ? record.roll : null;
    if (entry) Object.assign(entry, { name: record.name, hp: record.hp, max: record.max, target, roll });
    else others.set(record.pcId, { name: record.name, hp: record.hp, max: record.max, shown: { ...target }, target, roll });
  }
  for (const id of [...others.keys()]) if (!seen.has(id)) others.delete(id);
}

// --- joining and leaving
async function loadHp(pcId) {
  const response = await fetch(`${entitiesUrl}/${encodeURIComponent(pcId)}/data/combat.json`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
  const combat = await response.json();
  return { hp: Number.isFinite(combat?.hp_current) ? combat.hp_current : null, max: Number.isFinite(combat?.hp_max) ? combat.hp_max : null };
}
function begin() {
  joined = true; others.clear();
  stopWatch ||= watchTabletop(walkKey, receive, message);
  $('walk-change').hidden = false;
  $('walk-fit').hidden = !(isGM || spectator);
  syncClock().catch(() => {});
}
async function playAs(character, campaign) {
  const entities = await (await fetch(`${entitiesUrl}.json`, { signal: AbortSignal.timeout(15000) })).json();
  const player = resolvePlayer(entities, campaign, character);
  setPlayerIdentity(player);
  if (hordeMode) { $('walk-campaign').value = campaign; await loadRoster(campaign); }
  const combat = entities[player.pcId]?.data?.combat || {};
  const seat = Math.max(0, CHARACTERS.indexOf(character));
  me = { pcId: player.pcId, name: character, seat, pos: pcStart(player.pcId, seat), hp: Number.isFinite(combat.hp_current) ? combat.hp_current : null, max: Number.isFinite(combat.hp_max) ? combat.hp_max : null };
  spectator = false; focus = { ...me.pos };
  if (hordeMode) $('walk-change').textContent = 'Change character';
  begin(); post(true);
  loadChecks(me.pcId).catch(error => message(`Rolls unavailable: ${error.message}`));
}
function watchOnly() {
  me = null; spectator = true; focus = { x: world.w / 2, y: world.h / 2 };
  if (hordeMode) $('walk-change').textContent = 'Choose character';
  begin();
}
async function leave() {
  const old = me; me = null; spectator = false; joined = false; lastSent = '';
  if (old) lastPositions.set(old.pcId, { ...old.pos });
  $('walk-change').hidden = true; $('walk-hud').textContent = ''; $('walk-dice-history').replaceChildren(); loadChecks(null);
  $('walk-fit').hidden = true; fitView = false; camera = null; zoom = 1; endPan(); $('walk-fit').setAttribute('aria-pressed', 'false');
  if (old) fetch(walkPath(old.pcId), { method: 'DELETE', keepalive: true }).catch(() => {});
}

// --- the login dialog
const dialog = $('walk-login'), choices = $('walk-characters');
$('walk-campaign').append(...CAMPAIGNS.map(name => new Option(name, name)));
$('walk-campaign').value = CAMPAIGNS.includes('daddies') ? 'daddies' : CAMPAIGNS[0];
for (const name of CHARACTERS) {
  const button = document.createElement('button'), swatch = document.createElement('span');
  button.type = 'button'; swatch.className = 'swatch'; swatch.style.background = personColors(name, 'striker').body;
  button.append(swatch, document.createTextNode(name));
  button.addEventListener('click', async () => {
    choices.querySelectorAll('button').forEach(b => { b.disabled = true; });
    $('walk-login-status').textContent = `Loading ${name}…`;
    try { await playAs(name, $('walk-campaign').value); dialog.close(); }
    catch (error) { $('walk-login-status').textContent = error.name === 'TimeoutError' ? 'That took too long. Try again.' : error.message; }
    finally { choices.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
  });
  choices.append(button);
}
$('walk-map').addEventListener('change', () => chooseMap($('walk-map').value).catch(error => { $('walk-login-status').textContent = error.message; }));
$('walk-spectate').addEventListener('click', () => { watchOnly(); dialog.close(); });
dialog.addEventListener('cancel', event => { if (!joined) event.preventDefault(); });
$('walk-change').addEventListener('click', async () => { await leave(); pressed.clear(); $('walk-login-status').textContent = ''; dialog.showModal(); });
$('walk-fit').addEventListener('click', () => {
  if (!joined || !(isGM || spectator)) return;
  cancelStroke(); endPan(); camera = null; zoom = 1; fitView = !fitView;
  $('walk-fit').setAttribute('aria-pressed', String(fitView));
});

// --- dice: plain 2D rolls, kept on this page
$('walk-dice-toggle').addEventListener('click', () => {
  const panel = $('walk-dice'); panel.hidden = !panel.hidden; $('walk-dice-toggle').setAttribute('aria-expanded', String(!panel.hidden));
});
// The same sheet rolls as minigame.html: the character's own skill, ability and save bonuses, with disadvantage applied for armour or load.
const checks = new Map();   // key -> { label, expression, disadvantage }
async function loadChecks(pcId) {
  const select = $('walk-dice-check'); select.replaceChildren(); checks.clear();
  $('walk-dice-roll').disabled = select.disabled = true;
  if (!pcId) return;
  const [data, reference] = await Promise.all([readPC({ npcId: `v2:${pcId}` }), loadSheetReference()]);
  if (!me || me.pcId !== pcId) return;
  const rolls = sheetRolls(data, reference);
  for (const group of ['Ability Checks', 'Saving Throws', 'Skill Checks', 'Initiative']) {
    const optgroup = document.createElement('optgroup'); optgroup.label = group;
    for (const check of rolls[group] || []) { checks.set(check.key, check); optgroup.append(new Option(`${check.label} ${check.expression.slice(3)}`, check.key)); }
    if (optgroup.children.length) select.append(optgroup);
  }
  $('walk-dice-roll').disabled = select.disabled = !checks.size;
}
$('walk-dice-roll').addEventListener('click', () => {
  const check = checks.get($('walk-dice-check').value);
  if (!check || !me || paused) return;
  try {
    const roll = buildExpressionRoll(check.expression, check.disadvantage ? 'disadvantage' : 'normal');
    me.roll = { at: serverNow(), nat: roll.dice.find(die => !die.drop).v, total: roll.total }; post(true); // the die appears over our head on every screen
    const entry = document.createElement('li');
    entry.textContent = `${check.label}: ${roll.label} = ${roll.total}${roll.sub ? ` [${roll.sub}]` : ''}`;
    if (roll.cls) entry.className = roll.cls === 'crit' ? 'roll-critical' : 'roll-fumble';
    $('walk-dice-history').prepend(entry);
    while ($('walk-dice-history').children.length > 10) $('walk-dice-history').lastElementChild.remove();
  } catch (error) { message(error.message); }
});
// the select is a form control: arrow keys must change its choice, not walk the player
addEventListener('keydown', event => { if (event.target.matches?.('#walk-dice select')) event.stopImmediatePropagation(); }, true);

// --- keys
addEventListener('keydown', event => {
  if (event.target.matches?.('select, input, textarea, button, .editor-titlebar') && !(event.target.id === 'horde-command' && event.key.startsWith('Arrow'))) return;
  const key = KEY_TO_MOVE[event.key.toLowerCase()];
  if (!key || dialog.open || event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault(); pressed.add(key);
});
addEventListener('keydown', event => {
  if (event.defaultPrevented || event.key !== ' ' || !me || dialog.open || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target.matches?.('select, input')) return;
  event.preventDefault();
  if (paused || pcToken(me.pcId)?.walkDeleted) return;
  const lever = nearestTrigger(me.pos.x, me.pos.y, 1, 'lever');
  if (lever) fire(lever); else toggleDoor();
});
addEventListener('click', event => event.target.closest?.('button')?.blur()); // so Space opens doors instead of re-pressing a button
addEventListener('keyup', event => { const key = KEY_TO_MOVE[event.key.toLowerCase()]; if (key) pressed.delete(key); });
addEventListener('blur', () => pressed.clear());

// --- drawing
// The d20 above a character's head, as in minigame.html: tossed up, tumbling through faces, then settling on the real roll with the total.
// Timed from the roll's shared timestamp, so every screen shows the same moment.
const ROLL = { toss: 0.33, tumble: 1.2, hold: 4.6, end: 5.5 };   // seconds since the roll
const calmMotion = matchMedia('(prefers-reduced-motion: reduce)');
const dieFace = (n, seed) => ((Math.imul(n + seed, 2654435761) >>> 0) % 20) + 1;
const validRoll = r => !!r && Number.isFinite(r.at) && Number.isInteger(r.nat) && r.nat >= 1 && r.nat <= 20 && Number.isFinite(r.total);
function drawRollDie(roll, x, y, look) {
  const elapsed = (serverNow() - roll.at) / 1000;
  if (elapsed < 0 || elapsed > ROLL.end) return;
  const calm = calmMotion.matches, settled = calm || elapsed >= ROLL.tumble, ticks = elapsed * 30;
  const rise = calm ? 1 : Math.min(1, elapsed / ROLL.toss), home = y - 62, start = y - 14;
  const bounce = settled && !calm && elapsed < ROLL.tumble + 0.4 ? Math.abs(Math.sin((elapsed - ROLL.tumble) * 15)) * 4 * (1 - (elapsed - ROLL.tumble) / 0.4) : 0;
  const cy = start + (home - start) * (1 - (1 - rise) ** 2) - (settled ? 0 : Math.sin(rise * Math.PI) * 12) - bounce;
  const fade = elapsed > ROLL.hold ? Math.max(0, 1 - (elapsed - ROLL.hold) / (ROLL.end - ROLL.hold)) : 1;
  const shown = settled ? roll.nat : dieFace(Math.floor(ticks / (1 + Math.floor(ticks / 9))), roll.at % 97);
  const crit = roll.nat === 20, fumble = roll.nat === 1, color = settled && crit ? '#e6b422' : settled && fumble ? '#b8343a' : look.body;
  const r = 14, spin = settled ? 0 : ticks * 0.5 * (1 - ticks / 36);
  const hex = radius => { ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * Math.PI / 3; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * radius, Math.sin(a) * radius); } ctx.closePath(); };
  ctx.save(); ctx.globalAlpha = fade; ctx.translate(x, cy); ctx.rotate(spin);
  hex(r); ctx.fillStyle = color; ctx.fill(); ctx.lineJoin = 'round'; ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
  ctx.beginPath(); for (let k = 0; k < 6; k += 2) { const a = -Math.PI / 2 + k * Math.PI / 3; ctx[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78); } ctx.closePath();
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.stroke(); ctx.restore();
  ctx.save(); ctx.globalAlpha = fade; ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.fillStyle = '#ffffff';
  const say = (text, tx, ty, size, fill = '#ffffff') => { ctx.font = `700 ${size}px system-ui, sans-serif`; ctx.fillStyle = fill; ctx.strokeText(text, tx, ty); ctx.fillText(text, tx, ty); };
  say(String(shown), x, cy + 5, shown > 9 ? 13 : 15);
  if (settled) {
    say(`= ${roll.total}`, x, cy + r + 13, 12);
    if (crit || fumble) say(crit ? 'CRIT!' : 'Fumble', x, cy - r - 5, 12, crit ? '#ffd84a' : '#ff8f8f');
  }
  ctx.restore();
}
// A lever (handle thrown one way or the other) or a pressure plate (darker while someone stands on it).
function drawTrigger(t, standing) {
  const c = project(t.x, t.y), x = origin.x + c.x, y = origin.y + c.y;
  if (t.id === selected) { ctx.beginPath(); ctx.arc(x, y, 22, 0, 6.2832); ctx.lineWidth = 3; ctx.strokeStyle = '#a2cbff'; ctx.stroke(); }
  if (world.props.some(p => p.id === t.id)) return;
  if (t.kind === 'plate') {
    const down = standing.some(p => Math.hypot(p.x - t.x, p.y - t.y) <= 0.5);
    ctx.fillStyle = down ? '#5a4a2a' : '#8a7646'; ctx.fillRect(x - 16, y - 16, 32, 32);
    ctx.lineWidth = 2; ctx.strokeStyle = '#2b2210'; ctx.strokeRect(x - 16, y - 16, 32, 32); ctx.strokeRect(x - 10, y - 10, 20, 20);
    return;
  }
  const a = (t.on ? 1 : -1) * 0.7, tipX = x + Math.sin(a) * 20, tipY = y - Math.cos(a) * 20;
  ctx.fillStyle = '#3a3f4b'; ctx.fillRect(x - 12, y - 5, 24, 12);
  ctx.lineCap = 'round'; ctx.lineWidth = 4; ctx.strokeStyle = '#c9ccd4'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tipX, tipY); ctx.stroke();
  ctx.beginPath(); ctx.arc(tipX, tipY, 5, 0, 6.2832); ctx.fillStyle = t.on ? '#6fd36b' : '#d9533a'; ctx.fill();
}
function drawChains(chain) {
  const p = project(chain.x, chain.y), x = origin.x + p.x, y = origin.y + p.y;
  if (chain.id === selected) { ctx.beginPath(); ctx.arc(x, y, 27, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.strokeStyle = '#a2cbff'; ctx.stroke(); }
  ctx.save(); ctx.translate(x, y); ctx.lineWidth = 3; ctx.strokeStyle = chain.locked ? '#dfb872' : '#91bca8';
  for (const offset of [-11, 0, 11]) { ctx.beginPath(); ctx.ellipse(offset, 0, 9, 5, offset === 0 ? -0.6 : 0.6, 0, Math.PI * 2); ctx.stroke(); }
  if (chain.locked) { ctx.fillStyle = '#dfb872'; ctx.fillRect(-5, 7, 10, 9); ctx.beginPath(); ctx.arc(0, 7, 4, Math.PI, 0); ctx.stroke(); }
  ctx.restore(); ctx.textAlign = 'center'; ctx.font = '10px system-ui'; ctx.fillStyle = chain.locked ? '#dfb872' : '#91bca8'; ctx.fillText(chain.locked ? 'Locked' : 'Unlocked', x, y + 29);
  if (chain.locked || isGM && tool === 'connect') for (const token of world.tokens) if (token.walkAI?.chain === chain.id && !token.walkDeleted) {
    const q = tokenPosition(token), b = project(q.x, q.y);
    ctx.setLineDash([3, 3]); ctx.lineWidth = 2; ctx.strokeStyle = '#b6a186'; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(origin.x + b.x, origin.y + b.y); ctx.stroke(); ctx.setLineDash([]);
  }
}
function drawWalker(name, pos, hp, max, isMe, origin, roll, pcId) {
  const token = pcToken(pcId);
  if (token) {
    drawWalkToken(ctx, { ...token, ...pos, name, hp: hp ?? token.hp, hpMax: max ?? token.hpMax }, origin);
    if (roll) { const p = project(pos.x, pos.y); drawRollDie(roll, origin.x + p.x, origin.y + p.y, personColors(name, 'striker')); }
    return;
  }
  const p = project(pos.x, pos.y), x = origin.x + p.x, y = origin.y + p.y, look = personColors(name, 'striker');
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(x + 2, y + 3, 14, 0, 6.2832); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, 14, 0, 6.2832); ctx.fillStyle = look.body; ctx.fill();
  ctx.lineWidth = isMe ? 3 : 2; ctx.strokeStyle = isMe ? '#ffffff' : look.dark; ctx.stroke();
  ctx.beginPath(); ctx.arc(x - 4, y - 4, 4, 0, 6.2832); ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fill();
  ctx.font = '700 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(name, x, y - 22); ctx.fillStyle = isMe ? '#ffe066' : look.label; ctx.fillText(name, x, y - 22);
  if (roll) drawRollDie(roll, x, y, look);
  const fraction = hpFraction(hp, max);
  if (fraction !== null) {
    const w = 40; ctx.fillStyle = '#0e0a08'; ctx.fillRect(x - w / 2 - 1, y + 19, w + 2, 7);
    ctx.fillStyle = fraction > 0.5 ? '#6fd36b' : fraction > 0.25 ? '#e0b43a' : '#d9533a'; ctx.fillRect(x - w / 2, y + 20, Math.round(w * fraction), 5);
    ctx.font = '700 10px system-ui, sans-serif'; ctx.fillStyle = '#ffffff'; ctx.strokeText(`${hp}/${max}`, x, y + 37); ctx.fillText(`${hp}/${max}`, x, y + 37);
  }
}
const materialPatterns = new Map();
function materialPattern(name) {
  if (!materialPatterns.has(name)) materialPatterns.set(name, ctx.createPattern(materialCanvas(name), 'repeat'));
  const pattern = materialPatterns.get(name);
  pattern.setTransform(new DOMMatrix().translate(origin.x, origin.y).scale(TILE_W / 128, TILE_H / 128));
  return pattern;
}
function draw() {
  const dpr = devicePixelRatio || 1, width = canvas.clientWidth, height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
  viewScale = fitView ? Math.min(Math.max(1, width - 32) / (world.w * TILE_W), Math.max(1, height - 32) / (world.h * TILE_H)) : zoom;
  const w = width / viewScale, h = height / viewScale;
  ctx.setTransform(dpr * viewScale, 0, 0, dpr * viewScale, 0, 0); ctx.clearRect(0, 0, w, h);
  const center = fitView ? { x: world.w / 2, y: world.h / 2 } : camera || focus;
  const f = project(center.x, center.y);
  origin = { x: w / 2 - f.x, y: h / 2 - f.y };
  // floor: only the tiles that are on screen
  const x0 = Math.max(0, Math.floor(-origin.x / TILE_W)), x1 = Math.min(Math.ceil(world.w), Math.ceil((w - origin.x) / TILE_W));
  const y0 = Math.max(0, Math.floor(-origin.y / TILE_H)), y1 = Math.min(Math.ceil(world.h), Math.ceil((h - origin.y) / TILE_H));
  const floors = new Map(world.floors.map(t => [`${Math.floor(t.x)},${Math.floor(t.y)}`, t.material]));
  for (let gy = y0; gy < y1; gy++) for (let gx = x0; gx < x1; gx++) {
    const c = project(gx, gy), tw = Math.min(1, world.w - gx) * TILE_W, th = Math.min(1, world.h - gy) * TILE_H;
    ctx.fillStyle = (gx + gy) % 2 ? '#2d3445' : '#262c3b'; ctx.fillRect(origin.x + c.x, origin.y + c.y, tw, th);
    const material = floors.get(`${gx},${gy}`);
    if (material) ctx.drawImage(materialCanvas(material), origin.x + c.x, origin.y + c.y, tw, th);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.strokeRect(origin.x + c.x, origin.y + c.y, tw, th);
  }
  const edge = project(world.w, world.h);
  ctx.lineWidth = 3; ctx.strokeStyle = '#5d6b86'; ctx.strokeRect(origin.x, origin.y, edge.x, edge.y);
  const lines = (segments, width, color) => {
    ctx.beginPath();
    for (const [ax, ay, bx, by] of segments) { const a = project(ax, ay), b = project(bx, by); ctx.moveTo(origin.x + a.x, origin.y + a.y); ctx.lineTo(origin.x + b.x, origin.y + b.y); }
    ctx.lineWidth = width; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.stroke();
  };
  // A door is a leaf hinged at its first end: closed it lies across the gap, open it has swung a quarter turn.
  world.doors.forEach(([ax, ay, bx, by], i) => {
    const t = world.swing.get(i) ?? 0, ease = t * t * (3 - 2 * t), angle = ease * Math.PI / 2, dx = bx - ax, dy = by - ay;
    lines([[ax, ay, ax + dx * Math.cos(angle) - dy * Math.sin(angle), ay + dx * Math.sin(angle) + dy * Math.cos(angle)]], 7 - 2 * ease, materialPattern(world.doorMaterials[i] || 'wood'));
  });
  world.walls.forEach((wall, i) => lines([wall], 7, materialPattern(world.wallMaterials[i] || 'stone')));
  const triggerById = new Map(world.triggers.map(t => [t.id, t]));
  for (const prop of world.props) if (!prop.hidden || isGM) drawWalkProp(ctx, { ...prop, active: triggerById.get(prop.id)?.on || standingOn.has(prop.id) }, origin);
  for (const i of selection) {
    if (tool === 'floors') {
      const tile = world.floors[i]; if (!tile) continue;
      const p = project(tile.x - 0.5, tile.y - 0.5);
      ctx.lineWidth = 2 / viewScale; ctx.strokeStyle = '#a2cbff'; ctx.strokeRect(origin.x + p.x, origin.y + p.y, TILE_W, TILE_H);
    } else if (objectLayer(tool) && world[tool]?.[i]) {
      const object = world[tool][i], corners = tool === 'props' ? propCorners(object) : null;
      if (corners) lines(corners.map((p, j) => [p.x, p.y, corners[(j + 1) % 4].x, corners[(j + 1) % 4].y]), 2 / viewScale, '#a2cbff');
      else { const p = tokenPosition(object), s = project(p.x, p.y); ctx.beginPath(); ctx.arc(origin.x + s.x, origin.y + s.y, (object.size || 1) * TILE_W / 2, 0, Math.PI * 2); ctx.lineWidth = 2 / viewScale; ctx.strokeStyle = '#a2cbff'; ctx.stroke(); }
    } else if (world[tool]?.[i]) lines([world[tool][i]], 11, '#a2cbff99');
  }
  if (chain.length) {
    const points = hover ? [...chain, hover] : chain;
    ctx.setLineDash([6, 4]);
    lines(points.slice(1).map((p, i) => [points[i].x, points[i].y, p.x, p.y]), 7, '#a2cbff'); ctx.setLineDash([]);
    for (const p of chain) { const q = project(p.x, p.y); ctx.beginPath(); ctx.arc(origin.x + q.x, origin.y + q.y, 4 / viewScale, 0, Math.PI * 2); ctx.fillStyle = '#a2cbff'; ctx.fill(); }
  }
  if (stroke && ['select', 'replace'].includes(stroke.action)) {
    const a = project(stroke.start.x, stroke.start.y), b = project(stroke.end.x, stroke.end.y);
    ctx.lineWidth = 1 / viewScale; ctx.strokeStyle = '#a2cbff'; ctx.fillStyle = '#a2cbff22';
    ctx.fillRect(origin.x + a.x, origin.y + a.y, b.x - a.x, b.y - a.y);
    ctx.strokeRect(origin.x + a.x, origin.y + a.y, b.x - a.x, b.y - a.y);
  } else if (stroke && stroke.action === 'paint' && stroke.tool !== 'floors') {
    ctx.setLineDash([6, 4]);
    lines([[stroke.start.x, stroke.start.y, stroke.end.x, stroke.end.y]], 7, '#a2cbff');
    ctx.setLineDash([]);
  }
  const standing = everyone();
  for (const t of world.triggers) drawTrigger(t, standing);
  for (const chain of world.chains) drawChains(chain);
  if (isGM && tool) for (const t of world.triggers) { // wiring is only shown while the GM is editing
    ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeStyle = t.id === selected ? '#a2cbff' : 'rgba(162,203,255,0.4)';
    for (const index of t.doors) {
      const [ax, ay, bx, by] = world.doors[index], a = project(t.x, t.y), b = project((ax + bx) / 2, (ay + by) / 2);
      ctx.beginPath(); ctx.moveTo(origin.x + a.x, origin.y + a.y); ctx.lineTo(origin.x + b.x, origin.y + b.y); ctx.stroke();
    }
    for (const id of t.chains || []) {
      const chain = world.chains.find(c => c.id === id);
      if (!chain) continue;
      const a = project(t.x, t.y), b = project(chain.x, chain.y);
      ctx.beginPath(); ctx.moveTo(origin.x + a.x, origin.y + a.y); ctx.lineTo(origin.x + b.x, origin.y + b.y); ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  // Vision: players see only what their character can see; the GM and spectators see everything.
  const poly = me && !isGM ? visionPolygon(me.pos.x, me.pos.y) : null;
  if (poly) {
    const trace = () => { ctx.beginPath(); poly.forEach((q, i) => { const s = project(q.x, q.y); ctx[i ? 'lineTo' : 'moveTo'](origin.x + s.x, origin.y + s.y); }); ctx.closePath(); };
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h);
    poly.forEach((q, i) => { const s = project(q.x, q.y); ctx[i ? 'lineTo' : 'moveTo'](origin.x + s.x, origin.y + s.y); });
    ctx.closePath(); ctx.fillStyle = '#05060a'; ctx.fill('evenodd');   // darkness everywhere outside the lit area
    trace(); ctx.clip();
    const c = project(me.pos.x, me.pos.y), cx = origin.x + c.x, cy = origin.y + c.y, g = ctx.createRadialGradient(cx, cy, VISION * TILE_W * 0.3, cx, cy, VISION * TILE_W);
    g.addColorStop(0, 'rgba(5,6,10,0)'); g.addColorStop(1, 'rgba(5,6,10,0.85)');   // the light fades toward its edge
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
  }
  const list = [...others.entries()].filter(([id]) => !pcToken(id)?.walkDeleted).map(([pcId, o]) => ({ pcId, name: o.name, pos: o.shown, hp: o.hp, max: o.max, isMe: false, roll: o.roll }));
  for (const bot of roster) if (!pcToken(bot.pcId)?.walkDeleted && bot.pcId !== me?.pcId && !others.has(bot.pcId)) { // nobody is playing this PC: an idle stand-in at its last spot
    if (!botSpots.has(bot.seat)) botSpots.set(bot.seat, pcStart(bot.pcId, bot.seat));
    list.push({ pcId: bot.pcId, name: bot.name, pos: lastPositions.get(bot.pcId) || botSpots.get(bot.seat), hp: bot.hp, max: bot.max, isMe: false, roll: null });
  }
  if (me && !pcToken(me.pcId)?.walkDeleted) list.push({ pcId: me.pcId, name: me.name, pos: me.pos, hp: me.hp, max: me.max, isMe: true, roll: me.roll });
  const represented = new Set(list.map(p => `v2:${p.pcId}`));
  for (const token of world.tokens) {
    const p = tokenPosition(token);
    if (token.walkDeleted || token.hidden && !isGM || token.kind === 'pc' && represented.has(token.npcId) || poly && !lineOfSight(me.pos.x, me.pos.y, p.x, p.y)) continue;
    if (combat?.isZombie(token)) { combat.drawZombie(ctx, token, origin); continue; }
    drawWalkToken(ctx, { ...token, x: p.x, y: p.y }, origin);
    const status = ai.status(token);
    if (token.walkAI) {
      const labels = { waiting: 'Waiting for door', chained: 'Chained', wandering: 'Searching', seeking: 'Seeking PC', battle: 'In battle', following: 'Following' };
      const friendly = token.walkAI.disposition === 'friendly';
      const s = project(p.x, p.y); ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = friendly ? '#a8d8b0' : '#ffb4aa';
      ctx.fillText(`${friendly ? 'Friendly' : 'Enemy'} · ${token.walkAI.disabled ? 'AI off' : token.hp <= 0 ? 'Defeated (0 HP)' : labels[status?.mode] || 'Waiting for GM'}`, origin.x + s.x, origin.y + s.y + token.size * TILE_W * 0.4 + 28);
    }
  }
  list.sort((a, b) => a.pos.y - b.pos.y); // lower on screen draws on top
  for (const item of list) if (!poly || item.isMe || lineOfSight(me.pos.x, me.pos.y, item.pos.x, item.pos.y)) drawWalker(item.name, item.pos, item.hp, item.max, item.isMe, origin, item.roll, item.pcId);
}

// --- the loop
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  stepDoors(dt);
  ai.frame(dt);
  combat?.frame(dt);
  if (!paused) autoClose();
  if (joined) {
    const dir = direction(pressed);
    if (me) { if (!paused && !stroke && !pcToken(me.pcId)?.walkDeleted && !ai.held(me.pcId) && !combat?.held(me.pcId)) { me.pos = move(me.pos, dir, dt, combat?.speed(me.pcId), isGM ? null : hitsWall); checkPlates(); } focus = me.pos; post(); }
    else if (spectator && !stroke && !pan) {
      if (camera) { camera.x += dir.x * dt * 6; camera.y += dir.y * dt * 6; }
      else focus = move(focus, dir, dt, 6);
    }
    for (const other of others.values()) other.shown = smooth(other.shown, other.target, dt);
    const interactKey = hordeMode ? 'F' : 'Space';
    $('walk-hud').textContent = me ? `${me.name}${me.hp !== null && me.max !== null ? ` · ${me.hp}/${me.max} HP` : ''} · WASD or arrows to move${nearestTrigger(me.pos.x, me.pos.y, 1, 'lever') ? ` · ${interactKey}: lever` : nearestDoor(me.pos.x, me.pos.y) >= 0 ? ` · ${interactKey}: door` : ''}` : 'Spectating · WASD or arrows to look around';
    if (me && pcToken(me.pcId)?.walkDeleted) $('walk-hud').textContent = 'Token removed by GM';
  }
  const captor = me && !pcToken(me.pcId)?.walkDeleted ? ai.held(me.pcId) : null;
  $('walk-caught').hidden = !captor;
  if (captor) $('walk-caught').textContent = `Spotted by ${captor.name} · Movement stopped for battle`;
  draw();
  combat?.draw(ctx, origin, viewScale);
}
requestAnimationFrame(frame);

// Keep our own hit points current: the GM changes them on the tabletop while we walk.
setInterval(async () => {
  if (!me || document.hidden || hordeMode) return;
  try { const { hp, max } = await loadHp(me.pcId); if (me) { me.hp = hp; me.max = max; } } catch { /* try again next time */ }
}, 15000);
addEventListener('pagehide', () => { stopWatch?.(); if (me) fetch(walkPath(me.pcId), { method: 'DELETE', keepalive: true }).catch(() => {}); });

// --- start: load the map, then reuse the sheet sign-in when there is one, or a ?character= link, else ask
const params = new URLSearchParams(location.search);
const wanted = params.get('character'), campaign = params.get('campaign') || $('walk-campaign').value;
// Every PC of the campaign gets a bot until a player takes it.
async function loadRoster(campaign) {
  const entities = await (await fetch(`${entitiesUrl}.json`, { signal: AbortSignal.timeout(15000) })).json();
  roster = CHARACTERS.flatMap((name, seat) => {
    try {
      const { pcId } = resolvePlayer(entities, campaign, name), combat = entities[pcId]?.data?.combat || {};
      return [{ name, seat, pcId, cls: String(entities[pcId]?.data?.class || ''), hp: Number.isFinite(combat.hp_current) ? combat.hp_current : null, max: Number.isFinite(combat.hp_max) ? combat.hp_max : null }];
    } catch { return []; }   // that character isn't in this campaign
  });
}
$('walk-campaign').addEventListener('change', () => loadRoster($('walk-campaign').value).catch(() => {}));
async function start() {
  if (hordeMode) {
    const { createWalkHorde } = await import('./walk-horde.js');
    combat = createWalkHorde({ mapKey: () => currentMap ? mapKey() : null, base: walkBase,
      active: () => joined && !paused && !stroke, me: () => me,
      pcs: () => roster.filter(p => !pcToken(p.pcId)?.walkDeleted).map(p => ({ ...p, pos: me?.pcId === p.pcId ? me.pos : others.get(p.pcId)?.target || lastPositions.get(p.pcId) || pcStart(p.pcId, p.seat) })),
      editing: () => !!tool, position: id => me?.pcId === id ? me.pos : others.get(id)?.shown || lastPositions.get(id), onError: message, relocate: (id, pos) => {
        if (me?.pcId === id) me.pos = pos;
        lastPositions.set(id, pos);
      }, interact: () => {
        if (!me || paused) return false;
        const lever = nearestTrigger(me.pos.x, me.pos.y, 1, 'lever');
        if (lever) { fire(lever); return true; }
        if (nearestDoor(me.pos.x, me.pos.y) >= 0) { toggleDoor(); return true; }
        return false;
      } });
    if (isGM) { const label = $('walk-map').parentElement; $('walk-editor').append(label); }
  }
  tokenImages().catch(() => {});
  if (isGM) loadPuzzleLibrary().catch(error => { $('walk-editor-status').textContent = error.message; });
  loadRoster(CAMPAIGNS.includes(campaign) ? campaign : $('walk-campaign').value).catch(error => { if (hordeMode) message(error.message); });
  maps = (await (await fetch('battlemap/index.json', { signal: AbortSignal.timeout(15000) })).json()).map(m => m.file).filter(f => /\.dd2vtt$/i.test(f));
  $('walk-map').append(...maps.map(file => new Option(file.replace(/\.dd2vtt$/i, ''), file)));
  let shared = await fetch(mapPath, { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null);
  if (hordeMode && !shared) shared = await fetch(`${hordeBase}/walk/map.json`, { signal: AbortSignal.timeout(8000) }).then(r => r.json()).catch(() => null);
  await loadMap([params.get('map'), shared, 'prison_00.dd2vtt', maps[0]].find(f => maps.includes(f)));
  if (params.has('spectate')) watchOnly();
  else if (CHARACTERS.includes(wanted) && CAMPAIGNS.includes(campaign)) await playAs(wanted, campaign);
  else if (isGM) watchOnly();
  else if (playerIdentity && CAMPAIGNS.includes(playerIdentity.campaign)) await playAs(playerIdentity.character, playerIdentity.campaign).catch(() => dialog.showModal());
  else if (hordeMode) watchOnly();
  else dialog.showModal();
  if (hordeMode && !me) { fitView = true; $('walk-fit').setAttribute('aria-pressed', 'true'); }
}
start().catch(error => { message(error.message); if (!joined) dialog.showModal(); });
