import { openPanel } from './menu-bar.js';
import { givePCCard } from './pc-inventory.js';
import { decodeTree } from './firebase-codec.js';
import { modifierRow } from './effects-view.js';
import { ITEM_STATS, ITEM_SKILLS } from './item-modifiers.js';
import { CONDITIONS } from './sheet-combat.js';

const $ = id => document.getElementById(id), form = $('card-form'), status = $('card-status');
const opts = values => values.map(value => `<option value="${value}">${value.replaceAll('_', ' ')}</option>`).join('');
const remove = '<button type="button" data-card-remove aria-label="Remove">×</button>';
const text = '<input data-card-name maxlength="100" placeholder="Name" required><textarea data-card-desc rows="2" maxlength="20000" placeholder="Description"></textarea>';
const ROWS = {
  skill: `<select data-card-skill>${opts(ITEM_SKILLS)}</select><input data-card-value type="number" min="-999" max="999" step="1" value="1" required>${remove}`,
  change: () => modifierRow(),
  effect: `${text}${remove}`, feat: `${text}${remove}`,
  condition: `<select data-card-condition>${opts(CONDITIONS)}</select>${remove}`
};
$('card-stats').innerHTML = ITEM_STATS.map(key => `<label>${key.toUpperCase()}<input type="number" name="${key}" min="-999" max="999" step="1" value="0"></label>`).join('');

async function loadPCs() {
  status.textContent = 'Loading characters…';
  try {
    const response = await fetch(`${window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, '')}/v2/worlds/gaia/entities.json`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
    const entities = decodeTree(await response.json()) || {};
    $('card-pc').replaceChildren(...Object.entries(entities).filter(([, entity]) => entity?.kind === 'pc' && entity.data && !entity.data._sheetsDeleted)
      .sort((a, b) => String(a[1].name || a[1].data.name || a[0]).localeCompare(String(b[1].name || b[1].data.name || b[0])))
      .map(([id, entity]) => new Option(entity.name || entity.data.name || id, id)));
    status.textContent = $('card-pc').options.length ? '' : 'No characters available.';
  } catch (error) { status.textContent = error.message; }
}
$('open-card-creator').addEventListener('click', () => { openPanel($('card-panel')); loadPCs(); });
form.addEventListener('click', event => {
  const add = event.target.closest('[data-card-add]');
  if (add) {
    const row = document.createElement('div'), html = ROWS[add.dataset.cardAdd];
    row.className = 'card-row'; row.innerHTML = typeof html === 'function' ? html() : html;
    $(`card-${add.dataset.cardAdd}-rows`).append(row);
  }
  if (event.target.closest('[data-card-remove], [data-effect-remove]')) event.target.closest('.card-row').remove();
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity() || !$('card-pc').value) return;
  const rows = kind => [...$(`card-${kind}-rows`).children];
  const named = kind => rows(kind).map(row => ({ name: row.querySelector('[data-card-name]').value, description: row.querySelector('[data-card-desc]').value }));
  const card = { name: form.elements.name.value, description: form.elements.description.value, equip: form.elements.equip.checked,
    stats: Object.fromEntries(ITEM_STATS.map(key => [key, Number(form.elements[key].value)])),
    // shortcut: a repeated skill keeps its last value, sum them if stacking is ever wanted.
    skills: Object.fromEntries(rows('skill').map(row => [row.querySelector('[data-card-skill]').value, Number(row.querySelector('[data-card-value]').value)])),
    statChanges: rows('change').map(row => ({ target: row.querySelector('[data-effect-target]').value,
      operation: row.querySelector('[data-effect-operation]').value, value: Number(row.querySelector('[data-effect-value]').value) })),
    effects: named('effect'), feats: named('feat'), conditions: rows('condition').map(row => row.querySelector('[data-card-condition]').value) };
  const submit = $('card-submit'); submit.disabled = true; status.textContent = 'Giving card…';
  try {
    await givePCCard({ npcId: `v2:${$('card-pc').value}` }, card, crypto.randomUUID());
    status.textContent = `Gave ${card.name}.`;
  } catch (error) { status.textContent = error.message; }
  finally { submit.disabled = false; }
});
