import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanMapEdit, movePlacedObject, moveTrigger, setWorld, syncPropTrigger, world } from '../js/walk-model.js';
import { bucketCells, cutDoorOpening, eraseStrokeIndices, floorBrushCells, paintFloorTiles } from '../js/map-editor-model.js';

test('shared map edits preserve door indices and copy geometry', () => {
  const raw = { version: 1, walls: [[0, 0, 4, 0]], doors: [[1, 1, 2, 1], [3, 1, 4, 1]], doorMaterials: ['wood', 'metal'], floors: [{ x: 0.5, y: 0.5, material: 'grass' }] };
  const clean = cleanMapEdit(raw, 5, 5);
  assert.deepEqual(clean.doors, raw.doors);
  assert.deepEqual(clean.doorMaterials, ['wood', 'metal']);
  assert.deepEqual(clean.wallMaterials, ['stone']);
  clean.walls[0][0] = 2;
  assert.equal(raw.walls[0][0], 0);
  assert.equal(cleanMapEdit({ ...raw, doors: [[1, 1, 2, 1], [3, 1, Infinity, 1]] }, 5, 5), null);
  assert.equal(cleanMapEdit({ ...raw, walls: [[-1, 0, 4, 0]] }, 5, 5), null);
  assert.equal(cleanMapEdit({ ...raw, doors: [[1, 1, 1, 1]] }, 5, 5), null);
  assert.equal(cleanMapEdit({ ...raw, floors: [{ x: 8, y: 1, material: 'stone' }] }, 5, 5), null);
  assert.deepEqual(cleanMapEdit({ version: 1 }, 5, 5), { w: 5, h: 5, walls: [], wallMaterials: [], doors: [], doorMaterials: [], floors: [], props: [], tokens: [] });
});

test('dragging a trigger changes its position while preserving its door links and identity', () => {
  setWorld({ resolution: { map_size: { x: 10, y: 10 } }, line_of_sight: [[{ x: 5, y: 0 }, { x: 5, y: 10 }]] });
  const trigger = { id: 'lever1', kind: 'lever', x: 1.5, y: 1.5, doors: [0, 2], on: true };
  world.triggers = [trigger];
  assert.equal(moveTrigger('lever1', 3.2, 4.1), true);
  assert.equal(world.triggers[0], trigger);
  assert.deepEqual(trigger, { id: 'lever1', kind: 'lever', x: 3.5, y: 4.5, doors: [0, 2], on: true });
  assert.equal(moveTrigger('lever1', 5, 4, false), false, 'a move into a wall is rejected');
  assert.equal(moveTrigger('lever1', -1, 4), false);
  assert.deepEqual([trigger.x, trigger.y], [3.5, 4.5]);
});

test('GM object moves ignore walls and keep a prop linked to its trigger', () => {
  setWorld({ resolution: { map_size: { x: 10, y: 10 } }, line_of_sight: [[{ x: 5, y: 0 }, { x: 5, y: 10 }]] });
  world.props = [{ id: 'prop1', kind: 'lever', x: 1.5, y: 1.5, size: 1, rotation: 0 }];
  syncPropTrigger(world.props[0]); world.triggers[0].doors = [0];
  assert.equal(movePlacedObject('props', 'prop1', 7.5, 2.5), true);
  assert.deepEqual(world.triggers[0], { id: 'prop1', kind: 'lever', x: 7.5, y: 2.5, doors: [0], on: false });
  world.tokens = [{ id: 'token1', name: 'Guard', size: 1, hp: 4, x: 1.5, y: 1.5 }];
  assert.equal(movePlacedObject('tokens', 'token1', 5, 2, false), true, 'GM can put a token inside a wall');
  assert.deepEqual([world.tokens[0].x, world.tokens[0].y], [5, 2]);
  assert.equal(movePlacedObject('tokens', 'token1', 20, 2), false, 'map bounds still apply');
});

test('painting controls share room barriers, floor strokes and wall erasing with the main editor', () => {
  const wall = (ax, ay, bx, by) => ({ points: [{ x: ax, y: ay }, { x: bx, y: by }], material: 'stone' });
  const walls = [wall(2, 0, 2, 4)];
  const bounds = { width: 4, height: 4, walls, doors: [] };
  const cells = bucketCells(bounds, { x: 0.5, y: 0.5 }, 1);
  assert.equal(cells.length, 8);
  assert.ok(cells.every(p => p.x < 2));
  const floors = [];
  paintFloorTiles(floors, cells, 'wood');
  paintFloorTiles(floors, floorBrushCells({ x: 0.1, y: 0.1 }, { x: 0.1, y: 3.9 }), 'grass');
  assert.equal(floors.length, 8, 'painting over a room replaces tiles without duplicating them');
  assert.equal(floors.filter(t => t.material === 'grass').length, 4);
  const door = { points: [{ x: 2, y: 1 }, { x: 2, y: 2 }], open: false };
  const cut = cutDoorOpening(walls, door.points);
  assert.equal(bucketCells({ ...bounds, walls: cut, doors: [door] }, { x: 0.5, y: 0.5 }, 1).length, 8);
  assert.equal(bucketCells({ ...bounds, walls: cut, doors: [{ ...door, open: true }] }, { x: 0.5, y: 0.5 }, 1).length, 16);
  assert.deepEqual(eraseStrokeIndices(walls, { x: 0, y: 1 }, { x: 4, y: 1 }, 'walls'), [0]);
});
