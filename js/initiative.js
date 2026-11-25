import { visibleObject } from './player-vision.js';
import { tokenImage } from './token-art.js';
import { isGM, canControlPC } from './session-role.js';
import { openPanel } from './menu-bar.js';
import { drainOnTurn } from './effect-drain.js';
import { initiativeState, initiativeOrder, startTurn, remainingMovement, attacksPerTurn } from './initiative-model.js';

const $ = id => document.getElementById(id);
const floor = $('floor'), panel = $('initiative-panel'), list = $('initiative-list');
function render() {
  const map = floor.tabletopMap;
  const state = initiativeState(map?.initiative, map?.tokens || []);
  if (isGM && floor.initiativeActive && state.entries.length && !state.turn) startTurn(state, state.currentId || state.entries[0].id);
  if (map) map.initiative = state;
  const token = map?.tokens.find(token => token.id === state.currentId);
  const active = floor.initiativeActive && !!state.turn;
  const allowed = active && token?.kind === 'pc' && canControlPC(token);
  const turn = state.turn || {};
  $('player-turn-panel').hidden = !allowed;
  $('combat-status').textContent = token ? `${token.name}: ${remainingMovement(map, token)} ft left${token.speed == null ? ' (SPD unavailable)' : ''}` : '';
  for (const button of $('combat-controls').querySelectorAll('[data-turn-command]')) {
    const command = button.dataset.turnCommand;
    button.disabled = !allowed || floor.equipmentBusy || state.turn?.[command] === true;
    if (command === 'attack') {
      const total = attacksPerTurn(map, token);
      button.textContent = `Attack (${Math.max(0, total - (turn.attacksUsed || 0))}/${total})`;
      button.title = turn.firstTurn && token?.turnFeatures?.dreadAmbusher ? 'Extra attack: +1d8 damage on a hit' : 'Spend one attack';
      button.disabled = !allowed || floor.equipmentBusy || turn.action && !turn.attacking || (turn.attacksUsed || 0) >= total;
    }
    if (command === 'hunters-mark') {
      button.hidden = !token?.turnFeatures?.huntersMark;
      button.disabled = !allowed || floor.equipmentBusy || turn.bonus;
    }
    if (command !== 'end') button.setAttribute('aria-pressed', String(command === 'hunters-mark' ? turn.bonus === true : command === 'attack' ? turn.attacking === true : turn[command] === true));
  }
  list.replaceChildren();
  const order = initiativeOrder(state).slice(0, 4);
  for (let i = 0; i < 4; i++) {
    const token = map?.tokens.find(token => token.id === order[i]?.id && visibleObject(map,token));
    const tile = document.createElement('li');
    tile.textContent = token ? Array.from(token.name.trim())[0].toUpperCase() : '·';
    tile.title = token ? token.name : 'Empty turn';
    tile.setAttribute('aria-label', token ? `${i === 0 ? 'Current turn' : `Turn ${i + 1}`}: ${token.name}` : 'Empty turn');
    if (token) {
      if (i === 0) tile.setAttribute('aria-current', 'true');
      const image = document.createElement('img');
      image.alt = '';
      image.addEventListener('error', () => image.remove(), { once: true });
      image.src = tokenImage(token);
      tile.append(image);
    }
    list.append(tile);
  }
  $('initiative-start').disabled = !isGM || !state.entries.length && !floor.initiativeActive || floor.equipmentBusy;
  $('initiative-start').setAttribute('aria-pressed', String(!!floor.initiativeActive));
  $('initiative-start').title = $('initiative-start').ariaLabel = floor.initiativeActive ? 'End Initiative' : 'Start Initiative';
  $('initiative-start').textContent = floor.initiativeActive ? 'End' : 'Start';
  $('initiative-next').disabled = !isGM || !active || floor.equipmentBusy;
  floor.dispatchEvent(new Event('turn-changed'));
}
function changed() {
  render();
  floor.dispatchEvent(new Event('map-changed'));
}
floor.addEventListener('initiative-add', event => {
  const map = floor.tabletopMap;
  if (!isGM || !map || floor.equipmentBusy || floor.getAttribute('aria-busy') === 'true') return;
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
  if (!isGM || !map || floor.equipmentBusy || floor.getAttribute('aria-busy') === 'true') return;
  const state = initiativeState(map.initiative, map.tokens);
  const order = initiativeOrder(state);
  state.entries = state.entries.filter(entry => entry.id !== event.detail);
  if (order[0]?.id === event.detail) {
    if (order[1] && floor.initiativeActive) startTurn(state, order[1].id);
    else { state.currentId = null; delete state.turn; }
  }
  map.initiative = state;
  changed();
});
$('initiative-next').addEventListener('click', () => {
  const map = floor.tabletopMap;
  if (!isGM || !map || !floor.initiativeActive || floor.equipmentBusy || floor.getAttribute('aria-busy') === 'true') return;
  const order = initiativeOrder(initiativeState(map.initiative, map.tokens));
  if (!order.length) return;
  const next = order[1] || order[0];
  startTurn(map.initiative, next.id);
  changed();
  drainOnTurn(map.tokens.find(token => token.id === next.id)); // life-drain effects bite at the start of the turn
});
$('open-initiative').addEventListener('click', () => openPanel(panel));
floor.addEventListener('map-ready', render);
floor.addEventListener('map-changed', render);
render();

$('initiative-active').addEventListener('change', () => {
  if (!isGM || floor.equipmentBusy) { $('initiative-active').checked = !!floor.initiativeActive; return; }
  floor.initiativeActive = $('initiative-active').checked;
  if (isGM && floor.initiativeActive && floor.tabletopMap) {
    delete floor.tabletopMap.initiative.turn;
    delete floor.tabletopMap.initiative.completedIds;
    floor.tabletopMap.initiative.currentId = null;
  }
  changed();
});
$('initiative-start').addEventListener('click', () => {
  if (!isGM || !floor.tabletopMap || floor.equipmentBusy || floor.getAttribute('aria-busy') === 'true') return;
  if (!floor.initiativeActive && !floor.tabletopMap.initiative?.entries.length) return;
  $('initiative-active').checked = !floor.initiativeActive;
  $('initiative-active').dispatchEvent(new Event('change'));
});
$('combat-inventory').addEventListener('click', () => {
  const token = floor.tabletopMap?.tokens.find(token => token.id === floor.tabletopMap.initiative?.currentId);
  if (floor.initiativeActive && token?.kind === 'pc' && canControlPC(token)) {
    floor.dispatchEvent(new CustomEvent('token-sheet', { detail: { id: token.id, section: 'Inventory' } }));
  }
});
$('combat-controls').addEventListener('click', event => {
  const button = event.target.closest('[data-turn-command]');
  const state = floor.tabletopMap?.initiative;
  const token = floor.tabletopMap?.tokens.find(token => token.id === state?.currentId);
  if (!button || button.disabled || !state?.turn || !canControlPC(token)) return;
  floor.dispatchEvent(new CustomEvent('session-action', { detail: {
    type: 'turn', tokenId: token.id, turnId: state.turn.id, command: button.dataset.turnCommand
  } }));
  const section = { item: 'Inventory', attack: 'Weapons', 'hunters-mark': 'Spells' }[button.dataset.turnCommand];
  if (section) floor.dispatchEvent(new CustomEvent('token-sheet', { detail: { id: token.id, section } }));
});
window.addEventListener('player-signed-in', render);
