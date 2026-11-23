import { openPanel } from './menu-bar.js';
import './map-editor.js';
import { TIMES, fogSize, fogRectangles } from './environment-model.js';

const $ = id => document.getElementById(id);
const floor = $('floor'), map = $('map-view'), panel = $('environment-panel');
const canvas = $('weather-overlay'), context = canvas.getContext('2d');
let stroke, frame = 0, last = 0, particles = [];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function changed() {
  drawFog();
  updateWeather();
  floor.dispatchEvent(new Event('environment-changed'));
}
function drawFog() {
  const model = floor.tabletopMap;
  $('fog-of-war').replaceChildren(...fogRectangles(model).map(rect => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    for (const [name, value] of Object.entries(rect)) node.setAttribute(name, value);
    return node;
  }));
  map.style.backgroundColor = '#080b10';
  $('time-overlay').style.background = TIMES[model.environment.time].tint;
  $('time-overlay').hidden = $('toggle-3d').getAttribute('aria-pressed') === 'true';
}
$('open-environment').addEventListener('click', () => {
  openPanel(panel);
  $('environment-time').focus();
});
for (const field of ['time', 'weather']) $('environment-' + field).addEventListener('change', event => {
  floor.tabletopMap.environment[field] = event.target.value;
  floor.sceneDocument.environment[field] = event.target.value;
  changed();
});
for (const covered of [true, false]) $(covered ? 'fog-cover' : 'fog-reveal').addEventListener('click', () => {
  floor.tabletopMap.environment.fog = { covered, cells: [] };
  changed();
});
function paint(event) {
  const matrix = map.getScreenCTM();
  if (!matrix) return;
  const model = floor.tabletopMap, size = fogSize(model);
  const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  const x = Math.max(-1, Math.min(Math.ceil(model.width / size), Math.floor(p.x / size)));
  const y = Math.max(-1, Math.min(Math.ceil(model.height / size), Math.floor(p.y / size)));
  const previous = stroke.point || { x, y };
  stroke.point = { x, y };
  const cells = new Set(model.environment.fog.cells);
  const steps = Math.max(1, Math.abs(x - previous.x), Math.abs(y - previous.y));
  for (let i = 0; i <= steps; i++) {
    const cx = Math.round(previous.x + (x - previous.x) * i / steps);
    const cy = Math.round(previous.y + (y - previous.y) * i / steps);
    if (cx < 0 || cy < 0 || cx * size >= model.width || cy * size >= model.height) continue;
    const key = `${cx},${cy}`;
    if ((stroke.tool === 'reveal') === model.environment.fog.covered) cells.add(key);
    else cells.delete(key);
  }
  model.environment.fog.cells = [...cells];
  drawFog();
}
map.addEventListener('pointerdown', event => {
  if (event.button !== 0 || panel.hidden || !floor.tabletopMap || $('fog-tool').value === 'off') return;
  event.preventDefault(); event.stopImmediatePropagation();
  stroke = { pointerId: event.pointerId, tool: $('fog-tool').value };
  map.setPointerCapture(event.pointerId);
  paint(event);
}, true);
map.addEventListener('pointermove', event => {
  if (event.pointerId !== stroke?.pointerId) return;
  event.stopImmediatePropagation(); paint(event);
}, true);
function endStroke(event) {
  if (event.pointerId !== stroke?.pointerId) return;
  event.stopImmediatePropagation();
  stroke = null;
  if (map.hasPointerCapture(event.pointerId)) map.releasePointerCapture(event.pointerId);
  changed();
}
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) map.addEventListener(type, endStroke, true);
new MutationObserver(() => {
  if (!floor.tabletopMap) return;
  $('time-overlay').hidden = map.hidden;
  $('fog-tool').disabled = map.hidden;
  $('fog-help').textContent = map.hidden ? 'Fog editing: 2D only' : `Cell size: ${fogSize(floor.tabletopMap)} square(s)`;
}).observe($('toggle-3d'), { attributes: true, attributeFilter: ['aria-pressed'] });
floor.addEventListener('map-ready', () => {
  stroke = null;
  $('open-environment').disabled = false;
  $('environment-time').value = floor.tabletopMap.environment.time;
  $('environment-weather').value = floor.tabletopMap.environment.weather;
  $('fog-tool').value = 'off';
  $('fog-help').textContent = map.hidden ? 'Fog editing: 2D only' : `Cell size: ${fogSize(floor.tabletopMap)} square(s)`;
  drawFog(); updateWeather();
});
floor.addEventListener('map-changed', () => {
  if (floor.tabletopMap?.environment) drawFog();
});
function resize() {
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(floor.clientWidth * ratio));
  canvas.height = Math.max(1, Math.round(floor.clientHeight * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  updateWeather();
}
function drawWeather(now) {
  frame = 0;
  const width = floor.clientWidth, height = floor.clientHeight;
  const rain = floor.tabletopMap.environment.weather === 'rain';
  const delta = Math.min((now - last) / 1000, .05); last = now;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = '#b9d6ed88'; context.fillStyle = '#ffffffbb'; context.lineWidth = 1;
  for (const p of particles) {
    if (!reducedMotion.matches) {
      p.y = (p.y + delta * (rain ? 650 : 55) / Math.max(1, height)) % 1;
      p.x = (p.x + delta * (rain ? -.12 : .025) + 1) % 1;
    }
    context.beginPath();
    if (rain) { context.moveTo(p.x * width, p.y * height); context.lineTo(p.x * width - 3, p.y * height + 14); context.stroke(); }
    else { context.arc(p.x * width, p.y * height, p.size, 0, Math.PI * 2); context.fill(); }
  }
  if (!reducedMotion.matches && !document.hidden) frame = requestAnimationFrame(drawWeather);
}
function updateWeather() {
  cancelAnimationFrame(frame); frame = 0;
  context.clearRect(0, 0, floor.clientWidth, floor.clientHeight);
  if (!floor.tabletopMap || floor.tabletopMap.environment.weather === 'clear' || document.hidden) return;
  if (!particles.length) particles = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), size: 1 + Math.random() * 2 }));
  last = performance.now(); drawWeather(last);
}
new ResizeObserver(resize).observe(floor);
reducedMotion.addEventListener('change', updateWeather);
document.addEventListener('visibilitychange', updateWeather);
if (floor.tabletopMap) { drawFog(); updateWeather(); }
