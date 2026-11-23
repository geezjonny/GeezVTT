import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraStep } from '../js/first-person-model.js';

test('first-person movement follows camera yaw in every direction', () => {
  const clean = step => step.map(value => value || 0);
  for (const step of [[0,-1], [0,1], [-1,0], [1,0]]) {
    assert.deepEqual(clean(cameraStep(step, 0)), step);
    assert.deepEqual(clean(cameraStep(step, Math.PI / 2)), [step[1], -step[0]].map(value => value || 0));
    assert.deepEqual(clean(cameraStep(step, Math.PI)), step.map(value => -value || 0));
  }
  assert.deepEqual(clean(cameraStep([0,-1], Math.PI / 6)), [0,-1]);
  assert.deepEqual(clean(cameraStep([0,-1], Math.PI / 3)), [-1,0]);
});
