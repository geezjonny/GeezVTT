import { openPanel } from './menu-bar.js';
import { isGM, canControlPC } from './session-role.js';
import { npcCatalog, tokenProperties, TOKEN_ICONS, tokenIcon } from './token-model.js';
import { onMapRightClick } from './map-right-click.js';
import { showMapMenu } from './map-object-menu.js';
import { triggerMenuItem, interactionMenuItems } from './trigger-controls.js';
import { SHEET_SECTIONS, sheetHTML, loadSheetReference } from './sheet-view.js';
import { mountInventoryTools } from './inventory-tools.js';
import { applyFirebaseEvent } from './firebase-events.js';
import { sheetRolls } from './sheet-rolls.js';
import { rollFromSheet } from './dice-roller.js';
import { mountSpells } from './sheet-spells.js';
import { mountSpellSlots } from './sheet-slots.js';
import { mountEffects } from './effects-editor.js';
import { mountFeats } from './sheet-feats.js';
import { readPC } from './pc-inventory.js';
import { decodeTree, decodeEvent } from './firebase-codec.js';

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
  if (section === 'Inventory') inventoryTools.hidden = !canControlPC(token);
  $(`${sheetId(section)}-title`).textContent = `${entity?.name || token.name} · ${section}`;
  $(`${sheetId(section)}-content`).innerHTML = entity?.kind === 'pc' && entity.data && !entity.data._sheetsDeleted
    ? sheetHTML(entity.data, section, sheetReference, canControlPC(token), canControlPC(token), isGM) : '<p>Linked PC unavailable.</p>';
}
for (const section of ['Stats', 'Weapons']) {
  $(`${sheetId(section)}-content`).addEventListener('click', event => {
    const button = event.target.closest('[data-sheet-roll]');
    const token = tokens().find(token => token.id === sheetTokens.get(section));
    const entity = entities[pcId(token)];
    if (!button || !canControlPC(token) || entity?.kind !== 'pc' || !entity.data || entity.data._sheetsDeleted) return;
    const roll = Object.values(sheetRolls(entity.data, sheetReference)).flat().find(roll => roll.key === button.dataset.sheetRoll);
    if (roll) rollFromSheet(entity.name || token.name, roll);
  });
}
mountSpellSlots($('sheet-stats-content'), () => tokens().find(token => token.id === sheetTokens.get('Stats')),
  $('sheet-stats-status'), (pc, token) => {
    const id = pcId(token);
    if (id && entities[id]) { entities[id].data = pc; applyPC(id); }
  });
mountSpellSlots($('sheet-spells-content'), () => tokens().find(token => token.id === sheetTokens.get('Spells')),
  $('sheet-spells-status'), (pc, token) => {
    const id = pcId(token);
    if (id && entities[id]) { entities[id].data = pc; applyPC(id); }
  });
mountSpells($('sheet-spells-content'), {
  getToken: () => tokens().find(token => token.id === sheetTokens.get('Spells')),
  getPC: () => entities[pcId(tokens().find(token => token.id === sheetTokens.get('Spells')))]?.data,
  getReference: () => sheetReference, status: $('sheet-spells-status'), openGlossary: openPanel,
  onSaved: (pc, token) => { const id = pcId(token); if (id && entities[id]) { entities[id].data = pc; applyPC(id); } },
  onRoll: (roll, token) => rollFromSheet(token.name, roll)
});
mountFeats($('sheet-feats-content'), () => tokens().find(token => token.id === sheetTokens.get('Feats')),
  () => entities[pcId(tokens().find(token => token.id === sheetTokens.get('Feats')))]?.data, $('sheet-feats-status'), (pc, token) => {
    const id = pcId(token);
    if (id && entities[id]) { entities[id].data = pc; applyPC(id); }
  });
mountEffects($('sheet-effects-content'), () => tokens().find(token => token.id === sheetTokens.get('Effects')),
  () => entities[pcId(tokens().find(token => token.id === sheetTokens.get('Effects')))]?.data, $('sheet-effects-status'), (pc, token) => {
    const id = pcId(token);
    if (id && entities[id]) { entities[id].data = pc; applyPC(id); }
  });
async function openSheet(token, section) {
  if (!pcId(token)) return;
  sheetTokens.set(section, token.id);
  const panel = $(`${sheetId(section)}-panel`);
  $(`${sheetId(section)}-status`).textContent = '';
  drawSheet(section);
  openPanel(panel);
  panel.querySelector('.editor-titlebar').focus();
  try {
    sheetReference = await loadSheetReference();
    for (const id of knownPCs) applyPC(id);
    drawSheet(section);
  } catch (error) {
    $(`${sheetId(section)}-status`).textContent = error.message;
  }
}
let pcStream;
const knownPCs = new Set();
const base = window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, '');
async function read(path) {
  const response = await fetch(`${base}/${path}.json`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
  return decodeTree(await response.json());
}
const pcId = token => token?.npcId?.startsWith('v2:') && knownPCs.has(token.npcId.slice(3)) ? token.npcId.slice(3) : null;
window.addEventListener('player-signed-in', () => {
  for (const section of SHEET_SECTIONS) drawSheet(section);
});
const inventoryTools = mountInventoryTools($('sheet-inventory-content').parentElement,
  () => tokens().find(token => token.id === sheetTokens.get('Inventory')), () => entities, async (token, pc) => {
    const id = pcId(token);
    if (id && entities[id]) { entities[id].data = pc ?? await readPC(token); applyPC(id); }
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
  const character = entities[id]?.kind === 'pc' ? npcCatalog({ [id]: entities[id] }, null, sheetReference)[0] : null;
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
  if (!ids.size) { pcStream?.close(); pcStream = null; return; }
  if (pcStream) return;
  // One stream leaves connections available for item saves and tabletop requests.
  const stream = pcStream = new EventSource(`${base}/v2/worlds/gaia/entities.json`);
  const report = message => {
    for (const id of new Set([...tokens(), floor.tokenTemplate].map(pcId).filter(Boolean))) pcSyncStatus(id, message);
  };
  const update = event => {
    if (pcStream !== stream) return;
    try {
      entities = applyFirebaseEvent(entities, event.type, decodeEvent(event.type, JSON.parse(event.data))) || {};
      for (const [id, entity] of Object.entries(entities)) if (entity?.kind === 'pc') knownPCs.add(id);
      for (const id of new Set([...tokens(), floor.tokenTemplate].map(pcId).filter(Boolean))) {
        applyPC(id);
        pcSyncStatus(id, entities[id]?.kind === 'pc' && !entities[id].data?._sheetsDeleted ? '' : 'A linked PC is unavailable.');
      }
    } catch (error) { report(`PC sync failed: ${error.message}`); }
  };
  stream.addEventListener('put', update);
  stream.addEventListener('patch', update);
  stream.addEventListener('error', () => report('PC sync disconnected; reconnecting.'));
  for (const type of ['cancel', 'auth_revoked']) stream.addEventListener(type, () => {
    stream.close();
    if (pcStream === stream) { pcStream = null; report('PC sync denied by Firebase. Reopen Tokens to retry.'); }
  });
}
window.addEventListener('pagehide', () => { pcStream?.close(); pcStream = null; });

async function loadNPCs() {
  if (loading) return;
  loading = true;
  status('');
  try {
    try { sheetReference = await loadSheetReference(); } catch { /* Stored AC and custom item formulas remain available. */ }
    const results = await Promise.allSettled([read('v2/worlds/gaia/entities'), read('characters/npcs')]);
    if (results.every(result => result.status === 'rejected')) throw results[0].reason;
    if (results[0].status === 'fulfilled') entities = results[0].value || {};
    for (const [id, entity] of Object.entries(entities)) if (entity?.kind === 'pc') knownPCs.add(id);
    npcs = npcCatalog(results[0].value, results[1].value, sheetReference);
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
  if (!isGM && !pcId(token) && !interactionMenuItems({layer:'tokens',id:token.id}).length) return;
  showMapMenu(x, y, [
    ...interactionMenuItems({layer:'tokens',id:token.id}),
    ...SHEET_SECTIONS.map(section => ({ label: section, disabled: !pcId(token), action: () => openSheet(token, section) })),
    ...(isGM ? [
      triggerMenuItem({layer:'tokens',id:token.id}),
      { label: 'Edit token...', action: () => editToken(token) },
      { label: 'Rotate 90°', action: () => floor.dispatchEvent(new CustomEvent('vtt-token-rotate', { detail: token.id })) },
      { label: 'Add to initiative', action: () => floor.dispatchEvent(new CustomEvent('initiative-add', { detail: token.id })) },
      ...(floor.tabletopMap?.initiative?.entries.some(entry => entry.id === token.id) ? [
        { label: 'Remove from initiative', action: () => floor.dispatchEvent(new CustomEvent('initiative-remove', { detail: token.id })) }
      ] : [])
    ] : [])
  ], origin);
}
floor.addEventListener('token-sheet', event => {
  const token = tokens().find(token => token.id === event.detail?.id);
  const section = event.detail?.section;
  if (token && pcId(token) && SHEET_SECTIONS.includes(section)) openSheet(token, section);
});
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
  $('spell-glossary-panel').hidden = true;
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
