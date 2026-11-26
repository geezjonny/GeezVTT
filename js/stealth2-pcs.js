// Read-only access to our PCs. The sheet maths is the character sheet's own, so the numbers match what players see there.
import { decodeTree } from './firebase-codec.js';
import { sheetRolls } from './sheet-rolls.js';
import { loadSheetReference } from './sheet-view.js';
import { characterVision } from './vision-model.js';

const DEFAULT_COLOR = '#8f87e6';
export const SOCIAL_SKILLS = ['performance', 'deception', 'persuasion', 'intimidation'];

// -> sorted [{ id, name, campaign, color, darkvision (feet), passive, stealth, perception }]
// stealth and perception are { bonus, disadvantage, detail }, or null without the skill reference.
export function stealthPCs(entities, reference = {}) {
  const pcs = [];
  for (const [id, entity] of Object.entries(entities || {})) {
    try {
      const data = entity?.data, name = typeof entity?.name === 'string' ? entity.name.trim() : '';
      if (entity?.kind !== 'pc' || !data || data._sheetsDeleted || !name || !/^[^.#$\[\]\/\s]{1,200}$/.test(id)) continue;
      const campaign = String(entity.campaign ?? data.campaign ?? '').toLowerCase().replace(/^world__/, '');
      if (!campaign) continue;
      const vision = characterVision(data), perception = skillOf(data, reference, 'perception');
      const stored = Number.parseInt(data.senses?.passive_perception, 10);
      pcs.push({ id, name, campaign,
        color: /^#[0-9a-f]{6}$/i.test(data.token_color) ? data.token_color : DEFAULT_COLOR,
        darkvision: Math.max(vision.darkvision, vision.blindsight, vision.truesight),
        passive: Number.isFinite(stored) ? stored : 10 + (perception?.bonus ?? 0),
        stealth: skillOf(data, reference, 'stealth'), perception,
        social: Object.fromEntries(SOCIAL_SKILLS.map(skill => [skill, skillOf(data, reference, skill)])),
        weapons: weaponsOf(data, reference) });
    } catch (error) { console.warn(`Skipped PC ${id}: ${error.message}`); }
  }
  return pcs.sort((a, b) => a.name.localeCompare(b.name));
}

// Attacks that roll to hit, with how far they reach (feet). Ranges come from the sheet's notes, else the rulebook entry.
export function weaponsOf(data, reference = {}) {
  let rows = [];
  try { rows = sheetRolls(data, reference).Weapons; } catch { /* A malformed attack list means no weapons. */ }
  const weapons = new Map();
  for (const roll of rows) {
    if (!roll.key.startsWith('attack:') || !Number.isFinite(roll.bonus)) continue; // saving-throw spells have no to-hit
    const key = roll.key.slice(7), attack = data.attacks[key], name = String(attack.name);
    const entry = reference[name.toLowerCase()] || reference[name.toLowerCase().replace(/\(.*?\)/g, '').replace(/\s+cantrip\s*$/, '').trim()] || {};
    const text = `${attack.range || ''} ${attack.notes || ''}`;
    const written = text.match(/(range|thrown)\D{0,3}(\d+)\s*\/\s*(\d+)/i);
    const spell = entry.attack_type === 'ranged' || /ranged spell attack/i.test(text);
    let normal = 0, long = 0;
    if (written) { normal = Number(written[2]); long = Number(written[3]); }
    else if (spell) normal = long = Number.parseInt(entry.range, 10) || 60;
    else if (entry.weapon_range === 'Ranged' || entry.throw_range) {
      const range = entry.throw_range || entry.range;
      normal = Number(range?.normal) || 0; long = Number(range?.long) || normal;
    }
    const rangedOnly = spell || entry.weapon_range === 'Ranged' || written?.[1].toLowerCase() === 'range';
    const damage = rows.find(row => row.key === `damage:${key}`)?.expression || '';
    if (!weapons.has(name)) weapons.set(name, { name, bonus: roll.bonus, disadvantage: !!roll.disadvantage, damage, melee: !rangedOnly, normal, long });
  }
  const list = [...weapons.values()];
  if (!list.some(weapon => weapon.melee)) {
    const strength = Math.floor(((Number(data.stats?.str) || 10) - 10) / 2), proficiency = Number(data.combat?.proficiency_bonus ?? data.proficiency_bonus) || 2;
    list.push({ name: 'Unarmed strike', bonus: strength + proficiency, disadvantage: false, damage: String(Math.max(0, 1 + strength)), melee: true, normal: 0, long: 0 });
  }
  return list;
}
// The best weapon for a job: highest to-hit, then longest reach.
export const bestWeapon = (weapons, kind) => (weapons || []).filter(w => kind === 'melee' ? w.melee : w.long > 0)
  .sort((a, b) => b.bonus - a.bonus || (kind === 'melee' ? averageDamage(b) - averageDamage(a) : b.long - a.long))[0] || null;
const averageDamage = weapon => [...String(weapon.damage).matchAll(/([+-]?)\s*(\d*)d(\d+)|([+-]?)\s*(\d+)/g)]
  .reduce((sum, m) => sum + (m[3] ? Number(m[2] || 1) * (Number(m[3]) + 1) / 2 : Number(m[5])) * ((m[1] || m[4]) === '-' ? -1 : 1), 0);

function skillOf(data, reference, skill) {
  try {
    const roll = sheetRolls(data, reference)['Skill Checks'].find(check => check.key === `skill:${skill}`);
    return Number.isFinite(roll?.bonus) ? { bonus: roll.bonus, disadvantage: !!roll.disadvantage, detail: roll.detail || '' } : null;
  } catch { return null; }
}

export async function loadStealthPCs() {
  const base = window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, '');
  const [entities, reference] = await Promise.all([
    fetch(`${base}/v2/worlds/gaia/entities.json`, { signal: AbortSignal.timeout(15000) }).then(response => {
      if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
      return response.json();
    }),
    loadSheetReference().catch(() => ({})) // without it PCs still load; only the skill bonuses are missing
  ]);
  return stealthPCs(decodeTree(entities), reference);
}
