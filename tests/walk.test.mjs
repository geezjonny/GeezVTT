import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEY_TO_MOVE, RADIUS, SPEED, VISION, lineOfSight, visionPolygon, buildWorld, cleanTrigger, lockedDoors, nearestTrigger, direction, doorBlocked, doorOccupied, hitsWall, hpFraction, move, nearestDoor, project, setWorld, smooth, spawn, unproject, validWalker, world } from '../js/walk-model.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const P = (x, y) => ({ x, y });
// A 20x20 map split by a horizontal wall at y=10 with a door gap between x=4 and x=6, plus an image that must be dropped.
const fake = {
  resolution: { map_size: P(20, 20), pixels_per_grid: 70 }, image: 'AAAA'.repeat(1000),
  line_of_sight: [[P(0, 10), P(4, 10)], [P(6, 10), P(20, 10)], [P(10, 2), P(10, 6), P(14, 6)]],
  portals: [{ position: P(5, 10), bounds: [P(4, 10), P(6, 10)], closed: true }]
};
setWorld(fake);

test('only the geometry of a .dd2vtt is kept', () => {
  assert.deepEqual(Object.keys(buildWorld(fake)).sort(), ['doors', 'h', 'walls', 'w']);
  assert.equal(world.walls.length, 4, 'polylines become one segment per step');
  assert.deepEqual(world.doors, [[4, 10, 6, 10]]);
  assert.throws(() => buildWorld({}), /no size/);
  assert.equal(buildWorld({ resolution: { map_size: P(5, 5) }, line_of_sight: [[P(0, 0), { x: NaN, y: 1 }]] }).walls.length, 0, 'bad points are skipped');
});

test('projection turns grid steps into top-down screen steps, and back again', () => {
  assert.deepEqual(project(0, 0), { x: 0, y: 0 });
  assert.deepEqual(project(1, 0), { x: 48, y: 0 }, 'one tile along x goes right');
  assert.deepEqual(project(0, 1), { x: 0, y: 48 }, 'one tile along y goes down');
  for (const [gx, gy] of [[3.5, 7.25], [0, 0], [23.9, 0.1], [12, 12]]) {
    const back = unproject(project(gx, gy).x, project(gx, gy).y);
    near(back.x, gx); near(back.y, gy);
  }
});

test('WASD and the arrows move on the screen: up is up-screen', () => {
  for (const [grid, screen] of [['up', [0, -1]], ['down', [0, 1]], ['left', [-1, 0]], ['right', [1, 0]]]) {
    const d = direction([grid]), p = project(d.x, d.y);
    near(Math.sign(p.x), screen[0]); near(Math.sign(p.y), screen[1]);
    near(Math.hypot(d.x, d.y), 1, 1e-9);
  }
  const upRight = direction(['up', 'right']);
  near(upRight.x, Math.SQRT1_2); near(upRight.y, -Math.SQRT1_2);
  assert.deepEqual(direction(['up', 'down']), { x: 0, y: 0 }, 'opposite keys cancel');
  assert.deepEqual(direction([]), { x: 0, y: 0 });
  assert.deepEqual(['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'].map(k => KEY_TO_MOVE[k]), ['up', 'left', 'down', 'right', 'up', 'left', 'down', 'right']);
});

test('moving is the same speed in every direction and stays on the map', () => {
  for (const keys of [['up'], ['right'], ['up', 'right'], ['down', 'left']]) {
    const d = direction(keys), after = move({ x: 12, y: 15 }, d, 0.5);
    near(Math.hypot(after.x - 12, after.y - 15), SPEED * 0.5, 1e-9);
  }
  assert.deepEqual(move({ x: 1, y: 1 }, { x: -1, y: 0 }, 5), { x: RADIUS, y: 1 }, 'clamped at the left edge');
  assert.deepEqual(move({ x: 19, y: 19 }, { x: 0.6, y: 0.8 }, 9), { x: 20 - RADIUS, y: 20 - RADIUS });
  assert.deepEqual(move({ x: 5, y: 5 }, { x: 0, y: 0 }, 3), { x: 5, y: 5 }, 'standing still stays put');
});

test('walls block movement, bodies slide along them, and door gaps let you through', () => {
  assert.equal(hitsWall(12, 15), false);
  assert.equal(hitsWall(12, 10.2), true, 'touching the wall');
  const into = move({ x: 12, y: 10.4 }, { x: 0.6, y: -0.8 }, 0.05, 4, hitsWall); // one frame, drifting up-right into the wall
  assert.ok(into.y >= 10.4 - 1e-9 && into.x > 12, 'stopped by the wall but still slides sideways');
  const shut = move({ x: 5, y: 10.4 }, { x: 0, y: -1 }, 0.05, 4, hitsWall);
  assert.equal(shut.y, 10.4, 'a closed door stops you');
  world.open = new Set([0]);
  const door = move({ x: 5, y: 11 }, { x: 0, y: -1 }, 0.5, 4, hitsWall);
  assert.ok(door.y < 10, 'an open door lets you through');
  world.swing.set(0, 0.6);
  assert.equal(move({ x: 5, y: 10.4 }, { x: 0, y: -1 }, 0.05, 4, hitsWall).y, 10.4, 'a half-open door still blocks');
  world.swing.set(0, 1);
  assert.ok(move({ x: 5, y: 10.4 }, { x: 0, y: -1 }, 0.05, 4, hitsWall).y < 10.4, 'passable once fully open');
  world.open = new Set(); world.swing.clear();
});

test('a door stays open while anyone is near it, and may shut once everyone has gone', () => {
  assert.equal(doorOccupied(0, [{ x: 5, y: 11 }]), true);
  assert.equal(doorOccupied(0, [{ x: 5, y: 12 }, { x: 1, y: 1 }]), false);
});

test('doors are found within a tile, and cannot close on someone standing in them', () => {
  assert.equal(nearestDoor(5, 10.9), 0);
  assert.equal(nearestDoor(5, 12), -1);
  assert.equal(doorBlocked(0, 5, 10.2), true);
  assert.equal(doorBlocked(0, 5, 11), false);
  const stuck = move({ x: 5, y: 10.1 }, { x: 0, y: 1 }, 0.05, 4, hitsWall);
  assert.ok(stuck.y > 10.1, 'a body caught in a closed door can walk out');
});

test('levers and plates: shared records are cleaned, found by distance, and lock the doors they control', () => {
  assert.deepEqual(cleanTrigger('t1', { kind: 'lever', x: 3, y: 4, doors: [0, 0, 7, -1, 'a'], on: 1 }), { id: 't1', kind: 'lever', x: 3, y: 4, doors: [0], on: true });
  assert.deepEqual(cleanTrigger('t2', { kind: 'plate', x: 3, y: 4, doors: { 0: 0 } }).doors, [0], 'Firebase may hand a list back as an object');
  assert.equal(cleanTrigger('t3', { kind: 'plate', x: 3, y: 4 }).doors.length, 0, 'an unwired trigger has no doors');
  for (const bad of [null, { kind: 'bomb', x: 1, y: 1 }, { kind: 'lever', x: -1, y: 1 }, { kind: 'lever', x: 1, y: 99 }, { kind: 'lever', x: NaN, y: 1 }]) assert.equal(cleanTrigger('t', bad), null);
  assert.equal(cleanTrigger(5, { kind: 'lever', x: 1, y: 1 }), null);
  world.triggers = [cleanTrigger('a', { kind: 'lever', x: 2, y: 2, doors: [0] }), cleanTrigger('b', { kind: 'plate', x: 8, y: 8 })];
  assert.equal(nearestTrigger(2.5, 2, 1).id, 'a');
  assert.equal(nearestTrigger(2.5, 2, 1, 'plate'), null, 'filtered by kind');
  assert.equal(nearestTrigger(5, 5, 1), null, 'out of reach');
  assert.deepEqual([...lockedDoors()], [0]);
  world.triggers = [];
});

test('the lit area is one simple shape: its points go around the player in order', () => {
  for (const [x, y] of [[12, 12], [5, 11], [3.99, 10.5], [19.5, 18]]) {
    const turns = visionPolygon(x, y).map(p => Math.atan2(p.y - y, p.x - x));
    let backwards = 0;
    for (let i = 1; i < turns.length; i++) if (turns[i] < turns[i - 1] - 1e-9) backwards++;
    assert.equal(backwards, 0, `at ${x},${y}`);
  }
});

test('vision stops at walls and shut doors, reaches through open doors, and fades with distance', () => {
  const below = visionPolygon(12, 12);
  assert.ok(below.length > 90 && below.every(p => p.y >= 10 - 1e-6), 'the wall at y=10 and the shut door hide everything above');
  assert.ok(below.every(p => Math.hypot(p.x - 12, p.y - 12) <= VISION + 1e-9), 'never farther than the light reaches');
  assert.equal(lineOfSight(12, 12, 15, 14), true);
  assert.equal(lineOfSight(12, 12, 12, 8), false, 'blocked by the wall');
  assert.equal(lineOfSight(12, 12, 12, 12 + VISION + 1), false, 'too far');
  assert.equal(lineOfSight(5, 12, 5, 8), false, 'the shut door blocks sight');
  world.open = new Set([0]); world.swing.set(0, 1);
  assert.equal(lineOfSight(5, 12, 5, 8), true, 'an open door lets you see through');
  assert.ok(visionPolygon(5, 12).some(p => p.y < 10), 'light spills through the gap');
  world.open = new Set(); world.swing.clear();
});

test('players spawn near the middle, clear of walls, and apart from each other', () => {
  const spots = [0, 1, 2, 3, 4, 5].map(seat => spawn(seat));
  for (const s of spots) { assert.ok(!hitsWall(s.x, s.y)); assert.ok(Math.hypot(s.x - 10, s.y - 10) < 6); }
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) assert.ok(Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y) > 0.3, `${i} and ${j}`);
});

test('shown positions ease toward the reported one without overshooting', () => {
  let shown = { x: 0, y: 0 };
  const target = { x: 10, y: -4 };
  for (let i = 0; i < 6; i++) { const next = smooth(shown, target, 1 / 30); assert.ok(next.x > shown.x && next.x < target.x); shown = next; }
  near(smooth({ x: 1, y: 1 }, { x: 1, y: 1 }, 1).x, 1);
  const far = smooth({ x: 0, y: 0 }, target, 10);
  assert.ok(Math.abs(far.x - target.x) < 0.01, 'a long gap catches up');
});

test('shared player records must be complete, on the map and recent', () => {
  const now = 100000, good = { pcId: 'pc_1', name: 'Seris', x: 12, y: 12, seen: now - 1000 };
  assert.equal(validWalker(good, now), true);
  assert.equal(validWalker({ ...good, seen: now - 60000 }, now, Infinity), true, 'an expired presence still supplies a valid position for an idle stand-in');
  assert.equal(validWalker({ ...good, x: -1, seen: now - 60000 }, now, Infinity), false, 'remembering an old position still requires valid map coordinates');
  for (const bad of [null, { ...good, pcId: 5 }, { ...good, name: 'x'.repeat(41) }, { ...good, x: -1 }, { ...good, y: world.h + 1 }, { ...good, x: NaN },
    { ...good, seen: now - 20000 }, { ...good, seen: now + 60000 }, { ...good, seen: 'now' }]) assert.equal(validWalker(bad, now), false, JSON.stringify(bad));
});

test('hp fractions handle missing or odd sheet data', () => {
  assert.equal(hpFraction(25, 50), 0.5);
  assert.equal(hpFraction(80, 50), 1);
  assert.equal(hpFraction(-3, 50), 0);
  for (const [hp, max] of [[undefined, 50], [10, 0], [10, undefined], [NaN, 10]]) assert.equal(hpFraction(hp, max), null);
});
