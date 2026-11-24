import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanMapEdit, cleanTrigger, setWorld, world } from '../js/walk-model.js';
import { importedTokens } from '../js/token-model.js';
import { activeNPC, advanceNPC, npcPath, npcState, walkable } from '../js/walk-ai-model.js';

function setup(disposition = 'enemy', door = 0) {
  setWorld({ resolution: { map_size: { x: 12, y: 12 } }, line_of_sight: [
    [{ x: 6, y: 0 }, { x: 6, y: 5 }], [{ x: 6, y: 6 }, { x: 6, y: 12 }]
  ], portals: [{ bounds: [{ x: 6, y: 5 }, { x: 6, y: 6 }] }] });
  const token = importedTokens([{ id: 'guard', name: 'Guard', x: 4.5, y: 5.5, size: 1, hp: 10, walkAI: { door, disposition } }], 12, 12)[0];
  world.tokens = [token];
  return token;
}
const pc = { pcId: 'pc1', name: 'Seris', x: 8.5, y: 5.5, hp: 10 };
function open() { world.open.add(0); world.swing.set(0, 1); }

test('NPC waits for its door, leaves when it opens, and captures one visible PC', () => {
  const token = setup();
  let state = advanceNPC(token, null, [pc], 0.25);
  assert.equal(state.mode, 'waiting'); assert.equal(state.captured, null);
  open();
  state = advanceNPC(token, state, [], 0.25);
  assert.ok(state.x > token.x, 'NPC walks toward the outside of its doorway');
  const stopped = advanceNPC(token, state, [pc, { ...pc, pcId: 'pc2', x: 9.5 }], 0.25);
  assert.equal(stopped.captured, 'pc1'); assert.equal(stopped.mode, 'battle');
  assert.ok(stopped.x > state.x, 'NPC approaches while its spotted PC is frozen');
  const adjacent = advanceNPC(token, stopped, [{ ...pc, x: stopped.x + 1 }], 0.25);
  assert.equal(adjacent.x, stopped.x, 'NPC stops once it reaches battle distance');
});

test('friendly NPC follows a visible PC without capturing it', () => {
  const token = setup('friendly', -1); open();
  const state = advanceNPC(token, null, [pc], 0.25);
  assert.equal(state.mode, 'following'); assert.equal(state.target, 'pc1'); assert.equal(state.captured, null);
  assert.ok(state.x > token.x);
});

test('freed enemy and friendly NPCs immediately seek a PC around a wall without needing sight first', () => {
  for (const disposition of ['enemy', 'friendly']) {
    const token = setup(disposition, -1); open(); token.y = 8.5;
    const hiddenPC = { ...pc, y: 8.5 };
    const state = advanceNPC(token, null, [hiddenPC], 0.25);
    assert.equal(state.target, 'pc1');
    assert.equal(state.mode, disposition === 'enemy' ? 'seeking' : 'following');
    assert.equal(state.captured, null, 'a wall still prevents an enemy from freezing the PC');
    assert.ok(Math.hypot(state.x - token.x, state.y - token.y) > 0, 'seeking starts moving on the first update');
  }
});

test('relocking chains clears an existing capture and prevents a new freeze', () => {
  const token = setup('enemy', -1); open(); token.walkAI.chain = 'chain1';
  world.chains = [{ id: 'chain1', x: 4, y: 5, locked: false }];
  const caught = advanceNPC(token, null, [pc], 0.25);
  assert.equal(caught.captured, 'pc1');
  world.chains[0].locked = true;
  const chained = advanceNPC(token, caught, [pc], 0.25);
  assert.equal(chained.mode, 'chained'); assert.equal(chained.captured, null);
  assert.deepEqual([chained.x, chained.y], [caught.x, caught.y]);
  assert.equal(npcState(token, { ...caught, mode: 'chained' }).captured, null, 'a chained snapshot cannot retain a stale capture');
});

test('locked chains stop NPCs; freeing them enables their enemy or friendly behavior', () => {
  for (const disposition of ['enemy', 'friendly']) {
    const token = setup(disposition, -1); open();
    token.walkAI.chain = 'chain1'; world.chains = [{ id: 'chain1', x: 4.5, y: 5.5, locked: true }];
    const chained = advanceNPC(token, null, [pc], 0.25);
    assert.equal(chained.mode, 'chained'); assert.equal(chained.x, token.x); assert.equal(chained.captured, null);
    world.chains[0].locked = false;
    const free = advanceNPC(token, chained, [pc], 0.25);
    assert.equal(free.mode, disposition === 'enemy' ? 'battle' : 'following');
  }
});

test('walls block detection and paths; a GM release lasts until the PC leaves sight', () => {
  const token = setup('enemy', -1);
  assert.equal(advanceNPC(token, null, [pc], 0.25).captured, null);
  assert.deepEqual(npcPath(token, pc, 150), []);
  open();
  const path = npcPath(token, pc);
  assert.ok(path.length); assert.ok(walkable(token, path[0]));
  const caught = advanceNPC(token, null, [pc], 0.25);
  const released = { ...caught, captured: null, ignore: 'pc1' };
  assert.equal(advanceNPC(token, released, [pc], 0).captured, null);
  const lostSight = advanceNPC(token, released, [], 0);
  assert.equal(lostSight.ignore, null);
  assert.equal(advanceNPC(token, lostSight, [pc], 0).captured, 'pc1');
  token.hp = 0; assert.equal(activeNPC(token), false);
});

test('a door opening is remembered while an NPC remains chained', () => {
  const token = setup(); token.walkAI.chain = 'chain1';
  world.chains = [{ id: 'chain1', x: 4, y: 5, locked: true }];
  open();
  let state = advanceNPC(token, null, [], 0.2);
  assert.equal(state.mode, 'chained'); assert.equal(state.awake, true);
  world.open.clear(); world.swing.set(0, 0); world.chains[0].locked = false;
  state = advanceNPC(token, state, [], 0.2);
  assert.equal(state.mode, 'wandering', 'unlocking does not require the wake door to open a second time');
});

test('unlocking chains activates movement without waiting for a separate wake door', () => {
  const token = setup('friendly'); token.walkAI.chain = 'chain1';
  world.chains = [{ id: 'chain1', x: 4, y: 5, locked: true }];
  const nearbyPC = { ...pc, x: 1.5 };
  const chained = advanceNPC(token, null, [nearbyPC], 0.25);
  assert.equal(chained.mode, 'chained'); assert.equal(chained.captured, null);
  world.chains[0].locked = false;
  const free = advanceNPC(token, chained, [nearbyPC], 0.25);
  assert.equal(free.awake, true); assert.equal(free.mode, 'following');
  assert.ok(free.x < token.x, 'freed NPC heads toward a reachable PC rather than waiting on the closed door');
});

test('AI settings and chain wiring survive map normalization; dangling references fail', () => {
  const token = setup('friendly', -1); token.walkAI.chain = 'chain1';
  const raw = { version: 1, w: 12, h: 12, tokens: [token], chains: [{ id: 'chain1', x: 4, y: 4, locked: true }] };
  const map = cleanMapEdit(raw, 12, 12);
  assert.equal(map.tokens[0].walkAI.disposition, 'friendly');
  const trigger = cleanTrigger('lever1', { kind: 'lever', x: 2, y: 2, doors: [], chains: ['chain1'] }, map);
  assert.deepEqual(trigger.chains, ['chain1']);
  assert.equal(cleanMapEdit({ ...raw, chains: [] }, 12, 12), null);
  assert.equal(cleanMapEdit({ ...raw, tokens: [{ ...token, walkAI: { door: 99 } }] }, 12, 12), null);
  assert.equal(importedTokens([{ ...token, walkAI: { door: -1, disposition: 'invalid' } }], 12, 12).length, 0);
});
