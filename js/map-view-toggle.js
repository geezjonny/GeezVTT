const floor = document.querySelector('#floor');
const host = document.querySelector('#view-3d');
const map = document.querySelector('#map-view');
const toggle = document.querySelector('#toggle-3d');
const fit = document.querySelector('#fit-3d');
let view, active = false, mode = '2d';

export function firstPersonYaw() {
  return mode === 'first' ? view?.firstPersonYaw() : null;
}

export function tabletopPoint(event) {
  return active ? view?.tabletopPoint(event) : null;
}
export function screenPoint(point) {
  return active ? view?.screenPoint(point) : null;
}
export function tabletopHit(event) {
  return active ? view?.tabletopHit(event) : null;
}
export function previewToken(id, point) {
  if (active) view?.previewToken(id, point);
}

export function previewObject(kind,id,index,point) {
  if(active) view?.previewObject(kind,id,index,point);
}

export function previewPlacement(lines = []) {
  view?.previewPlacement(lines);
}

function layers() {
  view?.setLayers({ grid: document.querySelector('#toggle-grid').checked });
}
function show(next) {
  mode = next;
  const on = mode !== '2d';
  active = on;
  host.hidden = !on;
  fit.hidden = !on;
  map.hidden = on;
  toggle.setAttribute('aria-pressed', String(on));
  const label = { '2d': '2D', '3d': '3D', first: '1st Person' }[mode];
  toggle.dataset.view = mode;
  toggle.textContent = `View: ${label}`;
  toggle.title = `${label} view. Cycle 2D / 3D / 1st Person`;
  view?.setFirstPerson?.(mode === 'first');
  view?.setActive(on);
}
function fallback(error) {
  const failedView = view;
  view = null;
  show('2d');
  failedView?.destroy();
  const status = document.querySelector('#status');
  status.classList.add('error');
  status.textContent = `3D view unavailable: ${error.message}. The 2D map is still available.`;
}
toggle.addEventListener('click', async () => {
  if (!floor.tabletopMap) return;
  toggle.disabled = true;
  try {
    if (mode === 'first') { show('2d'); return; }
    if (mode === '3d') {
      if (typeof view?.setFirstPerson !== 'function') throw new Error('Reload the page to update the 3D renderer');
      show('first'); return;
    }
    toggle.textContent = 'Loading 3D…';
    if (!view) {
      const { createMapView3D } = await import('./map-view-3d.js?v=tabletop-tools-3');
      view = createMapView3D(host);
      view.setMap(floor.tabletopMap);
    }
    layers();
    show('3d');
  } catch (error) { fallback(error); }
  finally { toggle.disabled = false; }
});
fit.addEventListener('click', () => view?.fit());
document.querySelector('#toggle-grid').addEventListener('change', layers);
floor.addEventListener('map-ready', () => {
  try {
    view?.setMap(floor.tabletopMap);
    layers();
    if (active) show(mode);
  } catch (error) { fallback(error); }
});
floor.addEventListener('map-ready', () => toggle.click(), { once: true });
floor.addEventListener('map-changed', () => {
  try {
    view?.setMap(floor.tabletopMap, false);
    layers();
  } catch (error) { fallback(error); }
});
floor.addEventListener('environment-changed', () => {
  try { view?.setEnvironment(floor.tabletopMap.environment); }
  catch (error) { fallback(error); }
});
