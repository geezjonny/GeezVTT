import { openPanel } from './menu-bar.js';
import { tabletopPoint, screenPoint, tabletopHit, previewToken } from './map-view-toggle.js';

const $ = id => document.getElementById(id);
const floor = $('floor'), map = $('map-view'), host = $('view-3d');
const panel = $('vtt-panel'), overlay = $('vtt-overlay');
const buttons = [...panel.querySelectorAll('[data-vtt-tool]')];
let tool = 'select', enabled = true, gesture, measurement, ping, frame;
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
  if (gesture?.token) {
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
    doorIndex: event.target.closest('[data-door-index]')?.dataset.doorIndex
  };
  event.preventDefault(); event.stopImmediatePropagation();
  clear();
  if (tool === 'ping') { ping = { x: p.x, y: p.y, time: performance.now() }; redraw(); return; }
  const token = tool === 'select' ? floor.tabletopMap.tokens.find(item => item.id === hit?.tokenId) : null;
  if (tool === 'select' && !token) {
    if (hit?.doorIndex !== undefined) floor.dispatchEvent(new CustomEvent('vtt-door-toggle', { detail: Number(hit.doorIndex) }));
    return;
  }
  const target = map.hidden ? host.querySelector('canvas') : map;
  gesture = { pointerId: event.pointerId, target, start: p, token, destination: token && { x: token.x, y: token.y },
    element: !map.hidden && token ? $('tokens').querySelector(`[data-token-id="${CSS.escape(token.id)}"]`) : null };
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
  if (gesture.token) {
    const model = floor.tabletopMap;
    const x = gesture.token.x + Math.round(p.x - gesture.start.x), y = gesture.token.y + Math.round(p.y - gesture.start.y);
    gesture.destination = { x: Math.max(0, Math.min(model.width, x)), y: Math.max(0, Math.min(model.height, y)) };
    gesture.element?.setAttribute('transform', `translate(${gesture.destination.x} ${gesture.destination.y})`);
    previewToken(gesture.token.id, gesture.destination);
  }
}, true);
floor.addEventListener('pointerup', event => {
  if (event.pointerId !== gesture?.pointerId) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const previous = gesture;
  if (previous.token) {
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
});
floor.addEventListener('map-ready', () => { clear(); buttons.forEach(button => { button.disabled = false; }); });
new MutationObserver(clear).observe($('toggle-3d'), { attributes: true, attributeFilter: ['aria-pressed'] });
for (const target of [map, host]) target.dataset.vttTool = tool;
