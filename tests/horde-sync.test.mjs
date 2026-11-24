import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { GEEZ_FIREBASE_CONFIG: { databaseURL: 'https://example.test' }, addEventListener() {} };
const { validHordeSession, freshHordeSession, sessionConfig, eventsFromLog, nextSeq, tickAt, validSpeed, HORDE_MAX_AGE } = await import('../js/horde-sync.js');

const session = (extra = {}) => ({
  id: 'abc-123', seed: -42, phase: 'lobby', startsAt: null, createdAt: 1000,
  participants: [{ pcId: 'pc_1', name: 'Rurik', cls: 'Fighter', role: 'tank' }, { pcId: 'pc_2', name: 'Liora', cls: 'Bard', role: 'support' }],
  ...extra
});

test('sessions need an id, an integer seed and 1-12 distinctly named players', () => {
  assert.equal(validHordeSession(session()), true);
  assert.equal(validHordeSession(session({ participants: { 0: session().participants[0] } })), true, 'Firebase may return objects instead of arrays');
  for (const bad of [null, session({ id: 'a/b' }), session({ seed: 1.5 }), session({ participants: [] }), session({ phase: 'paused' }), session({ startsAt: 'soon' }),
    session({ participants: [{ pcId: 'a', name: 'Zed' }, { pcId: 'b', name: 'zed' }] }), session({ participants: [{ pcId: 'a b', name: 'Zed' }] })]) {
    assert.equal(validHordeSession(bad), false, JSON.stringify(bad)?.slice(0, 80));
  }
});

test('stale sessions are ignored after two hours', () => {
  assert.equal(freshHordeSession(session(), 1000 + HORDE_MAX_AGE - 1), true);
  assert.equal(freshHordeSession(session(), 1000 + HORDE_MAX_AGE), false);
  assert.equal(freshHordeSession(session({ createdAt: undefined }), 9e15), true, 'older records without a timestamp stay usable');
});

test('the game config derives roles from classes when the record has none', () => {
  const config = sessionConfig(session({ participants: [{ pcId: 'a', name: 'Kai', cls: 'Wizard' }] }));
  assert.deepEqual(config.participants, [{ pcId: 'a', name: 'Kai', cls: 'Wizard', role: 'pitch' }]);
  assert.equal(config.seed, -42);
});

test('the input log reads both array and object shapes and drops invalid or other-session events', () => {
  const good = { pcId: 'pc_1', seq: 0, t: 5, k: 'm', dx: 1, dy: 0 };
  const log = { 'abc-123': { pc_1: [good, null, { pcId: 'pc_1', seq: 2, t: 9, k: 'w', s: 'crypt' }], pc_2: { 0: { pcId: 'pc_2', seq: 0, t: 1, k: 'r', total: 12, nat: 9 } }, evil: { 0: { pcId: 'stranger', seq: 0, t: 1, k: 'm', dx: 0, dy: 0 } } },
    'other-session': { pc_1: [good] } };
  const events = eventsFromLog(log, session());
  assert.equal(events.length, 3);
  assert.deepEqual(eventsFromLog(null, session()), []);
  assert.equal(nextSeq(events, 'pc_1'), 3, 'resumes after the highest sequence so a reload cannot overwrite events');
  assert.equal(nextSeq(events, 'pc_2'), 1);
  assert.equal(nextSeq([], 'pc_9'), 0);
});

test('ticks count 30 a second from the server start time', () => {
  assert.equal(tickAt(10000, 10000), 0);
  assert.equal(tickAt(10000, 11000), 30);
  assert.equal(tickAt(10000, 10999), 29);
  assert.equal(tickAt(10000, 9000), -30);
});

test('zombie speed is an integer from 1 to 5 and defaults to the slowest setting', () => {
  for (const ok of [1, 2, 3, 4, 5]) assert.equal(validSpeed(ok), true);
  for (const bad of [0, 6, 2.5, '3', null, undefined]) assert.equal(validSpeed(bad), false);
  assert.equal(sessionConfig(session()).speed, 1);
  assert.equal(sessionConfig(session({ speed: 4 })).speed, 4);
  assert.equal(sessionConfig(session({ speed: 9 })).speed, 1, 'an invalid stored speed falls back safely');
  assert.equal(validHordeSession(session({ speed: 3 })), true);
  assert.equal(validHordeSession(session({ speed: 9 })), false);
});
