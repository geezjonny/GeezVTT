import { openPanel } from './menu-bar.js';
import { isGM } from './session-role.js';
import { npcCatalog, tokenProperties, TOKEN_ICONS, tokenIcon } from './token-model.js';
import { onMapRightClick } from './map-right-click.js';
import { showMapMenu } from './map-object-menu.js';
import { SHEET_SECTIONS, sheetHTML, loadSheetReference } from './sheet-view.js';
import { mountInventoryAdder } from './inventory-adder.js';

const $ = id => document.getElementById(id);
const floor = $('floor'), svg = $('map-view'), group = $('tokens'), properties = $('token-properties-panel');
const tokens = () => floor.tabletopMap?.tokens || [];
$('token-icon').replaceChildren(...TOKEN_ICONS.map(label => new Option(label, label.toLowerCase())));
let npcs = [], editingId, loading = false;
let entities = {}, editingValues;
let sheetReference = {};
const sheetTokens = new Map();
const sheetId = section => `sheet-${section.toLowerCase()}`;
function drawSheet(section) {
  const token = tokens().find(token => token.id === sheetTokens.get(section));
  if (!token) return;
  const entity = entities[pcId(token)];
  $(`${sheetId(section)}-title`).textContent = `${entity?.name || token.name} · ${section}`;
  $(`${sheetId(section)}-content`).innerHTML = entity?.kind === 'pc' && entity.data && !entity.data._sheetsDeleted
    ? sheetHTML(entity.data, section, sheetReference) : '<p>Linked PC unavailable.</p>';
}
async function openSheet(token, section) {
  sheetTokens.set(section, token.id);
  const panel = $(`${sheetId(section)}-panel`);
  $(`${sheetId(section)}-status`).textContent = '';
  drawSheet(section);
  openPanel(panel);
  panel.querySelector('.editor-titlebar').focus();
  try {
    sheetReference = await loadSheetReference();
    drawSheet(section);
  } catch (error) {
    $(`${sheetId(section)}-status`).textContent = error.message;
  }
}
const subscriptions = new Map();
const knownPCs = new Set();
const base = window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, '');
async function read(path) {
  const response = await fetch(`${base}/${path}.json`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
  return response.json();
}
const pcId = token => token?.npcId?.startsWith('v2:') && knownPCs.has(token.npcId.slice(3)) ? token.npcId.slice(3) : null;
mountInventoryAdder($('sheet-inventory-content').parentElement,
  () => tokens().find(token => token.id === sheetTokens.get('Inventory')),
  async token => {
    const id = pcId(token);
    if (id) { entities[id] = await read(`v2/worlds/gaia/entities/${encodeURIComponent(id)}`); applyPC(id); }
  });
const status = text => { $('token-status').textContent = text; };
function pcSyncStatus(id, message) {
  status(message);
  for (const [section, tokenId] of sheetTokens) {
    if (tokens().some(token => token.id === tokenId && pcId(token) === id)) $(`${sheetId(section)}-status`).textContent = message;
  }
}
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
  for (const [section, tokenId] of sheetTokens) {
    if (tokens().some(token => token.id === tokenId && token.npcId === `v2:${id}`)) drawSheet(section);
  }
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
          pcSyncStatus(id, entity?.kind === 'pc' && !entity.data?._sheetsDeleted ? '' : 'A linked PC is unavailable.');
        }
      } catch (error) { pcSyncStatus(id, `PC sync failed: ${error.message}`); }
      finally { subscription.reading = false; }
    };
    stream.addEventListener('put', refresh);
    stream.addEventListener('patch', refresh);
    stream.addEventListener('error', () => pcSyncStatus(id, 'PC sync disconnected; reconnecting.'));
    for (const type of ['cancel', 'auth_revoked']) stream.addEventListener(type, () => {
      stream.close(); pcSyncStatus(id, 'PC sync denied by Firebase. Reopen Tokens to retry.');
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
  $('token-icon').value = tokenIcon(token.icon);
  $('token-properties-status').textContent = '';
  openPanel(properties);
  $('token-name').focus();
}
function tokenMenu(token, x, y, origin) {
  if (!isGM && !pcId(token)) return;
  showMapMenu(x, y, [
    ...SHEET_SECTIONS.map(section => ({ label: section, disabled: !pcId(token), action: () => openSheet(token, section) })),
    ...(isGM ? [
      { label: 'Edit token...', action: () => editToken(token) },
      { label: 'Rotate 90°', action: () => floor.dispatchEvent(new CustomEvent('vtt-token-rotate', { detail: token.id })) },
      { label: 'Add to initiative', action: () => floor.dispatchEvent(new CustomEvent('initiative-add', { detail: token.id })) },
      ...(floor.tabletopMap?.initiative?.entries.some(entry => entry.id === token.id) ? [
        { label: 'Remove from initiative', action: () => floor.dispatchEvent(new CustomEvent('initiative-remove', { detail: token.id })) }
      ] : [])
    ] : [])
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
$('token-icon').addEventListener('change', () => {
  if (!isGM) return;
  const token = tokens().find(token => token.id === editingId);
  if (!token) return;
  const detail = { ...token, icon: $('token-icon').value };
  floor.dispatchEvent(new CustomEvent('token-update', { detail }));
  $('token-properties-status').textContent = detail.error || 'Icon updated.';
});
$('token-form').addEventListener('submit', async event => {
  event.preventDefault();
  const detail = { id: editingId, name: $('token-name').value, size: Number($('token-size').value), hp: Number($('token-hp').value), icon: $('token-icon').value };
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
      const updatedToken = tokens().find(token => token.id === detail.id);
      if (updatedToken) {
        const update = { ...updatedToken, icon: detail.icon };
        floor.dispatchEvent(new CustomEvent('token-update', { detail: update }));
        if (update.error) throw new Error(update.error);
      }
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
floor.addEventListener('map-ready', () => {
  editingId = null; properties.hidden = true;
  for (const section of SHEET_SECTIONS) $(`${sheetId(section)}-panel`).hidden = true;
  sheetTokens.clear();
  loadNPCs();
});
floor.addEventListener('map-changed', () => {
  for (const [section, tokenId] of sheetTokens) if (!tokens().some(token => token.id === tokenId)) {
    sheetTokens.delete(section); $(`${sheetId(section)}-panel`).hidden = true;
  }
  if (editingId && !tokens().some(token => token.id === editingId)) { editingId = null; properties.hidden = true; }
  syncPCs();
  for (const id of new Set(tokens().map(pcId).filter(Boolean))) applyPC(id);
});
if (floor.tabletopMap) loadNPCs();
