import { test } from 'node:test';
import assert from 'node:assert/strict';
import { step, validEvent, MAX_TICKS } from '../js/horde-model.js';
import { setWorld, world } from '../js/walk-model.js';
import { createEncounter, decodeEncounter, syncEncounter, toHorde, walkHordeArena } from '../js/walk-horde-model.js';

const pcs = [{ pcId: 'pc_lark', name: 'Lark', cls: 'ranger', pos: { x: 5, y: 5 } }];
const zombie = { id: 'placed_one', name: 'Walker', npcId: 'horde:walker', hp: 1, size: 1, x: 9, y: 9 };
const resetMap = () => setWorld({ resolution: { map_size: { x: 40, y: 30 } } });

test('manual encounters start immediately and never spawn waves or end on an empty map', () => {
  resetMap();
  const game = createEncounter(pcs), arena = walkHordeArena(); syncEncounter(game, pcs, []);
  for (let i = 0; i < 500; i++) step(game, [], arena);
  assert.equal(game.phase, 'wave'); assert.equal(game.wave, 1);
  assert.equal(game.zombies.length, 0);
  assert.deepEqual({ x: game.players[0].x, y: game.players[0].y }, toHorde(pcs[0].pos));
});

test('GM placement adds zombies; defeated zombies stay defeated until the GM changes the placement', () => {
  resetMap();
  const game = createEncounter(pcs);
  syncEncounter(game, pcs, [zombie]); assert.equal(game.zombies.length, 1);
  assert.equal(game.zombies[0].word, 'bones');
  game.zombies = [];
  syncEncounter(game, pcs, [zombie]); assert.equal(game.zombies.length, 0);
  syncEncounter(game, pcs, [{ ...zombie, x: 10 }]); assert.equal(game.zombies.length, 1);
  syncEncounter(game, pcs, []); assert.equal(game.zombies.length, 0);
});

test('door and chain connections hold zombies until released', () => {
  resetMap(); world.doors = [[8, 8, 9, 8]]; world.chains = [{ id: 'chain_one', x: 9, y: 9, locked: true }];
  const game = createEncounter(pcs), placed = { ...zombie, walkAI: { door: 0, chain: 'chain_one' } };
  syncEncounter(game, pcs, [placed]); assert.equal(game.zombies[0].frozen, 2);
  world.open.add(0); world.chains[0].locked = false; game.zombies[0].frozen = 0;
  syncEncounter(game, pcs, [placed]); assert.equal(game.zombies[0].frozen, 0);
  assert.equal(game.zombies[0].awake, true);
});

test('runtime serialization preserves empty lists and rejects malformed input', () => {
  const game = createEncounter(pcs);
  assert.deepEqual(decodeEncounter(JSON.stringify(game)), game);
  assert.equal(decodeEncounter('{broken'), null);
  assert.equal(decodeEncounter(JSON.stringify({ ...game, players: null })), null);
});

test('unengaged zombies roam while preserving their attack words', () => {
  resetMap();
  const game = createEncounter(pcs), arena = walkHordeArena();
  syncEncounter(game, pcs, [{ ...zombie, x: 25, y: 20 }]);
  const z = game.zombies[0], start = { x: z.x, y: z.y }, word = z.word;
  for (let i = 0; i < 180; i++) step(game, [], arena);
  assert.ok(z.x !== start.x || z.y !== start.y);
  assert.equal(z.word, word); assert.equal(arena.blocked(z.x, z.y), false);
});

test('a bard retains both typing attacks and the metronome ability on the walking map', () => {
  resetMap();
  const bard = [{ ...pcs[0], cls: 'bard' }], game = createEncounter(bard), arena = walkHordeArena();
  syncEncounter(game, bard, [{ ...zombie, x: 6, y: 5, hp: 10 }]);
  const event = (seq, extra) => ({ pcId: bard[0].pcId, seq, t: game.tick, ...extra });
  step(game, [event(0, { k: 'w', s: game.zombies[0].word })], arena);
  for (let i = 0; i < 10; i++) step(game, [], arena);
  assert.ok(game.zombies[0].hp < 10);
  step(game, [event(1, { k: 'o', mode: 1 })], arena);
  assert.equal(game.players[0].mech.bar.lanes.length, 8);
  const bar = game.players[0].mech.bar;
  while (game.tick < bar.at) step(game, [], arena);
  step(game, [event(2, { k: 'd', lane: bar.lanes[0] })], arena);
  assert.equal(bar.res[0], 2);
});

test('class rolls work immediately and manual ability inputs remain valid after twelve minutes', () => {
  resetMap();
  const game = createEncounter(pcs);
  step(game, [{ pcId: pcs[0].pcId, seq: 0, t: 0, k: 'r', total: 22, nat: 20 }], walkHordeArena());
  assert.equal(game.players[0].rolled, true); assert.equal(game.players[0].tier, 3);
  const action = { pcId: pcs[0].pcId, seq: 1, t: MAX_TICKS + 1, k: 'w', s: 'bones' };
  assert.equal(validEvent(action, game.players), false);
  assert.equal(validEvent(action, game.players, Number.MAX_SAFE_INTEGER), true);
});
