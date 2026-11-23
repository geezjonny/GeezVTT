import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movementQueue } from '../js/movement-queue.js';

test('held movement keeps only the latest waiting direction behind a slow request', async () => {
  const writes = [], releases = [];
  const send = movementQueue(action => {
    writes.push(action);
    return new Promise(resolve => releases.push(resolve));
  }, error => { throw error; });
  const finished = send({ dx: 1, dy: 0 });
  send({ dx: 1, dy: 0 });
  send({ dx: -1, dy: 0 });
  send({ dx: 0, dy: 1 });
  assert.equal(writes.length, 1);
  releases.shift()();
  await Promise.resolve();
  assert.deepEqual(writes, [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }]);
  releases.shift()();
  await finished;
  assert.equal(writes.length, 2);
});
test('a failed move drops queued repeats and allows fresh input', async () => {
  const errors = [], writes = [];
  let fail;
  const send = movementQueue(action => {
    writes.push(action);
    return writes.length === 1 ? new Promise((resolve, reject) => { fail = reject; }) : Promise.resolve();
  }, error => errors.push(error.message));
  const finished = send('first');
  send('old repeat');
  fail(new Error('Disconnected'));
  await finished;
  await send('fresh');
  assert.deepEqual(writes, ['first', 'fresh']);
  assert.deepEqual(errors, ['Disconnected']);
});
