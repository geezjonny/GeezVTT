import { equippedModifiers } from './equipment-modifiers.js';
export const ABILITIES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const sign = value => value >= 0 ? `+${value}` : String(value);
const number = (value, fallback) => value == null || value === '' ? fallback : Number(value);

export function sheetRolls(pc, reference = {}) {
  const bonuses = equippedModifiers(pc, reference);
  const score = ability => number(pc.stats?.[ability], 10) + (bonuses.stats[ability] || 0);
  const baseMod = ability => Math.floor((number(pc.stats?.[ability], 10) - 10) / 2);
  const mod = ability => Math.floor((score(ability) - 10) / 2);
  const delta = ability => mod(ability) - baseMod(ability);
  const proficiency = number(pc.combat?.proficiency_bonus, 2 + Math.floor((number(pc.level, 1) - 1) / 4));
  const check = (key, label, bonus, detail = '') => ({ key, label, bonus, detail, expression: `1d20${sign(bonus)}` });
  const proficientSaves = Object.values(pc.saves?.proficient || {});
  return {
    'Ability Checks': Object.entries(ABILITIES).map(([key, label]) => check(`ability:${key}`, label, mod(key), `Score ${score(key)}`)),
    'Saving Throws': Object.entries(ABILITIES).map(([key, label]) => check(`save:${key}`, `${label} save`,
      number(pc.saves?.[key]?.bonus, baseMod(key) + (proficientSaves.includes(key) ? proficiency : 0)) + delta(key))),
    'Skill Checks': Object.values(reference).filter(item => item.ability_score && item.url?.includes('/skills/')).map(skill => {
      const key = skill.index.replace(/-/g, '_'), data = pc.skills?.[key] || {};
      const ability = skill.ability_score.index;
      const bonus = number(data.bonus, baseMod(ability) + (data.expertise ? 2 : data.proficient ? 1 : 0) * proficiency)
        + delta(ability) + (bonuses.skills[key] || 0);
      return check(`skill:${key}`, `${skill.name}${data.expertise ? ' (expertise)' : data.proficient ? ' (proficient)' : ''}`, bonus);
    }),
    Initiative: [check('initiative', 'Initiative', number(pc.combat?.initiative_bonus, baseMod('dex')) + delta('dex'))],
    Weapons: Object.entries(pc.attacks || {}).flatMap(([key, attack]) => {
      if (!attack?.name) return [];
      const weapon = reference[attack.name.toLowerCase()] || {};
      const finesse = Object.values(weapon.properties || {}).some(property => property?.index === 'finesse');
      const ability = Object.hasOwn(ABILITIES, attack.ability) ? attack.ability : weapon.weapon_category ? (weapon.weapon_range === 'Ranged' ? 'dex' : 'str') : null;
      // shortcut: custom attacks need an ability or SRD weapon match to adjust stored attack bonuses.
      const adjustment = finesse ? Math.max(mod('str'), mod('dex')) - Math.max(baseMod('str'), baseMod('dex')) : ability ? delta(ability) : 0;
      const bonus = number(attack.to_hit ?? attack.attack_bonus, NaN) + adjustment;
      const damage = String(attack.damage || attack.damage_dice || '').replace(/([+-])\s*(\d+)(?=\s*(?:[a-z]+(?:\s+damage)?)?$)/i,
        (term, sign, value) => adjustment ? (Number(`${sign}${value}`) + adjustment >= 0 ? '+' : '') + (Number(`${sign}${value}`) + adjustment) : term);
      return [
        { ...check(`attack:${key}`, `${attack.name} attack`, bonus), detail: 'To hit' },
        { key: `damage:${key}`, label: `${attack.name} damage`, expression: damage, detail: attack.damage_type || '' }
      ];
    })
  };
}

export function changeSpellSlot(pc, level, pip) {
  const max = Number(pc.spellcasting?.slots?.[level]);
  if (!Number.isInteger(level) || level < 1 || level > 9 || !Number.isSafeInteger(max) || max < 1 || max > 100 ||
      !Number.isInteger(pip) || pip < 0 || pip >= max) throw new Error('Spell slot unavailable.');
  const used = Number(pc.spellcasting.slots_used?.[level] ?? 0);
  if (!Number.isSafeInteger(used) || used < 0 || used > max) throw new Error('Invalid used spell slot count.');
  pc.spellcasting.slots_used = { ...pc.spellcasting.slots_used, [level]: used + (pip < used ? -1 : 1) };
}
