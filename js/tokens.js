import { openPanel } from './menu-bar.js';
import { isGM } from './session-role.js';
import { npcCatalog, tokenProperties } from './token-model.js';
import { onMapRightClick } from './map-right-click.js';
import { showMapMenu } from './map-object-menu.js';

const $ = id => document.getElementById(id);
const floor = $('floor'), svg = $('map-view'), group = $('tokens'), properties = $('token-properties-panel');
const tokens = () => floor.tabletopMap?.tokens || [];
let npcs = [], editingId, loading = false;
let entities = {}, editingValues;
const subscriptions = new Map();
const knownPCs = new Set();
const base = window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, '');
async function read(path) {
  const response = await fetch(`${base}/${path}.json`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
  return response.json();
}
const pcId = token => token?.npcId?.startsWith('v2:') && knownPCs.has(token.npcId.slice(3)) ? token.npcId.slice(3) : null;
const status = text => { $('token-status').textContent = text; };
const tokenAt = event => tokens().find(token => token.id === event.target.closest('[data-token-id]')?.dataset.tokenId);
function template() {
  floor.tokenTemplate = { ...(npcs.find(npc => npc.npcId === $('token-source').value) || { name: 'Blank Token', size: 1, hp: 0, npcId: null }) };
}
$('token-source').addEventListener('change', () => { template(); syncPCs(); });
template();

function applyPC(id) {
  const character = entities[id]?.kind === 'pc' ? npcCatalog({ [id]: entities[id] })[0] : null;
  npcs = npcs.filter(npc => npc.npcId !== `v2:${id}`);
  if (character) npcs.push(character);
  const option = Array.from($('token-source').options).find(option => option.value === `v2:${id}`);
  if (option) {
    if (character) option.text = character.name;
    else option.remove();
  }
  template();
  if (character) floor.dispatchEvent(new CustomEvent('token-sync', { detail: character }));
  if (character && tokens().some(token => token.id === editingId && token.npcId === character.npcId)) {
    for (const key of ['name', 'size', 'hp']) {
      const input = $(`token-${key}`);
      if (input.value === String(editingValues[key])) {
        input.value = character[key];
        editingValues[key] = character[key];
      }
    }
  }
}

function syncPCs() {
  const ids = new Set([...tokens(), floor.tokenTemplate].map(pcId).filter(Boolean));
  for (const [id, subscription] of subscriptions) {
    if (!ids.has(id)) { subscription.stream.close(); subscriptions.delete(id); }
  }
  for (const id of ids) {
    if (subscriptions.has(id)) continue;
    const stream = new EventSource(`${base}/v2/worlds/gaia/entities/${encodeURIComponent(id)}.json`);
    const subscription = { stream, reading: false, dirty: false };
    subscriptions.set(id, subscription);
    const refresh = async () => {
      subscription.dirty = true;
      if (subscription.reading) return;
      subscription.reading = true;
      try {
        while (subscription.dirty && subscriptions.get(id) === subscription) {
          subscription.dirty = false;
          const entity = await read(`v2/worlds/gaia/entities/${encodeURIComponent(id)}`);
          if (subscriptions.get(id) !== subscription) return;
          entities[id] = entity;
          applyPC(id);
          status(entity?.kind === 'pc' && !entity.data?._sheetsDeleted ? '' : 'A linked PC is unavailable.');
        }
      } catch (error) { status(`PC sync failed: ${error.message}`); }
      finally { subscription.reading = false; }
    };
    stream.addEventListener('put', refresh);
    stream.addEventListener('patch', refresh);
    stream.addEventListener('error', () => status('PC sync disconnected; reconnecting.'));
    for (const type of ['cancel', 'auth_revoked']) stream.addEventListener(type, () => {
      stream.close(); status('PC sync denied by Firebase. Reopen Tokens to retry.');
      subscriptions.delete(id);
    });
  }
}

async function loadNPCs() {
  if (loading) return;
  loading = true;
  status('');
  try {
    const results = await Promise.allSettled([read('v2/worlds/gaia/entities'), read('characters/npcs')]);
    if (results.every(result => result.status === 'rejected')) throw results[0].reason;
    if (results[0].status === 'fulfilled') entities = results[0].value || {};
    for (const [id, entity] of Object.entries(entities)) if (entity?.kind === 'pc') knownPCs.add(id);
    npcs = npcCatalog(results[0].value, results[1].value);
    const previous = $('token-source').value;
    $('token-source').replaceChildren(new Option('Blank Token', ''), ...npcs.map(npc => new Option(npc.name, npc.npcId)));
    $('token-source').value = npcs.some(npc => npc.npcId === previous) ? previous : '';
    template();
    for (const id of Object.keys(entities)) if (entities[id]?.kind === 'pc') applyPC(id);
    syncPCs();
    status(results.some(result => result.status === 'rejected') ? 'A character source could not be read; the list may be incomplete.' : '');
  } catch (error) {
    status(`Could not load characters: ${error.message}. Reopen Tokens to retry. Blank Token is available.`);
  } finally { loading = false; }
}
$('open-tokens').addEventListener('click', loadNPCs);

function editToken(token) {
  if (!isGM) return;
  editingId = token.id;
  editingValues = { name: token.name, size: token.size, hp: token.hp };
  $('token-name').value = token.name;
  $('token-size').value = token.size;
  $('token-hp').value = token.hp;
  $('token-properties-status').textContent = '';
  openPanel(properties);
  $('token-name').focus();
}
function tokenMenu(token, x, y, origin) {
  if (!isGM) return;
  showMapMenu(x, y, [
    { label: 'Edit token...', action: () => editToken(token) },
    { label: 'Add to initiative', action: () => floor.dispatchEvent(new CustomEvent('initiative-add', { detail: token.id })) }
  ], origin);
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
  tokenMenu(token, event.clientX, event.clientY, svg);
});
group.addEventListener('keydown', event => {
  if (!isGM) return;
  const token = tokenAt(event);
  if (token && ['Enter', ' ', 'ContextMenu'].includes(event.key)) {
    event.preventDefault(); event.stopPropagation();
    const rect = event.target.getBoundingClientRect();
    tokenMenu(token, rect.right, rect.top, event.target);
  }
});
floor.addEventListener('token-edit', event => {
  const token = tokens().find(token => token.id === event.detail);
  if (token) editToken(token);
});
floor.addEventListener('token-menu', event => {
  const token = tokens().find(token => token.id === event.detail.id);
  if (token) tokenMenu(token, event.detail.x, event.detail.y, document.activeElement);
});
$('token-form').addEventListener('submit', async event => {
  event.preventDefault();
  const detail = { id: editingId, name: $('token-name').value, size: Number($('token-size').value), hp: Number($('token-hp').value) };
  const token = tokens().find(token => token.id === detail.id), id = pcId(token);
  if (id) {
    const before = { ...editingValues };
    const button = event.submitter || $('token-form').querySelector('button');
    button.disabled = true;
    try {
      const props = tokenProperties(detail.name, detail.size, detail.hp);
      const entity = await read(`v2/worlds/gaia/entities/${encodeURIComponent(id)}`);
      if (entity?.kind !== 'pc' || !entity.data || entity.data._sheetsDeleted) throw new Error('This PC is unavailable.');
      const patch = {};
      if (props.name !== before.name) {
        patch.name = props.name;
        if (Object.hasOwn(entity.data, 'name')) patch['data/name'] = props.name;
      }
      if (props.size !== before.size) patch['data/size'] = props.size;
      if (props.hp !== before.hp) patch['data/combat/hp_current'] = props.hp;
      if (Object.keys(patch).length) {
        const response = await fetch(`${base}/v2/worlds/gaia/entities/${encodeURIComponent(id)}.json`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch), signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
      }
      entities[id] = await read(`v2/worlds/gaia/entities/${encodeURIComponent(id)}`);
      applyPC(id);
      if (editingId === detail.id) {
        const updated = tokens().find(token => token.id === detail.id);
        if (updated) editToken(updated);
        $('token-properties-status').textContent = 'PC saved to Firebase.';
      }
    } catch (error) { $('token-properties-status').textContent = `PC save failed: ${error.message}`; }
    finally { button.disabled = false; }
    return;
  }
  floor.dispatchEvent(new CustomEvent('token-update', { detail }));
  $('token-properties-status').textContent = detail.error || 'Token updated.';
});
floor.addEventListener('map-ready', () => { editingId = null; properties.hidden = true; loadNPCs(); });
floor.addEventListener('map-changed', () => {
  if (editingId && !tokens().some(token => token.id === editingId)) { editingId = null; properties.hidden = true; }
  syncPCs();
  for (const id of new Set(tokens().map(pcId).filter(Boolean))) applyPC(id);
});
if (floor.tabletopMap) loadNPCs();
