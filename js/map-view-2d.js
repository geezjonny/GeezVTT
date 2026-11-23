const floor = document.querySelector('#floor');
const map = document.querySelector('#map-view');
let pan;

function extendGrid() {
  const box = map.viewBox.baseVal, grid = document.querySelector('#grid');
  grid.setAttribute('x', box.x-box.width);
  grid.setAttribute('y', box.y-box.height);
  grid.setAttribute('width', box.width*3);
  grid.setAttribute('height', box.height*3);
}
new MutationObserver(extendGrid).observe(map, { attributes: true, attributeFilter: ['viewBox'] });
floor.addEventListener('map-ready', extendGrid);

function endPan() {
  if (!pan) return;
  const { pointerId } = pan;
  pan = null;
  map.style.cursor = '';
  if (map.hasPointerCapture(pointerId)) map.releasePointerCapture(pointerId);
}
map.addEventListener('pointerdown', event => {
  if (event.button !== 1 || !floor.tabletopMap || map.hidden) return;
  const matrix = map.getScreenCTM();
  if (!matrix) return;
  event.preventDefault();
  const box = map.viewBox.baseVal;
  pan = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
    matrix: matrix.inverse(), x: box.x, y: box.y, width: box.width, height: box.height };
  map.setPointerCapture(event.pointerId);
  map.style.cursor = 'grabbing';
});
map.addEventListener('pointermove', event => {
  if (!pan || event.pointerId !== pan.pointerId) return;
  if (map.hidden) { endPan(); return; }
  event.preventDefault();
  event.stopImmediatePropagation();
  const start = new DOMPoint(pan.clientX, pan.clientY).matrixTransform(pan.matrix);
  const current = new DOMPoint(event.clientX, event.clientY).matrixTransform(pan.matrix);
  map.setAttribute('viewBox', `${pan.x + start.x - current.x} ${pan.y + start.y - current.y} ${pan.width} ${pan.height}`);
}, true);
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  map.addEventListener(type, event => { if (event.pointerId === pan?.pointerId) endPan(); });
}
map.addEventListener('auxclick', event => {
  if (event.button === 1 && floor.tabletopMap && !map.hidden) event.preventDefault();
});
floor.addEventListener('map-ready', endPan);

map.addEventListener('wheel', event => {
  if (!floor.tabletopMap || map.hidden) return;
  const matrix = map.getScreenCTM();
  if (!matrix) return;
  endPan();
  event.preventDefault();
  const pointer = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  const box = map.viewBox.baseVal;
  const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? map.clientHeight : 1;
  const scale = Math.exp(Math.max(-1, Math.min(1, event.deltaY * units * 0.0015)));
  const width = Math.max(floor.tabletopMap.width * 0.05, Math.min(floor.tabletopMap.width * 4, box.width * scale));
  const ratio = width / box.width;
  map.setAttribute('viewBox', `${pointer.x - (pointer.x - box.x) * ratio} ${pointer.y - (pointer.y - box.y) * ratio} ${width} ${box.height * ratio}`);
}, { passive: false });
