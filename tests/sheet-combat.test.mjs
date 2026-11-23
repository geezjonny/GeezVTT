import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conditionNames, changeCombat } from '../js/sheet-combat.js';
import { sheetHTML } from '../js/sheet-view.js';

test('conditions exclude Firebase empty-list metadata and retain named conditions', () => {
  assert.deepEqual(conditionNames({ '%EMPTY': 'array' }), []);
  assert.deepEqual(conditionNames({ 0: 'Poisoned', 3: 'Prone', '%EMPTY': 'array' }), ['Poisoned', 'Prone']);
  assert.deepEqual(conditionNames(['Poisoned', null, 'Poisoned']), ['Poisoned']);
  assert.deepEqual(conditionNames({ poisoned: true, prone: false }), ['poisoned']);
  const html = sheetHTML({ combat: { conditions: { '%EMPTY': 'array' } } }, 'Stats');
  assert.match(html, /Conditions<\/span><strong>None/);
  assert.doesNotMatch(html, />array</);
});

test('editable stats show combat controls while read-only stats hide them', () => {
  const pc = { combat: { hp_current: 12, hp_max: 20, temp_hp: 3, ac: 16, exhaustion: 0, conditions: ['Poisoned', '<Custom>'] } };
  const html = sheetHTML(pc, 'Stats', {}, true, true);
  for (const field of ['hp_current', 'temp_hp', 'exhaustion']) assert.ok(html.includes(`data-combat-field="${field}"`));
  assert.match(html, /value="12"> \/ 20/);
  assert.match(html, /AC total<\/span><strong>16/);
  assert.doesNotMatch(html, /data-combat-field="(?:ac|speed|hp_max)"|data-ac-mode|Maximum HP/);
  const gmHTML = sheetHTML(pc, 'Stats', {}, true, true, true);
  for (const field of ['ac', 'speed', 'hp_max']) assert.ok(gmHTML.includes(`data-combat-field="${field}"`));
  assert.match(gmHTML, /data-ac-mode/);
  assert.match(html, /Decrease exhaustion" disabled/);
  assert.match(html, /data-condition-toggle/);
  assert.match(html, /value="Poisoned" data-enabled="false">Remove Poisoned/);
  assert.match(html, /value="Prone" data-enabled="true">Add Prone/);
  assert.match(html, /Remove &lt;Custom&gt;/);
  assert.doesNotMatch(sheetHTML(pc, 'Stats', {}, true), /data-combat-field|data-condition-toggle|data-exhaustion-delta/);
  pc.combat.exhaustion = 6;
  assert.match(sheetHTML(pc, 'Stats', {}, true, true), /Increase exhaustion" disabled/);
});

test('manual combat changes preserve unrelated sheet values and validate field boundaries', () => {
  const pc = { combat: { hp_current: 10, hp_max: 20, conditions: ['Prone'] }, spellcasting: { slots: { 1: 2 } } };
  for (const [field, value] of Object.entries({ hp_current: 0, hp_max: 25, temp_hp: 4, ac: 18, exhaustion: 2 })) changeCombat(pc, { type: 'set', field, value });
  assert.deepEqual(pc.combat, { hp_current: 0, hp_max: 25, temp_hp: 4, ac: 18, exhaustion: 2, conditions: ['Prone'] });
  assert.equal(pc.spellcasting.slots[1], 2);
  for (const [field, value] of [['hp_current', -1], ['hp_max', 0], ['temp_hp', 1.5], ['ac', 1000], ['exhaustion', 7], ['hp_current', NaN], ['hp_current', '10'], ['__proto__', 1], ['unknown', 1]]) {
    assert.throws(() => changeCombat(pc, { type: 'set', field, value }));
  }
  changeCombat(pc, { type: 'exhaustion', delta: -1 });
  assert.equal(pc.combat.exhaustion, 1);
  changeCombat(pc, { type: 'exhaustion', delta: 1 });
  assert.equal(pc.combat.exhaustion, 2);
  assert.throws(() => changeCombat(pc, { type: 'exhaustion', delta: 2 }));
  assert.throws(() => changeCombat({ combat: { exhaustion: 0 } }, { type: 'exhaustion', delta: -1 }));
});

test('condition additions and removals preserve other conditions and return a plain empty list', () => {
  const pc = { combat: { conditions: { '%EMPTY': 'array' }, hp_current: 10 } };
  changeCombat(pc, { type: 'condition', name: 'Poisoned', enabled: true });
  changeCombat(pc, { type: 'condition', name: 'Prone', enabled: true });
  changeCombat(pc, { type: 'condition', name: 'Poisoned', enabled: true });
  assert.deepEqual(conditionNames(pc.combat.conditions).sort(), ['Poisoned', 'Prone']);
  changeCombat(pc, { type: 'condition', name: 'Poisoned', enabled: false });
  assert.deepEqual(pc.combat.conditions, ['Prone']);
  changeCombat(pc, { type: 'condition', name: 'Prone', enabled: false });
  assert.deepEqual(pc.combat.conditions, []);
  assert.equal(pc.combat.hp_current, 10);
  assert.throws(() => changeCombat(pc, { type: 'condition', name: 'Unknown', enabled: true }));
  assert.throws(() => changeCombat(pc, { type: 'condition', name: 'Prone', enabled: 'true' }));
});
