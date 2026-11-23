import { isGM } from './session-role.js';
import { sharedMapState, applySharedMap } from './map-editor.js';
import { playerDestination, nearbyDoor } from './player-actions.js';

const $ = id => document.getElementById(id);
const floor = $('floor'), status = $('session-status');
// shortcut: one shared Gaia table, add explicit room IDs when multiple tables are needed.
const base = `${window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, '')}/v2/worlds/gaia/vtt`;
const client = crypto.randomUUID();
let sceneId, signature, timer, sending = false, dirty = false, loading = false, pendingScene, pendingLive;
let outgoing = Promise.resolve();
const seen = new Set();
const report = error => { status.textContent = `Sync failed: ${error.message}`; };
async function write(path, data, method = 'PUT') {
  const response = await fetch(`${base}/${path}.json`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
}
function listen(path, callback) {
  const stream = new EventSource(`${base}/${path}.json`);
  let value = null;
  const update = event => {
    try {
      const message = JSON.parse(event.data);
      const assign = (path, data) => {
        const keys = path.split('/').filter(Boolean);
        if (!keys.length) { value = data; return; }
        value ||= {};
        let target = value;
        for (const key of keys.slice(0, -1)) target = target[key] ||= {};
        if (data === null) delete target[keys.at(-1)];
        else target[keys.at(-1)] = data;
      };
      if (event.type === 'patch') {
        for (const [key, data] of Object.entries(message.data || {})) assign(`${message.path}/${key}`, data);
      } else assign(message.path, message.data);
      callback(value);
    } catch (error) { report(error); }
  };
  stream.addEventListener('put', update);
  stream.addEventListener('patch', update);
  stream.addEventListener('error', () => { status.textContent = 'Sync disconnected; reconnecting…'; });
  for (const type of ['cancel', 'auth_revoked']) stream.addEventListener(type, () => {
    stream.close(); status.textContent = 'Tabletop sync denied by Firebase.';
  });
  window.addEventListener('pagehide', () => stream.close(), { once: true });
}
const sceneSignature = () => JSON.stringify([$('scene-name').value, floor.sceneDocument?.floors.map(entry => entry.name)]);
function schedule() {
  if (!isGM || !floor.tabletopMap) return;
  dirty = true;
  if (!timer && !sending) timer = setTimeout(flush, 100);
}
async function flush() {
  timer = null;
  if (sending || !dirty) return;
  if (floor.getAttribute('aria-busy') === 'true') { timer = setTimeout(flush, 100); return; }
  sending = true;
  dirty = false;
  try {
    if (!sceneId || signature !== sceneSignature()) {
      floor.captureFloor();
      sceneId = crypto.randomUUID();
      signature = sceneSignature();
      const scene = { format: 'geezvtt', version: 2, name: $('scene-name').value.trim() || 'Untitled scene',
        floors: floor.sceneDocument.floors, activeFloorIndex: floor.activeFloorIndex, environment: floor.sceneDocument.environment };
      const publishingId = sceneId;
      await write('scene', { id: publishingId, scene });
      if (sceneId !== publishingId) { dirty = true; return; }
    }
    await write('live', { sceneId, map: sharedMapState(), initiative: $('initiative-active').checked });
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
function applyLive() {
  if (loading || !pendingLive || pendingLive.sceneId !== sceneId) return;
  floor.initiativeActive = pendingLive.initiative === true;
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
  for (const type of ['map-changed', 'environment-changed', 'scene-changed']) floor.addEventListener(type, schedule);
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
  const action = { ...event.detail, client, sceneId, time: Date.now() };
  outgoing = outgoing.then(() => write('actions', action, 'POST')).catch(report);
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
    if (action.type === 'ping' && Number.isFinite(action.x) && Number.isFinite(action.y)) {
      if (action.client !== client) floor.dispatchEvent(new CustomEvent('session-ping', { detail: { x: action.x, y: action.y } }));
    } else if (action.type === 'dice' && typeof action.text === 'string' && action.text.length <= 500) {
      if (action.client !== client) floor.dispatchEvent(new CustomEvent('session-dice', { detail: action.text }));
    } else if (isGM && floor.tabletopMap && floor.getAttribute('aria-busy') !== 'true') {
      const map = floor.tabletopMap, token = map.tokens.find(token => token.id === action.tokenId && token.kind === 'pc');
      if (action.type === 'move') {
        const next = playerDestination(map, token, action.dx, action.dy, floor.initiativeActive);
        if (next) floor.dispatchEvent(new CustomEvent('vtt-token-move', { detail: { id: token.id, ...next } }));
      } else if (action.type === 'door') {
        const index = nearbyDoor(map, token);
        if (index >= 0) floor.dispatchEvent(new CustomEvent('vtt-door-toggle', { detail: index }));
      }
    }
    // Retain briefly so every connected view receives pings and dice before cleanup.
    if (isGM) setTimeout(() => write(`actions/${id}`, null, 'DELETE').catch(report), 5000);
  }
});
