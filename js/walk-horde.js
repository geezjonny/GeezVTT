import { isGM, sessionClient } from './session-role.js';
import { serverNow } from './horde-sync.js';
import { updateConditionally } from './firebase-update.js';
import { CHARGE_MAX, step, validEvent, ZOMBIES, MODE_NAMES, spellsFor, runeBeat, simonStep, actionRange } from './horde-model.js';
import { readPC } from './pc-inventory.js';
import { loadSheetReference } from './sheet-view.js';
import { sheetRolls } from './sheet-rolls.js';
import { buildExpressionRoll } from './dice-roll.js';
import { createHordeView, drawZombie as zombieSprite, LANE_KEYS, PAD_KEYS } from './horde-view.js';
import { world, project, lineOfSight, TILE_W } from './walk-model.js';
import { createEncounter, decodeEncounter, HORDE_UNIT, syncEncounter, toHorde, toWalk, walkHordeArena, zombieType } from './walk-horde-model.js';

export function createWalkHorde(context) {
  const $ = id => document.getElementById(id), input = $('horde-command'), form = $('horde-command-form');
  const controls = createHordeView($('horde-canvas'), $('horde-text'));
  let game = null, runtime = null, inputs = {}, busy = false, key = null, seq = 0, outbox = [], sending = false, dirty = false;
  let arena = walkHordeArena(), lastError = 0, restart = false;
  const shown = new Map(), teleports = new Map();
  let focusKey = '', rolling = false, rollRetry = 0, charging = null; // charging: tick our own Space hold began, shown before the GM's copy arrives
  const mine = () => game?.players.find(p => p.pcId === context.me()?.pcId);
  const visualTick = () => game ? game.tick + Math.max(0, Math.min(9, (serverNow() - runtime.at) * 30 / 1000)) : 0;
  const ready = () => !!mine() && context.active() && !context.editing();
  const typing = p => p && (['striker', 'healer', 'support', 'cutter', 'pitch'].includes(p.role) && !(p.mech.mode === 1 && ['striker', 'cutter', 'pitch'].includes(p.role)));
  const report = error => { if (Date.now() - lastError > 3000) { context.onError(`Horde: ${error.message}`); lastError = Date.now(); } };
  const path = () => `${context.base}/combat/${context.mapKey()}`;
  function reset() {
    game = null; runtime = null; inputs = {}; outbox = []; dirty = false; restart = false;
    focusKey = ''; rollRetry = 0; charging = null;
    shown.clear(); teleports.clear(); arena = walkHordeArena(); key = context.mapKey();
    for (const id of ['horde-canvas', 'horde-text']) { const canvas = $(id); canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); }
  }
  function receive(value) {
    if (key !== context.mapKey()) reset();
    inputs = value?.inputs || {};
    const next = value?.runtime;
    if (!next || next === runtime) return;
    const parsed = decodeEncounter(next.game);
    if (!parsed) return;
    if (game && parsed.tick < game.tick) { teleports.clear(); shown.clear(); }
    runtime = next; game = parsed;
    for (const [id, move] of Object.entries(game.teleports)) if (teleports.get(id) !== move.at) {
      teleports.set(id, move.at); context.relocate(id, toWalk(move));
    }
  }
  async function flush() {
    if (sending || !dirty || !context.mapKey()) return;
    sending = true; dirty = false;
    const target = path();
    try {
      const response = await fetch(`${target}/inputs/${sessionClient}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: outbox }), signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`Input sync failed (${response.status})`);
    } catch (error) { dirty = true; report(error); }
    finally { sending = false; }
  }
  function send(event) {
    const p = mine(); if (!p || !ready()) return;
    const action = { pcId: p.pcId, seq: seq++, t: Math.floor(visualTick()), ...event };
    outbox = [...outbox, action].slice(-32); dirty = true; flush();
  }
  const mode = n => send({ k: 'o', mode: n });
  const usesSpace = p => p && (p.role === 'tank' || p.role === 'simon' && !p.mech.mode || p.role === 'striker' && p.mech.mode === 1);
  $('walk-horde-reset').addEventListener('click', () => { if (isGM) restart = true; });
  async function autoRoll() {
    const p = mine(), mapKey = context.mapKey();
    if (!p || p.rolled || rolling || !ready() || Date.now() < rollRetry) return;
    rolling = true; rollRetry = Date.now() + 3000;
    try {
      const [data, reference] = await Promise.all([readPC({ npcId: `v2:${p.pcId}` }), loadSheetReference()]);
      const skills = { tank: 'athletics', striker: 'perception', healer: 'medicine', cutter: 'performance', simon: 'investigation', pitch: 'arcana' };
      const rolls = sheetRolls(data, reference), key = `skill:${skills[p.role] || (p.cls.toLowerCase() === 'bard' ? 'performance' : 'arcana')}`;
      const check = [...rolls['Skill Checks'], ...rolls['Ability Checks']].find(r => r.key === key) || rolls['Ability Checks'].find(r => r.key === 'ability:dex');
      const roll = buildExpressionRoll(check.expression, check.disadvantage ? 'disadvantage' : 'normal');
      if (mapKey === context.mapKey() && mine()?.pcId === p.pcId) send({ k: 'r', total: Math.max(-10, Math.min(60, roll.total)), nat: roll.dice.find(d => !d.drop).v });
    } catch (error) { report(error); }
    finally { rolling = false; }
  }

  form.addEventListener('submit', event => { event.preventDefault(); if (input.value) { send({ k: 'w', s: input.value }); input.value = ''; } });
  input.addEventListener('input', () => {
    input.value = input.value.toLowerCase().replace(/[^a-z]/g, '').slice(0, 16);
    const p = mine(), words = p?.role === 'healer' ? game.players.map(p => p.key) : p?.role === 'support' ? spellsFor(p.cls) : game?.zombies.map(z => z.word) || [];
    if (words.includes(input.value) && !words.some(w => w !== input.value && w.startsWith(input.value))) {
      send({ k: 'w', s: input.value }); input.value = '';
    }
  });
  for (const type of ['paste', 'drop']) input.addEventListener(type, e => e.preventDefault());
  addEventListener('keydown', event => {
    if (!ready() || event.ctrlKey || event.altKey || event.metaKey || event.target.matches?.('input, select, textarea, button, .editor-titlebar') && event.target !== input) return;
    const p = mine(), inInput = event.target === input;
    if ((event.key === 'Tab' || !inInput && /^[qe]$/i.test(event.key)) && MODE_NAMES[p.role]) {
      event.preventDefault(); if (!event.repeat) mode(event.key === 'Tab' ? 1 - (p.mech.mode || 0) : event.key.toLowerCase() === 'q' ? 0 : 1);
    } else if (event.key === ' ') {
      event.preventDefault();
      if (!event.repeat) {
        if (usesSpace(p)) { send({ k: 'c' }); if (['tank', 'simon'].includes(p.role) && !p.mech.mode && !p.downed) charging = Math.floor(visualTick()); }
        else context.interact();
      }
    } else if (!inInput && event.key.toLowerCase() === 'f') {
      event.preventDefault(); if (!event.repeat) context.interact();
    } else if (p.mech.mode === 1 && (['cutter', 'pitch'].includes(p.role) && event.key in LANE_KEYS || p.role === 'simon' && (event.key in PAD_KEYS || /^[1-4]$/.test(event.key)))) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) send(p.role === 'simon' ? { k: 's', pad: PAD_KEYS[event.key] ?? Number(event.key) - 1 } : { k: 'd', lane: LANE_KEYS[event.key] });
    } else if (event.key === 'Escape' && inInput) input.value = '';
  }, true);
  addEventListener('keyup', event => {
    if (event.key === ' ' && ready() && usesSpace(mine())) { event.preventDefault(); send({ k: 'x' }); charging = null; }
  }, true);
  addEventListener('blur', () => { charging = null; if (mine()?.mech.charge >= 0) send({ k: 'x' }); });
  $('walk-canvas').addEventListener('pointerdown', event => {
    if (!ready()) return;
    const hit = controls.hudAt(event.clientX, event.clientY);
    if (!hit) { input.blur(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    if (hit.type === 'mode') mode(hit.index);
    else if (mine().role === 'simon') { controls.flashPad(hit.index); send({ k: 's', pad: hit.index }); }
  }, true);

  async function tick() {
    flush();
    if (!isGM || busy || !context.mapKey() || !context.active()) return;
    const pcs = context.pcs(); if (!pcs.length) return;
    const mapKey = context.mapKey(), target = path(); busy = true;
    try {
      const next = await updateConditionally(`${target}/runtime.json`, current => {
        if (mapKey !== context.mapKey() || !context.active()) return { result: null, write: null };
        const now = serverNow();
        if (current?.owner !== sessionClient && current?.until > now && current.until < now + 15000) return { result: current, write: null };
        const state = !restart && decodeEncounter(current?.game) || createEncounter(pcs);
        syncEncounter(state, pcs, world.tokens);
        const elapsed = Math.max(1, Math.min(9, Math.round((now - (current?.at || now - 100)) * 30 / 1000)));
        const receipts = { ...(current?.receipts || {}) }, actions = [];
        for (const [client, record] of Object.entries(inputs)) {
          for (const action of Object.values(record?.events || {}).filter(a => validEvent(a, state.players, Number.MAX_SAFE_INTEGER)).sort((a, b) => a.seq - b.seq)) {
            if (action.seq <= (receipts[client] ?? -1) || action.k === 'm' || !state.players.some(p => p.pcId === action.pcId)) continue;
            actions.push({ ...action, t: Math.max(state.tick, Math.min(state.tick + elapsed - 1, action.t)) }); receipts[client] = action.seq;
          }
        }
        for (let i = 0; i < elapsed; i++) {
          const before = new Map(state.players.map(p => [p.pcId, { x: p.x, y: p.y }]));
          step(state, actions.filter(a => a.t === state.tick), arena);
          for (const p of state.players) {
            const old = before.get(p.pcId);
            if (p.x !== old.x || p.y !== old.y) state.teleports[p.pcId] = { x: p.x, y: p.y, at: state.tick };
          }
        }
        const result = { owner: sessionClient, until: now + 8000, at: now, receipts, game: JSON.stringify(state) };
        return { result, write: result };
      }, 'Combat changed elsewhere; retrying.', { raw: true });
      if (mapKey === context.mapKey() && next) { restart = false; receive({ inputs, runtime: next }); }
    } catch (error) { report(error); }
    finally { busy = false; }
  }
  const timer = setInterval(tick, 100);
  addEventListener('pagehide', () => { clearInterval(timer); controls.destroy(); });

  function position(token) {
    const z = game?.zombies.find(z => z.tokenId === token.id);
    return z ? shown.get(z.id) || toWalk(z) : token;
  }
  let audio, lastBeat, lastNote;
  function note(frequency) {
    if (!audio || audio.state !== 'running') return;
    const osc = audio.createOscillator(), gain = audio.createGain(); osc.frequency.value = frequency;
    gain.gain.setValueAtTime(.08, audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .08);
    osc.connect(gain).connect(audio.destination); osc.start(); osc.stop(audio.currentTime + .08);
  }
  function ensureAudio() { try { audio ||= new AudioContext(); if (audio.state === 'suspended') audio.resume(); } catch { /* audio may be unavailable */ } }
  addEventListener('keydown', ensureAudio, true);
  addEventListener('pointerdown', ensureAudio, true);
  return {
    reset, receive, position, isZombie: token => !!zombieType(token),
    alive: token => !game?.placements[token.id] || game.zombies.some(z => z.tokenId === token.id),
    createZombie(type, pos, door) {
      if (!ZOMBIES[type]) throw new Error('Choose a zombie type.');
      return { id: crypto.randomUUID(), npcId: `horde:${type}`, name: type[0].toUpperCase() + type.slice(1), size: 1, hp: ZOMBIES[type].hp,
        ...pos, rotation: 0, walkAI: { door, chain: null, disposition: 'enemy' } };
    },
    held: id => { const p = game?.players.find(p => p.pcId === id); return !!p && (p.downed || !!p.mech.plant || p.role === 'simon' && p.mech.mode === 1); },
    speed: id => {
      const p = game?.players.find(p => p.pcId === id);
      return (game?.buffs.haste > 0 ? 6 : 4) * (p && ['tank', 'simon'].includes(p.role) && p.mech.charge >= 0 ? .5 : 1);
    },
    frame(dt) {
      if (key !== context.mapKey()) reset();
      for (const z of game?.zombies || []) {
        const p = shown.get(z.id) || toWalk(z), target = toWalk(z), t = Math.min(1, dt * 12);
        shown.set(z.id, { x: p.x + (target.x - p.x) * t, y: p.y + (target.y - p.y) * t });
      }
      const p = mine(), me = context.me();
      if (p && me) { me.hp = p.hp; me.max = p.max; }
      form.hidden = !p;
      if (!p) return;
      input.parentElement.hidden = !typing(p); input.disabled = !ready() || p.downed;
      const nextFocus = `${p.pcId}:${typing(p)}`;
      if (nextFocus !== focusKey && !input.disabled) {
        focusKey = nextFocus;
        if (typing(p) && !document.activeElement?.matches('input:not(#horde-command), select, textarea')) input.focus({ preventScroll: true });
        else if (!typing(p)) input.blur();
      }
      autoRoll();
      const stance = MODE_NAMES[p.role]?.[p.mech.mode || 0] || p.role;
      const help = p.downed ? 'Downed' : p.mech.mode === 1 && ['cutter', 'pitch'].includes(p.role) ? 'Arrows: beats / WASD: move' : usesSpace(p) ? 'Space: ability / Tab: stance' : 'Arrows: move / Tab: stance';
      $('horde-role').textContent = `${stance} · ${p.hp}/${p.max} HP · ${help}`;
      $('horde-spell-list').textContent = p.role === 'support' ? spellsFor(p.cls).map((s, i) => `${s}${p.spellCd[i] ? ` (${Math.ceil(p.spellCd[i] / 30)}s)` : ''}`).join(' · ') : '';
      if (context.active() && ['cutter', 'pitch'].includes(p.role)) {
        const beat = Math.floor(visualTick() / runeBeat(p.tier)); if (beat !== lastBeat) { lastBeat = beat; note(beat % 4 ? 660 : 880); }
      }
      if (p.role === 'simon' && p.mech.phase === 'show') {
        const index = Math.floor((visualTick() - p.mech.at) / simonStep(p.tier)), id = `${p.mech.at}:${index}`;
        if (id !== lastNote) { lastNote = id; const frequency = [261.63, 329.63, 392, 440][p.mech.seq[index]]; if (frequency) note(frequency); }
      }
    },
    drawZombie(ctx, token, origin) {
      const z = game?.zombies.find(z => z.tokenId === token.id);
      if (!z && game?.placements[token.id]) return;
      const p = position(token), c = project(p.x, p.y), type = zombieType(token);
      const zombie = z || { type, boss: false };
      ctx.save(); ctx.translate(origin.x + c.x, origin.y + c.y - 18); ctx.scale(3, 3);
      zombieSprite(ctx, zombie, 0, 0, Math.floor((game?.tick || 0) / 8) % 2, !!z && game.log.some(e => e.type === 'hit' && e.a === z.id && e.t >= game.tick - 3)); ctx.restore();
      const me = mine(), range = me && actionRange(me), inRange = !me || !range || !z || (z.x - me.x) ** 2 + (z.y - me.y) ** 2 <= range ** 2;
      ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.fillStyle = !inRange ? '#818995' : input.value && z?.word.startsWith(input.value) ? '#ffe066' : z?.frozen ? '#9ad0ff' : '#ffe6bd';
      const word = z?.word || type; ctx.strokeText(word, origin.x + c.x, origin.y + c.y - 27); ctx.fillText(word, origin.x + c.x, origin.y + c.y - 27);
      if (z) { ctx.fillStyle = '#281818'; ctx.fillRect(origin.x + c.x - 18, origin.y + c.y + 30, 36, 4); ctx.fillStyle = '#c85d52'; ctx.fillRect(origin.x + c.x - 18, origin.y + c.y + 30, 36 * Math.max(0, z.hp / z.max), 4); }
    },
    draw(ctx, origin, zoom) {
      if (!game) return;
      const me = context.me(), clock = context.active() ? visualTick() : game.tick;
      // Draw our own hold and everyone's position from live walk data, not the GM's copy that is a few hundred ms old.
      const players = game.players.map(p => {
        const live = context.position(p.pcId), at = live ? toHorde(live) : p;
        const mech = p.pcId === me?.pcId && charging !== null && clock - charging < CHARGE_MAX ? { ...p.mech, charge: charging } : p.mech;
        return { ...p, ...at, mech };
      });
      controls.drawControls({ ...game, players, tick: Math.floor(clock) }, { me: me?.pcId, status: context.active() ? 'running' : 'waiting' }, clock % 1 + 1, {
        origin, zoom, tile: TILE_W, unit: HORDE_UNIT,
        visible: p => !me || isGM || lineOfSight(me.pos.x, me.pos.y, p.x / HORDE_UNIT, p.y / HORDE_UNIT)
      });
    }
  };
}
