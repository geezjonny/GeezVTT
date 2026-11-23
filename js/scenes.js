import { serializeMap } from './map-editor.js';

const floor = document.getElementById('floor');
const name = document.getElementById('scene-name');
const state = document.getElementById('scene-state');
const save = document.getElementById('save-scene');
const floors = document.getElementById('scene-floor');
let dirty = false;

function changed() {
  dirty = true;
  state.textContent = 'Unsaved scene';
}
floor.confirmMapReplace = () => !dirty || window.confirm('Discard unsaved scene changes and open another scene?');
window.addEventListener('beforeunload', event => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});
document.getElementById('open-scene').addEventListener('click', () => document.getElementById('scene-file').click());
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
  name.disabled = save.disabled = false;
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
async function stepFloor(direction) {
  if (floor.getAttribute('aria-busy') === 'true') return;
  const entries = floor.sceneDocument?.floors;
  const index = entries ? floor.activeFloorIndex + direction : 0;
  if (entries && index >= 0 && index < entries.length) {
    await switchFloor(index);
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d');
  context.fillStyle = '#293544';
  context.fillRect(0, 0, 1, 1);
  const width = floor.tabletopMap?.width || 40, height = floor.tabletopMap?.height || 40;
  const map = {
    image: canvas.toDataURL('image/png'),
    resolution: { pixels_per_grid: 1, map_size: { x: width, y: height }, map_origin: { x: 0, y: 0 } },
    line_of_sight: [], portals: [], lights: []
  };
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

save.addEventListener('click', () => {
  if (floor.getAttribute('aria-busy') === 'true') return;
  if (!name.value.trim()) { name.setCustomValidity('Enter a scene name.'); name.reportValidity(); name.focus(); return; }
  try {
    floor.captureFloor();
    const scene = { format: 'geezvtt', version: 2, name: name.value.trim(), activeFloorIndex: floor.activeFloorIndex, floors: floor.sceneDocument.floors };
    const url = URL.createObjectURL(new Blob([JSON.stringify(scene)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = scene.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') + '.geezvtt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    floor.sceneName = name.value = scene.name;
    dirty = false;
    state.textContent = 'Scene download started';
  } catch (error) {
    state.textContent = `Scene save failed: ${error.message}`;
  }
});
