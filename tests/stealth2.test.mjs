import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankMap, demoMap, normalizeMap, doorOpen, chestLocked, refreshGeo, moveCircle, lightLevel, lightAlpha, guardSees, sightThreat,
  hearingRange, canHear, perceptionScore, nearestUsable, canSnuff, snuffedValue, canLight, litValue, lightOn,
  reachCheck, inEarshot, guardNotices, chaseSees, isOut, postOf, refitGuard } from '../js/stealth2-model.js';
import { L, setM, setL, bumpMap, SPEED, NOISE, P_RAD, ACT } from '../js/stealth2-state.js';
import { stealthPCs, weaponsOf, bestWeapon } from '../js/stealth2-pcs.js';

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
  for (const light of [old, linked]) {
    assert.equal(canLight(light), true);
    L.lights[light.id] = litValue(light);
    assert.equal(lightOn(light), true);
  }
  assert.equal(canLight(moon), false);
});

test('a match table offers a match only to empty hands', () => {
  const map = blankMap(10, 10);
  map.props.push({ id: 'table', kind: 'matches', x: 2, y: 2, w: 1, h: 1, tall: false });
  load(map);
  assert.equal(nearestUsable(2, 3, 1.2, false).type, 'matches');
  assert.equal(nearestUsable(2, 3, 1.2, true), null);
});

test('melee needs to be adjacent; shots need range and a clear line', () => {
  const map = blankMap(60, 20);
  map.walls.push({ id: 'wall', a: [30, 0], b: [30, 20] });
  load(map);
  const from = { x: 5, y: 5 }, bow = { normal: 30, long: 120 };
  assert.equal(reachCheck(from, { x: 6.2, y: 5 }, {}, 'melee').ok, true);
  assert.equal(reachCheck(from, { x: 8, y: 5 }, {}, 'melee').reason, 'Too far');
  assert.deepEqual(reachCheck(from, { x: 10, y: 5 }, bow, 'ranged'), { ok: true, long: false });
  assert.deepEqual(reachCheck(from, { x: 20, y: 5 }, bow, 'ranged'), { ok: true, long: true });
  assert.equal(reachCheck(from, { x: 29.5, y: 5 }, bow, 'ranged').reason, 'Out of range');
  assert.equal(reachCheck({ x: 28, y: 5 }, { x: 33, y: 5 }, bow, 'ranged').reason, 'No clear shot');
  assert.equal(reachCheck({ x: 28, y: 5 }, { x: 30, y: 5 }, bow, 'ranged', 'light').ok, true); // a torch mounted on the wall
});

test('guards notice lights, hear shouts and track a quarry', () => {
  const map = blankMap(30, 30);
  map.walls.push({ id: 'wall', a: [0, 10], b: [30, 10] });
  load(map);
  const guard = { x: 5, y: 5, a: 0 }, def = { sight: 6, fov: 70 };
  assert.equal(guardNotices(guard, def, { x: 12, y: 5 }), true);
  assert.equal(guardNotices(guard, def, { x: 1, y: 5 }), false);                  // behind them
  assert.equal(guardNotices(guard, def, { x: 5 + ACT.noticeRange + 1, y: 5 }), false);
  assert.equal(guardNotices({ x: 5, y: 9, a: Math.PI / 2 }, def, { x: 5, y: 13 }), false); // other side of the wall
  assert.equal(inEarshot(guard, { x: 14, y: 5 }, ACT.tauntRange), true);
  assert.equal(inEarshot(guard, { x: 5, y: 12 }, ACT.tauntRange), false);          // halved by the wall
  assert.equal(chaseSees(guard, def, { x: 1, y: 5 }), true);                       // any direction while chasing
  assert.equal(chaseSees(guard, def, { x: 15, y: 5 }), false);
  assert.ok(ACT.chaseSpeed < SPEED.normal && ACT.chaseSpeed > SPEED.sneak);
});

test('editing the map moves only what the GM changed on a running guard', () => {
  const def = { x: 5, y: 5, face: 0, mode: 'patrol', path: [[5, 5], [9, 5]] };
  const guard = { x: 7, y: 5, a: 1, st: 'down', def, post: postOf(def), path: [[9, 5]] };
  assert.equal(refitGuard(guard, def), false);                       // a wall elsewhere changed
  assert.deepEqual([guard.x, guard.a, guard.st, guard.path], [7, 1, 'down', null]);
  def.path.push([9, 9]);
  assert.equal(refitGuard(guard, def), true);                        // new patrol point: stays put
  assert.equal(guard.x, 7);
  def.x = 2; def.face = 180;
  assert.equal(refitGuard(guard, def), true);                        // dragged and turned
  assert.deepEqual([guard.x, guard.a, guard.st], [2, Math.PI, 'down']);
  assert.deepEqual(['down', 'dead', 'gone', 'home', 'chase'].map(isOut), [true, true, true, false, false]);
});

test('windows stop bodies and shots but not sight or light', () => {
  const map = blankMap(10, 10);
  map.windows.push({ id: 'glass', a: [5, 0], b: [5, 10] });
  map.lights.push({ id: 'lamp', x: 3, y: 5, r: 6, color: '#ffffff', on: true });
  load(map);
  const token = { x: 4, y: 5 };
  moveCircle(token, 3, 0, P_RAD);
  assert.ok(token.x <= 5 - P_RAD + 1e-6, `stopped at ${token.x}`);
  assert.ok(lightLevel(6, 5) > 1 - map.dark);
  assert.equal(guardSees({ x: 4, y: 5, a: 0 }, { sight: 6, fov: 70 }, { x: 6, y: 5 }), true);
  assert.equal(reachCheck({ x: 4.5, y: 5 }, { x: 5.5, y: 5 }, {}, 'melee').ok, false);
  assert.equal(reachCheck({ x: 2, y: 5 }, { x: 8, y: 5 }, { normal: 30, long: 120 }, 'ranged').ok, false);
});

test('an older import turns its open doors into windows, once', () => {
  const door = (id, open) => ({ id, a: [0, 0], b: [1, 0], open, name: 'Door' });
  const map = normalizeMap({ w: 5, h: 5, doors: [door('pane', true), door('shut', false)] });
  assert.deepEqual([map.windows.map(w => w.id), map.doors.map(d => d.id)], [['pane'], ['shut']]);
  map.doors[0].open = true; // a door the GM leaves open afterwards stays a door
  assert.equal(normalizeMap(map).doors.length, 1);
});

test('weapons come from the sheet with their reach', () => {
  const data = { stats: { str: 14 }, attacks: {
    a: { name: 'Longbow', to_hit: '+9', damage: '1d8+4' },
    b: { name: 'Hand Crossbow', to_hit: 5, damage: '1d8+2', notes: 'Range 30/120. Load.' },
    c: { name: 'Dagger', to_hit: 5, damage: '1d4+2', notes: 'Finesse. Thrown 20/60.' },
    d: { name: 'Sacred Flame (cantrip)', damage: '2d8', notes: 'DEX save.' }
  } };
  const weapons = weaponsOf(data, { longbow: { weapon_range: 'Ranged', range: { normal: 150, long: 600 } } });
  const byName = Object.fromEntries(weapons.map(w => [w.name, w]));
  assert.deepEqual([byName.Longbow.melee, byName.Longbow.long], [false, 600]);
  assert.deepEqual([byName['Hand Crossbow'].melee, byName['Hand Crossbow'].long], [false, 120]);
  assert.deepEqual([byName.Dagger.melee, byName.Dagger.long], [true, 60]);
  assert.equal(byName['Sacred Flame (cantrip)'], undefined);
  assert.equal(bestWeapon(weapons, 'ranged').name, 'Longbow');
  assert.equal(bestWeapon(weapons, 'melee').name, 'Dagger');
  assert.equal(bestWeapon(weaponsOf({ stats: { str: 16 } }), 'melee').name, 'Unarmed strike');
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
