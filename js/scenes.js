import { serializeMap } from './map-editor.js';
import { isGM } from './session-role.js';

const floor = document.getElementById('floor');
const name = document.getElementById('scene-name');
const state = document.getElementById('scene-state');
const save = document.getElementById('save-scene');
const saveAs = document.getElementById('save-scene-as');
const floors = document.getElementById('scene-floor');
let dirty = false;
let revision = 0;
let saving = false;
const sceneFileTypes = [{ description: 'GeezVTT scene', accept: { 'application/json': ['.geezvtt'] } }];

function changed() {
  if (!isGM) return;
  revision++;
  dirty = true;
  state.textContent = 'Unsaved scene';
  floor.dispatchEvent(new Event('scene-changed'));
}
floor.confirmMapReplace = () => !dirty || window.confirm('Discard unsaved scene changes and open another scene?');
window.addEventListener('beforeunload', event => {
  if (!isGM || !dirty && !saving) return;
  event.preventDefault();
  event.returnValue = '';
});
document.getElementById('open-scene').addEventListener('click', async () => {
  if (!window.showOpenFilePicker) { document.getElementById('scene-file').click(); return; }
  try {
    const [handle] = await window.showOpenFilePicker({ types: sceneFileTypes, multiple: false });
    await floor.loadMap(await handle.getFile(), { fileHandle: handle });
  } catch (error) {
    if (error.name !== 'AbortError') state.textContent = `Scene open failed: ${error.message}`;
  }
});
name.addEventListener('input', () => { name.setCustomValidity(''); changed(); });
floor.addEventListener('map-changed', () => { if (!floor.changingMap) changed(); });
floor.addEventListener('environment-changed', () => { if (!floor.changingMap) changed(); });
floor.captureFloor = () => {
  floor.sceneDocument.floors[floor.activeFloorIndex].map = serializeMap();
};
function updateFloors() {
  floors.replaceChildren(...floor.sceneDocument.floors.map((entry, index) => {
    const option = document.createElement('option');
    option.value = index;
    option.textContent = entry.name;
    return option;
  }));
  floors.value = floor.activeFloorIndex;
  floors.disabled = false;
  document.getElementById('rename-floor').disabled = false;
  document.getElementById('remove-floor').disabled = floor.sceneDocument.floors.length < 2;
  document.getElementById('map-title').textContent = `Floor map: ${floor.sceneDocument.floors[floor.activeFloorIndex].name}`;
}
function loaded(event) {
  revision++;
  name.disabled = false;
  save.disabled = saveAs.disabled = saving;
  if (!event?.detail?.preserveScene) {
    name.value = floor.sceneName;
    name.setCustomValidity('');
    dirty = !floor.sceneSaved;
  }
  if (event?.detail?.addedFloor || event?.detail?.replacedMap) dirty = true;
  const entries = floor.sceneDocument.floors;
  const firstFloor = Math.max(0, entries.findIndex(entry => /^Floor\s*1$/i.test(entry.name)));
  entries.forEach((entry, index) => {
    if (!Number.isSafeInteger(entry.number) || entry.number === 0) {
      const namedNumber = Number(/^Floor\s*(-?\d+)$/i.exec(entry.name)?.[1]);
      const offset = index - firstFloor;
      entry.number = Number.isSafeInteger(namedNumber) && namedNumber !== 0 ? namedNumber : offset >= 0 ? offset + 1 : offset;
    }
    if (entry.name === 'Upper Floor' || entry.name === 'Lower Floor') {
      entry.name = `Floor ${entry.number}`;
      dirty = true;
    }
  });
  updateFloors();
  state.textContent = dirty ? 'Unsaved scene' : 'Scene opened';
}
floor.addEventListener('map-ready', loaded);
if (floor.tabletopMap) loaded();

async function switchFloor(index) {
  const entry = floor.sceneDocument.floors[index];
  return floor.loadMap({ name: entry.sourceName }, { entry, index });
}
function blankMap(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d');
  context.fillStyle = '#293544';
  context.fillRect(0, 0, 1, 1);
  return {
    image: canvas.toDataURL('image/png'),
    resolution: { pixels_per_grid: 1, map_size: { x: width, y: height }, map_origin: { x: 0, y: 0 } },
    line_of_sight: [], portals: [], lights: []
  };
}
document.getElementById('vtt-new-scene').addEventListener('click', async () => {
  if(!isGM || saving || floor.getAttribute('aria-busy')==='true') return;
  const value=window.prompt('Starting dimensions in grid squares (1-1000 per side):','20x20');
  if(value===null) return;
  const dimensions=/^\s*(\d+)\s*[x\u00d7]\s*(\d+)\s*$/i.exec(value);
  const width=Number(dimensions?.[1]), height=Number(dimensions?.[2]);
  if(!Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1 || width>1000 || height>1000) {
    window.alert('Enter dimensions such as 20x20, with each side from 1 to 1000.'); return;
  }
  if(!await floor.loadMap({name:'Blank scene.dd2vtt'},{map:blankMap(width,height),newScene:true})) return;
  const grid=document.getElementById('toggle-grid'); grid.checked=true; grid.dispatchEvent(new Event('change'));
  document.querySelector('[data-vtt-tool="select"]').click();
});
async function stepFloor(direction) {
  if (floor.getAttribute('aria-busy') === 'true') return;
  const entries = floor.sceneDocument?.floors;
  const index = entries ? floor.activeFloorIndex + direction : 0;
  if (entries && index >= 0 && index < entries.length) {
    await switchFloor(index);
    return;
  }
  const map = blankMap(floor.tabletopMap?.width || 40, floor.tabletopMap?.height || 40);
  let number = entries ? entries[floor.activeFloorIndex].number + direction : 1;
  if (number === 0) number = direction;
  const floorName = `Floor ${number}`;
  await floor.loadMap({ name: entries ? `${floorName}.dd2vtt` : 'Untitled scene.dd2vtt' }, {
    map, addFloor: Boolean(entries), insertIndex: Math.max(0, index), floorName
  });
}
for (const [id, direction] of [['floor-up', 1], ['floor-up-control', 1], ['floor-down', -1], ['floor-down-control', -1]]) {
  document.getElementById(id).addEventListener('click', () => stepFloor(direction));
}
floors.addEventListener('change', async () => {
  const index = Number(floors.value);
  floors.value = floor.activeFloorIndex;
  if (floor.getAttribute('aria-busy') === 'true' || index === floor.activeFloorIndex) return;
  await switchFloor(index);
});
document.getElementById('rename-floor').addEventListener('click', () => {
  if (floor.getAttribute('aria-busy') === 'true') return;
  const entry = floor.sceneDocument.floors[floor.activeFloorIndex];
  const value = window.prompt('Floor name (up to 100 characters):', entry.name);
  if (value === null) return;
  if (!value.trim() || value.trim().length > 100) { window.alert('Enter a floor name between 1 and 100 characters.'); return; }
  entry.name = value.trim();
  updateFloors();
  changed();
});
document.getElementById('remove-floor').addEventListener('click', async () => {
  const entries = floor.sceneDocument.floors;
  if (floor.getAttribute('aria-busy') === 'true' || entries.length < 2) return;
  const index = floor.activeFloorIndex;
  if (!window.confirm(`Remove "${entries[index].name}" and its map from this scene?`)) return;
  if (!await switchFloor(index === 0 ? 1 : index - 1)) return;
  entries.splice(index, 1);
  if (floor.activeFloorIndex > index) floor.activeFloorIndex--;
  updateFloors();
  changed();
});

async function saveScene(asNewFile = false) {
  if (saving || floor.getAttribute('aria-busy') === 'true') return;
  if (!name.value.trim()) { name.setCustomValidity('Enter a scene name.'); name.reportValidity(); name.focus(); return; }
  const sceneDocument = floor.sceneDocument;
  const savedRevision = revision;
  saving = save.disabled = saveAs.disabled = true;
  try {
    floor.captureFloor();
    const scene = { format: 'geezvtt', version: 2, name: name.value.trim(), activeFloorIndex: floor.activeFloorIndex, environment: floor.sceneDocument.environment, floors: floor.sceneDocument.floors };
    const blob = new Blob([JSON.stringify(scene)], { type: 'application/json' });
    const filename = scene.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') + '.geezvtt';
    let handle = asNewFile ? null : floor.sceneFileHandle;
    if (!handle && window.showSaveFilePicker) {
      handle = await window.showSaveFilePicker({
        suggestedName: asNewFile ? filename : floor.sceneFileName || filename,
        types: sceneFileTypes
      });
    }
    if (handle) {
      const writable = await handle.createWritable();
      try {
        await writable.write(blob);
        await writable.close();
      } catch (error) {
        try { await writable.abort(); } catch { /* The stream may already be closed. */ }
        throw error;
      }
    } else {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    if (floor.sceneDocument !== sceneDocument) return;
    if (handle) {
      floor.sceneFileHandle = handle;
      floor.sceneFileName = handle.name;
    }
    if (revision === savedRevision) {
      floor.sceneName = name.value = scene.name;
      if (handle) dirty = false;
    }
    state.textContent = handle
      ? dirty ? 'Saved; newer changes unsaved' : `Saved ${handle.name}`
      : 'Scene download started';
  } catch (error) {
    if (floor.sceneDocument === sceneDocument && error.name !== 'AbortError') state.textContent = `Scene save failed: ${error.message}`;
  } finally {
    saving = false;
    save.disabled = saveAs.disabled = !floor.tabletopMap;
  }
}
save.addEventListener('click', () => saveScene());
saveAs.addEventListener('click', () => saveScene(true));
