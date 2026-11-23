const floor = document.querySelector('#floor');
const map = document.querySelector('#map-view');

map.addEventListener('wheel', event => {
  if (!floor.tabletopMap || map.hidden) return;
  const matrix = map.getScreenCTM();
  if (!matrix) return;
  event.preventDefault();
  const pointer = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  const box = map.viewBox.baseVal;
  const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? map.clientHeight : 1;
  const scale = Math.exp(Math.max(-1, Math.min(1, event.deltaY * units * 0.0015)));
  const width = Math.max(floor.tabletopMap.width * 0.05, Math.min(floor.tabletopMap.width * 4, box.width * scale));
  const ratio = width / box.width;
  map.setAttribute('viewBox', `${pointer.x - (pointer.x - box.x) * ratio} ${pointer.y - (pointer.y - box.y) * ratio} ${width} ${box.height * ratio}`);
}, { passive: false });
