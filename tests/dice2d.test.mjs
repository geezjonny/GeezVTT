import test from 'node:test';
import assert from 'node:assert/strict';
import { diePoints, dieFacets } from '../js/dice2d.js';

test('every die size has a shape and facet lines, unknown sizes fall back to a d6', () => {
  for (const sides of [4, 6, 8, 10, 12, 20, 100]) {
    assert.match(diePoints(sides), /^\d+,\d+( \d+,\d+)+$/);
    assert.match(dieFacets(sides), /^M/);
  }
  assert.equal(diePoints(7), diePoints(6));
  assert.equal(dieFacets(7), dieFacets(6));
});

test('shapes have the right number of corners', () => {
  const corners = sides => diePoints(sides).split(' ').length;
  assert.deepEqual([4, 6, 8, 10, 12, 20].map(corners), [3, 4, 4, 4, 5, 6]);
});
