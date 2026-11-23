import { EQUIPMENT_SLOTS, fitsEquipment, equippedName, itemEquipped } from './inventory-model.js';
export const SHEET_SECTIONS = ['Stats', 'Inventory', 'Feats', 'Spells'];
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

export function sheetHTML(pc, section, reference = {}) {
  const combat = pc.combat || {}, casting = pc.spellcasting || {};
  const lookup = name => reference[String(name).toLowerCase()] || {};
  if (section === 'Stats') {
    let html = row('HP', `${combat.hp_current ?? 0} / ${combat.hp_max ?? '—'}`)
      + row('Temporary HP', combat.temp_hp ?? 0)
      + row('AC', combat.ac ?? combat.armor_class ?? pc.ac)
      + row('Exhaustion', combat.exhaustion ?? pc.exhaustion ?? 0);
    const conditions = list(combat.conditions);
    if (conditions.length) html += row('Conditions', conditions.join(', '));
    html += heading('Spell slots');
    let slots = '';
    for (let level = 1; level <= 9; level++) {
      const max = Number(casting.slots?.[level]), used = Math.max(0, Math.min(max, Number(casting.slots_used?.[level]) || 0));
      if (!Number.isSafeInteger(max) || max <= 0 || max > 100) continue;
      slots += `<div class="sheet-slots"><span>Level ${level}: ${max - used}/${max}</span><span class="sheet-pips" role="img" aria-label="${max - used} of ${max} spell slots remaining">${Array.from({ length: max }, (_, i) => `<i class="sheet-pip${i < used ? ' used' : ''}"></i>`).join('')}</span></div>`;
    }
    html += slots || '<p>No spell slots.</p>';
    html += heading('Skills');
    for (const skill of Object.values(reference).filter(item => item.ability_score && item.url?.includes('/skills/'))) {
      const key = skill.index.replace(/-/g, '_'), data = pc.skills?.[key] || {}, ability = skill.ability_score.index;
      const proficiency = Number(combat.proficiency_bonus ?? 2);
      const bonus = Number(data.bonus ?? (Math.floor((Number(pc.stats?.[ability] ?? 10) - 10) / 2) + (data.expertise ? 2 : data.proficient ? 1 : 0) * proficiency));
      html += row(`${skill.name}${data.expertise ? ' (expertise)' : data.proficient ? ' (proficient)' : ''}`, bonus >= 0 ? `+${bonus}` : bonus);
    }
    return html;
  }
  if (section === 'Inventory') {
    const items = Object.entries(pc.inventory || {}).filter(([, item]) => item && typeof item.name === 'string');
    let html = heading('Equipment');
    for (const [slot, label] of Object.entries(EQUIPMENT_SLOTS)) {
      const name = equippedName(pc, slot);
      const options = items.filter(([, item]) => Number(item.qty ?? 1) > 0 && fitsEquipment(slot, item, reference));
      const selected = options.find(([, item]) => item.name === name)?.[0];
      html += `<label class="sheet-equipment">${esc(label)}<select data-equipment-slot="${slot}" data-current-key="${esc(selected ?? '')}"><option value="">Unequip</option>${name && selected === undefined ? `<option value="" selected disabled>${esc(name)}</option>` : ''}${options.map(([key, item]) => `<option value="${esc(key)}"${key === selected ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label>`;
      if (name && lookup(name).desc) html += card(name, lookup(name).desc);
    }
    html += heading('Bag');
    html += `<div data-bag>${items.map(([key, item]) => `<div data-bag-key="${esc(key)}" tabindex="0" aria-label="${esc(item.name)} bag actions"><button type="button" data-bag-menu aria-label="${esc(item.name)} actions">⋯</button>${card(`${item.name} ×${item.qty ?? 1}${itemEquipped(pc, item, reference) ? ' (equipped)' : ''}`, item.desc || lookup(item.name).desc,
      [item.category, item.notes].filter(Boolean).join(' · '))}</div>`).join('') || '<p>Bag is empty.</p>'}</div>`;
    if (pc.coin_purse) html += row('Coins', ['pp', 'gp', 'ep', 'sp', 'cp'].map(key => `${pc.coin_purse[key] ?? 0} ${key}`).join(' · '));
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
  if (section === 'Spells') {
    let html = row('Ability', casting.ability) + row('Save DC', casting.spell_save_dc) + row('Attack bonus', casting.spell_attack_bonus);
    const spells = list(casting.spells).filter(spell => spell?.name);
    for (const [label, cantrip] of [['Cantrips', true], ['Spells', false]]) {
      html += heading(label);
      html += spells.filter(spell => (spell.level === 0 || spell.prepared_type === 'cantrip') === cantrip).map(spell => {
        const data = lookup(spell.name);
        const meta = [cantrip ? 'Cantrip' : `Level ${spell.level ?? data.level ?? 1}`, spell.prepared_type,
          data.casting_time, data.range, data.duration].filter(Boolean).join(' · ');
        return card(spell.name, spell.desc || spell.description || data.desc || spell.notes, meta) + (spell.beginner_tip ? card('Tip', spell.beginner_tip) : '');
      }).join('') || '<p>None recorded.</p>';
    }
    return html;
  }
  return '';
}
