import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mix, personColors, rgba } from '../js/horde-colors.js';

test('each character has their own colour: Liora green, Lark pink, Ashara orange, Seris purple, Rurik cyan', () => {
  const hue = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min || 1; return (max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60; };
  const magic = name => personColors(name, 'striker').magic;
  assert.ok(hue(magic('Liora')) > 100 && hue(magic('Liora')) < 150, 'green');
  assert.ok(hue(magic('Lark')) > 320 && hue(magic('Lark')) < 345, 'pink');
  assert.ok(hue(magic('Ashara')) > 20 && hue(magic('Ashara')) < 40, 'orange');
  assert.ok(hue(magic('Seris')) > 260 && hue(magic('Seris')) < 290, 'purple');
  assert.ok(hue(magic('Rurik')) > 175 && hue(magic('Rurik')) < 200, 'cyan');
  assert.equal(new Set(['Liora', 'Lark', 'Ashara', 'Seris', 'Rurik'].map(magic)).size, 5, 'all different');
});

test('names are matched by letters only, and unknown characters fall back to their role colour', () => {
  assert.equal(personColors(' Ser-is ', 'healer').magic, personColors('Seris', 'healer').magic);
  assert.equal(personColors('Guest', 'cutter').magic, personColors('Lark', 'cutter').magic, 'a guest bard is pink like the cutter role');
  assert.equal(personColors('Guest', 'tank').magic, personColors('Seris', 'tank').magic, 'a guest tank is purple');
  assert.ok(personColors('Guest', 'nonsense').magic, 'never undefined');
});

test('colour helpers blend and convert', () => {
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mix('#ff0000', '#ff0000', 0.7), '#ff0000');
  assert.equal(rgba('#ff8000', 0.5), 'rgba(255,128,0,0.5)');
});
