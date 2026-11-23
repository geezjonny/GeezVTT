import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environmentSettings, fogRectangles, fogSize } from '../js/environment-model.js';

test('old scenes retain original lighting and malformed fog cells are discarded', () => {
  const map = { width: 4, height: 3 };
  assert.deepEqual(environmentSettings(null, map), { time: 'original', weather: 'clear', fog: { covered: false, cells: [] } });
  assert.deepEqual(environmentSettings({ time: 'invalid', weather: 'snow', fog: { covered: true, cells: ['1,2', '1,2', '4,0', '-1,0', '01,2', null] } }, map), {
    time: 'original', weather: 'snow', fog: { covered: true, cells: ['1,2'] }
  });
});

test('cover/reveal cells produce matching rectangular fog for both renderers', () => {
  const map = { width: 3, height: 1, environment: { fog: { covered: true, cells: ['1,0'] } } };
  assert.deepEqual(fogRectangles(map), [{ x: 0, y: 0, width: 1, height: 1 }, { x: 2, y: 0, width: 1, height: 1 }]);
  map.environment.fog.covered = false;
  assert.deepEqual(fogRectangles(map), [{ x: 1, y: 0, width: 1, height: 1 }]);
  map.environment.fog.cells = [];
  assert.deepEqual(fogRectangles(map), []);
  map.environment.fog.covered = true;
  assert.deepEqual(fogRectangles(map), [{ x: 0, y: 0, width: 3, height: 1 }]);
});

test('large maps bound fog cell counts and clip partial edge cells', () => {
  const map = { width: 257, height: 1, environment: { fog: { covered: false, cells: ['85,0'] } } };
  assert.equal(fogSize(map), 3);
  assert.deepEqual(fogRectangles(map), [{ x: 255, y: 0, width: 2, height: 1 }]);
});

test('active lights reveal covered fog without changing manual fog data', () => {
  const map = { width: 3, height: 1, environment: { fog: { covered: true, cells: [] } },
    lights: [{ x: 1.5, y: .5, range: .6, intensity: 1, opacity: 1 }] };
  const outer = [{ x: 0, y: 0, width: 1, height: 1 }, { x: 2, y: 0, width: 1, height: 1 }];
  assert.deepEqual(fogRectangles(map), outer);
  assert.deepEqual(map.environment.fog.cells, []);
  for (const field of ['intensity', 'opacity', 'range']) {
    const previous = map.lights[0][field];
    map.lights[0][field] = 0;
    assert.deepEqual(fogRectangles(map), [{ x: 0, y: 0, width: 3, height: 1 }]);
    map.lights[0][field] = previous;
  }
  map.environment.fog.cells = ['2,0'];
  map.lights = [];
  assert.deepEqual(fogRectangles(map), [{ x: 0, y: 0, width: 2, height: 1 }]);
});

test('walls and closed doors block light reveal, and opening a door restores it', () => {
  const barrier = [{ x: 1, y: 0 }, { x: 1, y: 1 }];
  const map = { width: 3, height: 1, environment: { fog: { covered: true, cells: [] } },
    lights: [{ x: .5, y: .5, range: 4 }], walls: [barrier], doors: [] };
  const hidden = [{ x: 1, y: 0, width: 2, height: 1 }];
  assert.deepEqual(fogRectangles(map), hidden);
  map.walls = [];
  map.doors = [{ points: barrier, open: false }];
  assert.deepEqual(fogRectangles(map), hidden);
  map.doors[0].open = true;
  assert.deepEqual(fogRectangles(map), []);
});
