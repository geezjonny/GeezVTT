import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portalType, bucketCells } from '../js/map-editor-model.js';
import { crossesWindow } from '../js/token-model.js';
import { fogRectangles } from '../js/environment-model.js';

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
