import { openPanel } from './menu-bar.js';
import { isGM } from './session-role.js';
import { fogRectangles } from './environment-model.js';
import { tabletopPoint, screenPoint, tabletopHit, previewToken, previewObject } from './map-view-toggle.js';

const $ = id => document.getElementById(id);
const floor = $('floor'), map = $('map-view'), host = $('view-3d');
const panel = $('vtt-panel'), overlay = $('vtt-overlay');
const buttons = [...panel.querySelectorAll('[data-vtt-tool]')];
let tool = 'select', enabled = true, gesture, measurement, ping, frame;
let selectedToken;
const sendAction = detail => floor.dispatchEvent(new CustomEvent('session-action', { detail }));
const visible = p => isGM || !fogRectangles(floor.tabletopMap).some(rect => p.x >= rect.x && p.x < rect.x + rect.width && p.y >= rect.y && p.y < rect.y + rect.height);
function selectToken(token) {
  selectedToken = token?.id; floor.selectedTokenId=selectedToken;
  floor.dispatchEvent(new Event('vtt-selection-changed'));
  $('tokens').querySelectorAll('[data-token-id]').forEach(node => node.classList.toggle('player-selected', node.dataset.tokenId === selectedToken));
  $('vtt-controls').querySelector('[data-vtt-tool="select"]').title = token ? `Selected: ${token.name}` : isGM ? 'Select and move tokens or props' : 'Select a PC token';
}
$('vtt-view').addEventListener('click', () => $('toggle-3d').click());
new MutationObserver(() => {
  $('vtt-view').disabled = $('toggle-3d').disabled;
  $('vtt-view').setAttribute('aria-pressed', $('toggle-3d').getAttribute('aria-pressed'));
}).observe($('toggle-3d'), { attributes: true, attributeFilter: ['disabled', 'aria-pressed'] });
if (!isGM) {
  $('empty').textContent = 'Waiting for the GM’s map.';
  $('view-help').textContent = 'WASD: move selected PC · Space: door · Middle-drag: pan · Scroll: zoom · Right-drag: orbit';
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
  if (measurement?.expiresAt <= now) measurement = null;
  if (measurement) {
    const a = project(measurement.start), b = project(measurement.end);
    if (a && b) {
      svgNode('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      const label = svgNode('text', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 12 });
      label.textContent = `${(Math.hypot(measurement.end.x - measurement.start.x, measurement.end.y - measurement.start.y) * 5).toFixed(1)} ft`;
    }
  }
  if (gesture?.token || gesture?.object) {
    const p = project(gesture.destination);
    if (p) svgNode('circle', { cx: p.x, cy: p.y, r: 14 });
  }
  if (ping) {
    const age = (now - ping.time) / 1500, p = project(ping);
    if (age >= 1) ping = null;
    else if (p) {
      svgNode('circle', { cx: p.x, cy: p.y, r: 12 + age * 32, opacity: 1 - age });
      svgNode('circle', { cx: p.x, cy: p.y, r: 5 });
    }
  }
  frame = measurement || ping || gesture ? requestAnimationFrame(draw) : null;
}
function redraw() { if (!frame) frame = requestAnimationFrame(draw); }
function clear() {
  const previous = gesture;
  gesture = measurement = ping = null;
  if (previous?.element) previous.element.setAttribute('transform', `translate(${previous.token.x} ${previous.token.y})`);
  if(previous?.object) {
    if(previous.objectElement) previous.objectElement.setAttribute('transform',previous.objectTransform);
    previewObject(previous.objectKind,previous.object.id,previous.objectIndex,previous.object);
  }
  if (previous?.token) previewToken(previous.token.id, previous.token);
  if (previous?.target.hasPointerCapture(previous.pointerId)) previous.target.releasePointerCapture(previous.pointerId);
  cancelAnimationFrame(frame); frame = null; overlay.replaceChildren();
}
function activate(next) {
  clear(); tool = next; enabled = true;
  $('editor-close').click();
  $('fog-tool').value = 'off';
  for (const target of [map, host]) target.dataset.vttTool = tool;
  buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.vttTool === tool)));
}
buttons.forEach(button => button.addEventListener('click', () => activate(button.dataset.vttTool)));
$('vtt-roll').addEventListener('click', () => $('open-dice').click());
$('open-vtt').addEventListener('click', () => { openPanel(panel); $('vtt-collapse').focus(); });
$('vtt-collapse').addEventListener('click', () => {
  const collapsed = !$('vtt-controls').hidden;
  $('vtt-controls').hidden = collapsed;
  $('vtt-collapse').setAttribute('aria-expanded', String(!collapsed));
  $('vtt-collapse').setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} VTT controls`);
  $('vtt-collapse').textContent = collapsed ? '+' : '\u2212';
});
// Opening map editing tools hands input back to the editor.
for (const button of document.querySelectorAll('[data-edit-layer], #open-tools')) button.addEventListener('click', () => {
  clear(); enabled = false;
  buttons.forEach(button => button.setAttribute('aria-pressed', 'false'));
  for (const target of [map, host]) delete target.dataset.vttTool;
});
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
  if (!isGM && tool === 'select') {
    selectToken(token?.kind === 'pc' && visible(token) ? token : null);
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
  if (tool === 'measure') measurement = { start: cellCenter(p), end: cellCenter(p) };
  target.setPointerCapture(event.pointerId);
  redraw();
}, true);
floor.addEventListener('pointermove', event => {
  if (event.pointerId !== gesture?.pointerId) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const p = point(event);
  if (!p) return;
  if (measurement) measurement.end = cellCenter(p);
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
    if (measurement) measurement.expiresAt = performance.now() + 3000;
    if (previous.target.hasPointerCapture(event.pointerId)) previous.target.releasePointerCapture(event.pointerId);
  }
}, true);
for (const type of ['pointercancel', 'lostpointercapture']) floor.addEventListener(type, event => {
  if (event.pointerId === gesture?.pointerId) clear();
}, true);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !event.target.matches('input, textarea, select')) clear();
  if (isGM || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.target.isContentEditable || event.target.closest('input, textarea, select, button, .editor-titlebar')) return;
  const step = { KeyW: [0,-1], KeyA: [-1,0], KeyS: [0,1], KeyD: [1,0] }[event.code];
  if (!step && event.code !== 'Space') return;
  event.preventDefault();
  const token = floor.tabletopMap?.tokens.find(token => token.id === selectedToken && token.kind === 'pc');
  if (!token) return;
  if (step && !floor.initiativeActive) sendAction({ type: 'move', tokenId: token.id, dx: step[0], dy: step[1] });
  else if (!step && !event.repeat) sendAction({ type: 'door', tokenId: token.id });
});
floor.addEventListener('session-ping', event => {
  if (!floor.tabletopMap || !visible(event.detail)) return;
  ping = { ...event.detail, time: performance.now() }; redraw();
});
$('tokens').addEventListener('keydown', event => {
  if (isGM || event.key !== 'Enter') return;
  const token = floor.tabletopMap?.tokens.find(token => token.id === event.target.closest('[data-token-id]')?.dataset.tokenId);
  if (token?.kind !== 'pc' || !visible(token)) return;
  event.preventDefault();
  selectToken(token);
});
floor.addEventListener('map-changed', () => {
  if (!isGM) selectToken(floor.tabletopMap?.tokens.find(token => token.id === selectedToken));
});
floor.addEventListener('map-ready', () => { clear(); buttons.forEach(button => { button.disabled = false; }); });
new MutationObserver(clear).observe($('toggle-3d'), { attributes: true, attributeFilter: ['aria-pressed'] });
for (const target of [map, host]) target.dataset.vttTool = tool;
