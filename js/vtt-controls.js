import { openPanel } from './menu-bar.js';
import { isGM, canControlPC, playerIdentity, sessionClient } from './session-role.js';
import { fogRectangles } from './environment-model.js';
import { tabletopPoint, screenPoint, tabletopHit, previewToken, previewObject, firstPersonYaw } from './map-view-toggle.js';
import { cameraStep } from './first-person-model.js';
import { reachableCells } from './player-actions.js';
import { pcTokenStatus } from './token-model.js';

const $ = id => document.getElementById(id);
const floor = $('floor'), map = $('map-view'), host = $('view-3d');
const panel = $('vtt-panel'), overlay = $('vtt-overlay');
const buttons = [...panel.querySelectorAll('[data-vtt-tool]')];
let tool = 'select', enabled = true, gesture, measurement, ping, frame;
const remoteMeasurements = new Map(), remotePings = new Map();
let lastMeasureSent = 0;
let selectedToken;
let movementCells = new Map(), movementToken, displayedTurn, moving = true;
function updateMovement() {
  const model = floor.tabletopMap;
  const turnId = model?.initiative?.turn?.id;
  if (displayedTurn !== turnId) { displayedTurn = turnId; moving = true; }
  movementToken = floor.initiativeActive && model?.tokens.find(token => token.id === model.initiative?.currentId);
  movementCells = moving && movementToken && canControlPC(movementToken) ? reachableCells(model, movementToken) : new Map();
  if (movementCells.size && !isGM) {
    const fog = fogRectangles(model);
    for (const [key, cell] of movementCells) if (fog.some(rect => cell.x >= rect.x && cell.x < rect.x + rect.width && cell.y >= rect.y && cell.y < rect.y + rect.height)) movementCells.delete(key);
  }
  $('combat-move').disabled = !movementToken || !canControlPC(movementToken);
  $('combat-move').setAttribute('aria-pressed', String(moving));
  redraw();
}
$('combat-move').addEventListener('click', () => { moving = !moving; updateMovement(); });
for (const type of ['turn-changed', 'environment-changed']) floor.addEventListener(type, updateMovement);
window.addEventListener('player-signed-in', updateMovement);
function currentCharacter() {
  const tokens = floor.tabletopMap?.tokens || [];
  return tokens.find(token => token.id === floor.selectedTokenId && (isGM || canControlPC(token))) ||
    (!isGM && tokens.find(token => token.kind === 'pc' && canControlPC(token)));
}
function syncHealth() {
  const token = currentCharacter();
  const status = token && pcTokenStatus(token);
  const hud = $('first-person-health');
  hud.hidden = $('toggle-3d').dataset.view !== 'first' || !status;
  if (hud.hidden) return;
  $('first-person-character').textContent = token.name;
  $('first-person-hp').textContent = `${token.hp} / ${token.hpMax ?? '—'} HP`;
  $('first-person-ac').textContent = `AC ${token.ac ?? '—'}`;
  for (const button of hud.querySelectorAll('[data-character-sheet]')) button.disabled = !token.npcId?.startsWith('v2:');
  $('first-person-health-fill').style.width = `${status.fraction * 100}%`;
  hud.style.setProperty('--health-color', status.color);
  $('first-person-health-meter').setAttribute('aria-valuenow', String(status.fraction));
  $('first-person-health-meter').setAttribute('aria-valuetext', `${token.name}: ${token.hp} of ${token.hpMax ?? 'unknown'} HP`);
}
for (const type of ['map-ready', 'map-changed', 'vtt-selection-changed']) floor.addEventListener(type, syncHealth);
window.addEventListener('player-signed-in', syncHealth);
$('first-person-sheet-buttons').addEventListener('click', event => {
  const button = event.target.closest('[data-character-sheet]');
  const token = currentCharacter();
  if (button && token && !button.disabled) floor.dispatchEvent(new CustomEvent('token-sheet', {
    detail: { id: token.id, section: button.dataset.characterSheet }
  }));
});
const sendAction = detail => floor.dispatchEvent(new CustomEvent('session-action', { detail }));
const visible = p => isGM || !fogRectangles(floor.tabletopMap).some(rect => p.x >= rect.x && p.x < rect.x + rect.width && p.y >= rect.y && p.y < rect.y + rect.height);
function selectToken(token) {
  if (!isGM && (!canControlPC(token) || !visible(token))) token = null;
  selectedToken = token?.id; floor.selectedTokenId=selectedToken;
  floor.dispatchEvent(new Event('vtt-selection-changed'));
  $('tokens').querySelectorAll('[data-token-id]').forEach(node => node.classList.toggle('player-selected', node.dataset.tokenId === selectedToken));
  $('vtt-controls').querySelector('[data-vtt-tool="select"]').title = token ? `Selected: ${token.name}` : isGM ? 'Select and move tokens or props' : 'Select a PC token';
}
$('vtt-view').addEventListener('click', () => $('toggle-3d').click());
$('vtt-grid').addEventListener('click', () => $('toggle-grid').click());
const syncGrid = () => $('vtt-grid').setAttribute('aria-pressed', String($('toggle-grid').checked));
$('toggle-grid').addEventListener('change', syncGrid);
syncGrid();
$('vtt-environment').addEventListener('click', () => $('open-environment').click());
const syncEnvironment = () => { $('vtt-environment').disabled = $('open-environment').disabled; };
new MutationObserver(syncEnvironment).observe($('open-environment'), { attributes: true, attributeFilter: ['disabled'] });
syncEnvironment();
new MutationObserver(() => {
  $('vtt-view').disabled = $('toggle-3d').disabled;
  $('vtt-view').setAttribute('aria-pressed', $('toggle-3d').getAttribute('aria-pressed'));
  const label = { '2d': '2D', '3d': '3D', first: '1st Person' }[$('toggle-3d').dataset.view] || '2D';
  $('vtt-view').title = `${label} view. Cycle 2D / 3D / 1st Person`;
  $('vtt-view').setAttribute('aria-label', $('vtt-view').title);
  syncHealth();
}).observe($('toggle-3d'), { attributes: true, attributeFilter: ['disabled', 'aria-pressed', 'data-view'] });
if (!isGM) {
  $('empty').textContent = 'Waiting for the GM’s map.';
  map.setAttribute('aria-label', 'Player tabletop. Select a PC; WASD to move, Space to open nearby doors.');
}
const svgNode = (tag, attributes) => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  overlay.append(node);
  return node;
};
function point(event) {
  if (map.hidden) return tabletopPoint(event);
  const matrix = map.getScreenCTM();
  return matrix && new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
}
const cellCenter = p => ({ x: Math.floor(p.x) + .5, y: Math.floor(p.y) + .5 });
function project(p) {
  const matrix = map.getScreenCTM();
  const screen = map.hidden ? screenPoint(p) : matrix && new DOMPoint(p.x, p.y).matrixTransform(matrix);
  const rect = overlay.getBoundingClientRect();
  return screen && { x: screen.x - rect.left, y: screen.y - rect.top };
}
function draw(now) {
  overlay.replaceChildren();
  for (const cell of movementCells.values()) {
    const corners = [[-.46,-.46],[.46,-.46],[.46,.46],[-.46,.46]].map(([x,y]) => project({ x: cell.x+x, y: cell.y+y }));
    if (corners.every(Boolean)) svgNode('polygon', {
      points: corners.map(p => `${p.x},${p.y}`).join(' '), fill: '#58bfff', 'fill-opacity': '.22', stroke: '#72ceff', 'stroke-width': '1'
    });
  }
  if (measurement?.expiresAt <= now) measurement = null;
  if (measurement && gesture && now - lastMeasureSent > 1000) shareMeasurement();
  for (const [client, value] of remoteMeasurements) if (value.expiresAt <= now) remoteMeasurements.delete(client);
  for (const value of [measurement, ...remoteMeasurements.values()].filter(Boolean)) {
    const a = project(value.start), b = project(value.end);
    if (a && b) {
      svgNode('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      const label = svgNode('text', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 12 });
      label.textContent = `${value.by || (isGM ? 'GM' : playerIdentity?.character)}: ${(Math.hypot(value.end.x - value.start.x, value.end.y - value.start.y) * 5).toFixed(1)} ft`;
    }
  }
  if (gesture?.token || gesture?.object) {
    const p = project(gesture.destination);
    if (p) svgNode('circle', { cx: p.x, cy: p.y, r: 14 });
  }
  for (const [client, value] of remotePings) if (now - value.time >= 1500) remotePings.delete(client);
  if (ping && now - ping.time >= 1500) ping = null;
  for (const value of [ping, ...remotePings.values()].filter(Boolean)) {
    const age = (now - value.time) / 1500, p = project(value);
    if (age >= 1) continue;
    if (p) {
      svgNode('circle', { cx: p.x, cy: p.y, r: 12 + age * 32, opacity: 1 - age });
      svgNode('circle', { cx: p.x, cy: p.y, r: 5 });
      svgNode('text', { x: p.x, y: p.y - 18 }).textContent = value.by || (isGM ? 'GM' : playerIdentity?.character);
    }
  }
  frame = movementCells.size || measurement || ping || gesture || remoteMeasurements.size || remotePings.size ? requestAnimationFrame(draw) : null;
}
function redraw() { if (!frame) frame = requestAnimationFrame(draw); }
function clear() {
  const previous = gesture;
  if (measurement) sendAction({ type: 'measure', clear: true });
  gesture = measurement = ping = null;
  if (previous?.element) previous.element.setAttribute('transform', `translate(${previous.token.x} ${previous.token.y})`);
  if(previous?.object) {
    if(previous.objectElement) previous.objectElement.setAttribute('transform',previous.objectTransform);
    previewObject(previous.objectKind,previous.object.id,previous.objectIndex,previous.object);
  }
  if (previous?.token) previewToken(previous.token.id, previous.token);
  if (previous?.target.hasPointerCapture(previous.pointerId)) previous.target.releasePointerCapture(previous.pointerId);
  cancelAnimationFrame(frame); frame = null; overlay.replaceChildren();
  if (movementCells.size || remoteMeasurements.size || remotePings.size) redraw();
}
function shareMeasurement(finished = false) {
  if (!measurement || !finished && performance.now() - lastMeasureSent < 200) return;
  lastMeasureSent = performance.now();
  sendAction({ type: 'measure', start: measurement.start, end: measurement.end, finished });
}
function activate(next) {
  floor.dispatchEvent(new Event('build-stop'));
  clear(); tool = next; enabled = true;
  $('editor-close').click();
  $('fog-tool').value = 'off';
  for (const target of [map, host]) target.dataset.vttTool = tool;
  buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.vttTool === tool)));
}
buttons.forEach(button => button.addEventListener('click', () => activate(button.dataset.vttTool)));
$('vtt-floor-up').addEventListener('click',()=>$('floor-up-control').click());
$('vtt-floor-down').addEventListener('click',()=>$('floor-down-control').click());
$('vtt-roll').addEventListener('click', () => $('open-dice').click());
$('open-vtt').addEventListener('click', () => { openPanel(panel); $('vtt-collapse').focus(); });
// Opening map editing tools hands input back to the editor.
function handToEditor() {
  clear(); enabled=false;
  buttons.forEach(button=>button.setAttribute('aria-pressed','false'));
  for(const target of [map,host]) delete target.dataset.vttTool;
}
floor.addEventListener('build-start',handToEditor);
for (const button of document.querySelectorAll('[data-edit-layer], #open-tools')) button.addEventListener('click', handToEditor);
$('fog-tool').addEventListener('change', () => {
  if ($('fog-tool').value === 'off') return;
  clear(); enabled = false;
  buttons.forEach(button => button.setAttribute('aria-pressed', 'false'));
  for (const target of [map, host]) delete target.dataset.vttTool;
});
floor.addEventListener('pointerdown', event => {
  if (!enabled || event.button !== 0 || !floor.tabletopMap || floor.getAttribute('aria-busy') === 'true' || !event.target.closest('#map-view, #view-3d')) return;
  const p = point(event);
  if (!p) return;
  const hit = map.hidden ? tabletopHit(event) : {
    tokenId: event.target.closest('[data-token-id]')?.dataset.tokenId,
    doorIndex: event.target.closest('[data-door-index]')?.dataset.doorIndex,
    lightIndex: event.target.closest('[data-light-index]')?.dataset.lightIndex,
    portalId: event.target.closest('[data-portal-id]')?.dataset.portalId,
    propId: event.target.closest('[data-prop-id]')?.dataset.propId
  };
  event.preventDefault(); event.stopImmediatePropagation();
  clear();
  if (tool === 'ping') {
    if (!visible(p)) return;
    ping = { x: p.x, y: p.y, time: performance.now() }; redraw();
    sendAction({ type: 'ping', x: p.x, y: p.y }); return;
  }
  const token = tool === 'select' ? floor.tabletopMap.tokens.find(item => item.id === hit?.tokenId) : null;
  if (tool === 'select' && floor.initiativeActive) {
    const destination = movementToken && [...movementCells.values()].find(cell => Math.abs(cell.x-p.x) <= .5 && Math.abs(cell.y-p.y) <= .5);
    if (destination && visible(destination) && (!token || token.id === movementToken.id)) {
      sendAction({ type: 'move', tokenId: movementToken.id, turnId: floor.tabletopMap.initiative.turn.id,
        x: destination.x, y: destination.y, dx: destination.x-movementToken.x, dy: destination.y-movementToken.y });
    } else if (token) selectToken(token);
    (map.hidden ? host.querySelector('canvas') : map)?.focus({ preventScroll: true });
    return;
  }
  if (!isGM && tool === 'select') {
    if (token || firstPersonYaw() === null) selectToken(token?.kind === 'pc' && visible(token) ? token : null);
    (map.hidden ? host.querySelector('canvas') : map)?.focus({ preventScroll: true });
    return;
  }
  if(isGM && tool==='select') selectToken(token);
  const objectKind=tool==='select' && isGM && !token && (hit?.lightIndex!==undefined?'lights':hit?.portalId?'portals':hit?.propId?'props':null);
  const object=objectKind && (objectKind==='lights'?floor.tabletopMap.lights[Number(hit.lightIndex)]:floor.tabletopMap[objectKind].find(item=>item.id===(hit.portalId || hit.propId)));
  if (tool === 'select' && !token && !object) {
    if (hit?.doorIndex !== undefined) floor.dispatchEvent(new CustomEvent('vtt-door-toggle', { detail: Number(hit.doorIndex) }));
    return;
  }
  const target = map.hidden ? host.querySelector('canvas') : map;
  gesture = { pointerId: event.pointerId, target, start: p, token, object, objectKind, objectIndex:Number(hit?.lightIndex), destination: (token || object) && { x: (token || object).x, y: (token || object).y },
    element: !map.hidden && token ? $('tokens').querySelector(`[data-token-id="${CSS.escape(token.id)}"]`) : null };
  if(object && !map.hidden) {
    const key=objectKind==='lights'?'light-index':objectKind==='portals'?'portal-id':'prop-id';
    const value=objectKind==='lights'?String(hit.lightIndex):object.id;
    gesture.objectElement=$(objectKind).querySelector(`[data-${key}="${CSS.escape(value)}"]`);
    gesture.objectTransform=gesture.objectElement?.getAttribute('transform') || '';
  }
  if (tool === 'measure') {
    if (!visible(p)) { gesture = null; return; }
    measurement = { start: cellCenter(p), end: cellCenter(p) };
    lastMeasureSent = -Infinity; shareMeasurement();
  }
  target.setPointerCapture(event.pointerId);
  redraw();
}, true);
floor.addEventListener('pointermove', event => {
  if (event.pointerId !== gesture?.pointerId) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const p = point(event);
  if (!p) return;
  if (measurement && visible(p)) { measurement.end = cellCenter(p); shareMeasurement(); }
  if (gesture.token || gesture.object) {
    const moving=gesture.token || gesture.object;
    const model = floor.tabletopMap;
    const x = moving.x + Math.round(p.x - gesture.start.x), y = moving.y + Math.round(p.y - gesture.start.y);
    gesture.destination = { x: Math.max(0, Math.min(model.width, x)), y: Math.max(0, Math.min(model.height, y)) };
    gesture.element?.setAttribute('transform', `translate(${gesture.destination.x} ${gesture.destination.y})`);
    if(gesture.token) previewToken(gesture.token.id, gesture.destination);
    else {
      gesture.objectElement?.setAttribute('transform',`translate(${gesture.destination.x-moving.x} ${gesture.destination.y-moving.y}) ${gesture.objectTransform}`);
      previewObject(gesture.objectKind,moving.id,gesture.objectIndex,gesture.destination);
    }
  }
}, true);
floor.addEventListener('pointerup', event => {
  if (event.pointerId !== gesture?.pointerId) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const previous = gesture;
  if(previous.object) {
    clear();
    floor.dispatchEvent(new CustomEvent('vtt-object-move',{detail:{kind:previous.objectKind,id:previous.object.id,index:previous.objectIndex,...previous.destination}}));
  } else if (previous.token) {
    clear();
    floor.dispatchEvent(new CustomEvent('vtt-token-move', { detail: { id: previous.token.id, ...previous.destination } }));
  } else {
    gesture = null;
    if (measurement) { measurement.expiresAt = performance.now() + 3000; shareMeasurement(true); }
    if (previous.target.hasPointerCapture(event.pointerId)) previous.target.releasePointerCapture(event.pointerId);
  }
}, true);
for (const type of ['pointercancel', 'lostpointercapture']) floor.addEventListener(type, event => {
  if (event.pointerId === gesture?.pointerId) clear();
}, true);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !event.target.matches('input, textarea, select')) clear();
  if (isGM || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.target.isContentEditable || event.target.closest('input, textarea, select, button, .editor-titlebar')) return;
  const yaw = firstPersonYaw();
  let step = { KeyW: [0,-1], KeyA: [-1,0], KeyS: [0,1], KeyD: [1,0],
    ...(yaw === null ? {} : { ArrowUp: [0,-1], ArrowLeft: [-1,0], ArrowDown: [0,1], ArrowRight: [1,0] }) }[event.code];
  if (step && yaw !== null) step = cameraStep(step, yaw);
  if (!step && event.code !== 'Space') return;
  event.preventDefault();
  const token = floor.tabletopMap?.tokens.find(token => token.id === selectedToken && token.kind === 'pc');
  if (!token || !canControlPC(token)) return;
  if (step) {
    if (floor.initiativeActive && (!moving || movementToken?.id !== token.id || !movementCells.has(`${token.x + step[0]},${token.y + step[1]}`))) return;
    sendAction({ type: 'move', tokenId: token.id, turnId: floor.tabletopMap?.initiative?.turn?.id ?? null, dx: step[0], dy: step[1] });
  }
  else if (!step && !event.repeat) sendAction({ type: 'door', tokenId: token.id });
});
floor.addEventListener('session-ping', event => {
  if (!floor.tabletopMap || !visible(event.detail)) return;
  remotePings.set(event.detail.client, { ...event.detail, time: performance.now() }); redraw();
});
floor.addEventListener('session-measure', event => {
  const value = event.detail;
  if (value.client === sessionClient) return;
  if (value.clear) remoteMeasurements.delete(value.client);
  else if (visible(value.start) && visible(value.end)) remoteMeasurements.set(value.client, { ...value, expiresAt: performance.now() + (value.finished ? 3000 : 1500) });
  redraw();
});
$('tokens').addEventListener('keydown', event => {
  if (isGM || event.key !== 'Enter') return;
  const token = floor.tabletopMap?.tokens.find(token => token.id === event.target.closest('[data-token-id]')?.dataset.tokenId);
  if (token?.kind !== 'pc' || !canControlPC(token) || !visible(token)) return;
  event.preventDefault();
  selectToken(token);
});
function selectOwnToken() {
  if (!isGM) selectToken(floor.tabletopMap?.tokens.find(token => token.id === selectedToken && canControlPC(token)) || floor.tabletopMap?.tokens.find(token => token.kind === 'pc' && canControlPC(token) && visible(token)));
}
window.addEventListener('player-signed-in', selectOwnToken);
floor.addEventListener('map-changed', selectOwnToken);
floor.addEventListener('map-ready', () => { remoteMeasurements.clear(); remotePings.clear(); clear(); selectOwnToken(); buttons.forEach(button => { button.disabled = false; }); });
new MutationObserver(clear).observe($('toggle-3d'), { attributes: true, attributeFilter: ['aria-pressed'] });
for (const target of [map, host]) target.dataset.vttTool = tool;
