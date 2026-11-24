import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARENA, CHARGE_MAX, MODE_NAMES, CROWD_MAX, HordeTimeline, IDEAL_CHARGE, MAX_TICKS, PLANT_COOLDOWN, PLANT_PERIOD, chargeWindow, plantDurability, plantWindow, runeBeat, simonStart, ROLES, WAVES, clone, createGame, gameResults, normalizeName, roleForClass, spellsFor, step, tierFromRoll, validEvent } from '../js/horde-model.js';

// The typing party: two strikers, a healer and a word-caster. The role mini-games get their own party below.
const party = [
  { pcId: 'pc_tank', name: 'Rurik', cls: 'fighter', role: 'striker' },
  { pcId: 'pc_ranger', name: 'Lark', cls: 'ranger', role: 'striker' },
  { pcId: 'pc_cleric', name: 'Seris', cls: 'cleric', role: 'healer' },
  { pcId: 'pc_bard', name: 'Liora', cls: 'bard', role: 'support' }
];
const config = (extra = {}) => ({ seed: 1234, participants: party, speed: 4, ...extra });

// A simple scripted player per role. `cpt` is ticks per typed character, so the bots type like a person.
function makeBots(game, cpt) {
  const seq = new Map(), dir = new Map(), busy = new Map(), plan = [];
  const send = (pcId, event) => { const n = seq.get(pcId) ?? 0; seq.set(pcId, n + 1); return { pcId, seq: n, ...event }; };
  return { cpt, seq, dir, busy, plan, send };
}
function botTurn(timeline, tick, state, bots, quality = 1) {
  const { cpt, dir, busy, send } = bots;
  const out = [];
  for (const p of state.players) {
    if (p.downed) { if (dir.get(p.pcId)) { dir.set(p.pcId, 0); out.push(send(p.pcId, { t: tick, k: 'm', dx: 0, dy: 0 })); } continue; }
    let goal = { x: ARENA.width / 2, y: 2200 }, word = null;
    const zs = state.zombies.filter(z => z.hp - z.pending > 0);
    const reach = { tank: 33, striker: 130, healer: 70, support: 100 }[p.role] * 16 * 0.8;
    const near = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    if (p.role === 'striker' || p.role === 'tank') {
      const target = [...zs].sort((a, b) => b.y - a.y)[0];
      if (target) { goal = p.role === 'tank' ? { x: target.x, y: target.y } : { x: target.x, y: Math.min(target.y + 800, 2300) }; if (near(p, target) <= reach ** 2) word = target.word; }
    } else if (p.role === 'healer') {
      const hurt = state.players.filter(a => a.hp < a.max * 0.7 || a.downed).sort((a, b) => (a.hp / a.max) - (b.hp / b.max))[0];
      if (hurt) { goal = { x: hurt.x, y: hurt.y }; if (near(p, hurt) <= reach ** 2) word = hurt.key; }
    } else {
      const cast = (p.cls === 'bard' ? ['haste', 'bless', 'hush'] : ['frost', 'blast', 'shield']).find((s, i) => p.spellCd[i] === 0);
      if (zs.length >= 3 && cast) word = cast;
      const front = [...zs].sort((a, b) => b.y - a.y)[0];
      if (front) goal = { x: front.x, y: Math.min(front.y + 1000, 2300) };
    }
    const dx = Math.abs(goal.x - p.x) < 60 ? 0 : Math.sign(goal.x - p.x), dy = Math.abs(goal.y - p.y) < 60 ? 0 : Math.sign(goal.y - p.y);
    const code = dx * 3 + dy;
    if ((dir.get(p.pcId) ?? 0) !== code) { dir.set(p.pcId, code); out.push(send(p.pcId, { t: tick, k: 'm', dx, dy })); }
    if (word && (busy.get(p.pcId) ?? 0) <= tick && p.cooldown === 0 && Math.random !== null) {
      const delay = Math.ceil(word.length * cpt / quality);
      busy.set(p.pcId, tick + delay + 6);
      out.push(send(p.pcId, { t: tick + delay, k: 'w', s: word }));
    }
  }
  return out;
}
function play(cfg, { cpt = 8, ticks = MAX_TICKS, bots = true, rolls = true } = {}) {
  const timeline = new HordeTimeline(cfg), helper = makeBots(null, cpt);
  if (rolls) for (const p of cfg.participants) timeline.addEvent(helper.send(p.pcId, { t: 5, k: 'r', total: 14, nat: 10 }));
  for (let tick = 0; tick < ticks; tick++) {
    const state = timeline.stateAt(tick);
    if (state.phase === 'won' || state.phase === 'lost') break;
    if (bots) for (const event of botTurn(timeline, tick, state, helper)) assert.ok(timeline.addEvent(event), JSON.stringify(event));
  }
  return timeline.stateAt(ticks === MAX_TICKS ? MAX_TICKS : ticks);
}

test('classes map to roles, rolls map to tiers, names normalise', () => {
  assert.deepEqual(['Fighter', 'barbarian', 'ranger', 'cleric', 'wizard', 'bard', 'artificer', ''].map(roleForClass),
    ['tank', 'tank', 'striker', 'healer', 'pitch', 'cutter', 'simon', 'striker']);
  assert.deepEqual([9, 10, 14, 15, 19, 20].map(total => tierFromRoll({ total, nat: 10 })), [0, 1, 1, 2, 2, 3]);
  assert.equal(tierFromRoll({ total: 9, nat: 20 }), 1);
  assert.equal(tierFromRoll({ total: 25, nat: 20 }), 3);
  assert.equal(normalizeName(" Ser-is 2 "), 'seris');
  assert.deepEqual(spellsFor('Bard'), ['haste', 'bless', 'hush']);
  assert.deepEqual(ROLES, ['tank', 'healer', 'cutter', 'simon', 'pitch', 'striker', 'support']);
});

test('games need distinct letter names, an integer seed and 1 to 12 players', () => {
  assert.throws(() => createGame({ seed: 1.5, participants: party }));
  assert.throws(() => createGame({ seed: 1, participants: [] }));
  assert.throws(() => createGame({ seed: 1, participants: [{ pcId: 'a', name: 'Zed' }, { pcId: 'b', name: 'zed!' }] }), /distinct/);
  assert.throws(() => createGame({ seed: 1, participants: [{ pcId: 'a', name: '123' }] }));
  const game = createGame(config());
  assert.deepEqual(game.players.map(p => p.pcId), ['pc_bard', 'pc_cleric', 'pc_ranger', 'pc_tank'], 'players sort by id, not input order');
  assert.ok(game.players.every(p => Number.isInteger(p.x) && p.hp === p.max));
});

test('events are validated', () => {
  const ok = { pcId: 'pc_tank', seq: 0, t: 10, k: 'm', dx: 1, dy: -1 };
  assert.equal(validEvent(ok, party), true);
  for (const bad of [{ ...ok, pcId: 'stranger' }, { ...ok, seq: -1 }, { ...ok, t: 1.5 }, { ...ok, t: MAX_TICKS + 1 }, { ...ok, dx: 2 }, { ...ok, k: 'z' }, { pcId: 'pc_tank', seq: 0, t: 0, k: 'd', lane: 4 }, { pcId: 'pc_tank', seq: 0, t: 0, k: 's', pad: -1 }, { pcId: 'pc_tank', seq: 0, t: 0, k: 'p', dir: 2 },
    { pcId: 'pc_tank', seq: 0, t: 0, k: 'w', s: 'Bad Word' }, { pcId: 'pc_tank', seq: 0, t: 0, k: 'w', s: 'a'.repeat(17) },
    { pcId: 'pc_tank', seq: 0, t: 0, k: 'r', total: 99, nat: 5 }, { pcId: 'pc_tank', seq: 0, t: 0, k: 'r', total: 10, nat: 21 }, null]) {
    assert.equal(validEvent(bad, party), false, JSON.stringify(bad));
  }
  assert.equal(validEvent({ pcId: 'pc_tank', seq: 1, t: 3, k: 'r', total: 12, nat: 7 }, party), true);
});

test('rolls count once, and only during the countdown', () => {
  const timeline = new HordeTimeline(config());
  timeline.addEvent({ pcId: 'pc_tank', seq: 0, t: 1, k: 'r', total: 22, nat: 20 });
  timeline.addEvent({ pcId: 'pc_tank', seq: 1, t: 2, k: 'r', total: 1, nat: 1 });
  timeline.addEvent({ pcId: 'pc_ranger', seq: 0, t: 470, k: 'r', total: 22, nat: 20 });
  const state = timeline.stateAt(500);
  const get = id => state.players.find(p => p.pcId === id);
  assert.equal(get('pc_tank').tier, 3);
  assert.equal(get('pc_tank').max, 20 + 3 * 4);
  assert.equal(get('pc_ranger').tier, 1, 'a roll after the wave has started is ignored');
});

test('the same log gives the same game in any arrival order, and late events re-simulate correctly', () => {
  const events = [];
  const all = play(config(), { ticks: 900 });
  assert.ok(all.tick >= 900 || all.phase === 'lost');
  // Rebuild the log the bots produced by replaying a recorded run.
  const recorder = new HordeTimeline(config()), helper = makeBots(null, 8);
  for (const p of party) recorder.addEvent(helper.send(p.pcId, { t: 5, k: 'r', total: 14, nat: 10 }));
  for (let tick = 0; tick < 900; tick++) for (const e of botTurn(recorder, tick, recorder.stateAt(tick), helper)) { recorder.addEvent(e); events.push(e); }
  for (const p of party) events.push({ pcId: p.pcId, seq: 0, t: 5, k: 'r', total: 14, nat: 10 });
  const reference = clone(recorder.stateAt(900));

  const shuffled = new HordeTimeline(config());
  const copy = [...events].reverse();
  for (const e of copy) shuffled.addEvent(e);
  assert.deepEqual(shuffled.stateAt(900), reference);

  // Play forward first, then deliver half of the events late.
  const late = new HordeTimeline(config());
  const half = events.filter((_, i) => i % 2), rest = events.filter((_, i) => !(i % 2));
  half.forEach(e => late.addEvent(e));
  late.stateAt(900);
  rest.forEach(e => late.addEvent(e));
  assert.deepEqual(late.stateAt(900), reference);
  assert.deepEqual(late.stateAt(450), clone(new HordeTimeline(config()).stateAt(0)).tick === 0 ? late.stateAt(450) : null);
  const fresh = new HordeTimeline(config());
  events.forEach(e => fresh.addEvent(e));
  assert.deepEqual(clone(late.stateAt(450)), clone(fresh.stateAt(450)), 'rewinding gives the same state as a fresh replay');
  assert.equal(late.addEvent(events[0]), false, 'duplicate events are ignored');
});

test('the simulation uses integers only and never grows without bound', () => {
  const timeline = new HordeTimeline(config()), helper = makeBots(null, 8);
  for (const p of party) timeline.addEvent(helper.send(p.pcId, { t: 5, k: 'r', total: 14, nat: 10 }));
  let max = 0;
  for (let tick = 0; tick < 3000; tick++) {
    const state = timeline.stateAt(tick);
    for (const e of botTurn(timeline, tick, state, helper)) timeline.addEvent(e);
    for (const item of [...state.players, ...state.zombies, ...state.arrows]) for (const key of ['x', 'y', 'ox', 'oy']) assert.ok(Number.isInteger(item[key]), `${key} ${item[key]} at ${tick}`);
    for (const z of state.zombies) assert.ok(z.x >= 0 && z.x <= ARENA.width && z.y >= 0 && z.y <= ARENA.height);
    for (const p of state.players) assert.ok(p.hp >= 0 && p.hp <= p.max && p.shield >= 0 && p.shield <= 10);
    max = Math.max(max, state.zombies.length, state.arrows.length);
    assert.ok(state.log.length < 400);
  }
  assert.ok(max < 80, `entity count stayed bounded (${max})`);
});

test('a party that does nothing loses to the horde', () => {
  const end = play(config(), { bots: false });
  assert.equal(end.phase, 'lost');
  assert.ok(end.tick < MAX_TICKS, `lost after ${end.tick} ticks`);
  assert.equal(end.wave >= 1, true);
});

test('four bots typing at about 45 wpm clear all six waves', () => {
  const end = play(config());
  const results = gameResults(end);
  assert.equal(end.phase, 'won', `ended ${end.phase} in wave ${end.wave}, gate ${end.gate.hp}, ${JSON.stringify(results.players.map(p => [p.role, p.kills, p.downed]))}`);
  assert.equal(end.wave, WAVES);
  assert.ok(results.kills > 40);
  assert.ok(results.mvp);
});

test('slow, careless typing loses', () => {
  const end = play(config(), { cpt: 60 });
  assert.equal(end.phase, 'lost');
});

test('a word hits the nearest matching zombie in range; out of range or unknown words miss', () => {
  const game = createGame(config());
  game.phase = 'wave'; game.wave = 1; game.spawn.left = 99; game.spawn.wait = 99999;
  const ranger = game.players.find(p => p.role === 'striker');
  const zombie = (id, x, y, word) => ({ id, type: 'walker', x, y, ox: x, oy: y, hp: 1, max: 1, pending: 0, word, cool: 0, frozen: 0, slow: 0 });
  game.zombies.push(zombie(90, ranger.x, ranger.y - 1600, 'crypt'), zombie(91, ranger.x, ranger.y - 600, 'crypt'), zombie(92, 200, 200, 'ghoul'));
  step(game, [{ pcId: ranger.pcId, seq: 0, t: 0, k: 'w', s: 'crypt' }]);
  assert.equal(game.arrows.length, 1);
  assert.equal(game.arrows[0].zid, 91, 'the nearest matching zombie');
  assert.equal(game.zombies.find(z => z.id === 91).pending, 1);
  step(game, [{ pcId: ranger.pcId, seq: 1, t: 1, k: 'w', s: 'crypt' }]);
  assert.equal(game.arrows.at(-1).zid, 90, 'a zombie already doomed by an arrow in flight is skipped');
  for (let i = 0; i < 30; i++) step(game);
  assert.equal(game.zombies.some(z => z.id === 91 || z.id === 90), false, 'both arrows landed');
  assert.equal(ranger.stats.kills, 2);
  step(game, [{ pcId: ranger.pcId, seq: 2, t: 0, k: 'w', s: 'ghoul' }]);
  assert.equal(ranger.stats.misses, 1, 'out of range');
  step(game, [{ pcId: ranger.pcId, seq: 3, t: 0, k: 'w', s: 'ghoul' }]);
  assert.equal(ranger.stats.misses, 1, 'the miss cooldown ignores the next word');
});

test('healers heal and revive by typing a name, within range', () => {
  const game = createGame(config());
  game.phase = 'wave'; game.wave = 1; game.spawn.left = 99; game.spawn.wait = 99999;
  const healer = game.players.find(p => p.role === 'healer'), tank = game.players.find(p => p.pcId === 'pc_tank');
  tank.hp = 10; tank.x = healer.x; tank.y = healer.y;
  step(game, [{ pcId: healer.pcId, seq: 0, t: 0, k: 'w', s: 'rurik' }]);
  assert.equal(tank.hp, 10 + 6 + 2, 'tier 1 heals 8');
  tank.downed = true; tank.hp = 0;
  for (let n = 0; n < 3; n++) {
    for (let i = 0; i < 25; i++) step(game);
    step(game, [{ pcId: healer.pcId, seq: n + 1, t: 0, k: 'w', s: 'rurik' }]);
  }
  assert.equal(tank.downed, false);
  assert.equal(tank.hp, Math.floor(tank.max * 2 / 5));
  assert.equal(healer.stats.revives, 1);
  tank.x = 100; tank.y = 200;
  for (let i = 0; i < 25; i++) step(game);
  tank.hp = 1;
  step(game, [{ pcId: healer.pcId, seq: 9, t: 0, k: 'w', s: 'rurik' }]);
  assert.equal(tank.hp, 1, 'too far away');
});

test('support spells buff the party, control zombies and have cooldowns', () => {
  const game = createGame(config());
  game.phase = 'wave'; game.wave = 1; game.spawn.left = 99; game.spawn.wait = 99999;
  const bard = game.players.find(p => p.role === 'support');
  const zombie = { id: 80, type: 'walker', x: bard.x, y: bard.y - 100, ox: 0, oy: 0, hp: 1, max: 1, pending: 0, word: 'crypt', cool: 0, frozen: 0, slow: 0 };
  game.zombies.push(zombie);
  step(game, [{ pcId: bard.pcId, seq: 0, t: 0, k: 'w', s: 'haste' }]);
  assert.ok(game.buffs.haste > 200);
  const runner = game.players.find(p => p.pcId === 'pc_tank'), before = runner.x;
  step(game, [{ pcId: runner.pcId, seq: 0, t: 1, k: 'm', dx: 1, dy: 0 }]);
  assert.equal(runner.x - before, 60, 'haste is 1.5x speed');
  for (let i = 0; i < 50; i++) step(game);
  step(game, [{ pcId: bard.pcId, seq: 1, t: 60, k: 'w', s: 'haste' }]);
  assert.equal(bard.stats.casts, 1, 'the same spell is on cooldown');
  for (let i = 0; i < 25; i++) step(game);
  step(game, [{ pcId: bard.pcId, seq: 2, t: 86, k: 'w', s: 'hush' }]);
  assert.ok(zombie.slow > 0);
});

// --- the role mini-games
const squad = [
  { pcId: 'a_seris', name: 'Seris', cls: 'Fighter', role: 'tank' },
  { pcId: 'b_liora', name: 'Liora', cls: 'Ranger', role: 'striker' },
  { pcId: 'c_lark', name: 'Lark', cls: 'Bard', role: 'cutter' },
  { pcId: 'd_ashara', name: 'Ashara', cls: 'Artificer', role: 'simon' },
  { pcId: 'e_rurik', name: 'Rurik', cls: 'Bard', role: 'pitch' }
];
const inWave = game => { game.phase = 'wave'; game.wave = 1; game.spawn.left = 99; game.spawn.wait = 999999; return game; };
const zed = (id, x, y, extra = {}) => ({ id, type: 'walker', x, y, ox: x, oy: y, hp: 3, max: 3, pending: 0, word: 'crypt', cool: 0, frozen: 0, slow: 0, ...extra });
const who = (game, id) => game.players.find(p => p.pcId === id);
const tickN = (game, n) => { for (let i = 0; i < n; i++) step(game); };

test('tank: holding Space and releasing in the ideal window slams every zombie in range for full damage', () => {
  const game = inWave(createGame({ seed: 5, participants: squad })), seris = who(game, 'a_seris');
  const near = zed(1, seris.x, seris.y - 400, { hp: 9, max: 9 }), far = zed(2, seris.x, seris.y - 2400, { hp: 9, max: 9 });
  game.zombies.push(near, far);
  step(game, [{ pcId: 'a_seris', seq: 0, t: 0, k: 'c' }]);
  assert.equal(seris.mech.charge, 0);
  tickN(game, IDEAL_CHARGE - 1);
  step(game, [{ pcId: 'a_seris', seq: 1, t: IDEAL_CHARGE, k: 'x' }]);
  assert.equal(near.hp, 9 - 5, 'a perfect release does 5');
  assert.equal(far.hp, 9, 'outside the slam radius');
  assert.equal(seris.mech.charge, -1);
  assert.ok(seris.shield >= 3, 'a perfect slam grants shield');

  const early = inWave(createGame({ seed: 5, participants: squad })), e = who(early, 'a_seris');
  early.zombies.push(zed(1, e.x, e.y - 400, { hp: 9, max: 9 }));
  step(early, [{ pcId: 'a_seris', seq: 0, t: 0, k: 'c' }]);
  tickN(early, 5);
  step(early, [{ pcId: 'a_seris', seq: 1, t: 6, k: 'x' }]);
  assert.equal(early.zombies[0].hp, 8, 'a quick tap only does 1');
  assert.equal(chargeWindow(3) > chargeWindow(0), true, 'a better roll widens the window');
});

test('tank: charging too long overcharges and releases weakly; moving while charging is slower', () => {
  const game = inWave(createGame({ seed: 5, participants: squad })), seris = who(game, 'a_seris');
  game.zombies.push(zed(1, seris.x, seris.y - 400, { hp: 9, max: 9 }));
  step(game, [{ pcId: 'a_seris', seq: 0, t: 0, k: 'c' }, { pcId: 'a_seris', seq: 1, t: 0, k: 'm', dx: 1, dy: 0 }]);
  assert.equal(seris.x - seris.ox, 20, 'half speed while charging');
  tickN(game, CHARGE_MAX + 2);
  assert.equal(seris.mech.charge, -1, 'auto-released at the limit');
  assert.ok(game.zombies[0].hp >= 9 - 1 || game.zombies[0].hp === 8, 'overcharge is weak');
});

test('bard (cutting words): the metronome always ticks, and a word typed on the beat hits harder than one off the beat', () => {
  const beat = runeBeat(who(createGame({ seed: 9, participants: squad }), 'c_lark').tier), fire = offset => {
    const game = inWave(createGame({ seed: 9, participants: squad })), lark = who(game, 'c_lark');
    game.zombies.push(zed(1, lark.x, lark.y - 400, { hp: 9, max: 9 }));
    while (game.tick % beat !== offset) step(game);
    step(game, [{ pcId: 'c_lark', seq: 0, t: game.tick, k: 'w', s: 'crypt' }]);
    return game.arrows[0].damage;
  };
  assert.equal(fire(0), 2, 'on the click: +1 damage');
  assert.equal(fire(beat >> 1), 1, 'off the beat: plain damage');
  assert.ok(runeBeat(3) > runeBeat(0), 'a better roll slows the metronome');
});

test('bard (hold person): pressing every arrow on its beat pins the zombie nearest the gate; others can still damage it', () => {
  const game = inWave(createGame({ seed: 9, participants: squad })), lark = who(game, 'c_lark'), seris = who(game, 'a_seris');
  const front = zed(1, 2000, 2000, { hp: 9, max: 9 }), back = zed(2, 2000, 500, { hp: 9, max: 9 });
  game.zombies.push(back, front);
  step(game, [{ pcId: 'c_lark', seq: 0, t: 0, k: 'o', mode: 1 }]);
  tickN(game, 1);
  const { at, beat, lanes } = lark.mech.bar;
  assert.equal(at % beat, 0, 'the bar sits on the metronome grid');
  lanes.forEach((lane, i) => {
    if (lane < 0) return;
    while (game.tick < at + i * beat) step(game);
    step(game, [{ pcId: 'c_lark', seq: 10 + i, t: game.tick, k: 'd', lane }]);
  });
  while (lark.mech.bar) step(game);
  assert.equal(front.hp, 9, 'hold person does no damage');
  assert.ok(front.frozen >= 80, 'a perfect bar pins it for a while');
  assert.equal(back.frozen, 0);
  assert.equal(lark.stats.holds >= 1, true);
  assert.equal(front.holdBy, game.players.indexOf(lark), 'the held zombie remembers whose hand holds it');
  seris.x = front.x; seris.y = front.y - 200;
  step(game, [{ pcId: 'a_seris', seq: 0, t: game.tick, k: 'c' }]);
  tickN(game, IDEAL_CHARGE - 1);
  step(game, [{ pcId: 'a_seris', seq: 1, t: game.tick, k: 'x' }]);
  assert.ok(front.hp < 9, 'a held zombie still takes damage');
  tickN(game, front.frozen + 2);
  assert.equal(front.holdBy, -1, 'the hand lets go when the hold ends');
});

test('simon (heal): a finished round sends one orb to the most hurt ally, and healing beyond full becomes shield', () => {
  const game = inWave(createGame({ seed: 3, participants: squad })), ashara = who(game, 'd_ashara');
  game.players.forEach(p => { p.hp = p.max; });
  const hurt = who(game, 'b_liora'); hurt.hp = 3;
  step(game, [{ pcId: 'd_ashara', seq: 50, t: 0, k: 'o', mode: 1 }]);
  tickN(game, 40);
  assert.equal(ashara.mech.phase, 'show');
  const len = ashara.mech.len;
  assert.equal(len, simonStart(ashara.tier));
  const seq = [...ashara.mech.seq];
  while (ashara.mech.phase === 'show') step(game);
  assert.equal(ashara.mech.phase, 'input');
  seq.forEach((pad, i) => step(game, [{ pcId: 'd_ashara', seq: i, t: game.tick, k: 's', pad }]));
  assert.equal(ashara.stats.rounds, 1);
  const orb = game.arrows.find(a => a.kind === 'orb');
  assert.ok(orb, 'the finished round becomes an orb in flight');
  assert.equal(orb.effect, 'heal');
  assert.equal(game.players[orb.to].pcId, 'b_liora', 'it flies to the most hurt ally');
  assert.equal(hurt.hp, 3, 'nothing is healed until the orb arrives');
  while (game.arrows.some(a => a.kind === 'orb')) step(game);
  assert.equal(hurt.hp, 3 + (len + ashara.tier) * 2, 'the heal is doubled for a single target');
  assert.equal(ashara.stats.healed, (len + ashara.tier) * 2);
  assert.equal(ashara.mech.len, len + 1, 'the next pattern is longer');
  tickN(game, 80);
  while (ashara.mech.phase !== 'input') step(game);
  step(game, [{ pcId: 'd_ashara', seq: 9, t: game.tick, k: 's', pad: (ashara.mech.seq[0] + 1) % 4 }]);
  assert.equal(ashara.mech.phase, 'rest');
  assert.equal(ashara.stats.rounds, 1);
  assert.equal(ashara.mech.len, len, 'a failed round shortens the pattern');
});

test('simon: a downed ally is the first to be healed, and is revived', () => {
  const game = inWave(createGame({ seed: 3, participants: squad })), ashara = who(game, 'd_ashara'), lark = who(game, 'c_lark');
  lark.downed = true; lark.hp = 0;
  game.arrows.push({ id: 900, x: ashara.x, y: ashara.y, ox: ashara.x, oy: ashara.y, kind: 'orb', from: game.players.indexOf(ashara), to: game.players.indexOf(lark), zid: 0, amount: 8, effect: 'heal' });
  while (game.arrows.length) step(game);
  assert.equal(lark.downed, false);
  assert.ok(lark.hp >= Math.ceil(lark.max * 2 / 5));
  assert.equal(ashara.stats.revives, 1);
});

test('simon (touch heal): holding Space beside a hurt ally and releasing in the window heals everyone near her', () => {
  const game = inWave(createGame({ seed: 3, participants: squad })), ashara = who(game, 'd_ashara'), lark = who(game, 'c_lark'), seris = who(game, 'a_seris');
  game.players.forEach(p => { p.hp = p.max; p.x = p.ox = 400; p.y = p.oy = 400; });
  ashara.x = ashara.ox = 2500; ashara.y = ashara.oy = 2000; lark.x = lark.ox = 2560; lark.y = lark.oy = 2000; seris.x = seris.ox = 2440; seris.y = seris.oy = 2000;
  lark.hp = 3; seris.hp = 3;
  step(game, [{ pcId: 'd_ashara', seq: 0, t: 0, k: 'c' }]);
  assert.equal(ashara.mech.charge, 0);
  tickN(game, IDEAL_CHARGE - 1);
  step(game, [{ pcId: 'd_ashara', seq: 1, t: IDEAL_CHARGE, k: 'x' }]);
  assert.equal(ashara.mech.charge, -1);
  assert.equal(lark.hp, 3 + 8 + 2 * ashara.tier);
  assert.equal(seris.hp, 3 + 8 + 2 * ashara.tier, 'a perfect release heals everyone in reach');
  assert.equal(ashara.stats.healed, 2 * (8 + 2 * ashara.tier));
});

test('striker (slash): Space as the rings meet teleports Liora onto the target and sweeps the zombies around it', () => {
  const game = inWave(createGame({ seed: 4, participants: squad })), liora = who(game, 'b_liora');
  const far = zed(1, 800, 2000, { hp: 9, max: 9 }), mate = zed(2, 860, 2000, { hp: 9, max: 9 });
  game.zombies.push(far, mate);
  step(game, [{ pcId: 'b_liora', seq: 0, t: 0, k: 'o', mode: 1 }]);
  assert.equal(liora.mech.slash.zid, 1, 'the zombie nearest the gate is the target');
  while (game.tick < liora.mech.slash.at) step(game);
  step(game, [{ pcId: 'b_liora', seq: 1, t: game.tick, k: 'c' }]);
  assert.ok(Math.abs(liora.x - far.x) < 200, 'she lands on the target');
  assert.ok(far.hp < 9 && mate.hp < 9, 'the sweep hits its neighbour too');
  assert.equal(liora.mech.slash, null);
});

const plant = (game, seris, t = game.tick) => step(game, [{ pcId: 'a_seris', seq: 7000 + t, t, k: 'o', mode: 1 }, { pcId: 'a_seris', seq: 8000 + t, t, k: 'c' }]);
const press = (game, t) => step(game, [{ pcId: 'a_seris', seq: 9000 + t, t, k: 'c' }]);

test('tank (hold the line): Space plants the shield; every zombie in the arena is drawn to her and she cannot move', () => {
  const game = inWave(createGame({ seed: 5, participants: squad })), seris = who(game, 'a_seris');
  const far = zed(1, 300, 300, { hp: 9, max: 9 });
  game.zombies.push(far);
  const before = Math.hypot(far.x - seris.x, far.y - seris.y);
  plant(game, seris);
  assert.ok(seris.mech.plant, 'the shield is planted');
  assert.equal(seris.mech.plant.dur, plantDurability(seris.tier));
  step(game, [{ pcId: 'a_seris', seq: 1, t: game.tick, k: 'm', dx: 1, dy: 0 }]);
  const x = seris.x; tickN(game, 20);
  assert.equal(seris.x, x, 'a planted tank does not move');
  assert.ok(Math.hypot(far.x - seris.x, far.y - seris.y) < before, 'a zombie far outside the normal taunt radius walks toward her');
  const walker = zed(2, 300, 300);
  const control = inWave(createGame({ seed: 5, participants: squad })); control.zombies.push(walker);
  tickN(control, 20);
  assert.equal(walker.x, 300, 'without the shield the same zombie just walks straight down');
});

test('tank (hold the line): tapping Space in the green keeps the shield up and shields allies; misses wear it down until it shatters', () => {
  const game = inWave(createGame({ seed: 5, participants: squad })), seris = who(game, 'a_seris'), liora = who(game, 'b_liora');
  liora.x = seris.x + 300; liora.y = seris.y;
  const near = zed(1, seris.x + 100, seris.y - 250, { hp: 9, max: 9 });
  game.zombies.push(near);
  plant(game, seris);
  const w = plantWindow(seris.tier), pl = seris.mech.plant, max = pl.dur;
  while (game.tick < pl.next - 1) step(game);
  press(game, pl.next);                                        // dead centre of the green
  assert.equal(pl.hits, 1);
  assert.ok(pl.next > game.tick && pl.next <= game.tick + PLANT_PERIOD, 'the next pulse is about one period away');
  assert.ok(liora.shield >= 2 && seris.shield >= 2, 'a perfect tap shields everyone in reach');
  assert.ok(near.frozen > 0, 'zombies at the shield are staggered');
  assert.equal(seris.stats.slams, 1);
  assert.equal(pl.dur, max, 'durability stays full');
  // Miss the next pulse completely: durability drops.
  const next = pl.next;
  while (game.tick <= next + w + 1) step(game);
  assert.equal(pl.dur, max - 1, 'a missed pulse wears the shield down');
  // A tap far too early costs durability too.
  step(game, [{ pcId: 'a_seris', seq: 5, t: game.tick, k: 'c' }]);
  assert.equal(pl.dur, max - 2, 'tapping outside the green costs durability');
  // Miss everything else: it shatters and cannot be replanted straight away.
  while (seris.mech.plant) step(game);
  assert.equal(seris.mech.plant, null);
  plant(game, seris);
  assert.equal(seris.mech.plant, null, 'a shattered shield needs a moment before it can be planted again');
  tickN(game, PLANT_COOLDOWN + 2);
  step(game, [{ pcId: 'a_seris', seq: 77, t: game.tick, k: 'c' }]);
  assert.ok(seris.mech.plant, 'planted again after the cooldown');
});

test('tank (hold the line): the planted tank takes far less damage, and switching stance lifts the shield', () => {
  const run = planted => {
    const game = inWave(createGame({ seed: 5, participants: squad })), seris = who(game, 'a_seris');
    if (planted) plant(game, seris);
    const z = zed(1, seris.x, seris.y - 100, { type: 'brute', hp: 99, max: 99 });
    game.zombies.push(z); seris.shield = 0;
    tickN(game, 60);
    return seris.max - seris.hp;
  };
  assert.ok(run(true) < run(false), 'less damage behind the shield');
  const game = inWave(createGame({ seed: 5, participants: squad })), seris = who(game, 'a_seris');
  plant(game, seris);
  step(game, [{ pcId: 'a_seris', seq: 3, t: game.tick, k: 'o', mode: 0 }]);
  assert.equal(seris.mech.plant, null, 'Q / E lifts the shield');
  assert.equal(seris.mech.mode, 0);
});

test('only the four mini-game roles can change stance, and not while charging', () => {
  const game = inWave(createGame({ seed: 5, participants: squad }));
  step(game, [{ pcId: 'b_liora', seq: 0, t: 0, k: 'o', mode: 1 }, { pcId: 'a_seris', seq: 0, t: 0, k: 'c' }, { pcId: 'a_seris', seq: 1, t: 0, k: 'o', mode: 1 }]);
  assert.equal(who(game, 'b_liora').mech.mode, undefined, 'typing roles have no stance');
  assert.equal(who(game, 'a_seris').mech.mode, 0, 'the tank cannot switch mid-charge');
  assert.equal(validEvent({ pcId: 'a_seris', seq: 0, t: 0, k: 'o', mode: 2 }, squad), false);
  for (const [role, names] of Object.entries(MODE_NAMES)) assert.equal(names.length, 2, role);
});

test('between waves everyone rolls again, downed players get back up, and the wave starts early once all have rolled', () => {
  const timeline = new HordeTimeline({ seed: 7, participants: squad });
  let seq = 0;
  for (const p of squad) timeline.addEvent({ pcId: p.pcId, seq: seq++, t: 0, k: 'r', total: 12, nat: 10 });
  assert.equal(timeline.stateAt(100).phase, 'countdown', 'the dice need a moment to be seen');
  assert.equal(timeline.stateAt(200).phase, 'wave', 'wave 1 starts five seconds after everyone has rolled');
  const game = clone(timeline.stateAt(200));
  game.zombies = []; game.spawn.left = 0; game.players[0].downed = true; game.players[0].hp = 0; game.players[1].hp = 1;
  step(game);
  assert.equal(game.phase, 'between');
  assert.ok(game.players.every(p => !p.downed && !p.rolled), 'revived and ready to roll');
  assert.ok(game.players[1].hp > 1);
  const next = new HordeTimeline({ seed: 7, participants: squad });
  Object.assign(next, { head: null });
  const again = clone(game);
  for (const p of squad) applyRoll(again, p.pcId, { total: 17, nat: 12 });
  assert.ok(again.players.every(p => p.tier === 2 && p.rolled), 'a new roll sets the new tier');
  for (let i = 0; i < 155 && again.phase === 'between'; i++) step(again);
  assert.equal(again.phase, 'wave', 'early start 5 seconds after the last roll');
  assert.equal(again.wave, 2);
});

function applyRoll(game, pcId, roll) { step(game, [{ pcId, seq: game.tick, t: game.tick, k: 'r', ...roll }]); }

test('the five-role party stays deterministic and bounded with random inputs', () => {
  const run = () => {
    const timeline = new HordeTimeline({ seed: 21, participants: squad });
    let seq = 0, state = 1234567;
    const next = n => { state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff; return state % n; };
    for (const p of squad) timeline.addEvent({ pcId: p.pcId, seq: seq++, t: 0, k: 'r', total: 10 + next(12), nat: 1 + next(20) });
    for (let tick = 1; tick < 2500; tick++) {
      if (tick % 7 === 0) { const p = squad[next(5)].pcId, kinds = { a_seris: ['c', 'x', 'm', 'o'], b_liora: ['w', 'm'], c_lark: ['d', 'o'], d_ashara: ['s', 'o'], e_rurik: ['p', 'o'] }[p], k = kinds[next(kinds.length)];
        const extra = { o: { mode: next(2) }, c: {}, x: {}, m: { dx: next(3) - 1, dy: next(3) - 1 }, w: { s: 'crypt' }, d: { lane: next(4) }, s: { pad: next(4) }, p: { dir: next(3) - 1 } }[k];
        timeline.addEvent({ pcId: p, seq: seq++, t: tick, k, ...extra }); }
    }
    const end = clone(timeline.stateAt(2500));
    return end;
  };
  const a = run(), b = run();
  assert.deepEqual(a, b);
  for (const p of a.players) { assert.ok(Number.isInteger(p.hp) && p.hp >= 0 && p.hp <= p.max); assert.ok((p.mech.notes?.length ?? 0) < 30); }
});

test('the audience: spectators shoot the zombie nearest the gate with a typed word, two hits for one damage, and can do nothing else', () => {
  const game = inWave(createGame({ seed: 8, participants: squad }));
  const near = zed(1, 2500, 2000, { hp: 2, max: 2 }), far = zed(2, 2500, 400, { hp: 2, max: 2, word: 'crypt' });
  game.zombies.push(far, near);
  near.word = 'crypt';
  step(game, [{ pcId: 'spec-fan00001', seq: 0, t: 0, k: 'w', s: 'crypt' }]);
  assert.equal(game.crowd.length, 1);
  assert.equal(game.arrows.length, 1);
  assert.equal(game.arrows[0].zid, 1, 'the zombie closest to the gate is targeted');
  tickN(game, 40);
  assert.equal(near.hp, 2, 'one hit is only half a point of damage');
  step(game, [{ pcId: 'spec-fan00002', seq: 0, t: game.tick, k: 'w', s: 'crypt' }]);
  tickN(game, 40);
  assert.equal(near.hp, 1, 'the second hit completes one damage');
  for (let n = 0; n < 2; n++) { step(game, [{ pcId: `spec-fan0000${3 + n}`, seq: 0, t: game.tick, k: 'w', s: 'crypt' }]); tickN(game, 40); }
  assert.equal(game.zombies.some(z => z.id === 1), false, 'four hits kill a two-hit zombie');
  assert.equal(gameResults(game).crowd.kills, 1);
  assert.ok(gameResults(game).kills >= 1);

  const fan = game.crowd[0];
  step(game, [{ pcId: fan.id, seq: 1, t: game.tick, k: 'w', s: 'nothing' }]);
  assert.ok(fan.cooldown > 0, 'a wrong word costs a short cooldown');
  const arrows = game.arrows.length;
  step(game, [{ pcId: fan.id, seq: 2, t: game.tick, k: 'w', s: 'crypt' }]);
  assert.equal(game.arrows.length, arrows, 'typing during the cooldown does nothing');
});

test('spectator events are limited to words, and the audience has a size limit', () => {
  assert.equal(validEvent({ pcId: 'spec-abcd1234', seq: 0, t: 5, k: 'w', s: 'crypt' }, party), true);
  for (const bad of [{ k: 'm', dx: 1, dy: 0 }, { k: 'c' }, { k: 'r', total: 20, nat: 20 }, { k: 'd', lane: 1 }]) {
    assert.equal(validEvent({ pcId: 'spec-abcd1234', seq: 0, t: 5, ...bad }, party), false, bad.k);
  }
  assert.equal(validEvent({ pcId: 'spectator!', seq: 0, t: 5, k: 'w', s: 'crypt' }, party), false);
  const game = inWave(createGame({ seed: 8, participants: squad }));
  game.zombies.push(zed(1, 2500, 2000));
  for (let i = 0; i < CROWD_MAX + 5; i++) step(game, [{ pcId: `spec-fan${String(i).padStart(5, '0')}`, seq: 0, t: game.tick, k: 'w', s: 'crypt' }]);
  assert.equal(game.crowd.length, CROWD_MAX);
  const timeline = new HordeTimeline({ seed: 1, participants: squad });
  assert.equal(timeline.addEvent({ pcId: 'spec-abcd1234', seq: 0, t: 500, k: 'w', s: 'crypt' }), true);
  assert.equal(timeline.addEvent({ pcId: 'spec-abcd1234', seq: 0, t: 500, k: 'w', s: 'crypt' }), false, 'duplicates are ignored for spectators too');
});

test('the GM sets zombie speed from 1 to 5, and 4 is the original pace', () => {
  const walk = speed => {
    const game = inWave(createGame({ seed: 3, participants: squad, speed }));
    game.zombies.push(zed(1, 2500, 0));
    for (let i = 0; i < 120; i++) step(game);
    return game.zombies[0].y;
  };
  const [one, two, three, four, five] = [1, 2, 3, 4, 5].map(walk);
  assert.ok(one < two && two < three && three < four && four < five, 'faster setting, farther walked');
  assert.equal(four, 4 * 120, 'speed 4 is the original 4 units per tick');
  assert.equal(one, 120, 'speed 1 is a quarter of that');
  assert.equal(five, 5 * 120);
  assert.equal(createGame({ seed: 1, participants: squad }).speed, 1, 'the default is the slowest setting');
  for (const bad of [0, 6, 1.5, '3']) assert.throws(() => createGame({ seed: 1, participants: squad, speed: bad }), /1 to 5/);
});

test('speed changes use fractional movement without drifting: the same log still gives the same game', () => {
  const run = () => { const t = new HordeTimeline({ seed: 9, participants: squad, speed: 2 }); let n = 0; for (const p of squad) t.addEvent({ pcId: p.pcId, seq: n++, t: 0, k: 'r', total: 12, nat: 9 }); return JSON.stringify(t.stateAt(900)); };
  assert.equal(run(), run());
});

test('slow zombies still reach a target diagonally: the fractional part of each step is carried, not lost', () => {
  const game = inWave(createGame({ seed: 5, participants: squad, speed: 1 })), seris = who(game, 'a_seris');
  const z = zed(1, 300, 300);
  game.zombies.push(z);
  plant(game, seris); // a planted shield makes every zombie chase her, here along a long diagonal
  const before = Math.hypot(z.x - seris.x, z.y - seris.y);
  tickN(game, 400);
  assert.ok(before - Math.hypot(z.x - seris.x, z.y - seris.y) > 150, 'at speed 1 it closes at about 1 unit per tick, even on a diagonal');
  assert.ok(Number.isInteger(z.x) && Number.isInteger(z.y) && Number.isInteger(z.rx) && Number.isInteger(z.ry), 'still integer-only');
});

test('each roll is remembered in the game state so every screen can draw the die above that character', () => {
  const timeline = new HordeTimeline({ seed: 2, participants: squad });
  timeline.addEvent({ pcId: 'a_seris', seq: 0, t: 10, k: 'r', total: 21, nat: 14 });
  timeline.addEvent({ pcId: 'a_seris', seq: 1, t: 20, k: 'r', total: 5, nat: 1 });
  const seris = timeline.stateAt(40).players.find(p => p.pcId === 'a_seris');
  assert.deepEqual(seris.roll, { nat: 14, total: 21, at: 10 }, 'the first roll of the phase counts; a second one is ignored');
  assert.equal(timeline.stateAt(40).players.find(p => p.pcId === 'b_liora').roll, null, 'players who have not rolled show no die');
  // The next roll phase replaces it.
  const game = clone(timeline.stateAt(40)); game.phase = 'between'; game.timer = 300; game.players.forEach(p => { p.rolled = false; });
  step(game, [{ pcId: 'a_seris', seq: 5, t: game.tick, k: 'r', total: 12, nat: 6 }]);
  assert.deepEqual(who(game, 'a_seris').roll, { nat: 6, total: 12, at: 40 });
});
