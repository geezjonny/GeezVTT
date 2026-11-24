// Zombie Horde: a deterministic co-op game where every role plays its own mini-game. See horde-design.md.
// The state is a pure function of (seed, participants, input events). Every client replays the same log and
// gets the same result, so only integer math and the seeded generator below are allowed here:
// no Math.random, Date, sqrt, sin, cos, pow, and no object-key iteration order.

export const TICKS_PER_SECOND = 30;
export const MAX_TICKS = TICKS_PER_SECOND * 60 * 12;
export const ARENA = { width: 5120, height: 2880, gateY: 2560 }; // 1/16 logical pixel units: 320 x 180 px
export const WAVES = 6;
const PX = 16;
const COUNTDOWN = 450, BETWEEN = 300, EARLY_START = 150, CHECKPOINT = 30, LOG_TICKS = 45;
const PLAYER_Y = 2300, PLAYER_MIN_Y = 200, PLAYER_MAX_Y = ARENA.gateY - 160, PLAYER_MIN_X = 160, PLAYER_MAX_X = ARENA.width - 160;
const SPEED = 40, ARROW_SPEED = 120, MISS_COOLDOWN = 20, CAST_COOLDOWN = 45, SPELL_COOLDOWN = 240, SHIELD_MAX = 10;
const GATE_HP = 100, GATE_REACH = 200;

// tank: move + hold Space to charge a slam.  healer: type names to heal.  cutter: falling-rune lanes.
// simon: touch heal or glyphs.  cutter and pitch (the bards): play arrows on the metronome's beat.  striker: type zombie words or teleport-slash.  support: type spells.
export const ROLES = ['tank', 'healer', 'cutter', 'simon', 'pitch', 'striker', 'support'];
const CLASS_ROLE = {
  fighter: 'tank', barbarian: 'tank', paladin: 'tank',
  cleric: 'healer', druid: 'healer',
  bard: 'cutter', artificer: 'simon', wizard: 'pitch', sorcerer: 'pitch', warlock: 'pitch',
  ranger: 'striker', rogue: 'striker', monk: 'striker'
};
export const roleForClass = cls => CLASS_ROLE[String(cls ?? '').toLowerCase()] || 'striker';
const MOVERS = ['tank', 'healer', 'striker', 'support', 'simon', 'cutter', 'pitch']; // simon only walks in her touch-heal stance
// Four roles can switch between two stances at any time (Q / E, or the two buttons); mode 0 is the default.
export const MODE_NAMES = { tank: ['Attack', 'Hold the line'], cutter: ['Cutting words', 'Hold person'], pitch: ['Cutting words', 'Hold person'], simon: ['Touch heal', 'Glyphs'], striker: ['Arrows', 'Slash'] };
const ORB_SPEED = 90;
// The audience: spectators who are not in the party can type zombie words and shoot from the stands for half damage.
export const CROWD_MAX = 24;
export const isSpectator = id => typeof id === 'string' && /^spec-[a-zA-Z0-9]{4,24}$/.test(id);

// Role mini-game timing, in ticks (30 per second). The view reads these too.
export const IDEAL_CHARGE = 36, CHARGE_MAX = 90;
export const chargeWindow = tier => 4 + 3 * tier;                 // +/- ticks around the ideal for full power
export const RUNE_PERFECT = 3, RUNE_GOOD = 7, RUNE_LANES = 4, BAR_SLOTS = 8, BEAT_WORD = 2; // a typed word lands on the beat within BEAT_WORD ticks of a click
export const runeBeat = tier => 12 + 3 * tier;                    // ticks per beat of the metronome; a better roll means a slower, easier tempo
export const simonStart = tier => tier >= 3 ? 2 : tier >= 1 ? 3 : 4;
export const simonStep = tier => 20 + 4 * tier;                   // ticks each pad is shown
// Hold the line: a planted shield pulses every PLANT_PERIOD ticks; Seris must tap Space inside the green window.
export const PLANT_PERIOD = 36, PLANT_COOLDOWN = 90;
export const plantWindow = tier => 5 + 2 * tier;
// Liora's teleport slash: a ring closes on the target over SLASH_LEAD ticks; Space inside the window teleports and cuts.
export const SLASH_LEAD = 45;
export const slashWindow = tier => 5 + 2 * tier;
export const plantDurability = tier => 3 + tier;

export const ZOMBIES = {
  walker: { speed: 4, hp: 1, damage: 2, cool: 30, words: 'bones crypt ghoul skull claws grave curse risen gloom rot tomb worm mold'.split(' ') },
  runner: { speed: 9, hp: 1, damage: 1, cool: 24, words: 'ash bat fog imp orb sun mud web ink bog elk'.split(' ') },
  brute: { speed: 3, hp: 6, damage: 4, cool: 45, words: 'graveyard nightmare tombstone ravenous darkness shambling creeping restless skeleton haunting dreadful'.split(' ') }
};
export const SPELLS = {
  bard: ['haste', 'bless', 'hush'],
  arcane: ['frost', 'blast', 'shield']
};
export const spellsFor = cls => String(cls ?? '').toLowerCase() === 'bard' ? SPELLS.bard : SPELLS.arcane;

export const tierFromRoll = ({ total, nat }) => {
  const base = total < 10 ? 0 : total < 15 ? 1 : total < 20 ? 2 : 3;
  return Math.min(3, base + (nat === 20 ? 1 : 0));
};
export const normalizeName = name => String(name ?? '').toLowerCase().replace(/[^a-z]/g, '');

// --- seeded generator (mulberry32); the state lives in game.rng so it clones and checkpoints with the game.
function rand(game) {
  game.rng = (game.rng + 0x6D2B79F5) | 0;
  let t = Math.imul(game.rng ^ (game.rng >>> 15), 1 | game.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}
const randInt = (game, n) => rand(game) % n;

const dist2 = (a, b) => (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Integer step of `speed` toward a point, using the cheap octagon length estimate instead of sqrt.
function stepToward(from, to, speed, carry = null) {
  const dx = to.x - from.x, dy = to.y - from.y, ax = Math.abs(dx), ay = Math.abs(dy);
  const length = Math.max(ax, ay) + (Math.min(ax, ay) >> 1);
  if (length <= speed) return { x: to.x, y: to.y, arrived: true };
  // `carry` (fields rx and ry on the mover) keeps the part of a step that rounds away, so slow movers still arrive.
  const nx = dx * speed + (carry?.rx || 0), ny = dy * speed + (carry?.ry || 0), sx = Math.trunc(nx / length), sy = Math.trunc(ny / length);
  if (carry) { carry.rx = nx - sx * length; carry.ry = ny - sy * length; }
  return { x: from.x + sx, y: from.y + sy, arrived: false };
}

export function validEvent(event, participants = []) {
  if (!event || typeof event !== 'object') return false;
  if (isSpectator(event.pcId)) { if (event.k !== 'w') return false; }
  else if (!participants.some(p => p.pcId === event.pcId)) return false;
  if (!Number.isInteger(event.seq) || event.seq < 0 || event.seq > 1e6) return false;
  if (!Number.isInteger(event.t) || event.t < 0 || event.t > MAX_TICKS) return false;
  if (event.k === 'm') return [-1, 0, 1].includes(event.dx) && [-1, 0, 1].includes(event.dy);
  if (event.k === 'w') return typeof event.s === 'string' && /^[a-z]{1,16}$/.test(event.s);
  if (event.k === 'c' || event.k === 'x') return true;
  if (event.k === 'o') return event.mode === 0 || event.mode === 1;
  if (event.k === 'd') return Number.isInteger(event.lane) && event.lane >= 0 && event.lane < RUNE_LANES;
  if (event.k === 's') return Number.isInteger(event.pad) && event.pad >= 0 && event.pad < 4;
  if (event.k === 'r') return Number.isInteger(event.total) && event.total >= -10 && event.total <= 60 && Number.isInteger(event.nat) && event.nat >= 1 && event.nat <= 20;
  return false;
}

export const SPEED_MIN = 1, SPEED_MAX = 5, SPEED_DEFAULT = 1;
// `speed` is the GM's zombie speed from 1 to 5; 4 is the original pace.
export function createGame({ seed, participants, speed = SPEED_DEFAULT }) {
  if (!Number.isInteger(seed)) throw new Error('A game needs an integer seed.');
  if (!Number.isInteger(speed) || speed < SPEED_MIN || speed > SPEED_MAX) throw new Error('Zombie speed is 1 to 5.');
  const sorted = [...participants].sort((a, b) => a.pcId < b.pcId ? -1 : a.pcId > b.pcId ? 1 : 0);
  if (!sorted.length || sorted.length > 12) throw new Error('A game needs 1 to 12 players.');
  const names = new Set();
  const players = sorted.map((p, i) => {
    const key = normalizeName(p.name);
    if (!key || names.has(key)) throw new Error('Players need distinct names made of letters.');
    names.add(key);
    const role = ROLES.includes(p.role) ? p.role : roleForClass(p.cls);
    const x = ARENA.width / 2 + (2 * i - (sorted.length - 1)) * 200;
    return {
      pcId: p.pcId, name: p.name, key, cls: String(p.cls ?? ''), role, tier: 1, rolled: false, roll: null, mech: newMech(role),
      x, y: PLAYER_Y, ox: x, oy: PLAYER_Y, dx: 0, dy: 0, hp: 0, max: 0, shield: 0, downed: false, revive: 0, cooldown: 0, spellCd: [0, 0, 0],
      stats: { kills: 0, damage: 0, taken: 0, blocked: 0, healed: 0, casts: 0, revives: 0, misses: 0, slams: 0, cuts: 0, rounds: 0, holds: 0 }
    };
  });
  const game = {
    tick: 0, rng: seed | 0, speed, phase: 'countdown', timer: COUNTDOWN, wave: 0, nextId: 1,
    gate: { hp: GATE_HP, max: GATE_HP }, buffs: { haste: 0, bless: 0 },
    spawn: { left: 0, index: 0, every: 0, wait: 0, brutes: 0 },
    players, zombies: [], arrows: [], crowd: [], log: []
  };
  for (const player of players) setVitals(player);
  return game;
}

const newMech = role => role === 'tank' ? { charge: -1, mode: 0, plant: null, cool: 0 } : role === 'cutter' || role === 'pitch' ? { bar: null, combo: 0, next: 0, mode: 0 }
  : role === 'simon' ? { phase: 'rest', at: 0, seq: [], len: 0, progress: 0, deadline: 0, mode: 0, charge: -1 }
  : role === 'striker' ? { mode: 0, slash: null, next: 0 }
  : {};
// Re-rolling between waves changes the maximum but keeps the damage already taken.
function setVitals(player) {
  const max = (player.role === 'tank' ? 40 : 20) + player.tier * (player.role === 'tank' ? 8 : 4);
  player.hp = player.max ? Math.min(max, player.hp + Math.max(0, max - player.max)) : max;
  player.max = max;
}
const playerSpeed = game => game.buffs.haste > 0 ? SPEED * 3 >> 1 : SPEED;
const log = (game, type, a = 0, b = 0, c = 0) => game.log.push({ t: game.tick, type, a, b, c });

export function clone(game) { return JSON.parse(JSON.stringify(game)); }

// --- spawning
function pickWord(game, type) {
  const list = ZOMBIES[type].words, used = new Set(game.zombies.map(z => z.word)), firsts = new Set(game.zombies.map(z => z.word[0]));
  const free = list.filter(w => !used.has(w));
  const distinct = free.filter(w => !firsts.has(w[0]));
  const pool = distinct.length ? distinct : free.length ? free : list;
  return pool[randInt(game, pool.length)];
}
function startWave(game) {
  game.wave++;
  game.phase = 'wave';
  const n = game.wave;
  game.spawn = { left: 4 + 2 * n + game.players.length, index: 0, every: Math.max(24, 96 - 8 * n), wait: 30, brutes: n >= 3 ? n >> 1 : 0 };
  log(game, 'wave', n);
}
function spawnZombie(game) {
  const s = game.spawn, n = game.wave, last = s.left === 1;
  let type = 'walker';
  if (n === WAVES && last) type = 'brute';
  else if (s.brutes > 0 && s.index % 7 === 6) { type = 'brute'; s.brutes--; }
  else if (n >= 2 && randInt(game, 4) === 0) type = 'runner';
  const def = ZOMBIES[type], hp = def.hp * (n === WAVES && last ? 2 : 1);
  const x = PLAYER_MIN_X + randInt(game, ARENA.width - 2 * PLAYER_MIN_X), y = 0;
  game.zombies.push({ id: game.nextId++, type, x, y, ox: x, oy: y, hp, max: hp, pending: 0, word: pickWord(game, type), cool: 0, frozen: 0, slow: 0, boss: n === WAVES && last });
  s.left--; s.index++;
}

// --- events
const ranges = player => {
  const t = player.tier;
  return { tank: (30 + 3 * t) * PX, striker: (110 + 20 * t) * PX, healer: (60 + 10 * t) * PX, support: (90 + 10 * t) * PX, cutter: (90 + 15 * t) * PX, pitch: (90 + 15 * t) * PX }[player.role];
};
export { ranges as actionRange };
export const eligible = z => z.hp - z.pending > 0;
function miss(game, player) { player.cooldown = MISS_COOLDOWN; player.stats.misses++; log(game, 'miss', index(game, player)); }
const index = (game, player) => game.players.indexOf(player);

const isBard = player => player.role === 'cutter' || player.role === 'pitch';
// The metronome never stops: it clicks every runeBeat ticks. A bard's words and arrows land "on the beat" within a few ticks of a click.
const beatOffset = (game, player) => { const beat = runeBeat(player.tier), at = game.tick % beat; return Math.min(at, beat - at); };
const rollPhase = game => game.phase === 'countdown' || game.phase === 'between';
function applyEvent(game, event) {
  if (isSpectator(event.pcId)) return crowdWord(game, event);
  const player = game.players.find(p => p.pcId === event.pcId);
  if (!player) return;
  const mech = player.mech, tickNow = game.tick;
  switch (event.k) {
    case 'm': if (MOVERS.includes(player.role) && !(player.role === 'simon' && mech.mode === 1)) { player.dx = event.dx; player.dy = event.dy; } return;
    case 'r':
      // Everyone rolls again before each wave; the result sets that role's difficulty for the wave.
      if (!rollPhase(game) || player.rolled) return;
      player.rolled = true; player.tier = tierFromRoll(event); setVitals(player);
      player.roll = { nat: event.nat, total: event.total, at: game.tick };
      log(game, 'roll', index(game, player), player.tier);
      return;
    case 'o':
      if (MODE_NAMES[player.role] && !player.downed && !(mech.charge >= 0)) {
        mech.mode = event.mode; // switching stance lifts the shield and stops the walk or the ring
        if (player.role === 'tank') mech.plant = null;
        else if (player.role === 'simon') player.dx = player.dy = 0;
        else if (player.role === 'striker') mech.slash = null;
        else if (isBard(player)) { mech.bar = null; mech.combo = 0; player.dx = player.dy = 0; }
      }
      return;
    case 'c':
      if (player.downed || game.phase !== 'wave') return;
      if (player.role === 'simon') { if (mech.mode === 0 && mech.charge < 0) mech.charge = tickNow; return; }
      if (player.role === 'striker') { if (mech.mode === 1) slashPress(game, player); return; }
      if (player.role !== 'tank') return;
      if (mech.mode === 1) { if (mech.plant) plantPress(game, player, tickNow); else plantShield(game, player, tickNow); } else if (mech.charge < 0) mech.charge = tickNow;
      return;
    case 'x':
      if (player.role === 'tank' && mech.mode === 0 && mech.charge >= 0) release(game, player, tickNow - mech.charge);
      else if (player.role === 'simon' && mech.mode === 0 && mech.charge >= 0) touchHeal(game, player, tickNow - mech.charge);
      return;
    case 'd': if (isBard(player) && mech.mode === 1 && !player.downed) cutRune(game, player, event.lane); return;
    case 's': if (player.role === 'simon' && !player.downed) simonPad(game, player, event.pad); return;
    case 'w':
      if (player.downed || player.cooldown > 0 || game.phase !== 'wave' && game.phase !== 'between') return;
      if (player.role === 'healer') return healerWord(game, player, event.s);
      if (player.role === 'support') return supportWord(game, player, event.s);
      if ((player.role === 'striker' || isBard(player)) && mech.mode === 0) return fightWord(game, player, event.s);
  }
}

// --- audience: any spectator can shoot the zombie nearest the gate that has the typed word. Two hits do one damage.
function crowdWord(game, event) {
  if (game.phase !== 'wave') return;
  let fan = game.crowd.findIndex(f => f.id === event.pcId);
  if (fan < 0) {
    if (game.crowd.length >= CROWD_MAX) return;
    game.crowd.push({ id: event.pcId, cooldown: 0, stats: { kills: 0, damage: 0 } });
    fan = game.crowd.length - 1;
  }
  if (game.crowd[fan].cooldown > 0) return;
  const target = game.zombies.filter(z => z.word === event.s && eligible(z)).sort((a, b) => b.y - a.y || a.id - b.id)[0];
  if (!target) { game.crowd[fan].cooldown = MISS_COOLDOWN; return; }
  game.arrows.push({ id: game.nextId++, x: target.x, y: ARENA.gateY, ox: target.x, oy: ARENA.gateY, zid: target.id, damage: 0, from: -1, fan });
}

// --- tank: charge with Space, release inside the ideal window for the biggest slam.
function release(game, player, held) {
  player.mech.charge = -1;
  const diff = Math.abs(held - IDEAL_CHARGE), window = chargeWindow(player.tier);
  const perfect = diff <= window;
  const damage = perfect ? 5 : diff <= 2 * window ? 3 : diff <= 4 * window ? 2 : 1;
  const radius = (36 + 3 * player.tier) * PX;
  let hit = 0;
  for (const z of game.zombies) if (z.hp > 0 && dist2(z, player) <= radius * radius) { hurt(game, z, damage, player); hit++; }
  if (perfect) player.shield = Math.min(SHIELD_MAX, player.shield + 3);
  player.stats.slams++;
  log(game, 'slam', index(game, player), damage, perfect ? 1 : 0);
}

// --- hold the line: Space plants the shield. Every zombie in the arena is drawn to the tank, and she holds it by tapping
// Space in the green window on every pulse. Misses wear the shield down; at zero it shatters.
function plantShield(game, player, tickNow) {
  const m = player.mech;
  if (m.plant || tickNow < m.cool) return;
  const max = plantDurability(player.tier);
  m.plant = { next: tickNow + PLANT_PERIOD, dur: max, max, hits: 0 };
  player.dx = player.dy = 0;
  const reach = (48 + 3 * player.tier) * PX;
  for (const z of game.zombies) if (z.hp > 0 && dist2(z, player) <= reach * reach) { z.y = Math.max(0, z.y - 24 * PX); z.frozen = Math.max(z.frozen, 15); }
  log(game, 'plant', index(game, player), player.tier);
}
function plantPress(game, player, t) {
  const pl = player.mech.plant, w = plantWindow(player.tier);
  if (Math.abs(t - pl.next) > w) {
    if (t < pl.next - w) { pl.dur--; log(game, 'clank', index(game, player), 0); if (pl.dur <= 0) breakShield(game, player); } // too early
    return;
  }
  const perfect = Math.abs(t - pl.next) <= w >> 1, reach = (48 + 3 * player.tier) * PX;
  pl.hits++; pl.dur = Math.min(pl.max, pl.dur + 1); pl.next += PLANT_PERIOD;
  for (const z of game.zombies) if (z.hp > 0 && dist2(z, player) <= reach * reach) { z.frozen = Math.max(z.frozen, perfect ? 16 : 10); z.y = Math.max(0, z.y - (perfect ? 6 : 3) * PX); }
  for (const p of game.players) if (!p.downed && dist2(p, player) <= reach * reach) p.shield = Math.min(SHIELD_MAX, p.shield + (perfect ? 2 : 1));
  player.stats.slams++;
  log(game, 'clang', index(game, player), perfect ? 1 : 0, pl.hits);
}
function breakShield(game, player) {
  player.mech.plant = null; player.mech.cool = game.tick + PLANT_COOLDOWN;
  log(game, 'shatter', index(game, player));
}

// --- bards (cutter and pitch roles): the metronome always ticks. Cutting words is typing, with a bonus for landing on the beat.
// Hold person shows a bar of eight beats; she presses each arrow on its beat, and a clean bar pins zombies.
function barTick(game, player) {
  const m = player.mech, slot = index(game, player);
  if (game.phase !== 'wave' || player.downed || m.mode !== 1) { m.bar = null; m.combo = 0; return; }
  if (!m.bar) {
    if (game.tick < m.next) return;
    const beat = runeBeat(player.tier), lanes = Array.from({ length: BAR_SLOTS }, (_, i) => i === 0 || randInt(game, 5) < 3 ? randInt(game, RUNE_LANES) : -1);
    m.bar = { at: (Math.floor(game.tick / beat) + 3) * beat, beat, lanes, res: lanes.map(() => 0) }; // on the metronome's grid, after two to three empty beats
    return;
  }
  const bar = m.bar;
  bar.lanes.forEach((lane, i) => { if (lane >= 0 && bar.res[i] === 0 && game.tick > bar.at + i * bar.beat + RUNE_GOOD) { bar.res[i] = -1; m.combo = 0; log(game, 'drop', slot); } });
  if (game.tick > bar.at + (BAR_SLOTS - 1) * bar.beat + RUNE_GOOD) { finishBar(game, player); m.bar = null; m.next = game.tick + bar.beat; }
}
function cutRune(game, player, lane) {
  const m = player.mech, bar = m.bar;
  if (!bar) { m.combo = 0; return; }
  let best = -1;
  bar.lanes.forEach((l, i) => { const off = Math.abs(game.tick - (bar.at + i * bar.beat)); if (l >= 0 && bar.res[i] === 0 && off <= RUNE_GOOD && (best < 0 || off < Math.abs(game.tick - (bar.at + best * bar.beat)))) best = i; });
  if (best < 0) { m.combo = 0; return; }
  if (bar.lanes[best] !== lane) { bar.res[best] = -1; m.combo = 0; return; }
  bar.res[best] = Math.abs(game.tick - (bar.at + best * bar.beat)) <= RUNE_PERFECT ? 2 : 1;
  m.combo++;
}
function finishBar(game, player) {
  const bar = player.mech.bar, slot = index(game, player);
  const max = 2 * bar.lanes.filter(l => l >= 0).length, power = bar.res.reduce((sum, r) => sum + Math.max(0, r), 0);
  if (power * 2 < max) return; // under half: the bar fizzles
  const byGate = game.zombies.filter(z => z.hp > 0).sort((a, b) => b.y - a.y || a.id - b.id), strong = power * 4 >= max * 3;
  player.stats.rounds++;
  // Hold person: pins the zombie nearest the gate (two on a strong bar). It can still be hurt by others.
  const duration = 30 + Math.floor(60 * power / max);
  for (const z of byGate.slice(0, strong ? 2 : 1)) { z.frozen = Math.max(z.frozen, duration); z.holdBy = slot; log(game, 'hold', slot, z.id, duration); player.stats.holds++; }
}

// --- simon: watch the pads light up, repeat them; every finished round heals the party.
function simonTick(game, player) {
  const m = player.mech;
  if (game.phase !== 'wave' || player.downed || m.mode === 0) { m.phase = 'rest'; m.at = game.tick + 30; m.len = 0; return; }
  if (m.phase === 'rest' && game.tick >= m.at) {
    m.len = m.len || simonStart(player.tier);
    m.seq = Array.from({ length: m.len }, () => randInt(game, 4));
    m.phase = 'show'; m.at = game.tick; m.progress = 0;
  } else if (m.phase === 'show' && game.tick - m.at >= m.len * simonStep(player.tier)) {
    m.phase = 'input'; m.at = game.tick; m.deadline = game.tick + m.len * 45 + 90;
  } else if (m.phase === 'input' && game.tick > m.deadline) {
    m.phase = 'rest'; m.at = game.tick + 60; m.len = Math.max(2, m.len - 1); log(game, 'simonfail', index(game, player));
  }
}
function simonPad(game, player, pad) {
  const m = player.mech;
  if (m.phase !== 'input') return;
  const slot = index(game, player);
  if (m.seq[m.progress] !== pad) { m.phase = 'rest'; m.at = game.tick + 60; m.len = Math.max(2, m.len - 1); log(game, 'simonfail', slot); return; }
  m.progress++;
  log(game, 'simonok', slot, pad);
  if (m.progress < m.len) return;
  const amount = m.len + player.tier;
  player.stats.rounds++;
  log(game, 'simonwin', slot, amount);
  // The finished round becomes one orb that flies to whoever needs it: the most hurt ally, or the zombie nearest the gate.
  const orb = { id: game.nextId++, x: player.x, y: player.y, ox: player.x, oy: player.y, kind: 'orb', from: slot, to: -1, zid: 0, amount: 0, effect: 'heal' };
  const ratio = p => p.downed ? -1 : p.hp / p.max;
  orb.to = game.players.reduce((best, p, i) => ratio(p) < ratio(game.players[best]) ? i : best, 0);
  orb.amount = amount * 2;
  game.arrows.push(orb);
  m.phase = 'rest'; m.at = game.tick + 60; m.len = Math.min(8, m.len + 1);
}

// --- simon, touch heal: walk up to an ally, hold Space and release in the gold zone (the same timing as the tank's slam).
// A perfect release heals everyone beside her, a good one the neediest, a poor one a little. A downed ally is stood back up.
function touchHeal(game, player, held) {
  player.mech.charge = -1;
  const diff = Math.abs(held - IDEAL_CHARGE), window = chargeWindow(player.tier), slot = index(game, player);
  const power = diff <= window ? 2 : diff <= 2 * window ? 1 : 0, reach = (40 + 3 * player.tier) * PX;
  const hurt = game.players.filter(p => p !== player && dist2(p, player) <= reach * reach && (p.downed || p.hp < p.max))
    .sort((a, b) => (b.downed ? 1 : 0) - (a.downed ? 1 : 0) || a.hp * b.max - b.hp * a.max || index(game, a) - index(game, b));
  if (!hurt.length) return miss(game, player);
  for (const target of power === 2 ? hurt : hurt.slice(0, 1)) {
    if (target.downed) {
      if (!power) { miss(game, player); continue; }
      target.downed = false; target.revive = 0; target.hp = Math.max(1, Math.ceil(target.max * 2 / 5));
      player.stats.revives++; log(game, 'revive', slot, index(game, target));
      continue;
    }
    const amount = Math.min(target.max - target.hp, power === 2 ? 8 + 2 * player.tier : power === 1 ? 5 + player.tier : 2);
    target.hp += amount; player.stats.healed += amount;
    log(game, 'heal', slot, index(game, target), amount);
  }
  player.stats.casts++;
}

// --- striker, slash stance: rings close on the zombie nearest the gate; Space as they meet teleports her there for a sweep.
function strikerTick(game, player) {
  const m = player.mech;
  if (m.mode !== 1 || game.phase !== 'wave' || player.downed) { m.slash = null; return; }
  if (m.slash) {
    if (!game.zombies.some(z => z.id === m.slash.zid && z.hp > 0)) m.slash = null;
    else if (game.tick > m.slash.at + slashWindow(player.tier)) { m.slash = null; m.next = game.tick + 15; log(game, 'slashmiss', index(game, player)); }
  }
  if (m.slash || game.tick < m.next) return;
  const target = game.zombies.filter(z => z.hp > 0).sort((a, b) => b.y - a.y || a.id - b.id)[0];
  if (target) m.slash = { zid: target.id, start: game.tick, at: game.tick + SLASH_LEAD };
}
function slashPress(game, player) {
  const m = player.mech, slot = index(game, player);
  if (!m.slash) return;
  const target = game.zombies.find(z => z.id === m.slash.zid && z.hp > 0), off = game.tick - m.slash.at, window = slashWindow(player.tier);
  if (!target) { m.slash = null; return; }
  if (Math.abs(off) > window) { m.slash = null; m.next = game.tick + 20; log(game, 'slashmiss', slot); return; } // too early: she whiffs
  const perfect = Math.abs(off) <= window >> 1, radius = (30 + 3 * player.tier) * PX, damage = 2 + (player.tier >> 1) + (perfect ? 1 : 0);
  player.x = player.ox = clamp(target.x, PLAYER_MIN_X, PLAYER_MAX_X); player.y = player.oy = clamp(target.y, PLAYER_MIN_Y, PLAYER_MAX_Y);
  log(game, 'slash', slot, target.id, perfect ? 1 : 0);
  for (const z of game.zombies.filter(z => z.hp > 0 && dist2(z, target) <= radius * radius)) hurt(game, z, damage, player);
  player.stats.cuts++; m.slash = null; m.next = game.tick + 30;
}

function mechanicsTick(game) {
  for (const p of game.players) {
    if (p.role === 'tank') {
      const pl = p.mech.plant;
      if (pl && (p.downed || game.phase !== 'wave')) p.mech.plant = null;
      else if (pl && game.tick > pl.next + plantWindow(p.tier)) { pl.dur--; pl.next += PLANT_PERIOD; log(game, 'clank', index(game, p), 1); if (pl.dur <= 0) breakShield(game, p); }
      if (p.downed) p.mech.charge = -1;
      else if (p.mech.charge >= 0 && game.tick - p.mech.charge >= CHARGE_MAX) release(game, p, CHARGE_MAX);
    } else if (p.role === 'cutter' || p.role === 'pitch') barTick(game, p);
    else if (p.role === 'simon') {
      if (p.downed || game.phase !== 'wave') p.mech.charge = -1;
      else if (p.mech.charge >= 0 && game.tick - p.mech.charge >= CHARGE_MAX) touchHeal(game, p, CHARGE_MAX);
      simonTick(game, p);
    } else if (p.role === 'striker') strikerTick(game, p);
  }
}

function fightWord(game, player, word) {
  const range = ranges(player);
  const candidates = game.zombies.filter(z => z.word === word && eligible(z)).sort((a, b) => dist2(a, player) - dist2(b, player) || a.id - b.id);
  const target = candidates[0];
  if (!target || dist2(target, player) > range * range) return miss(game, player);
  const slot = index(game, player);
  const raw = 1 + (player.tier >> 1) + (isBard(player) && beatOffset(game, player) <= BEAT_WORD ? 1 : 0), damage = target.type === 'brute' ? Math.max(1, raw >> 1) : raw;
  target.pending += damage;
  game.arrows.push({ id: game.nextId++, x: player.x, y: player.y, ox: player.x, oy: player.y, zid: target.id, damage, from: slot });
  log(game, 'fire', slot, target.id, isBard(player) && beatOffset(game, player) <= BEAT_WORD ? 1 : 0);
}

function healerWord(game, player, word) {
  const target = game.players.find(p => p.key === word);
  if (!target || dist2(target, player) > ranges(player) ** 2) return miss(game, player);
  const slot = index(game, player);
  if (target.downed) {
    target.revive++;
    log(game, 'mend', slot, index(game, target));
    if (target.revive >= 3) {
      target.downed = false; target.revive = 0; target.hp = Math.max(1, Math.floor(target.max * 2 / 5));
      player.stats.revives++; log(game, 'revive', slot, index(game, target));
    }
    return;
  }
  const amount = Math.min(target.max - target.hp, 6 + 2 * player.tier);
  if (amount <= 0) return miss(game, player);
  target.hp += amount; player.stats.healed += amount;
  log(game, 'heal', slot, index(game, target), amount);
}

function supportWord(game, player, word) {
  const spells = spellsFor(player.cls), spell = spells.indexOf(word);
  if (spell < 0 || player.spellCd[spell] > 0) return miss(game, player);
  const duration = 180 + 60 * player.tier, radius = (90 + 10 * player.tier) * PX, slot = index(game, player);
  const near = list => list.filter(item => (item.hp === undefined || item.hp > 0) && dist2(item, player) <= radius * radius);
  if (word === 'haste') game.buffs.haste = Math.max(game.buffs.haste, duration);
  else if (word === 'bless') game.buffs.bless = Math.max(game.buffs.bless, duration);
  else if (word === 'hush') near(game.zombies).forEach(z => { z.slow = Math.max(z.slow, duration); });
  else if (word === 'frost') near(game.zombies).forEach(z => { z.frozen = Math.max(z.frozen, 60 + 30 * player.tier); });
  else if (word === 'blast') near(game.zombies).forEach(z => hurt(game, z, 2 + (player.tier >> 1), player));
  else if (word === 'shield') game.players.forEach(p => { if (!p.downed) p.shield = Math.min(SHIELD_MAX, p.shield + 4); });
  player.spellCd[spell] = SPELL_COOLDOWN; player.cooldown = CAST_COOLDOWN; player.stats.casts++;
  log(game, 'cast', slot, spell, spells.length);
}

function hurt(game, zombie, damage, by) {
  zombie.hp -= damage;
  by.stats.damage += damage;
  if (zombie.hp > 0) {
    if (zombie.type === 'brute') zombie.word = pickWord(game, 'brute');
    log(game, 'hit', zombie.id);
    return;
  }
  by.stats.kills++;
  log(game, 'kill', zombie.id, zombie.x >> 4, zombie.y >> 4);
}

// --- one tick
export function step(game, events = []) {
  if (game.phase === 'won' || game.phase === 'lost') return game;
  for (const p of game.players) { p.ox = p.x; p.oy = p.y; }
  for (const z of game.zombies) { z.ox = z.x; z.oy = z.y; }
  for (const a of game.arrows) { a.ox = a.x; a.oy = a.y; }
  for (const event of events) applyEvent(game, event);
  advancePhase(game);
  movePlayers(game);
  mechanicsTick(game);
  moveArrows(game);
  zombiesAct(game);
  game.zombies = game.zombies.filter(z => z.hp > 0);
  tickDown(game);
  if (game.gate.hp <= 0 || game.players.every(p => p.downed)) { game.phase = 'lost'; log(game, 'lost'); }
  game.tick++;
  game.log = game.log.filter(entry => entry.t > game.tick - LOG_TICKS);
  if (game.tick >= MAX_TICKS && game.phase !== 'won') game.phase = 'lost';
  return game;
}

function advancePhase(game) {
  if (game.phase === 'countdown' || game.phase === 'between') {
    // The next wave starts when the timer runs out, or a few seconds after everyone has rolled.
    if (game.players.every(p => p.downed || p.rolled)) game.timer = Math.min(game.timer, EARLY_START);
    if (--game.timer <= 0) startWave(game);
  } else if (game.phase === 'wave') {
    const s = game.spawn;
    if (s.left > 0 && --s.wait <= 0) { spawnZombie(game); s.wait = s.every; }
    if (s.left === 0 && !game.zombies.length && !game.arrows.length) {
      if (game.wave >= WAVES) { game.phase = 'won'; log(game, 'won'); return; }
      enterBetween(game);
    }
  }
}
// A breather between waves: downed players get back up, everyone recovers a little, and everyone rolls again.
function enterBetween(game) {
  game.phase = 'between'; game.timer = BETWEEN;
  for (const p of game.players) {
    p.rolled = false; p.shield = 0; p.dx = p.dy = 0;
    if (p.downed) { p.downed = false; p.revive = 0; p.hp = Math.max(1, Math.ceil(p.max * 3 / 10)); } else p.hp = Math.min(p.max, p.hp + Math.ceil(p.max / 4));
  }
  log(game, 'between', game.wave);
}

function movePlayers(game) {
  const speed = playerSpeed(game);
  for (const p of game.players) {
    if (p.downed || !p.dx && !p.dy || p.role === 'tank' && p.mech.plant) continue;
    // Diagonals keep the same speed on both axes (a slight speed-up, fixed for everyone).
    const pace = (p.role === 'tank' || p.role === 'simon') && p.mech.charge >= 0 ? speed >> 1 : speed;
    p.x = clamp(p.x + p.dx * pace, PLAYER_MIN_X, PLAYER_MAX_X);
    p.y = clamp(p.y + p.dy * pace, PLAYER_MIN_Y, PLAYER_MAX_Y);
  }
}

function moveOrb(game, orb, live) {
  const caster = game.players[orb.from];
  const target = orb.effect === 'heal' ? game.players[orb.to] : game.zombies.find(z => z.id === orb.zid && z.hp > 0);
  if (!target) return;
  const next = stepToward(orb, target, ORB_SPEED);
  if (!next.arrived) { orb.x = next.x; orb.y = next.y; live.push(orb); return; }
  orb.x = target.x; orb.y = target.y;
  if (orb.effect === 'hurt') { hurt(game, target, orb.amount, caster); log(game, 'orbhit', orb.from, target.id, orb.amount); return; }
  const slot = orb.to;
  if (target.downed) { target.downed = false; target.revive = 0; target.hp = Math.max(1, Math.ceil(target.max * 2 / 5)); caster.stats.revives++; log(game, 'revive', orb.from, slot); }
  const gain = Math.min(target.max - target.hp, orb.amount);
  target.hp += gain; caster.stats.healed += gain;
  target.shield = Math.min(SHIELD_MAX, target.shield + ((orb.amount - gain) >> 1)); // healing beyond full becomes shield
  log(game, 'heal', orb.from, slot, gain);
}
function moveArrows(game) {
  const live = [];
  for (const arrow of game.arrows) {
    if (arrow.kind === 'orb') { moveOrb(game, arrow, live); continue; }
    const target = game.zombies.find(z => z.id === arrow.zid);
    if (!target || target.hp <= 0) continue;
    const next = stepToward(arrow, target, ARROW_SPEED);
    if (!next.arrived) { arrow.x = next.x; arrow.y = next.y; live.push(arrow); continue; }
    arrow.x = target.x; arrow.y = target.y;
    if (arrow.from < 0) {
      target.chip = (target.chip || 0) + 1;
      if (target.chip >= 2) { target.chip = 0; hurt(game, target, 1, game.crowd[arrow.fan]); }
      continue;
    }
    target.pending = Math.max(0, target.pending - arrow.damage);
    hurt(game, target, arrow.damage, game.players[arrow.from]);
  }
  game.arrows = live;
}

function zombiesAct(game) {
  const tanks = game.players.filter(p => p.role === 'tank' && !p.downed);
  const alive = game.players.filter(p => !p.downed);
  for (const z of game.zombies) {
    if (z.hp <= 0) continue;
    if (z.cool > 0) z.cool--;
    if (z.frozen > 0) { if (--z.frozen === 0) z.holdBy = -1; continue; }
    const def = ZOMBIES[z.type];
    // Speed is counted in quarter units per tick, so every setting from 1 to 5 divides evenly.
    z.sp = (z.sp || 0) + (z.slow > 0 ? (def.speed * game.speed) >> 1 : def.speed * game.speed);
    const speed = z.sp >> 2; z.sp &= 3;
    if (z.slow > 0) z.slow--;
    let target = null;
    const planted = tanks.filter(t => t.mech.plant);
    for (const t of planted) if (!target || dist2(z, t) < dist2(z, target)) target = t; // a planted shield pulls every zombie in
    if (!planted.length) for (const t of tanks) {
      const radius = (50 + 10 * t.tier) * PX;
      if (dist2(z, t) <= radius * radius && (!target || dist2(z, t) < dist2(z, target))) target = t;
    }
    if (!target) {
      const aggro = 56 * PX;
      for (const p of alive) if (dist2(z, p) <= aggro * aggro && (!target || dist2(z, p) < dist2(z, target))) target = p;
    }
    if (target) {
      const reach = 20 * PX;
      if (dist2(z, target) <= reach * reach) { if (z.cool === 0) { bite(game, z, target); z.cool = def.cool; } }
      else { const next = stepToward(z, target, speed, z); z.x = next.x; z.y = next.y; }
      continue;
    }
    if (z.y >= ARENA.gateY - GATE_REACH) {
      if (z.cool === 0) { game.gate.hp -= def.damage; z.cool = def.cool; log(game, 'gate', z.x >> 4); }
    } else z.y = Math.min(ARENA.gateY - GATE_REACH, z.y + speed);
  }
}

function bite(game, zombie, player) {
  let damage = ZOMBIES[zombie.type].damage;
  if (player.role === 'tank' && player.mech.plant) damage = Math.max(1, Math.ceil(damage / 3)); // behind the planted shield
  if (game.buffs.bless > 0) damage = (damage + 1) >> 1;
  const absorbed = Math.min(player.shield, damage);
  player.shield -= absorbed; player.stats.blocked += absorbed;
  const dealt = damage - absorbed;
  player.hp -= dealt; player.stats.taken += dealt;
  log(game, 'bite', index(game, player), zombie.id, dealt);
  if (player.hp <= 0) { player.hp = 0; player.downed = true; player.dx = player.dy = 0; player.revive = 0; log(game, 'down', index(game, player)); }
}

function tickDown(game) {
  if (game.buffs.haste > 0) game.buffs.haste--;
  if (game.buffs.bless > 0) game.buffs.bless--;
  for (const p of game.players) {
    if (p.cooldown > 0) p.cooldown--;
    p.spellCd = p.spellCd.map(v => v > 0 ? v - 1 : 0);
  }
  for (const fan of game.crowd) if (fan.cooldown > 0) fan.cooldown--;
}

export function gameResults(game) {
  const players = game.players.map(p => {
    const s = p.stats;
    return { pcId: p.pcId, name: p.name, role: p.role, tier: p.tier, downed: p.downed, ...s,
      score: s.kills * 2 + (s.healed >> 1) + (s.blocked >> 1) + s.casts * 3 + s.revives * 5 + s.slams * 2 + (s.cuts >> 1) + s.rounds * 4 + s.holds * 4 };
  });
  const best = Math.max(0, ...players.map(p => p.score));
  return { phase: game.phase, wave: game.wave, gate: game.gate.hp, players, mvp: best > 0 ? players.find(p => p.score === best).pcId : null,
    crowd: { fans: game.crowd.length, kills: game.crowd.reduce((sum, f) => sum + f.stats.kills, 0) },
    kills: players.reduce((sum, p) => sum + p.kills, 0) + game.crowd.reduce((sum, f) => sum + f.stats.kills, 0), over: game.phase === 'won' || game.phase === 'lost' };
}

// --- the shared input log, replayed deterministically from checkpoints.
export class HordeTimeline {
  constructor(config) {
    this.config = config;
    this.byTick = new Map();
    this.seen = new Set();
    this.checkpoints = [clone(createGame(config))];
    this.head = null;
  }
  addEvent(event) {
    if (!validEvent(event, this.config.participants)) return false;
    const id = `${event.pcId}#${event.seq}`;
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    const list = this.byTick.get(event.t) || [];
    list.push(event);
    list.sort((a, b) => a.pcId < b.pcId ? -1 : a.pcId > b.pcId ? 1 : a.seq - b.seq);
    this.byTick.set(event.t, list);
    // Anything simulated at or after this tick is stale.
    if (this.head && this.head.tick > event.t) this.head = null;
    this.checkpoints = this.checkpoints.filter(c => c.tick <= event.t);
    return true;
  }
  // The returned state is shared and valid until the next call; treat it as read-only.
  stateAt(tick) {
    if (!Number.isInteger(tick) || tick < 0) throw new Error('Choose a tick.');
    if (!this.head || this.head.tick > tick) {
      const base = this.checkpoints.filter(c => c.tick <= tick).pop() || this.checkpoints[0];
      this.head = clone(base);
    }
    while (this.head.tick < tick && this.head.phase !== 'won' && this.head.phase !== 'lost') {
      step(this.head, this.byTick.get(this.head.tick) || []);
      if (this.head.tick % CHECKPOINT === 0 && !this.checkpoints.some(c => c.tick === this.head.tick)) this.checkpoints.push(clone(this.head));
    }
    return this.head;
  }
}
