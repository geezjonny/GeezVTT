import { resolveItemUse } from './item-use.js';
import { isGM, sessionClient as client, playerIdentity, canControlPC } from './session-role.js';
import { playerPresence } from './player-presence.js';
import { ownsPC, validPlayer } from './player-session-model.js';
import { sharedMapState, applySharedMap } from './map-editor.js';
import { playerDestination, freeDestination, nearbyDoor, FREE_ROAM_ENABLED } from './player-actions.js';
import { watchTabletop } from './tabletop-stream.js';
import { movementQueue } from './movement-queue.js';
import { takeTurnAction } from './initiative-model.js';
import { updatePCInventory } from './pc-inventory.js';
import { loadSheetReference } from './sheet-view.js';
import { livePatch } from './tabletop-live-model.js';

const $ = id => document.getElementById(id);
const floor = $('floor'), status = $('session-status');
// shortcut: one shared Gaia table, add explicit room IDs when multiple tables are needed.
const base = `${window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, '')}/v2/worlds/gaia/vtt`;
let sceneId, signature, timer, sending = false, dirty = false, loading = false, pendingScene, pendingLive;
let outgoing = Promise.resolve();
let lastLive;
let publishing = Promise.resolve();
const seen = new Set();
const report = error => { status.textContent = `Sync failed: ${error.message}`; };
async function equip(action, token) {
  let error;
  const map = floor.tabletopMap;
  try {
    if (floor.equipmentBusy) throw new Error('Another equipment change is saving. Try again.');
    if (!floor.initiativeActive || action.turnId !== map.initiative?.turn?.id) throw new Error('Turn changed; reopen inventory.');
    floor.equipmentBusy = true;
    floor.dispatchEvent(new Event('map-changed'));
    try {
      const reference = await loadSheetReference();
      const change = { type: 'equip', slot: action.slot, key: action.key };
      await updatePCInventory(token, change, reference, { map, turnId: action.turnId });
    } finally {
      floor.equipmentBusy = false;
      floor.dispatchEvent(new Event('map-changed'));
    }
  } catch (failure) { error = failure.message; }
  const result = { requestId: action.requestId, ...(error ? { error } : {}) };
  if (action.client === client) floor.dispatchEvent(new CustomEvent('session-equipment-result', { detail: result }));
  else await write('actions', { type: 'equipment-result', ...result, target: action.client,
    client, sceneId: action.sceneId, actor: { character: 'GM' }, time: Date.now() }, 'POST');
}
async function useItem(action, token) {
  let result;
  try {
    if (floor.equipmentBusy || floor.compartmentBusy) throw new Error('Another inventory change is saving. Try again.');
    if (action.floorIndex !== floor.activeFloorIndex) throw new Error('Floor changed; reopen the bag.');
    floor.equipmentBusy = true;
    floor.dispatchEvent(new Event('map-changed'));
    try {
      const reference = await loadSheetReference();
      result = await resolveItemUse(token, action, reference);
    } finally { floor.equipmentBusy = false; floor.dispatchEvent(new Event('map-changed')); }
  } catch (error) { result = { error: error.message }; }
  const detail = { requestId: action.requestId, error: result.error || null, text: result.text || '' };
  status.textContent = detail.error || detail.text;
  if (action.client === client) floor.dispatchEvent(new CustomEvent('session-item-result', { detail }));
  else await write('actions', { type: 'item-result', ...detail, target: action.client, client, sceneId, actor: { character: 'GM' }, time: Date.now() }, 'POST');
}
async function write(path, data, method = 'PUT') {
  const response = await fetch(`${base}/${path}.json`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
}
const sendMovement = movementQueue(action => write('actions', action, 'POST'), report);
function listen(path, callback) {
  const stop = watchTabletop(path, callback, message => { status.textContent = message; });
  window.addEventListener('pagehide', stop, { once: true });
}
const sceneSignature = () => JSON.stringify([$('scene-name').value, floor.sceneDocument?.floors.map(entry => entry.name)]);
function schedule() {
  if (!isGM || !floor.tabletopMap) return;
  dirty = true;
  if (!timer && !sending) timer = setTimeout(flush, 100);
}
function flush() {
  if (sending) return publishing;
  publishing = flushChanges();
  return publishing;
}
async function flushChanges() {
  timer = null;
  if (sending || !dirty) return;
  if (floor.getAttribute('aria-busy') === 'true' || floor.compartmentBusy) { timer = setTimeout(flush, 100); return; }
  sending = true;
  dirty = false;
  try {
    if (!sceneId || signature !== sceneSignature()) {
      floor.captureFloor();
      sceneId = crypto.randomUUID();
      signature = sceneSignature();
      const scene = { format: 'geezvtt', version: 2, name: $('scene-name').value.trim() || 'Untitled scene',
        floors: floor.sceneDocument.floors, activeFloorIndex: floor.activeFloorIndex, environment: floor.sceneDocument.environment, audio: floor.sceneDocument.audio };
      const publishingId = sceneId;
      await write('scene', { id: publishingId, scene });
      if (sceneId !== publishingId) { dirty = true; return; }
    }
    const nextLive = { sceneId, map: sharedMapState(), initiative: $('initiative-active').checked, freeRoam: FREE_ROAM_ENABLED && floor.freeRoam === true };
    if (lastLive?.sceneId === sceneId) {
      const patch = livePatch(lastLive, nextLive);
      if (Object.keys(patch).length) await write('live', patch, 'PATCH');
    } else await write('live', nextLive);
    lastLive = nextLive;
    status.textContent = 'GM · Synced';
  } catch (error) {
    // Retry the scene too: a failed scene write must not strand subsequent live updates.
    sceneId = null;
    dirty = true;
    report(error);
    timer = setTimeout(flush, 1500);
  } finally {
    sending = false;
    if (dirty && !timer) timer = setTimeout(flush, 100);
  }
}
floor.flushSharedTabletop = async () => {
  if (!isGM) return;
  for (let attempt = 0; attempt < 2 && (dirty || sending); attempt++) {
    if (timer) { clearTimeout(timer); timer = null; }
    await flush();
  }
  if (dirty || sending) throw new Error('Tabletop is not synced; try again after reconnecting.');
};
function applyLive() {
  if (loading || !pendingLive || pendingLive.sceneId !== sceneId) return;
  floor.initiativeActive = pendingLive.initiative === true;
  const roam = FREE_ROAM_ENABLED && pendingLive.freeRoam === true;
  if (floor.freeRoam !== roam) { floor.freeRoam = roam; floor.dispatchEvent(new Event('roam-changed')); }
  applySharedMap(pendingLive.map);
  status.textContent = floor.initiativeActive ? 'Player · Initiative active' : 'Player · Synced';
}
async function receiveScene(value) {
  if (!value?.id || !value.scene || value.id === sceneId) return;
  pendingScene = value;
  if (loading) return;
  loading = true;
  try {
    while (pendingScene) {
      const next = pendingScene;
      pendingScene = null;
      const file = new File([JSON.stringify(next.scene)], 'Shared table.geezvtt');
      if (!await floor.loadMap(file)) throw new Error('Shared scene could not be loaded.');
      sceneId = next.id;
    }
  } catch (error) { report(error); }
  finally { loading = false; applyLive(); }
}
if (isGM) {
  status.textContent = 'GM · Load a map to share';
  floor.addEventListener('map-ready', () => { sceneId = null; schedule(); });
  for (const type of ['map-changed', 'environment-changed', 'scene-changed', 'roam-changed']) floor.addEventListener(type, schedule);
  $('initiative-active').addEventListener('change', () => {
    floor.initiativeActive = $('initiative-active').checked;
    schedule();
  });
} else {
  status.textContent = 'Player · Connecting…';
  listen('scene', value => { receiveScene(value); });
  listen('live', value => { pendingLive = value; applyLive(); });
}
floor.addEventListener('session-action', event => {
  if (!sceneId) { status.textContent = 'Waiting for a shared map'; return; }
  if (!isGM && !playerIdentity) { status.textContent = 'Sign in first.'; return; }
  if (!isGM && ['move', 'door', 'chest', 'turn', 'equip', 'interact', 'item-use'].includes(event.detail.type) &&
      !canControlPC(floor.tabletopMap?.tokens.find(token => token.id === event.detail.tokenId))) return;
  const action = { ...event.detail, client, sceneId, floorIndex: floor.activeFloorIndex, actor: isGM ? { character: 'GM' } : playerIdentity, time: Date.now() };
  if (action.type === 'move' && !floor.initiativeActive) sendMovement(action);
  else outgoing = outgoing.then(() => write('actions', action, 'POST')).catch(report);
});
listen('actions', actions => {
  for (const id of seen) if (!Object.hasOwn(actions || {}, id)) seen.delete(id);
  for (const [id, action] of Object.entries(actions || {})) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (!action || action.sceneId !== sceneId || !Number.isFinite(action.time) || Math.abs(Date.now() - action.time) > 30000) {
      if (isGM) write(`actions/${id}`, null, 'DELETE').catch(report);
      continue;
    }
    // Retain briefly so every connected view receives each action before cleanup.
    if (isGM) setTimeout(() => write(`actions/${id}`, null, 'DELETE').catch(report), 5000);
    if (!validPlayer(action.actor) && action.actor?.character !== 'GM') continue;
    if (!isGM && action.actor.character !== 'GM' && action.actor.campaign !== playerIdentity?.campaign) continue;
    if (action.type === 'item-result' && action.target === client && action.actor.character === 'GM') {
      floor.dispatchEvent(new CustomEvent('session-item-result', { detail: action }));
      status.textContent = action.error || action.text || 'Item used.';
      continue;
    }
    if (action.type === 'equipment-result' && action.actor.character === 'GM' && action.target === client) {
      floor.dispatchEvent(new CustomEvent('session-equipment-result', { detail: action }));
      continue;
    }
    if (action.type === 'chest-result' && action.actor.character === 'GM' && action.target === client) {
      floor.dispatchEvent(new CustomEvent('session-chest-result', { detail: action }));
      continue;
    }
    if (action.type === 'interact-result' && action.actor.character === 'GM' && action.target === client) {
      status.textContent = typeof action.text === 'string' ? action.text : 'Interaction complete.';
      continue;
    }
    if (['ping', 'measure', 'move', 'door', 'chest', 'turn', 'equip', 'interact', 'item-use'].includes(action.type) && action.floorIndex !== floor.activeFloorIndex) continue;
    const by = action.actor.character;
    if (action.type === 'ping' && Number.isFinite(action.x) && Number.isFinite(action.y)) {
      if (action.client !== client) floor.dispatchEvent(new CustomEvent('session-ping', { detail: { x: action.x, y: action.y, by, client: action.client } }));
    } else if (action.type === 'measure') {
      const point = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x <= floor.tabletopMap?.width && p.y <= floor.tabletopMap?.height;
      if (action.client !== client && Date.now() - action.time < 3000 && (action.clear || point(action.start) && point(action.end))) {
        floor.dispatchEvent(new CustomEvent('session-measure', { detail: { ...action, by } }));
      }
    } else if (action.type === 'dice' && typeof action.text === 'string' && action.text.length <= 500) {
      if (action.client !== client) floor.dispatchEvent(new CustomEvent('session-dice', { detail: action.text }));
    } else if (isGM && floor.tabletopMap && floor.getAttribute('aria-busy') !== 'true') {
      const map = floor.tabletopMap, token = map.tokens.find(token => token.id === action.tokenId && (token.kind === 'pc' || action.client === client));
      if (['move', 'chest', 'door', 'turn', 'equip', 'interact', 'item-use'].includes(action.type) && action.client !== client && !ownsPC(playerPresence(action.client), token)) {
        write(`actions/${id}`, null, 'DELETE').catch(report);
        continue;
      }
      if (action.type === 'item-use') {
        useItem(action,token).catch(report);
        continue;
      }
      if (action.type === 'equip') {
        equip(action, token).catch(report);
        continue;
      }
      if (floor.equipmentBusy && ['move', 'turn'].includes(action.type)) continue;
      if (floor.initiativeActive && ['move', 'turn'].includes(action.type) && action.turnId !== map.initiative?.turn?.id) continue;
      if (action.type === 'turn') {
        if (floor.initiativeActive && takeTurnAction(map, token?.id, action.turnId, action.command)) floor.dispatchEvent(new Event('map-changed'));
      } else if (action.type === 'move') {
        const dx = Number.isFinite(action.x) && token ? action.x-token.x : action.dx;
        const dy = Number.isFinite(action.y) && token ? action.y-token.y : action.dy;
        const roam = FREE_ROAM_ENABLED && action.free === true && floor.freeRoam === true && !floor.initiativeActive;
        const next = roam ? freeDestination(map, token, action.x, action.y) : playerDestination(map, token, dx, dy, floor.initiativeActive);
        if (next) {
          floor.dispatchEvent(new CustomEvent('vtt-token-move', { detail: { id: token.id, ...next, ...(roam ? { roam: true } : {}) } }));
          if (timer && !sending) { clearTimeout(timer); flush(); }
        }
      } else if (action.type === 'chest') {
        floor.dispatchEvent(new CustomEvent('vtt-chest-action',{detail:action}));
      } else if (action.type === 'interact') {
        const detail={ref:action.ref,tokenId:token?.id,remote:action.client!==client};
        floor.dispatchEvent(new CustomEvent('vtt-object-interact',{detail}));
        if(action.client!==client) write('actions',{type:'interact-result',target:action.client,text:detail.error || 'Interaction complete.',
          client,sceneId,actor:{character:'GM'},time:Date.now()},'POST').catch(report);
      } else if (action.type === 'door') {
        const index = nearbyDoor(map, token);
        if (index >= 0) floor.dispatchEvent(new CustomEvent('vtt-door-toggle', { detail: {index,tokenId:token.id} }));
      }
    }
  }
});
