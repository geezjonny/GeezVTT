import { isGM } from './session-role.js';
import { openPanel } from './menu-bar.js';
import { initiativeState, initiativeOrder } from './initiative-model.js';

const $ = id => document.getElementById(id);
const floor = $('floor'), panel = $('initiative-panel'), list = $('initiative-list');
function render() {
  const map = floor.tabletopMap;
  const state = initiativeState(map?.initiative, map?.tokens || []);
  if (map) map.initiative = state;
  list.replaceChildren();
  for (const entry of initiativeOrder(state).slice(0, 4)) {
    const token = map.tokens.find(token => token.id === entry.id);
    const row = document.createElement('li'), name = document.createElement('span');
    name.textContent = token.name;
    name.title = name.textContent;
    row.append(name);
    if (isGM) {
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${token.name} from initiative`);
      remove.addEventListener('click', () => {
        const order = initiativeOrder(map.initiative);
        if (order[0]?.id === entry.id) map.initiative.currentId = order[1]?.id || null;
        map.initiative.entries = map.initiative.entries.filter(item => item.id !== entry.id);
        changed();
      });
      row.append(remove);
    }
    list.append(row);
  }
  if (!state.entries.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No initiative'; list.append(empty);
  }
  $('initiative-next').disabled = state.entries.length < 2;
}
function changed() {
  render();
  floor.dispatchEvent(new Event('map-changed'));
}
floor.addEventListener('initiative-add', event => {
  const map = floor.tabletopMap;
  if (!isGM || !map || floor.getAttribute('aria-busy') === 'true') return;
  const token = map.tokens.find(token => token.id === event.detail);
  if (!token) return;
  const state = initiativeState(map.initiative, map.tokens);
  const existing = state.entries.find(entry => entry.id === token.id);
  const value = window.prompt(`Initiative for ${token.name}:`, String(existing?.score ?? 0));
  if (value === null) return;
  const score = Number(value);
  if (!value.trim() || !Number.isSafeInteger(score)) { window.alert('Enter a whole number for initiative.'); return; }
  if (existing) existing.score = score;
  else state.entries.push({ id: token.id, score });
  map.initiative = state;
  changed(); openPanel(panel);
});
$('initiative-next').addEventListener('click', () => {
  const map = floor.tabletopMap;
  if (!isGM || !map || floor.getAttribute('aria-busy') === 'true') return;
  const order = initiativeOrder(initiativeState(map.initiative, map.tokens));
  if (order.length < 2) return;
  map.initiative.currentId = order[1].id;
  changed();
});
$('open-initiative').addEventListener('click', () => openPanel(panel));
floor.addEventListener('map-ready', render);
floor.addEventListener('map-changed', render);
render();
