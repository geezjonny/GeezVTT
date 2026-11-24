import { randomDie } from './dice-roll.js';

export const TYPING_WAVE = 20;
export const ZOMBIE_TRAVEL = 12000;
const WORDS = {
  long: 'graveyard nightmare tombstone ravenous darkness shambling creeping restless skeleton haunting dreadful'.split(' '),
  medium: 'crypt ghoul bones ghost skull claws haunt grave curse risen gloom'.split(' '),
  short: 'ax bow ash bat fog rot hex imp orb sun'.split(' '),
  letter: [...'abcdefghijklmnopqrstuvwxyz']
};

export function typingTier(natural, total) {
  if (!Number.isInteger(natural) || natural < 1 || natural > 20 || !Number.isFinite(total)) throw new Error('Invalid Dexterity roll.');
  return natural === 20 ? 'letter' : total < 10 ? 'long' : total < 15 ? 'medium' : 'short';
}

export function createTypingGame(natural, total) {
  return { tier: typingTier(natural, total), elapsed: 0, spawned: 0, kills: 0, lives: 3, zombies: [], status: 'playing' };
}

export function advanceTypingGame(game, milliseconds, random = randomDie) {
  if (game.status !== 'playing' || !Number.isFinite(milliseconds) || milliseconds <= 0) return;
  const until = game.elapsed + milliseconds;
  while (game.elapsed < until && game.status === 'playing') {
    const spawnAt = game.spawned < TYPING_WAVE ? 800 + game.spawned * 2200 : Infinity;
    game.elapsed = Math.min(until, spawnAt, ...game.zombies.map(zombie => zombie.born + ZOMBIE_TRAVEL));
    const survivors = game.zombies.filter(zombie => game.elapsed - zombie.born < ZOMBIE_TRAVEL);
    game.lives = Math.max(0, game.lives - (game.zombies.length - survivors.length));
    game.zombies = survivors;
    if (!game.lives) { game.status = 'lost'; break; }
    if (game.elapsed === spawnAt) {
      const available = WORDS[game.tier].filter(word => !game.zombies.some(zombie => zombie.word === word));
      game.zombies.push({ id: game.spawned, word: available[random(available.length) - 1], born: spawnAt });
      game.spawned++;
    }
    if (game.spawned === TYPING_WAVE && !game.zombies.length) game.status = 'won';
  }
}

export function typeZombieWord(game, word) {
  if (game.status !== 'playing' || typeof word !== 'string') return false;
  const index = game.zombies.findIndex(zombie => zombie.word === word.toLowerCase());
  if (index < 0) return false;
  game.zombies.splice(index, 1);
  game.kills++;
  if (game.spawned === TYPING_WAVE && !game.zombies.length) game.status = 'won';
  return true;
}

// Shared snapshots are display data; they never drive the participant's simulation.
export function validTypingSnapshot(value) {
  const game = value?.game;
  return typeof value?.owner === 'string' && value.owner.length <= 100 &&
    Number.isInteger(value.natural) && value.natural >= 1 && value.natural <= 20 &&
    Number.isFinite(value.total) && Math.abs(value.total) <= 2000 &&
    typeof value.paused === 'boolean' && typeof value.typed === 'string' && /^[a-z]{0,12}$/.test(value.typed) &&
    game && game.tier === typingTier(value.natural, value.total) &&
    Number.isFinite(game.elapsed) && game.elapsed >= 0 && game.elapsed <= 120000 &&
    Number.isInteger(game.spawned) && game.spawned >= 0 && game.spawned <= TYPING_WAVE &&
    Number.isInteger(game.kills) && game.kills >= 0 && game.kills <= game.spawned &&
    Number.isInteger(game.lives) && game.lives >= 0 && game.lives <= 3 &&
    ['playing', 'won', 'lost', 'stopped'].includes(game.status) &&
    (game.zombies == null || Array.isArray(game.zombies) && game.zombies.length <= TYPING_WAVE && game.zombies.every(zombie =>
      Number.isInteger(zombie?.id) && zombie.id >= 0 && zombie.id < game.spawned &&
      WORDS[game.tier].includes(zombie.word) && Number.isFinite(zombie.born) && zombie.born >= 0 && zombie.born <= game.elapsed));
}

export function validMinigameSession(value) {
  return !!value && typeof value.id === 'string' && /^[a-f0-9-]{36}$/.test(value.id) && value.type === 'typing' &&
    typeof value.stopped === 'boolean' && Array.isArray(value.participants) && value.participants.length > 0 && value.participants.length <= 32 &&
    value.participants.every(pc => typeof pc?.pcId === 'string' && /^[^.#$\[\]/\s]{1,200}$/.test(pc.pcId) && typeof pc.name === 'string' && pc.name.length <= 120) &&
    new Set(value.participants.map(pc => pc.pcId)).size === value.participants.length;
}

export function minigameResults(session, runs = {}) {
  if (!validMinigameSession(session)) return { players: [], kills: 0, finished: 0, complete: false };
  const players = session.participants.map(pc => {
    const snapshot = runs[pc.pcId];
    const value = validTypingSnapshot(snapshot) && snapshot.pcId === pc.pcId ? snapshot : null;
    return { ...pc, kills: value?.game.kills || 0, lives: value?.game.lives ?? null,
      natural: value?.natural ?? null, total: value?.total ?? null,
      status: ['won', 'lost'].includes(value?.game.status) ? value.game.status : session.stopped ? 'stopped' : value?.game.status || 'waiting', paused: value?.paused || false };
  });
  const finished = players.filter(pc => ['won', 'lost', 'stopped'].includes(pc.status)).length;
  return { players, kills: players.reduce((sum, pc) => sum + pc.kills, 0), finished, complete: finished === players.length };
}
