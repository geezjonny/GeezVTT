import { EQUIPMENT_SLOTS, COIN_TYPES, fitsEquipment, equippedName, itemEquipped } from './inventory-model.js';
import { modifierText } from './item-modifiers.js';
import { characterStats, baseSpeed } from './equipment-modifiers.js';
import { spellsHTML, spellSlotsHTML } from './spell-view.js';
import { sheetRolls } from './sheet-rolls.js';
import { effectsHTML } from './effects-view.js';
import { CONDITIONS, conditionNames } from './sheet-combat.js';
export const SHEET_SECTIONS = ['Stats', 'Weapons', 'Inventory', 'Feats', 'Spells', 'Effects'];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const list = value => Object.values(value && typeof value === 'object' ? value : {});
const text = value => Array.isArray(value) ? value.join('\n\n') : value;
const heading = label => `<h3>${esc(label)}</h3>`;
const row = (label, value) => `<div class="sheet-row"><span>${esc(label)}</span><strong>${esc(value ?? '—')}</strong></div>`;
const card = (name, description, meta = '') => `<article><strong>${esc(name)}</strong>${meta ? `<small>${esc(meta)}</small>` : ''}${description ? `<p>${esc(text(description))}</p>` : ''}</article>`;
let referencePromise;
export function loadSheetReference() {
  return referencePromise ||= Promise.all(['spells', 'equipment', 'magic_items', 'skills'].map(async name => {
    const response = await fetch(`data/${name}.json`);
    if (!response.ok) throw new Error('Reference descriptions unavailable.');
    return response.json();
  })).then(groups => Object.fromEntries(groups.flat().map(item => [item.name.toLowerCase(), item]))).catch(error => {
    referencePromise = null;
    throw error;
  });
}

export function sheetHTML(pc, section, reference = {}, rollable = false, editableCombat = false, gm = false) {
  const combat = pc.combat || {};
  const final = characterStats(pc, reference);
  if (section === 'Effects') return effectsHTML(pc, editableCombat, reference, gm);
  const lookup = name => reference[String(name).toLowerCase()] || {};
  const rollRow = roll => {
    const unavailable = !roll.expression || (roll.bonus !== undefined && !Number.isFinite(roll.bonus));
    const value = unavailable ? 'Unavailable' : roll.bonus === undefined ? roll.expression : roll.bonus >= 0 ? `+${roll.bonus}` : roll.bonus;
    const content = `<span>${esc(roll.label)}</span><strong>${esc(value)}</strong>`;
    return (rollable ? `<button type="button" class="sheet-row sheet-roll" data-sheet-roll="${esc(roll.key)}"${unavailable ? ' disabled' : ''} title="${esc([roll.detail, roll.expression].filter(Boolean).join(' · '))}">${content}</button>` : row(roll.label, value))
      + (roll.detail ? `<small>${esc(roll.detail)}</small>` : '');
  };
  if (section === 'Weapons') return sheetRolls(pc, reference).Weapons.map(rollRow).join('') || '<p>No weapon attacks recorded.</p>';
  if (section === 'Stats') {
    const edit = (label, field, value, max = 999999, min = 0) => `<label class="sheet-row"><span>${esc(label)}</span><input type="number" data-combat-field="${field}" aria-label="${esc(label)}" min="${min}" max="${max}" step="1" value="${esc(value ?? '')}"></label>`;
    let html = row('HP', `${combat.hp_current ?? 0} / ${final.hpMax ?? '—'}`)
      + row('Temporary HP', combat.temp_hp ?? 0)
      + row('AC', final.ac)
      + row('Exhaustion', combat.exhaustion ?? pc.exhaustion ?? 0);
    if (editableCombat) {
      const exhaustion = Number(combat.exhaustion ?? pc.exhaustion ?? 0);
      html = edit('HP', 'hp_current', combat.hp_current ?? 0)
        + edit('Maximum HP (base)', 'hp_max', combat.hp_max, 999999, 1) + row('Maximum HP total', final.hpMax)
        + edit('Temporary HP', 'temp_hp', combat.temp_hp ?? 0)
        + edit('AC (base)', 'ac', combat.ac ?? combat.armor_class ?? pc.ac, 999) + row('AC total', final.ac)
        + `<div class="sheet-exhaustion"><button type="button" data-exhaustion-delta="-1" aria-label="Decrease exhaustion"${exhaustion <= 0 ? ' disabled' : ''}>−</button>${edit('Exhaustion', 'exhaustion', exhaustion, 6)}<button type="button" data-exhaustion-delta="1" aria-label="Increase exhaustion"${exhaustion >= 6 ? ' disabled' : ''}>+</button></div>`;
    }
    if (editableCombat) {
      html += `<label class="sheet-equipment">AC calculation<select data-ac-mode>${['stored', 'unarmored', 'armor'].map(mode => `<option value="${mode}"${(combat.ac_mode || 'stored') === mode ? ' selected' : ''}>${{ stored: 'Stored AC + effects', unarmored: '10 + DEX + effects', armor: 'Equipped armor + DEX + effects' }[mode]}</option>`).join('')}</select></label>`;
      html += edit('SPD base (ft)', 'speed', baseSpeed(pc), 1000);
    }
    html += row('SPD (ft)', final.speed);
    html += heading('Ability scores');
    for (const [key, label] of Object.entries({ str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' })) {
      if (editableCombat) html += `<label class="sheet-row"><span>${label} base</span><input type="number" data-base-stat="${key}" aria-label="${label} base" min="0" max="999" step="1" value="${esc(final.base.stats[key])}"></label>`;
      html += row(`${label} total`, final.stats[key]);
    }
    if (final.effects.length) html += row('Active effects', final.effects.map(effect => effect.label).join(', '));
    const conditions = conditionNames(combat.conditions);
    html += row('Conditions', conditions.join(', ') || 'None');
    if (editableCombat) {
      const options = [...new Set([...conditions, ...CONDITIONS])];
      html += `<label class="sheet-equipment">Conditions<select data-condition-toggle aria-label="Add or remove a condition"><option value="">Add / remove condition</option>${options.map(name => `<option value="${esc(name)}" data-enabled="${!conditions.includes(name)}">${conditions.includes(name) ? 'Remove' : 'Add'} ${esc(name)}</option>`).join('')}</select></label>`;
    }
    for (const [label, rolls] of Object.entries(sheetRolls(pc, reference))) {
      if (label !== 'Weapons') html += heading(label) + rolls.map(rollRow).join('');
    }
    html += heading('Spell slots');
    html += spellSlotsHTML(pc, editableCombat);
    return html;
  }
  if (section === 'Inventory') {
    const items = Object.entries(pc.inventory || {}).filter(([, item]) => item && typeof item.name === 'string');
    let html = heading('Equipment');
    for (const [slot, label] of Object.entries(EQUIPMENT_SLOTS)) {
      const name = equippedName(pc, slot);
      const options = items.filter(([, item]) => Number(item.qty ?? 1) > 0 && fitsEquipment(slot, item, reference));
      const selected = options.find(([, item]) => item.name === name)?.[0];
      html += `<label class="sheet-equipment">${esc(label)}<select data-equipment-slot="${slot}" data-current-key="${esc(selected ?? '')}"${editableCombat ? '' : ' disabled'}><option value="">Unequip</option>${name && selected === undefined ? `<option value="" selected disabled>${esc(name)}</option>` : ''}${options.map(([key, item]) => `<option value="${esc(key)}"${key === selected ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>`;
      const equippedItem = items.find(([, item]) => item.name === name)?.[1];
      const description = equippedItem?.desc ?? lookup(name).desc;
      if (name && description) html += card(name, description, modifierText(equippedItem?.modifiers));
    }
    html += heading('Bag');
    html += `<div data-bag>${items.map(([key, item]) => `<div data-bag-key="${esc(key)}"${editableCombat ? ' tabindex="0"' : ''} aria-label="${esc(item.name)}${editableCombat ? ' bag actions' : ''}">${editableCombat ? `<button type="button" data-bag-menu aria-label="${esc(item.name)} actions">\u22ef</button>` : ''}${card(`${item.name} \u00d7${item.qty ?? 1}${itemEquipped(pc, item, reference) ? ' (equipped)' : ''}`, item.desc ?? lookup(item.name).desc,
      [item.category, modifierText(item.modifiers), item.notes].filter(Boolean).join(' \u00b7 '))}</div>`).join('') || '<p>Bag is empty.</p>'}</div>`;
    html += heading('Coins');
    for (const [coin, label] of Object.entries(COIN_TYPES)) {
      const amount = pc.coin_purse?.[coin] ?? 0;
      html += editableCombat ? `<div class="sheet-coin"><span>${label} (${coin})</span><button type="button" data-coin="${coin}" data-coin-delta="-1" aria-label="Remove one ${label.toLowerCase()} coin"${Number(amount) <= 0 ? ' disabled' : ''}>−</button><strong>${esc(amount)}</strong><button type="button" data-coin="${coin}" data-coin-delta="1" aria-label="Add one ${label.toLowerCase()} coin">+</button></div>` : row(`${label} (${coin})`, amount);
    }
    return html;
  }
  if (section === 'Feats') {
    const abilities = list(pc.abilities).filter(ability => ability?.label);
    const feats = list(pc.feats).filter(Boolean);
    let html = abilities.map(ability => card(ability.label, ability.effect_desc,
      [ability.kind === 'charge' ? `${ability.current ?? ability.max}/${ability.max} charges` : '', ability.die, ability.recharge].filter(Boolean).join(' · '))).join('');
    html += feats.map(feat => typeof feat === 'string' ? card(feat) : card(feat.name || feat.label, feat.desc || feat.description)).join('');
    if (pc.origin_feat) html += card('Origin feat', pc.origin_feat);
    if (pc.text_blocks?.features_traits) html += card('Features & traits', pc.text_blocks.features_traits);
    if (pc.text_blocks?.proficiencies_languages) html += card('Proficiencies & languages', pc.text_blocks.proficiencies_languages);
    return html || '<p>No feats or features recorded.</p>';
  }
  if (section === 'Spells') return spellsHTML(pc, reference, editableCombat);
  return '';
}
