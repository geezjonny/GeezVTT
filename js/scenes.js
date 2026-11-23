import { serializeMap } from './map-editor.js';

const floor = document.getElementById('floor');
const name = document.getElementById('scene-name');
const state = document.getElementById('scene-state');
const save = document.getElementById('save-scene');
let dirty = false;

function changed() {
  dirty = true;
  state.textContent = 'Unsaved scene';
}
floor.confirmMapReplace = () => !dirty || window.confirm('Discard unsaved scene changes and open another map or scene?');
window.addEventListener('beforeunload', event => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});
document.getElementById('open-scene').addEventListener('click', () => document.getElementById('scene-file').click());
name.addEventListener('input', () => { name.setCustomValidity(''); changed(); });
floor.addEventListener('map-changed', changed);
function loaded() {
  name.disabled = save.disabled = false;
  name.value = floor.sceneName;
  name.setCustomValidity('');
  dirty = !floor.sceneSaved;
  state.textContent = dirty ? 'Unsaved scene' : 'Scene opened';
}
floor.addEventListener('map-ready', loaded);
if (floor.tabletopMap) loaded();

save.addEventListener('click', () => {
  if (!name.value.trim()) { name.setCustomValidity('Enter a scene name.'); name.reportValidity(); name.focus(); return; }
  try {
    const scene = { format: 'geezvtt', version: 1, name: name.value.trim(), sourceName: floor.sourceName, map: serializeMap() };
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
