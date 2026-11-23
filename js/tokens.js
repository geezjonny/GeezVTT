import { openPanel } from './menu-bar.js';
import { npcCatalog } from './token-model.js';
import { onMapRightClick } from './map-right-click.js';

const $ = id => document.getElementById(id);
const floor = $('floor'), svg = $('map-view'), group = $('tokens'), properties = $('token-properties-panel');
const tokens = () => floor.tabletopMap?.tokens || [];
let npcs = [], editingId, loading = false;
const status = text => { $('token-status').textContent = text; };
const tokenAt = event => tokens().find(token => token.id === event.target.closest('[data-token-id]')?.dataset.tokenId);
function template() {
  floor.tokenTemplate = { ...(npcs.find(npc => npc.npcId === $('token-source').value) || { name: 'Blank Token', size: 1, hp: 0, npcId: null }) };
}
$('token-source').addEventListener('change', template);
template();

async function loadNPCs() {
  if (loading) return;
  loading = true;
  status('');
  try {
    const base = window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, '');
    const read = async path => {
      const response = await fetch(`${base}/${path}.json`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
      return response.json();
    };
    const results = await Promise.allSettled([read('v2/worlds/gaia/entities'), read('characters/npcs')]);
    if (results.every(result => result.status === 'rejected')) throw results[0].reason;
    npcs = npcCatalog(results[0].value, results[1].value);
    const previous = $('token-source').value;
    $('token-source').replaceChildren(new Option('Blank Token', ''), ...npcs.map(npc => new Option(npc.name, npc.npcId)));
    $('token-source').value = npcs.some(npc => npc.npcId === previous) ? previous : '';
    template();
    status(results.some(result => result.status === 'rejected') ? 'One NPC source could not be read; the list may be incomplete.' : '');
  } catch (error) {
    status(`Could not load NPCs: ${error.message}. Reopen Tokens to retry. Blank Token is available.`);
  } finally { loading = false; }
}
$('open-tokens').addEventListener('click', loadNPCs);

function editToken(token) {
  editingId = token.id;
  $('token-name').value = token.name;
  $('token-size').value = token.size;
  $('token-hp').value = token.hp;
  $('token-properties-status').textContent = '';
  openPanel(properties);
  $('token-name').focus();
}
onMapRightClick(svg, event => {
  if (svg.hidden) return;
  // Pointer capture can target the map instead of the token under the cursor.
  const matrix = svg.getScreenCTM();
  const point = matrix && new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  const token = tokenAt(event) || (point && tokens().findLast(token => Math.hypot(point.x - token.x, point.y - token.y) <= token.size / 2));
  if (!token) return;
  event.preventDefault();
  event.stopPropagation();
  editToken(token);
});
group.addEventListener('keydown', event => {
  const token = tokenAt(event);
  if (token && ['Enter', ' ', 'ContextMenu'].includes(event.key)) {
    event.preventDefault(); event.stopPropagation(); editToken(token);
  }
});
floor.addEventListener('token-edit', event => {
  const token = tokens().find(token => token.id === event.detail);
  if (token) editToken(token);
});
$('token-form').addEventListener('submit', event => {
  event.preventDefault();
  const detail = { id: editingId, name: $('token-name').value, size: Number($('token-size').value), hp: Number($('token-hp').value) };
  floor.dispatchEvent(new CustomEvent('token-update', { detail }));
  $('token-properties-status').textContent = detail.error || 'Token updated.';
});
floor.addEventListener('map-ready', () => { editingId = null; properties.hidden = true; });
floor.addEventListener('map-changed', () => {
  if (editingId && !tokens().some(token => token.id === editingId)) { editingId = null; properties.hidden = true; }
});
