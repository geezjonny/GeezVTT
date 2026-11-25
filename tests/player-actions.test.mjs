import assert from 'node:assert/strict';
import { playerDestination, nearbyDoor, freeDestination, canStand } from '../js/player-actions.js';
import { fogRectangles } from '../js/environment-model.js';

const pc = { kind: 'pc', x: 2.5, y: 2.5, size: 1 };
const map = { width: 10, height: 10, walls: [], doors: [], lights: [], environment: { fog: { covered: true, cells: [] } } };
assert.deepEqual(playerDestination(map, pc, 1, 0, false), { x: 3.5, y: 2.5 });
assert.equal(playerDestination(map, pc, 1, 0, true), null);
assert.equal(playerDestination(map, { ...pc, kind: 'npc' }, 1, 0, false), null);
assert.equal(playerDestination(map, pc, 2, 0, false), null);
assert.equal(playerDestination(map, { ...pc, x: .5 }, -1, 0, false), null);
const wall = [{ x: 3, y: 1 }, { x: 3, y: 4 }];
map.walls = [wall];
assert.equal(playerDestination(map, pc, 1, 0, false), null);
map.walls = [];
map.doors = [{ points: wall, type: 'door', open: false, locked: true }];
assert.equal(playerDestination(map, pc, 1, 0, false), null);
assert.equal(nearbyDoor(map, pc), -1);
map.doors[0].locked = false;
assert.equal(nearbyDoor(map, pc), 0);
map.doors[0].open = true;
assert.deepEqual(playerDestination(map, pc, 1, 0, false), { x: 3.5, y: 2.5 });
map.doors[0].type = 'window';
assert.equal(playerDestination(map, pc, 1, 0, false), null);
assert.equal(nearbyDoor(map, pc), -1);
assert.equal(nearbyDoor(map, { ...pc, x: 8 }), -1);

const covered = p => fogRectangles(map).some(r => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height);
assert.equal(covered(pc), true);
map.lights = [{ x: 1.5, y: 2.5, range: 5, intensity: 1 }];
assert.equal(covered(pc), false);
map.walls = [wall];
assert.equal(covered({ x: 4.5, y: 2.5 }), true);
map.walls = [];
map.doors = [{ points: wall, type: 'door', open: false }];
assert.equal(covered({ x: 4.5, y: 2.5 }), true);
map.doors[0].open = true;
assert.equal(covered({ x: 4.5, y: 2.5 }), false);

// Free roam: fractional positions, short hops only, walls/closed doors/windows block, map edges clamp.
const open = { width: 10, height: 10, walls: [], doors: [] };
assert.deepEqual(freeDestination(open, pc, 2.62, 2.5), { x: 2.62, y: 2.5 });
assert.equal(freeDestination(open, pc, 7, 2.5), null);
assert.equal(freeDestination(open, { ...pc, kind: 'npc' }, 2.6, 2.5), null);
assert.equal(freeDestination(open, { ...pc, speed: 0 }, 2.6, 2.5), null);
assert.equal(freeDestination(open, pc, NaN, 2.5), null);
assert.equal(freeDestination(open, pc, .2, 2.5), null);
const walled = { ...open, walls: [[{ x: 3, y: 1 }, { x: 3, y: 4 }]] };
assert.equal(freeDestination(walled, pc, 3.6, 2.5), null);
assert.equal(canStand(walled, 1, { x: 2.4, y: 2.5 }, { x: 2.6, y: 2.5 }), false); // within a token radius of the wall
assert.equal(canStand(walled, 1, { x: 2.4, y: 2.5 }, { x: 2.4, y: 2.9 }), true);
const door = { ...open, doors: [{ points: [{ x: 3, y: 1 }, { x: 3, y: 4 }], type: 'door', open: true }] };
assert.notEqual(freeDestination(door, pc, 3.6, 2.5), null);
door.doors[0].open = false;
assert.equal(freeDestination(door, pc, 3.6, 2.5), null);
