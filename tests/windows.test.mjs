import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalType, bucketCells, adjoiningWallIndex, windowFrameParts } from '../js/map-editor-model.js';
import { crossesWindow } from '../js/token-model.js';
import { fogRectangles } from '../js/environment-model.js';

test('window frames use adjoining aligned walls rather than crossing walls',()=>{
  const door={points:[{x:1,y:0},{x:3,y:0}]};
  const crossing={points:[{x:1,y:0},{x:1,y:2}],material:'wood'};
  const adjacent={points:[{x:0,y:0},{x:1,y:0}],material:'brick'};
  assert.equal(adjoiningWallIndex(door,[crossing,adjacent]),1);
  assert.equal(adjoiningWallIndex(door,[crossing]),-1);
  assert.equal(adjoiningWallIndex(door,[adjacent.points]),0);
});

test('window frames leave a rectangular central opening even for short windows',()=>{
  for(const length of [.1,1,3]) {
    const parts=windowFrameParts(length);
    assert.equal(parts.length,4);
    assert.ok(parts.every(part=>part.width>0 && part.height>0));
    assert.equal(parts.some(part=>length/2>part.x-part.width/2 && length/2<part.x+part.width/2 && 1.1>part.y-part.height/2 && 1.1<part.y+part.height/2),false);
  }
});

test('unmarked open portals become windows and explicit types preserve opened doors', () => {
  assert.equal(portalType({ closed: false }), 'window');
  assert.equal(portalType({ closed: true }), 'door');
  assert.equal(portalType({}), 'door');
  assert.equal(portalType({ closed: false, geezvtt_type: 'door' }), 'door');
  assert.equal(portalType({ closed: false, geezvtt_type: 'window' }), 'window');
  assert.equal(portalType({ closed: true, geezvtt_type: 'invalid' }), 'door');
});

test('windows transmit light while closed doors block it', () => {
  const portal = { type: 'window', open: false, points: [{ x: 1, y: 0 }, { x: 1, y: 1 }] };
  const map = { width: 3, height: 1, walls: [], doors: [portal],
    environment: { fog: { covered: true, cells: [] } },
    lights: [{ x: .5, y: .5, range: 4 }] };
  assert.deepEqual(fogRectangles(map), []);
  portal.type = 'door';
  assert.deepEqual(fogRectangles(map), [{ x: 1, y: 0, width: 2, height: 1 }]);
  portal.open = true;
  assert.deepEqual(fogRectangles(map), []);
});

test('windows enclose bucket fills even when their source portal was open', () => {
  const map = { width: 4, height: 4, walls: [], doors: [
    { type: 'window', open: true, points: [{ x: 2, y: 0 }, { x: 2, y: 4 }] }
  ] };
  assert.equal(bucketCells(map, { x: .5, y: .5 }, 1).length, 8);
});

test('token movement cannot jump through windows or clip their endpoints', () => {
  const doors = [{ type: 'window', points: [{ x: 2, y: 0 }, { x: 2, y: 4 }] }];
  const token = { x: .5, y: 2, size: 1 };
  assert.equal(crossesWindow(token, { x: 3.5, y: 2 }, doors), true);
  assert.equal(crossesWindow(token, { x: 1.75, y: 2 }, doors), true);
  assert.equal(crossesWindow(token, { x: .5, y: 3 }, doors), false);
  assert.equal(crossesWindow({ ...token, y: 4.25 }, { x: 3.5, y: 4.25 }, doors), true);
  assert.equal(crossesWindow({ ...token, y: 4.75 }, { x: 3.5, y: 4.75 }, doors), false);
  doors[0].type = 'door';
  assert.equal(crossesWindow(token, { x: 3.5, y: 2 }, doors), false);
});
