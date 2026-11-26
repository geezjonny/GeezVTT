import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankMap, demoMap, normalizeMap, doorOpen, chestLocked, refreshGeo, moveCircle, lightLevel, lightAlpha, guardSees, sightThreat,
  hearingRange, canHear, perceptionScore, nearestUsable, canSnuff, snuffedValue, lightOn } from '../js/stealth-model.js';
import { L, setM, setL, bumpMap, SPEED, NOISE, P_RAD } from '../js/stealth-state.js';
import { stealthPCs } from '../js/stealth-pcs.js';

const live = () => ({ levers: {}, doors: {}, chests: {}, unlock: {}, lights: {}, tokens: {}, paused: false, spotted: null, edit: false });
function load(map) { setM(normalizeMap(map)); setL(live()); bumpMap(); refreshGeo(); }

test('a lever-linked gate and chest flip when all their levers are on', () => {
  const map = demoMap();
  load(map);
  const gate = map.doors.find(d => d.name === 'Iron gate'), chest = map.props.find(p => p.kind === 'chest' && p.locked);
  assert.equal(doorOpen(gate), false);
  assert.equal(chestLocked(chest), true);
  for (const lever of map.levers) L.levers[lever.id] = true;
  assert.equal(doorOpen(gate), true);
  assert.equal(chestLocked(chest), false);
});

test('walls stop movement, and block light', () => {
  const map = blankMap(10, 10);
  map.walls.push({ id: 'wall', a: [5, 0], b: [5, 10] });
  map.lights.push({ id: 'lamp', x: 3, y: 5, r: 6, color: '#ffffff', on: true });
  load(map);
  const token = { x: 4, y: 5 };
  moveCircle(token, 3, 0, P_RAD);
  assert.ok(token.x <= 5 - P_RAD + 1e-6, `stopped at ${token.x}`);
  assert.ok(lightLevel(4, 5) > lightLevel(6, 5));
  assert.equal(lightLevel(6, 5), 1 - map.dark);
});

test('the eye warning climbs as a guard gets close to seeing me', () => {
  const map = blankMap(30, 30);
  map.dark = 0;
  load(map);
  const guard = { x: 5, y: 15, a: 0 }, def = { sight: 6, fov: 70 };
  const threat = (x, y) => sightThreat(guard, def, { x, y });
  assert.equal(threat(8, 15), 1);                       // in range, in front
  assert.equal(guardSees(guard, def, { x: 8, y: 15 }), true);
  assert.ok(threat(12, 15) > 0 && threat(12, 15) < 1);  // just out of range
  assert.ok(threat(12, 15) > threat(14, 15));
  assert.equal(threat(25, 15), 0);                      // far away
  assert.equal(threat(1, 15), 0);                       // well behind
  map.walls.push({ id: 'wall', a: [7, 0], b: [7, 30] });
  bumpMap(); refreshGeo();
  assert.equal(threat(8, 15), 0);                       // behind a wall
});

test('tokens are faint in the dark and solid in light', () => {
  const map = blankMap(20, 20);
  map.lights.push({ id: 'lamp', x: 3, y: 3, r: 5, color: '#ffffff', on: true });
  map.floors['15_15'] = 'shadow';
  load(map);
  assert.equal(lightAlpha(3, 3), 1);
  assert.equal(lightAlpha(15.5, 15.5), 0.35);
  assert.ok(lightAlpha(10, 10) < 0.5);
});

test('guards are heard within Perception minus 8 squares, half through walls', () => {
  const map = blankMap(30, 30);
  map.walls.push({ id: 'wall', a: [0, 10], b: [30, 10] });
  load(map);
  const me = { x: 5, y: 5 }, at = (dx, dy = 0) => ({ x: 5 + dx, y: 5 + dy });
  assert.equal(hearingRange(16), 8);
  assert.equal(canHear(me, 16, at(8)), true);
  assert.equal(canHear(me, 16, at(8.5)), false);
  assert.equal(canHear(me, 16, at(8.5), true), true);   // a hurrying guard is louder
  assert.equal(canHear(me, 16, at(0, 6)), false);       // behind the wall: 4 squares only
  assert.equal(canHear(me, 18, at(0, 5)), true);
  assert.equal(canHear(me, 8, at(1)), false);
});

test('a Listen roll only helps, and wears off', () => {
  const ranger = { passive: 16, listen: { score: 22, until: 1000 } };
  assert.equal(perceptionScore(ranger, 500), 22);
  assert.equal(perceptionScore(ranger, 1500), 16);
  assert.equal(perceptionScore({ passive: 16, listen: { score: 7, until: 1000 } }, 500), 16);
});

test('PCs carry passive Perception and the Perception bonus', () => {
  const skills = { perception: { name: 'Perception', index: 'perception', url: '/api/skills/perception', ability_score: { index: 'wis' } } };
  const [a, b] = stealthPCs({
    pc_a: { kind: 'pc', name: 'A', campaign: 'daddies', data: { senses: { passive_perception: 16 }, skills: { perception: { bonus: 6 } } } },
    pc_b: { kind: 'pc', name: 'B', campaign: 'daddies', data: { skills: { perception: { bonus: 3 } } } }
  }, skills);
  assert.deepEqual([a.passive, a.perception.bonus], [16, 6]);
  assert.deepEqual([b.passive, b.perception.bonus], [13, 3]);
});

test('torches and braziers can be put out, even lever-lit ones', () => {
  const map = blankMap(10, 10);
  map.lights.push({ id: 'old', x: 2, y: 2, r: 4, color: '#ffffff', on: true });
  map.lights.push({ id: 'moon', kind: 'glow', x: 8, y: 8, r: 4, color: '#ffffff', on: true });
  map.lights.push({ id: 'linked', kind: 'brazier', x: 5, y: 5, r: 4, color: '#ffffff', on: false });
  map.levers.push({ id: 'lever', x: 1, y: 9, targets: ['linked'] });
  load(map);
  const [old, moon, linked] = map.lights;
  assert.equal(nearestUsable(2, 2.5, 1.2).o.id, 'old');   // a light with no kind is a torch
  assert.equal(nearestUsable(8, 8, 1.2), null);           // a glow has nothing to put out
  L.levers.lever = true;
  for (const light of [old, linked]) {
    assert.equal(canSnuff(light), true);
    L.lights[light.id] = snuffedValue(light);
    assert.equal(lightOn(light), false);
    assert.equal(canSnuff(light), false);
  }
  assert.equal(lightOn(moon), true);
});

test('normal movement is faster and louder than sneaking', () => {
  assert.deepEqual(Object.keys(SPEED), ['normal', 'sneak']);
  assert.ok(SPEED.normal > SPEED.sneak && NOISE.normal > NOISE.sneak);
});

const reference = {
  stealth: { name: 'Stealth', index: 'stealth', url: '/api/skills/stealth', ability_score: { index: 'dex' } },
  'chain mail': { name: 'Chain Mail', stealth_disadvantage: true }
};

test('PCs come from live sheet records with colour, darkvision and Stealth', () => {
  const pcs = stealthPCs({
    pc_a: { kind: 'pc', name: 'Zed', campaign: 'daddies', data: { token_color: '#ec4899', stats: { dex: 14 }, senses: { darkvision: 60 }, skills: { stealth: { bonus: 3 } } } },
    pc_b: { kind: 'pc', name: 'Abe', campaign: 'world__disney', data: { token_color: 'url(x)', stats: { dex: 12 }, equipped: { armor: 'Chain Mail' }, inventory: { a: { name: 'Chain Mail', qty: 1 } } } },
    npc: { kind: 'npc', name: 'Guard', campaign: 'daddies', data: {} },
    gone: { kind: 'pc', name: 'Gone', campaign: 'daddies', data: { _sheetsDeleted: true } },
    homeless: { kind: 'pc', name: 'Nowhere', data: {} },
    'bad.id': { kind: 'pc', name: 'Bad', campaign: 'daddies', data: {} }
  }, reference);
  assert.deepEqual(pcs.map(pc => pc.name), ['Abe', 'Zed']);
  const [abe, zed] = pcs;
  assert.equal(abe.campaign, 'disney');
  assert.equal(abe.color, '#8f87e6');
  assert.equal(abe.darkvision, 0);
  assert.equal(abe.stealth.bonus, 1);
  assert.equal(abe.stealth.disadvantage, true);
  assert.deepEqual([zed.color, zed.darkvision, zed.stealth.bonus, zed.stealth.disadvantage], ['#ec4899', 60, 3, false]);
});

test('without skill reference data PCs still load', () => {
  const [pc] = stealthPCs({ pc_a: { kind: 'pc', name: 'Zed', campaign: 'daddies', data: {} } });
  assert.equal(pc.stealth, null);
});
