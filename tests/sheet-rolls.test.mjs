import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetRolls, changeSpellSlot } from '../js/sheet-rolls.js';
import { sheetHTML } from '../js/sheet-view.js';
import { buildExpressionRoll } from '../js/dice-roll.js';

const reference = { acrobatics: { index: 'acrobatics', name: 'Acrobatics', url: '/api/2014/skills/acrobatics', ability_score: { index: 'dex' } } };

test('checks, expertise, saves and initiative use sheet totals without double adding proficiency', () => {
  const pc = { stats: { dex: 14, str: 9 }, combat: { proficiency_bonus: 2, initiative_bonus: 5 },
    skills: { acrobatics: { proficient: true } }, saves: { proficient: { 0: 'dex' } } };
  let rolls = sheetRolls(pc, reference);
  assert.equal(rolls['Ability Checks'].length, 6);
  assert.equal(rolls['Saving Throws'].length, 6);
  assert.equal(rolls['Ability Checks'][0].expression, '1d20-1');
  assert.equal(rolls['Skill Checks'][0].expression, '1d20+4');
  assert.equal(rolls['Saving Throws'][1].expression, '1d20+4');
  assert.equal(rolls.Initiative[0].expression, '1d20+5');
  pc.skills.acrobatics = { expertise: true };
  assert.equal(sheetRolls(pc, reference)['Skill Checks'][0].bonus, 6);
  pc.skills.acrobatics.bonus = 0;
  assert.equal(sheetRolls(pc, reference)['Skill Checks'][0].bonus, 0);
  assert.equal(sheetRolls({ stats: { dex: 8 }, level: 5 }).Initiative[0].bonus, -1);
});

test('keyed weapon attacks use recorded attack and damage bonuses exactly once', () => {
  const pc = { stats: { dex: 18 }, combat: { proficiency_bonus: 3 }, attacks: { rapier: { name: 'Rapier', to_hit: '+7', damage: '1d8+4', damage_type: 'piercing' } } };
  const rolls = sheetRolls(pc).Weapons;
  assert.equal(rolls[0].expression, '1d20+7');
  assert.equal(rolls[1].expression, '1d8+4');
  assert.equal(buildExpressionRoll(rolls[0].expression, 'normal', () => 10).total, 17);
  assert.equal(buildExpressionRoll(rolls[1].expression, 'normal', () => 5).total, 9);
});

test('formula rolls support mixed damage dice, flat damage and advantage', () => {
  const roll = buildExpressionRoll('1d8 + 2d6 + 4 piercing', 'normal', sides => sides);
  assert.equal(roll.total, 24);
  assert.equal(roll.dice.length, 3);
  const values = [2, 18];
  assert.equal(buildExpressionRoll('d20+4', 'advantage', () => values.shift()).total, 22);
  assert.equal(buildExpressionRoll('1d20-2', 'normal', () => 1).total, -1);
  assert.equal(buildExpressionRoll('1').total, 1);
  for (const expression of ['', '1d20+NaN', '1d8 + sneak attack', '1d8;alert(1)', '13d6', '0d6', '1d7', '1d8-1d6', '1d6+1000', '6d100+1d100']) {
    assert.throws(() => buildExpressionRoll(expression));
  }
  assert.throws(() => buildExpressionRoll('1d8+1d6', 'advantage'));
});

test('Stats exposes roll actions, scores and accessible slot buttons; standalone keeps plain roll rows', () => {
  const pc = { stats: { dex: 14 }, spellcasting: { slots: { 1: 3 }, slots_used: { 1: 1 } } };
  const html = sheetHTML(pc, 'Stats', reference, true);
  for (const key of ['ability:str', 'ability:dex', 'ability:con', 'ability:int', 'ability:wis', 'ability:cha', 'save:dex', 'skill:acrobatics', 'initiative']) {
    assert.ok(html.includes(`data-sheet-roll="${key}"`));
  }
  assert.match(html, /Score 14/);
  assert.match(html, /aria-pressed="true" aria-label="Restore level 1 slot 1"/);
  assert.match(html, /aria-pressed="false" aria-label="Spend level 1 slot 2"/);
  assert.doesNotMatch(sheetHTML(pc, 'Stats', reference), /data-sheet-roll/);
  assert.match(sheetHTML({ attacks: [{ name: '<Rapier>', damage: '1d8' }] }, 'Weapons', {}, true), /data-sheet-roll="attack:0" disabled/);
  assert.match(sheetHTML({ attacks: [{ name: '<Rapier>', to_hit: 0 }] }, 'Weapons', {}, true), /&lt;Rapier&gt;/);
});

test('Stats groups ability checks, saves and skills into compact grids without losing rolls', () => {
  const skills = Object.fromEntries(Array.from({ length: 18 }, (_, index) => [`skill${index}`, {
    index: `skill${index}`, name: `Skill ${index}`, url: `/skills/skill${index}`, ability_score: { index: 'dex' }
  }]));
  const html = sheetHTML({ stats: { dex: 14 } }, 'Stats', skills, true);
  const grids = [...html.matchAll(/<div class="sheet-check-grid(?: sheet-skill-grid)?">([\s\S]*?)<\/div><\/div>/g)];
  assert.equal(grids.length, 3);
  for (const [index, count] of [6, 6, 18].entries()) {
    assert.equal((grids[index][1].match(/data-sheet-roll=/g) || []).length, count);
    assert.doesNotMatch(grids[index][1], /<small>/);
  }
  assert.match(html, /class="sheet-check-grid sheet-skill-grid"/);
  assert.match(html, /aria-label="Dexterity" title="Dexterity · Score 14 · 1d20\+2"><span>DEX<\/span>/);
  assert.match(html, /aria-label="Dexterity save"/);
});

test('Weapons shows one compact row per weapon with attack and damage dice in tooltips', () => {
  const pc = { attacks: { rapier: { name: '<Rapier>', to_hit: 7, damage: '1d8+4', damage_type: 'piercing' },
    bow: { name: 'Bow', to_hit: 5, damage: '1d6+3' } } };
  const html = sheetHTML(pc, 'Weapons', {}, true);
  assert.equal((html.match(/class="sheet-weapon"/g) || []).length, 2);
  assert.match(html, /<strong>&lt;Rapier&gt;<\/strong>/);
  assert.match(html, /data-sheet-roll="attack:rapier"[^>]*title="1d20\+7 · To hit">Attack<\/button>/);
  assert.match(html, /data-sheet-roll="damage:rapier"[^>]*title="1d8\+4 · piercing">Damage<\/button>/);
  assert.match(html, /data-sheet-roll="attack:bow"/);
  assert.match(html, /data-sheet-roll="damage:bow"/);
  assert.doesNotMatch(html, /<small>|<script>|sheet-roll/);
  const readOnly = sheetHTML(pc, 'Weapons');
  assert.doesNotMatch(readOnly, /data-sheet-roll/);
  assert.equal((readOnly.match(/ disabled/g) || []).length, 4);
});

test('Stealth marks equipped armor disadvantage without changing its numerical bonus', () => {
  const reference = {
    stealth: { index: 'stealth', name: 'Stealth', url: '/skills/stealth', ability_score: { index: 'dex' } },
    'chain mail': { stealth_disadvantage: true }
  };
  const pc = { stats: { dex: 14 }, equipped: { armor: 'Chain Mail' }, inventory: { armor: { name: 'Chain Mail', qty: 1 } } };
  const roll = () => sheetRolls(pc, reference)['Skill Checks'][0];
  assert.equal(roll().bonus, 2);
  assert.equal(roll().disadvantage, true);
  const html = sheetHTML(pc, 'Stats', reference, true);
  assert.match(html, /data-sheet-roll="skill:stealth"/);
  assert.match(html, /Disadvantage: Chain Mail/);
  assert.match(html, /<strong>\+2<\/strong><small aria-label="Disadvantage">dis<\/small>/);
  pc.inventory.armor.stealth_disadvantage = false;
  assert.equal(roll().disadvantage, false);
  delete pc.inventory.armor.stealth_disadvantage;
  pc.inventory.armor.qty = 0;
  assert.equal(roll().disadvantage, false);
  pc.inventory.armor.qty = 1;
  delete pc.equipped.armor;
  assert.equal(roll().disadvantage, false);
  assert.doesNotMatch(sheetHTML(pc, 'Stats', reference, true), /aria-label="Disadvantage"/);
});

test('slot clicks spend or restore one slot and preserve all other sheet data', () => {
  const pc = { spellcasting: { slots: { 1: 3, 2: 2 }, slots_used: { 1: 0, 2: 1 } }, combat: { hp_current: 10 } };
  changeSpellSlot(pc, 1, 2);
  assert.equal(pc.spellcasting.slots_used[1], 1);
  changeSpellSlot(pc, 1, 0);
  assert.equal(pc.spellcasting.slots_used[1], 0);
  for (const pip of [0, 1, 2]) changeSpellSlot(pc, 1, pip);
  assert.equal(pc.spellcasting.slots_used[1], 3);
  assert.equal(pc.spellcasting.slots_used[2], 1);
  assert.equal(pc.combat.hp_current, 10);
  for (const [level, pip] of [[0, 0], [3, 0], [1, -1], [1, 3], [1, 0.5]]) assert.throws(() => changeSpellSlot(pc, level, pip));
  pc.spellcasting.slots_used[1] = 0.5;
  assert.throws(() => changeSpellSlot(pc, 1, 0), /Invalid used/);
});
