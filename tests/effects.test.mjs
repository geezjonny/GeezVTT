import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BARK_ARM, changeEffects, applyModifiers } from '../js/effects-model.js';
import { characterStats } from '../js/equipment-modifiers.js';
import { sheetRolls } from '../js/sheet-rolls.js';
import { sheetHTML } from '../js/sheet-view.js';
import { npcCatalog, importedTokens } from '../js/token-model.js';
import { changeCombat } from '../js/sheet-combat.js';
import { encodeTree, decodeTree } from '../js/firebase-codec.js';
import { startTurn, remainingMovement } from '../js/initiative-model.js';

const reference = {
  'leather armor': { armor_class: { base: 11, dex_bonus: true } },
  'half plate': { armor_class: { base: 15, dex_bonus: true, max_bonus: 2 } },
  'plate': { armor_class: { base: 18, dex_bonus: false } },
  acrobatics: { index: 'acrobatics', name: 'Acrobatics', url: '/api/2014/skills/acrobatics', ability_score: { index: 'dex' } },
  longsword: { weapon_category: 'Martial', weapon_range: 'Melee' }
};
const lark = () => ({ name: 'Lark', level: 5, stats: { str: 10, con: 12, dex: 14, int: 12, wis: 12, cha: 18 },
  combat: { ac: 14, speed: 35, hp_current: 25, hp_max: 33, initiative_bonus: 2 },
  saves: { dex: { bonus: 5 }, con: { bonus: 1 } }, skills: { acrobatics: { bonus: 5 } },
  attacks: [{ name: 'Longsword', to_hit: '+3', damage: '1d8' }],
  spellcasting: { ability: 'cha', spell_attack_bonus: 7, spell_save_dc: 15 },
  equipped: { armor: 'Leather Armor' }, inventory: { leather: { name: 'Leather Armor', category: 'Armor', qty: 1 } }
});
function activate(pc, id = 'effects:bark') {
  changeEffects(pc, { type: 'save', id, value: structuredClone(BARK_ARM) });
  changeEffects(pc, { type: 'activate', id });
}

test('Bark Arm computes every final score and dependent roll without rewriting base stats', () => {
  const pc = lark(), original = structuredClone(pc);
  activate(pc);
  const final = characterStats(pc, reference);
  assert.deepEqual(final.stats, { str: 12, con: 14, dex: 7, int: 12, wis: 12, cha: 18 });
  assert.equal(final.ac, 16); assert.equal(final.speed, 17); assert.equal(final.hpMax, 38);
  assert.deepEqual(pc.stats, original.stats); assert.deepEqual(pc.combat, original.combat);
  const rolls = sheetRolls(pc, reference);
  assert.equal(rolls['Ability Checks'][0].bonus, 1);
  assert.equal(rolls['Ability Checks'][1].bonus, -2);
  assert.equal(rolls['Saving Throws'][1].bonus, 1);
  assert.equal(rolls['Saving Throws'][2].bonus, 2);
  assert.equal(rolls['Skill Checks'][0].bonus, 1);
  assert.equal(rolls.Initiative[0].bonus, -2);
  assert.equal(rolls.Weapons[0].expression, '1d20+4');
  assert.equal(rolls.Weapons[1].expression, '1d8+1');
  assert.equal(final.spellAttack, 7); assert.equal(final.spellDC, 15);
  const [token] = npcCatalog({ lark: { kind: 'pc', name: 'Lark', data: pc } }, null, reference);
  assert.equal(token.ac, 16); assert.equal(token.speed, 17); assert.equal(token.hpMax, 38);
});

test('sheet.html and right-click Stats render the same final values, separate from editable bases', () => {
  const pc = lark(); activate(pc);
  for (const [editable, gm] of [[false, false], [true, false], [true, true]]) {
    const html = sheetHTML(pc, 'Stats', reference, true, editable, gm);
    for (const [label, value] of [['STR', 12], ['DEX', 7], ['CON', 14], ['INT', 12], ['WIS', 12], ['CHA', 18], ['SPD (ft)', 17]]) {
      assert.ok(html.includes(`${label}</span><strong>${value}</strong>`), label);
    }
    assert.match(html, /AC(?: total)?<\/span><strong>16/);
    assert.match(html, /Bark Arm/);
    if (editable && gm) assert.match(html, /data-base-stat="dex"[^>]*value="14"/);
    else assert.doesNotMatch(html, /data-base-stat/);
    if (editable && gm) {
      assert.match(html, /Maximum HP total<\/span><strong>38/);
      assert.match(html, /data-combat-field="speed"[^>]*value="35"/);
    } else if (editable) {
      assert.match(html, /value="25"> \/ 38/);
      assert.doesNotMatch(html, /data-combat-field="(?:speed|ac|hp_max)"|data-ac-mode/);
    } else assert.match(html, /25 \/ 38/);
  }
  assert.match(sheetHTML(pc, 'Effects', reference, false, true, true), /1\/2 uses/);
  assert.match(sheetHTML(pc, 'Effects', reference, false, true, true), /60 min left/);
});

test('uses, non-stacking, game-time expiration, and recharge survive a Firebase round trip', () => {
  let pc = lark(); activate(pc);
  assert.throws(() => changeEffects(pc, { type: 'activate', id: 'effects:bark' }), /already active/);
  pc = decodeTree(JSON.parse(JSON.stringify(encodeTree(pc))));
  assert.equal(characterStats(pc).speed, 17);
  changeEffects(pc, { type: 'advance', minutes: 59 });
  assert.equal(pc.activeEffects['effects:bark'].remainingMinutes, 1);
  changeEffects(pc, { type: 'advance', minutes: 1 });
  assert.equal(characterStats(pc).speed, 35);
  changeEffects(pc, { type: 'activate', id: 'effects:bark' });
  changeEffects(pc, { type: 'end', id: 'effects:bark' });
  assert.throws(() => changeEffects(pc, { type: 'activate', id: 'effects:bark' }), /No uses/);
  changeEffects(pc, { type: 'reset', recharge: 'long_rest' });
  assert.equal(pc.effects.bark.current, 0);
  changeEffects(pc, { type: 'reset', recharge: 'daily' });
  assert.equal(pc.effects.bark.current, 2);
});

test('armor formulas use final DEX, apply caps, and retain stored AC unless explicitly selected', () => {
  const pc = lark(); activate(pc);
  changeCombat(pc, { type: 'ac-mode', value: 'armor' });
  assert.equal(characterStats(pc, reference).ac, 11);
  pc.equipped.armor = 'Half Plate'; pc.inventory.half = { name: 'Half Plate', qty: 1 };
  assert.equal(characterStats(pc, reference).ac, 15);
  pc.equipped.armor = 'Plate'; pc.inventory.plate = { name: 'Plate', qty: 1 };
  assert.equal(characterStats(pc, reference).ac, 20);
  delete pc.equipped.armor;
  assert.equal(characterStats(pc, reference).ac, 10);
  pc.equipped.armor = 'Custom'; pc.inventory.custom = { name: 'Custom', qty: 1, armor_class: { base: 13, dex_bonus: true, max_bonus: 2 } };
  assert.equal(characterStats(pc).ac, 13);
});

test('equipped effects apply once; consumables spend one item atomically and indefinite effects persist', () => {
  let pc = lark();
  pc.inventory.potion = { name: 'Potion', qty: 2, category: 'Consumable' };
  const effect = { ...BARK_ARM, label: 'Potion', max: 0, duration_minutes: 0, inventoryKey: 'potion', consume: true };
  changeEffects(pc, { type: 'save', id: 'effects:potion', value: effect });
  changeEffects(pc, { type: 'activate', id: 'effects:potion' });
  assert.equal(pc.inventory.potion.qty, 1);
  pc = decodeTree(JSON.parse(JSON.stringify(encodeTree(pc))));
  changeEffects(pc, { type: 'advance', minutes: 120 });
  assert.equal(characterStats(pc).speed, 17);
  changeEffects(pc, { type: 'end', id: 'effects:potion' });
  changeEffects(pc, { type: 'save', id: 'effects:armor', value: { ...BARK_ARM, mode: 'equipped', max: 0, inventoryKey: 'leather' } });
  assert.equal(characterStats(pc).speed, 17);
  delete pc.equipped.armor;
  assert.equal(characterStats(pc).speed, 35);
});

test('base-score edits recalculate stored rolls and spell math, including while effects are active', () => {
  const pc = lark(); activate(pc);
  changeCombat(pc, { type: 'base-stat', field: 'str', value: 14 });
  changeCombat(pc, { type: 'base-stat', field: 'dex', value: 18 });
  changeCombat(pc, { type: 'base-stat', field: 'cha', value: 20 });
  assert.equal(characterStats(pc).stats.str, 16);
  assert.equal(sheetRolls(pc, reference).Weapons[0].bonus, 6);
  assert.equal(sheetRolls(pc, reference)['Saving Throws'][1].bonus, 2);
  assert.equal(characterStats(pc).spellAttack, 8);
  assert.equal(characterStats(pc).spellDC, 16);
});

test('effects reject malformed input and combine set/add/multiply in a predictable order', () => {
  const pc = lark();
  for (const patch of [{ label: '' }, { max: -1 }, { duration_minutes: NaN }, { modifiers: [{ target: '__proto__', operation: 'add', value: 1 }] },
    { modifiers: [{ target: 'str', operation: 'multiply', value: -1 }] }, { inventoryKey: 'missing', consume: true }]) {
    assert.throws(() => changeEffects(pc, { type: 'save', id: 'effects:bad', value: { ...BARK_ARM, ...patch } }));
  }
  assert.throws(() => changeEffects(pc, { type: 'save', id: 'effects:__proto__', value: BARK_ARM }));
  assert.equal(applyModifiers(10, 'str', [{ target: 'str', operation: 'multiply', value: .5 }, { target: 'str', operation: 'add', value: 2 }, { target: 'str', operation: 'set', value: 20 }]), 11);
});

test('first-turn speed bonuses are halved along with speed and spent movement is preserved', () => {
  const pc = lark(); pc.abilities = { dread_ambusher: { label: 'Dread Ambusher' } }; activate(pc);
  const [token] = npcCatalog({ hero: { kind: 'pc', name: 'Hero', data: pc } }); token.id = 'hero';
  const [imported] = importedTokens([{ ...token, x: 2.5, y: 2.5 }], 20, 20);
  assert.equal(imported.turnFeatures.firstTurnSpeedBonus, 5);
  const map = { initiative: { entries: [{ id: token.id, score: 20 }], currentId: null } };
  startTurn(map.initiative, token.id);
  map.initiative.turn.movementSpent = 10;
  assert.equal(remainingMovement(map, token), 12);
});


test('set effects retain equipment additions before multipliers, with no double counting', () => {
  const pc = lark();
  pc.inventory.leather.modifiers = { ac: 1, stats: { str: 2 }, skills: { acrobatics: 2 } };
  changeEffects(pc, { type: 'save', id: 'effects:set', value: { ...BARK_ARM, mode: 'passive', modifiers: [
    { target: 'str', operation: 'set', value: 18 }, { target: 'str', operation: 'multiply', value: .5 },
    { target: 'ac', operation: 'set', value: 16 }
  ] } });
  const final = characterStats(pc, reference);
  assert.equal(final.stats.str, 10);
  assert.equal(final.ac, 17);
  assert.equal(sheetRolls(pc, reference)['Skill Checks'][0].bonus, 7);
});


test('consumption preserves equipped items and depleted uses leave inventory unchanged', () => {
  const pc = lark();
  changeEffects(pc, { type: 'save', id: 'effects:consume', value: { ...BARK_ARM, consume: true, inventoryKey: 'leather' } });
  assert.throws(() => changeEffects(pc, { type: 'activate', id: 'effects:consume' }), /Unequip/);
  assert.equal(pc.effects.consume.current, 2);
  assert.equal(pc.inventory.leather.qty, 1);
  delete pc.equipped.armor;
  pc.effects.consume.current = 0;
  assert.throws(() => changeEffects(pc, { type: 'activate', id: 'effects:consume' }), /No uses/);
  assert.equal(pc.inventory.leather.qty, 1);
  assert.equal(pc.activeEffects, undefined);
});
