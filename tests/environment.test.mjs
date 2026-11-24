import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environmentSettings, fogRectangles, fogSize } from '../js/environment-model.js';

test('old scenes retain original lighting and malformed fog cells are discarded', () => {
  const map = { width: 4, height: 3 };
  assert.deepEqual(environmentSettings(null, map), { time: 'original', weather: 'clear', weatherColor: '#b9d6ed', fog: { covered: false, cells: [] } });
  assert.deepEqual(environmentSettings({ time: 'invalid', weather: 'snow', fog: { covered: true, cells: ['1,2', '1,2', '4,0', '-1,0', '01,2', null] } }, map), {
    time: 'original', weather: 'snow', weatherColor: '#ffffff', fog: { covered: true, cells: ['1,2'] }
  });
});

test('exterior floor fog keeps signed cells through import and clips enlarged tiles', () => {
  const map={width:1,height:1,floors:[{x:-1,y:-1,size:2},{x:3.5,y:.5,size:1}]};
  map.environment=environmentSettings({fog:{covered:true,cells:['-2,-2','3,0','-3,0','01,0']}},map);
  assert.deepEqual(map.environment.fog.cells,['-2,-2','3,0']);
  const fog=fogRectangles(map);
  const covered=(x,y)=>fog.some(rect=>x>=rect.x && x<rect.x+rect.width && y>=rect.y && y<rect.y+rect.height);
  assert.equal(covered(-1.5,-1.5),false);
  assert.equal(covered(-.5,-1.5),true);
  assert.equal(covered(.5,.5),true);
  assert.equal(covered(3.5,.5),false);
  map.environment.fog.covered=false;
  assert.deepEqual(fogRectangles(map),[{x:-2,y:-2,width:1,height:1},{x:3,y:0,width:1,height:1}]);
});

test('distant painted floors do not allocate fog across the empty gap', () => {
  const map={width:1,height:1,floors:[{x:1000000.5,y:.5}],environment:{fog:{covered:true,cells:[]}}};
  assert.deepEqual(fogRectangles(map),[{x:0,y:0,width:1,height:1},{x:1000000,y:0,width:1,height:1}]);
});

test('hidden lights do not reveal manual fog or provide player illumination', () => {
  const map={width:1,height:1,environment:{time:'night',fog:{covered:true,cells:[]}},lights:[{x:.5,y:.5,range:10,hidden:true}]};
  assert.deepEqual(fogRectangles(map),[{x:0,y:0,width:1,height:1}]);
  const viewer={x:5,y:.5,size:1,vision:{sight:120,darkvision:0}};
  assert.deepEqual(fogRectangles(map,[viewer]),[{x:0,y:0,width:1,height:1}]);
  map.lights[0].hidden=false;
  assert.deepEqual(fogRectangles(map,[viewer]),[]);
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
