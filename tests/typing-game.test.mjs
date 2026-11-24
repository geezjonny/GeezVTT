import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTypingGame, typingTier, advanceTypingGame, typeZombieWord, validTypingSnapshot, validMinigameSession, minigameResults, TYPING_WAVE, ZOMBIE_TRAVEL } from '../js/typing-game-model.js';

test('Dexterity totals set word length and only a natural 20 gives single letters', () => {
  assert.equal(typingTier(9, 9), 'long');
  assert.equal(typingTier(9, 10), 'medium');
  assert.equal(typingTier(14, 14), 'medium');
  assert.equal(typingTier(14, 15), 'short');
  assert.equal(typingTier(19, 24), 'short');
  assert.equal(typingTier(20, 9), 'letter');
  assert.throws(() => typingTier(21, 21));
});

test('words kill once, ignore case, and active zombies have distinct words', () => {
  const game = createTypingGame(12, 12);
  advanceTypingGame(game, 3000, () => 1);
  assert.equal(game.zombies.length, 2);
  assert.notEqual(game.zombies[0].word, game.zombies[1].word);
  const word = game.zombies[0].word;
  assert.equal(typeZombieWord(game, word.slice(0, -1)), false);
  assert.equal(typeZombieWord(game, word.toUpperCase()), true);
  assert.equal(typeZombieWord(game, word), false);
  assert.equal(game.kills, 1);
});

test('arrival costs lives, ends the wave, and further input cannot change the result', () => {
  const game = createTypingGame(5, 5);
  advanceTypingGame(game, 800 + ZOMBIE_TRAVEL + 4400, () => 1);
  assert.equal(game.lives, 0);
  assert.equal(game.status, 'lost');
  const before = JSON.stringify(game);
  advanceTypingGame(game, 1000);
  assert.equal(typeZombieWord(game, game.zombies[0]?.word), false);
  assert.equal(JSON.stringify(game), before);
});

test('a delayed frame resolves arrivals in order without exhausting the word list', () => {
  const game = createTypingGame(16, 18);
  advanceTypingGame(game, 120000, () => 1);
  assert.equal(game.status, 'lost');
  assert.equal(game.lives, 0);
  assert.ok(game.spawned < TYPING_WAVE);
  assert.ok(game.zombies.every(zombie => typeof zombie.word === 'string'));
});

test('a full cleared wave wins with exactly twenty kills', () => {
  const game = createTypingGame(20, 25);
  for (let i = 0; i < TYPING_WAVE; i++) {
    advanceTypingGame(game, i ? 2200 : 800, () => 1);
    assert.equal(game.zombies[0].word.length, 1);
    assert.equal(typeZombieWord(game, game.zombies[0].word), true);
  }
  assert.equal(game.status, 'won');
  assert.equal(game.kills, TYPING_WAVE);
  assert.equal(game.lives, 3);
});

test('spectator snapshots accept Firebase empty lists and reject invalid shared values', () => {
  const value = { owner: 'client', natural: 12, total: 14, typed: '', paused: false, game: createTypingGame(12, 14) };
  assert.ok(validTypingSnapshot(value));
  assert.ok(validTypingSnapshot({ ...value, game: { ...value.game, zombies: null } }));
  assert.ok(!validTypingSnapshot({ ...value, natural: 0 }));
  assert.ok(!validTypingSnapshot({ ...value, game: { ...value.game, spawned: 999 } }));
  assert.ok(!validTypingSnapshot({ ...value, typed: '<script>' }));
  assert.ok(!validTypingSnapshot({ ...value, game: { ...value.game, spawned: 1, zombies: [{ id: 0, word: '<script>', born: 0 }] } }));
});

const session = { id: '12345678-1234-1234-1234-123456789abc', type: 'typing', stopped: false,
  participants: [{ pcId: 'pc-one', name: 'One' }, { pcId: 'pc-two', name: 'Two' }] };

test('shared sessions reject duplicate participants and invalid PC identifiers', () => {
  assert.equal(validMinigameSession(session), true);
  assert.equal(validMinigameSession({ ...session, participants: [] }), false);
  assert.equal(validMinigameSession({ ...session, participants: [session.participants[0], session.participants[0]] }), false);
  assert.equal(validMinigameSession({ ...session, participants: [{ pcId: 'bad/path', name: 'Bad' }] }), false);
  assert.equal(validMinigameSession({ ...session, id: '../other' }), false);
});

test('team results count only selected PCs and retain Dexterity and partial scores', () => {
  const game = createTypingGame(12, 14);
  advanceTypingGame(game, 800, () => 1);
  typeZombieWord(game, game.zombies[0].word);
  const snapshot = { owner: 'client', pcId: 'pc-one', natural: 12, total: 14, typed: '', paused: false, game };
  const runs = { 'pc-one': snapshot, outsider: { ...snapshot, pcId: 'outsider' } };
  const result = minigameResults(session, runs);
  assert.equal(result.kills, 1);
  assert.equal(result.finished, 0);
  assert.equal(result.complete, false);
  assert.equal(result.players[0].total, 14);
  assert.equal(result.players[1].status, 'waiting');
  const stopped = minigameResults({ ...session, stopped: true }, runs);
  assert.equal(stopped.kills, 1);
  assert.equal(stopped.complete, true);
  assert.equal(stopped.finished, 2);
  assert.equal(minigameResults(session, { 'pc-one': { ...snapshot, pcId: 'outsider' } }).kills, 0);
});

test('final results survive a Firebase round trip and reject invalid scores', () => {
  const game = createTypingGame(20, 22);
  for (let i = 0; i < TYPING_WAVE; i++) {
    advanceTypingGame(game, i ? 2200 : 800, () => 1);
    typeZombieWord(game, game.zombies[0].word);
  }
  const snapshot = { owner: 'client', pcId: 'pc-one', natural: 20, total: 22, typed: '', paused: false, game: { ...game, zombies: null } };
  const onePC = { ...session, participants: [session.participants[0]] };
  const result = minigameResults(onePC, JSON.parse(JSON.stringify({ 'pc-one': snapshot })));
  assert.equal(result.kills, 20);
  assert.equal(result.complete, true);
  assert.equal(result.players[0].status, 'won');
  assert.equal(minigameResults({ ...onePC, stopped: true }, { 'pc-one': snapshot }).players[0].status, 'won');
  assert.equal(minigameResults(onePC, { 'pc-one': { ...snapshot, game: { ...game, kills: 999 } } }).kills, 0);
});
