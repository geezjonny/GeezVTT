export const SHEET_SECTIONS = ['Stats', 'Inventory', 'Feats', 'Spells'];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const list = value => Object.values(value && typeof value === 'object' ? value : {});
const text = value => Array.isArray(value) ? value.join('\n\n') : value;
const heading = label => `<h3>${esc(label)}</h3>`;
const row = (label, value) => `<div class="sheet-row"><span>${esc(label)}</span><strong>${esc(value ?? '—')}</strong></div>`;
const card = (name, description, meta = '') => `<article><strong>${esc(name)}</strong>${meta ? `<small>${esc(meta)}</small>` : ''}${description ? `<p>${esc(text(description))}</p>` : ''}</article>`;
let referencePromise;
export function loadSheetReference() {
  return referencePromise ||= Promise.all(['spells', 'equipment', 'magic_items'].map(async name => {
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
    return html + (slots || '<p>No spell slots.</p>');
  }
  if (section === 'Inventory') {
    const equipped = pc.equipped || {};
    let html = heading('Equipment');
    for (const [key, label] of [['helmet', 'Helmet'], ['armor', 'Armor'], ['shield', 'Shield'], ['main_hand', 'Weapon']]) {
      const name = equipped[key] === true ? label : equipped[key] || (key === 'main_hand' ? equipped.weapon : '');
      html += row(label, name || '—');
      if (name && lookup(name).desc) html += card(name, lookup(name).desc);
    }
    html += heading('Bag');
    const items = list(pc.inventory).filter(item => item && typeof item.name === 'string');
    html += items.map(item => card(`${item.name} ×${item.qty ?? 1}`, item.desc || lookup(item.name).desc,
      [item.category, item.notes].filter(Boolean).join(' · '))).join('') || '<p>Bag is empty.</p>';
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
