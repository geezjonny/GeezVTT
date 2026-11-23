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
  const order = initiativeOrder(state).slice(0, 4);
  for (let i = 0; i < 4; i++) {
    const token = map?.tokens.find(token => token.id === order[i]?.id);
    const tile = document.createElement('li');
    tile.textContent = token ? Array.from(token.name.trim())[0].toUpperCase() : '·';
    tile.title = token ? token.name : 'Empty turn';
    tile.setAttribute('aria-label', token ? `${i === 0 ? 'Current turn' : `Turn ${i + 1}`}: ${token.name}` : 'Empty turn');
    if (token) {
      if (i === 0) tile.setAttribute('aria-current', 'true');
      const image = document.createElement('img');
      image.alt = '';
      image.addEventListener('error', () => image.remove(), { once: true });
      image.src = `token/${encodeURIComponent(token.name)}.png`;
      tile.append(image);
    }
    list.append(tile);
  }
  $('initiative-next').disabled = !isGM || state.entries.length < 2;
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
floor.addEventListener('initiative-remove', event => {
  const map = floor.tabletopMap;
  if (!isGM || !map || floor.getAttribute('aria-busy') === 'true') return;
  const state = initiativeState(map.initiative, map.tokens);
  const order = initiativeOrder(state);
  state.entries = state.entries.filter(entry => entry.id !== event.detail);
  if (order[0]?.id === event.detail) state.currentId = order[1]?.id ?? null;
  map.initiative = state;
  changed();
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
