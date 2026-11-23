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
