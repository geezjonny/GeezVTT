import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetHTML, SHEET_SECTIONS } from '../js/sheet-view.js';

test('Stats reads sheet combat values and renders used and remaining spell pips', () => {
  const html = sheetHTML({ combat: { hp_current: 0, hp_max: 20, ac: 16, exhaustion: 2 }, spellcasting: { slots: { 1: 3 }, slots_used: { 1: 1 } } }, 'Stats');
  assert.match(html, /0 \/ 20/);
  assert.match(html, /AC<\/span><strong>16/);
  assert.match(html, /Exhaustion<\/span><strong>2/);
  assert.match(html, /2 of 3 spell slots remaining/);
  assert.equal((html.match(/class="sheet-pip used"/g) || []).length, 1);
  assert.equal((html.match(/class="sheet-pip"/g) || []).length, 2);
  assert.doesNotMatch(sheetHTML({ spellcasting: { slots: { 1: Infinity } } }, 'Stats'), /class="sheet-pip/);
});

test('Inventory supports equipped slots, keyed bags, zero quantity and reference descriptions', () => {
  const html = sheetHTML({ equipped: { armor: 'Chain Mail', shield: true, weapon: 'Sword' }, inventory: { a: { name: 'Torch', qty: 0, notes: '<img src=x>' }, b: null } }, 'Inventory', { torch: { desc: ['Burns for an hour.'] } });
  for (const expected of ['Equipment', 'Bag', 'Chain Mail', 'Shield', 'Sword', 'Torch ×0', 'Burns for an hour.', '&lt;img src=x&gt;']) assert.ok(html.includes(expected));
  assert.ok(!html.includes('<img'));
});

test('Feats includes sheet abilities, charges, origin feat and feature notes', () => {
  const html = sheetHTML({ abilities: { a: { label: 'Second Wind', kind: 'charge', max: 2, current: 0, effect_desc: 'Heal.' } }, origin_feat: 'Alert', text_blocks: { features_traits: 'Dwarf traits' } }, 'Feats');
  for (const expected of ['Second Wind', '0/2 charges', 'Heal.', 'Alert', 'Dwarf traits']) assert.ok(html.includes(expected));
});

test('Spells supports sparse Firebase lists and escapes reference text', () => {
  const html = sheetHTML({ spellcasting: { spell_save_dc: 15, spells: { a: { name: 'Light', level: 0 }, b: null, c: { name: 'Bless', level: 1, beginner_tip: 'Help allies.' } } } }, 'Spells', { bless: { desc: ['<script>bad()</script>'], range: '30 feet' } });
  for (const expected of ['15', 'Cantrip', 'Light', 'Bless', '30 feet', 'Help allies.', '&lt;script&gt;']) assert.ok(html.includes(expected));
  assert.ok(!html.includes('<script>'));
  for (const section of SHEET_SECTIONS) assert.ok(sheetHTML({}, section));
});
