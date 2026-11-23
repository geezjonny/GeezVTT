import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initiativeState, startTurn, remainingMovement, takeTurnAction, attacksPerTurn, equipmentTurnCost } from '../js/initiative-model.js';
import { playerDestination, reachableCells } from '../js/player-actions.js';
import { npcCatalog, importedTokens } from '../js/token-model.js';
import { changeCombat } from '../js/sheet-combat.js';

function combat() {
  const liora = { id: 'liora', kind: 'pc', name: 'Liora', x: 4.5, y: 4.5, size: 1, hp: 44, speed: 30,
    turnFeatures: { extraAttack: true, dreadAmbusher: true, huntersMark: true } };
  const seris = { ...liora, id: 'seris', turnFeatures: undefined };
  const map = { width: 20, height: 20, walls: [], doors: [], tokens: [liora, seris],
    initiative: { entries: [{ id: 'liora', score: 20 }, { id: 'seris', score: 10 }], currentId: null } };
  startTurn(map.initiative, liora.id);
  return { map, liora, seris };
}

test('2014 weapon draws use a free interaction, swaps also need an action, and spent budgets reject changes', () => {
  const { map, liora, seris } = combat();
  const pc = { inventory: { sword: { name: 'Sword' }, bow: { name: 'Longbow' } }, equipped: {} };
  const change = { type: 'equip', slot: 'main_hand', key: 'sword' };
  assert.deepEqual(equipmentTurnCost(map, liora.id, pc, change), { item: true, action: false });
  pc.equipped.main_hand = 'Longbow';
  assert.deepEqual(equipmentTurnCost(map, liora.id, pc, change), { item: true, action: true });
  map.initiative.turn.action = true;
  assert.throws(() => equipmentTurnCost(map, liora.id, pc, change), /Not enough/);
  assert.deepEqual(equipmentTurnCost(map, liora.id, pc, { ...change, key: '' }), { item: true, action: false });
  map.initiative.turn.action = false;
  map.initiative.turn.item = true;
  assert.throws(() => equipmentTurnCost(map, liora.id, pc, change), /Not enough/);
  assert.deepEqual(equipmentTurnCost(map, liora.id, pc, { ...change, key: '' }), { item: false, action: true });
  assert.throws(() => equipmentTurnCost(map, seris.id, pc, change), /Wait for your turn/);
  assert.deepEqual(equipmentTurnCost(map, liora.id, pc, { ...change, key: 'bow' }), { item: false, action: false });
});

test('shields require an action and armor cannot be changed in one turn', () => {
  const { map, liora } = combat();
  const pc = { inventory: { shield: { name: 'Shield' }, armor: { name: 'Leather Armor' } } };
  assert.deepEqual(equipmentTurnCost(map, liora.id, pc, { slot: 'shield', key: 'shield' }), { item: false, action: true });
  assert.throws(() => equipmentTurnCost(map, liora.id, pc, { slot: 'armor', key: 'armor' }), /longer than one turn/);
  map.initiative.turn.action = true;
  assert.throws(() => equipmentTurnCost(map, liora.id, pc, { slot: 'shield', key: 'shield' }), /available action/);
  delete map.initiative.turn;
  assert.throws(() => equipmentTurnCost(map, liora.id, pc, { slot: 'shield', key: 'shield' }), /Wait for your turn/);
});

test('Liora splits first-turn movement around three attacks and one bonus action, then loses her first-turn bonuses', () => {
  const { map, liora, seris } = combat();
  const id = map.initiative.turn.id;
  assert.equal(remainingMovement(map, liora), 40);
  assert.equal(attacksPerTurn(map, liora), 3);
  const move = playerDestination(map, liora, 2, 0, true);
  assert.equal(move.cost, 10);
  Object.assign(liora, { x: move.x, y: move.y });
  map.initiative.turn.movementSpent += move.cost;
  assert.equal(remainingMovement(map, liora), 30);
  assert.equal(takeTurnAction(map, liora.id, id, 'hunters-mark'), true);
  assert.equal(takeTurnAction(map, liora.id, id, 'bonus'), false);
  for (let i = 0; i < 3; i++) assert.equal(takeTurnAction(map, liora.id, id, 'attack'), true);
  assert.equal(takeTurnAction(map, liora.id, id, 'attack'), false);
  assert.equal(takeTurnAction(map, liora.id, id, 'action'), false);
  const second = playerDestination(map, liora, 6, 0, true);
  assert.equal(second.cost, 30);
  Object.assign(liora, { x: second.x, y: second.y });
  map.initiative.turn.movementSpent += second.cost;
  assert.equal(remainingMovement(map, liora), 0);
  assert.equal(playerDestination(map, liora, 1, 0, true), null);
  const restored = initiativeState(JSON.parse(JSON.stringify(map.initiative)), map.tokens);
  map.initiative = restored;
  assert.equal(takeTurnAction(map, liora.id, id, 'end'), true);
  assert.equal(remainingMovement(map, seris), 30);
  assert.equal(takeTurnAction(map, liora.id, id, 'end'), false);
  assert.equal(takeTurnAction(map, seris.id, map.initiative.turn.id, 'end'), true);
  assert.equal(remainingMovement(map, liora), 30);
  assert.equal(attacksPerTurn(map, liora), 2);
  assert.equal(map.initiative.turn.attacksUsed, 0);
});

test('movement respects active token, walls, closed doors, map edges and remaining budget', () => {
  const { map, liora, seris } = combat();
  assert.equal(remainingMovement(null, null), 0);
  assert.equal(reachableCells(map, seris).size, 0);
  const wall = [{ x: 5, y: 0 }, { x: 5, y: 20 }];
  map.walls = [wall];
  assert.equal(playerDestination(map, liora, 1, 0, true), null);
  map.walls = [];
  map.doors = [{ points: wall, type: 'door', open: false }];
  assert.equal(playerDestination(map, liora, 1, 0, true), null);
  map.doors[0].open = true;
  assert.equal(playerDestination(map, liora, 1, 1, true).cost, 5);
  assert.equal(playerDestination(map, liora, -5, 0, true), null);
  assert.equal(playerDestination(map, liora, 9, 0, true), null);
  assert.equal(playerDestination(map, liora, NaN, 0, true), null);
});

test('a different action prevents attacks, and a solo combatant gets a fresh turn', () => {
  const { map, liora } = combat();
  map.initiative.entries = [map.initiative.entries[0]];
  const id = map.initiative.turn.id;
  assert.equal(takeTurnAction(map, liora.id, id, 'action'), true);
  assert.equal(takeTurnAction(map, liora.id, id, 'attack'), false);
  assert.equal(takeTurnAction(map, liora.id, id, 'end'), true);
  assert.notEqual(map.initiative.turn.id, id);
  assert.equal(map.initiative.turn.action, false);
  assert.equal(map.initiative.turn.firstTurn, false);
});

test('recorded speed and abilities survive token catalog and map import; SPD edits validate', () => {
  const data = { combat: { hp_current: 44, speed: 30 }, abilities: {
    extra_attack: { label: 'Extra Attack' }, dread_ambusher: { label: 'Dread Ambusher' },
    hunters_mark: { label: "Hunter's Mark (spell)" }
  } };
  const [token] = npcCatalog({ liora: { kind: 'pc', name: 'Liora', data } });
  const [restored] = importedTokens([{ ...token, x: 2.5, y: 2.5 }], 20, 20);
  assert.equal(restored.speed, 30);
  assert.deepEqual(restored.turnFeatures, { extraAttack: true, dreadAmbusher: true, huntersMark: true });
  changeCombat(data, { type: 'set', field: 'speed', value: 35 });
  assert.equal(npcCatalog({ liora: { kind: 'pc', name: 'Liora', data } })[0].speed, 35);
  assert.throws(() => changeCombat(data, { type: 'set', field: 'speed', value: -1 }));
});
