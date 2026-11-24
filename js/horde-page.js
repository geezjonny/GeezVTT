// minigame.html controller for Zombie Horde. Every browser replays the same input log; see horde-design.md.
import { isGM, playerIdentity } from './session-role.js';
import { readPC } from './pc-inventory.js';
import { loadSheetReference } from './sheet-view.js';
import { sheetRolls } from './sheet-rolls.js';
import { buildExpressionRoll } from './dice-roll.js';
import { CAMPAIGNS, CHARACTERS, resolvePlayer } from './player-session-model.js';
import { HordeTimeline, MODE_NAMES, TICKS_PER_SECOND, actionRange, eligible, runeBeat, simonStep, gameResults, spellsFor } from './horde-model.js';
import { LANE_KEYS, PAD_KEYS, createHordeView } from './horde-view.js';
import { createHordeSession, hordeBase, endHordeSession, eventsFromLog, nextSeq, postEvent, serverNow, sessionConfig, setHordeSpeed, startHordeSession, syncClock, tickAt, watchHorde } from './horde-sync.js';

const $ = id => document.getElementById(id);
const RENDER_LAG = 4;
const ROLE_NAME = { tank: 'Tank', striker: 'Striker', healer: 'Healer', support: 'Support', cutter: 'Cutter', simon: 'Simon', pitch: 'Pitch' };
const TYPING = ['striker', 'healer', 'support'];
const isBardRole = role => role === 'cutter' || role === 'pitch';
// Spectators are the audience: they are not in the party, so they get a stable anonymous id for their shots.
const spectatorId = (() => {
  try { const saved = sessionStorage.getItem('geezvtt.spectator'); if (/^spec-[a-zA-Z0-9]{4,24}$/.test(saved)) return saved; } catch { /* storage may be blocked */ }
  const id = `spec-${[...crypto.getRandomValues(new Uint8Array(8))].map(n => (n % 36).toString(36)).join('')}`;
  try { sessionStorage.setItem('geezvtt.spectator', id); } catch { /* the id then lasts for this page only */ }
  return id;
})();
const HINT = {
  spectator: 'Type a zombie\'s word to shoot it from the stands (half damage).',
  tank: 'Arrows move. Hold Space, release in the gold zone. Q / E: attack or hold the line.',
  tankLine: 'Space plants your shield and draws every zombie to you. Then tap Space in the green to keep it up. Q / E switches.',
  striker: 'Arrows move. Type a zombie\'s word to shoot it. Tab: teleport slash.',
  strikerSlash: 'Arrows move. Press Space as the outer ring meets the inner one to teleport and slash. Tab: back to arrows.',
  healer: 'Arrows move. Type a name to heal; three times to revive.',
  support: 'Arrows move. Type a spell word to cast it.',
  cutter: 'Type a zombie word to shoot it; words on the beat hit harder. Arrows move. Tab: hold person.',
  bardHold: 'Press each arrow on its beat to hold zombies in place. WASD walks. Q / E: cutting words.',
  simon: 'Arrows move. Stand by a hurt ally, hold Space and release in the gold zone to heal. Q / E: glyphs.',
  simonGlyphs: 'Watch the glyphs, then repeat them: arrows (up, left, down, right) or click. Q / E: touch heal.',
  pitch: 'Arrows move. Type a zombie word to shoot it; words on the beat hit harder. Tab: hold person.'
};
const ROLL_CHECK = { tank: ['skill:athletics', 'Athletics'], striker: ['skill:perception', 'Perception'], healer: ['skill:medicine', 'Medicine'],
  cutter: ['skill:performance', 'Performance'], simon: ['skill:investigation', 'Investigation'], pitch: ['skill:arcana', 'Arcana'] };
const checkFor = player => ROLL_CHECK[player.role] || (player.cls.toLowerCase() === 'bard' ? ['skill:performance', 'Performance'] : ['skill:arcana', 'Arcana']);
const view = createHordeView($('horde-canvas'), $('horde-text'));
let session, timeline, events = [], logReady = false, rollingSent = false, resultsWritten = null;
let typed = '', held = new Set(), lastDir = '0,0', lastSeq = 0, endHandled = false, rollSentKey = null;
const message = text => { if ($('minigame-status').textContent !== text) $('minigame-status').textContent = text; };
const mePlayer = () => session?.participants && Object.values(session.participants).find(p => p.pcId === playerIdentity?.pcId);
const startsAt = () => Number.isFinite(session?.startsAt) ? session.startsAt : null;
const currentTick = () => startsAt() === null ? 0 : Math.max(0, tickAt(startsAt()));

// --- session and log
function receiveSession(value) {
  const changed = !value || !session || value.id !== session.id || value.seed !== session.seed || value.speed !== session.speed;
  session = value;
  message(value ? '' : isGM ? 'Pick the party and create a game.' : 'Waiting for a game from the tabletop.');
  if (changed) {
    timeline = value ? new HordeTimeline(sessionConfig(value)) : null;
    events = []; rollingSent = false; endHandled = false; resultsWritten = null; typed = ''; $('minigame-input').value = '';
    $('minigame-player-name').textContent = '';
    if (value) addEvents(eventsFromLog(lastLog, value));
  }
  renderPanels();
}
let lastLog = null;
function receiveLog(value) {
  lastLog = value; logReady = true;
  if (session && timeline) addEvents(eventsFromLog(value, session));
}
function addEvents(list) {
  for (const event of list) if (timeline.addEvent(event)) events.push(event);
}

// --- input
function send(event) {
  const id = actorId(), full = { pcId: id, seq: Math.max(lastSeq, nextSeq(events, id)), ...event };
  lastSeq = full.seq + 1;
  if (!timeline.addEvent(full)) return;
  events.push(full);
  postEvent(session.id, full).catch(error => message(`${error.message} Your last action may not be shared.`));
}
const actorId = () => mePlayer() ? playerIdentity?.pcId : spectatorId;
const audienceMode = () => !!session && !mePlayer() && !isGM;
const canWatchType = () => audienceMode() && session.phase === 'running' && startsAt() !== null && logReady;
const canPlay = () => !!session && !!mePlayer() && session.phase === 'running' && startsAt() !== null && logReady;
function sendMovement() {
  const dx = (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0), dy = (held.has('ArrowDown') ? 1 : 0) - (held.has('ArrowUp') ? 1 : 0);
  const key = `${dx},${dy}`;
  if (key === lastDir || !canPlay()) return;
  lastDir = key; send({ t: currentTick(), k: 'm', dx, dy });
}
const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const myRole = () => mePlayer()?.role;
const myMode = () => timeline?.head?.players.find(p => p.pcId === playerIdentity?.pcId)?.mech.mode ?? 0;
// Space is the tank's charge, Ashara's touch heal and Liora's slash, each only in its own stance.
const typesWords = role => TYPING.includes(role) || isBardRole(role) && myMode() === 0;
const usesSpace = () => { const role = myRole(); return role === 'tank' || role === 'simon' && myMode() === 0 || role === 'striker' && myMode() === 1; };
function clickPad(pad) {
  if (!canPlay() || myRole() !== 'simon') return;
  view.flashPad(pad); ensureAudio(); playNote(pad);
  send({ t: currentTick(), k: 's', pad });
}
// Ashara clicks the glyphs. The canvas sits under the text layer, which ignores the mouse.
function sendMode(mode) {
  if (!canPlay() || !MODE_NAMES[myRole()]) return;
  send({ t: currentTick(), k: 'o', mode });
}
// Ashara clicks the glyphs, and anyone can click a stance button. The canvas sits under the text layer, which ignores the mouse.
$('horde-canvas').addEventListener('pointerdown', event => {
  const hit = view.hudAt(event.clientX, event.clientY);
  if (!hit) return;
  event.preventDefault();
  if (hit.type === 'pad' && myRole() === 'simon') clickPad(hit.index); else if (hit.type === 'mode') sendMode(hit.index);
});
// Each role has its own use for the keyboard. Typing roles keep their words in the text box.
function press(event) {
  if (!canPlay() || event.repeat) return;
  const role = myRole();
  ensureAudio();
  if (/^[qe]$/i.test(event.key) && MODE_NAMES[role]) { event.preventDefault(); sendMode(event.key.toLowerCase() === 'q' ? 0 : 1); return; }
  if (role === 'simon' && /^[1-4]$/.test(event.key)) { event.preventDefault(); clickPad(Number(event.key) - 1); return; }
  if (event.key === ' ' && usesSpace()) { event.preventDefault(); send({ t: currentTick(), k: 'c' }); return; }
  if (!ARROWS.has(event.key)) return;
  event.preventDefault();
  if (isBardRole(role) && myMode() === 1) send({ t: currentTick(), k: 'd', lane: LANE_KEYS[event.key] });
  else if (role === 'simon' && myMode() === 1) clickPad(PAD_KEYS[event.key]);
  else { held.add(event.key); sendMovement(); }
}
function release(event) {
  if (event.key === ' ' && (myRole() === 'tank' || myRole() === 'simon' && myMode() === 0) && canPlay()) { event.preventDefault(); send({ t: currentTick(), k: 'x' }); return; }
  if (held.delete(event.key)) sendMovement();
}
// In hold person the arrows are the beat keys, so a bard walks with WASD instead.
const WASD = { w: 'ArrowUp', a: 'ArrowLeft', s: 'ArrowDown', d: 'ArrowRight' };
const wasdWalk = event => isBardRole(myRole()) && myMode() === 1 && WASD[event.key.toLowerCase()];
document.addEventListener('keydown', event => {
  if (event.target === $('minigame-input')) return;
  if (wasdWalk(event)) { event.preventDefault(); if (canPlay() && !event.repeat) { held.add(WASD[event.key.toLowerCase()]); sendMovement(); } return; }
  if (ARROWS.has(event.key) || /^[qe]$/i.test(event.key) && MODE_NAMES[myRole()] || event.key === ' ' && usesSpace() || /^[1-4]$/.test(event.key) && myRole() === 'simon' && myMode() === 1) press(event);
});
document.addEventListener('keyup', event => {
  if (wasdWalk(event)) { if (held.delete(WASD[event.key.toLowerCase()])) sendMovement(); return; }
  if (event.target !== $('minigame-input')) release(event);
});
function stopHolding() { held.clear(); sendMovement(); }
window.addEventListener('blur', stopHolding);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopHolding(); });

function words() {
  if (audienceMode() && timeline?.head) { const live = timeline.head.zombies.filter(eligible).map(z => z.word); return { all: live, inRange: new Set(live) }; }
  const me = timeline?.head?.players.find(p => p.pcId === playerIdentity?.pcId);
  if (!me || !timeline.head) return { all: [], inRange: new Set() };
  const state = timeline.head;
  if (me.role === 'healer') return { all: state.players.map(p => p.key), inRange: new Set(state.players.filter(p => (p.x - me.x) ** 2 + (p.y - me.y) ** 2 <= actionRange(me) ** 2).map(p => p.key)) };
  if (me.role === 'support') { const list = spellsFor(me.cls); return { all: list, inRange: new Set(list.filter((_, i) => me.spellCd[i] === 0)) }; }
  const live = state.zombies.filter(eligible);
  return { all: live.map(z => z.word), inRange: new Set(live.filter(z => (z.x - me.x) ** 2 + (z.y - me.y) ** 2 <= actionRange(me) ** 2).map(z => z.word)) };
}
function submit(word) {
  if (!(canPlay() || canWatchType()) || !/^[a-z]{1,16}$/.test(word)) return;
  send({ t: currentTick(), k: 'w', s: word });
}
$('minigame-input').addEventListener('input', () => {
  typed = $('minigame-input').value.toLowerCase().replace(/[^a-z]/g, '').slice(0, 16);
  $('minigame-input').value = typed;
  const { all } = words();
  // Fire as soon as the word is complete and no longer word starts the same way.
  if (typed && all.includes(typed) && !all.some(word => word !== typed && word.startsWith(typed))) { submit(typed); typed = ''; $('minigame-input').value = ''; }
});
$('minigame-input').addEventListener('keydown', event => {
  if (event.key === 'Tab' && MODE_NAMES[myRole()]) { event.preventDefault(); sendMode(1 - myMode()); }
  else if (event.key === ' ' && usesSpace()) { event.preventDefault(); press(event); }
  else if (event.key === 'Enter') { event.preventDefault(); if (typed) submit(typed); typed = ''; $('minigame-input').value = ''; }
  else if (event.key === 'Escape') { typed = ''; $('minigame-input').value = ''; }
  else if (ARROWS.has(event.key)) { event.preventDefault(); press(event); }
  event.stopPropagation();
});
$('minigame-input').addEventListener('keyup', event => { release(event); });
for (const type of ['paste', 'drop']) $('minigame-input').addEventListener(type, event => event.preventDefault());
$('minigame-entry').addEventListener('submit', event => event.preventDefault());

// --- class roll: automatic at the start of every wave. The result sets that wave's difficulty.
function rollState() {
  const head = timeline?.head, me = mePlayer();
  if (!head || !me || !session) return { can: false };
  const mine = head.players.find(p => p.pcId === me.pcId);
  const open = session.phase === 'running' && startsAt() !== null && (head.phase === 'countdown' || head.phase === 'between');
  const key = `${head.phase}:${head.wave}`;
  return { can: !!mine && open && !mine.rolled && rollSentKey !== key && logReady, key, wave: head.wave };
}
let rollRetryAt = 0;
async function autoRoll() {
  const me = mePlayer(), state = rollState();
  if (!state.can || Date.now() < rollRetryAt) return;
  rollSentKey = state.key;
  try {
    const [data, reference] = await Promise.all([readPC({ npcId: `v2:${me.pcId}` }), loadSheetReference()]);
    const [key] = checkFor({ role: me.role, cls: me.cls || '' });
    const rolls = sheetRolls(data, reference);
    const check = [...rolls['Skill Checks'], ...rolls['Ability Checks']].find(roll => roll.key === key) || rolls['Ability Checks'].find(roll => roll.key === 'ability:dex');
    const roll = buildExpressionRoll(check.expression, check.disadvantage ? 'disadvantage' : 'normal');
    const natural = roll.dice.find(die => !die.drop).v;
    send({ t: currentTick(), k: 'r', total: Math.max(-10, Math.min(60, roll.total)), nat: natural });
  } catch (error) { rollSentKey = null; rollRetryAt = Date.now() + 3000; message(error.message); }
}

// --- GM controls
$('horde-start').addEventListener('click', async () => {
  if (!isGM || !session || session.phase !== 'lobby') return;
  $('horde-start').disabled = true;
  try { await startHordeSession(session.id); } catch (error) { message(error.message); $('horde-start').disabled = false; }
});
$('horde-speed').addEventListener('change', async () => {
  if (!isGM || !session || session.phase !== 'lobby') return;
  try { await setHordeSpeed(Number($('horde-speed').value)); } catch (error) { message(error.message); }
});
$('horde-end').addEventListener('click', async () => {
  if (!isGM || !session) return;
  try { await endHordeSession(session.id, timeline ? compactResults(timeline.stateAt(currentTick() + 1)) : undefined); } catch (error) { message(error.message); }
});
const compactResults = state => { const r = gameResults(state); return { phase: r.phase, wave: r.wave, kills: r.kills, crowdKills: r.crowd.kills, gate: Math.max(0, r.gate), mvp: r.mvp, players: r.players.map(p => ({ pcId: p.pcId, name: p.name, role: p.role, kills: p.kills, healed: p.healed, blocked: p.blocked, casts: p.casts, revives: p.revives, score: p.score })) }; };

// --- GM: create the game from this page (the tabletop panel does the same)
$('horde-campaign').replaceChildren(...CAMPAIGNS.map(name => new Option(name, name)));
$('horde-party').append(...CHARACTERS.map(name => {
  const label = document.createElement('label'), box = document.createElement('input'), role = document.createElement('select');
  box.type = 'checkbox'; box.value = name; box.checked = true;
  role.dataset.name = name; role.setAttribute('aria-label', `${name} role`);
  role.append(new Option('Role from class', ''), ...Object.entries(ROLE_NAME).map(([value, text]) => new Option(text, value)));
  label.append(box, document.createTextNode(name), role); return label;
}));
$('horde-setup').addEventListener('submit', async event => {
  event.preventDefault();
  if (!isGM) return;
  $('horde-create').disabled = true; message('Reading classes…');
  try {
    const entities = await (await fetch(`${hordeBase.replace(/\/vtt$/, '')}/entities.json`, { signal: AbortSignal.timeout(15000) })).json();
    const names = [...$('horde-party').querySelectorAll('input:checked')].map(box => box.value);
    const participants = names.map(name => {
      const { pcId } = resolvePlayer(entities, $('horde-campaign').value, name);
      return { pcId, name, cls: String(entities[pcId]?.data?.class ?? ''), role: $('horde-party').querySelector(`select[data-name="${name}"]`).value || undefined };
    });
    receiveSession(await createHordeSession(participants, Number($('horde-new-speed').value)));
    message('');
  } catch (error) { message(error.message); }
  finally { $('horde-create').disabled = false; }
});

// --- panels (rebuilt only when their content changes)
function renderPanels() {
  const running = session?.phase === 'running', me = mePlayer();
  $('horde-setup').hidden = !isGM || (!!session && session.phase !== 'ended');
  $('horde-lobby').hidden = !isGM || !session;
  $('horde-start').hidden = session?.phase !== 'lobby';
  $('horde-end').hidden = !session || session.phase === 'ended';
  $('horde-speed-label').hidden = session?.phase !== 'lobby';
  if (session && document.activeElement !== $('horde-speed')) $('horde-speed').value = String(session.speed ?? 1);
  const typing = !!me && typesWords(me.role), audience = audienceMode();
  $('minigame-entry').hidden = !(typing || audience) || !running;
  $('minigame-input').disabled = typing ? !canPlay() : !canWatchType();
  const mode = me && timeline?.head?.players.find(p => p.pcId === me.pcId)?.mech.mode;
  $('horde-hint').textContent = me ? (me.role === 'tank' && mode === 1 ? HINT.tankLine : me.role === 'striker' && mode === 1 ? HINT.strikerSlash : me.role === 'simon' && mode === 1 ? HINT.simonGlyphs : isBardRole(me.role) && mode === 1 ? HINT.bardHold : HINT[me.role]) : audience && running ? HINT.spectator : '';
}

function renderSpells(state) {
  const me = state.players.find(p => p.pcId === playerIdentity?.pcId), spells = $('horde-spells');
  if (me?.role === 'support') {
    spells.hidden = false;
    spells.replaceChildren(...spellsFor(me.cls).map((name, i) => { const li = document.createElement('li'); li.textContent = me.spellCd[i] > 0 ? `${name} · ${Math.ceil(me.spellCd[i] / TICKS_PER_SECOND)}s` : name; if (me.spellCd[i] > 0) li.className = 'cooling'; return li; }));
  } else spells.hidden = true;
}
function renderResults(state) {
  const box = $('horde-results'), results = gameResults(state);
  box.hidden = !results.over;
  if (!results.over) return;
  const mvp = results.players.find(p => p.pcId === results.mvp);
  const text = `${state.phase === 'won' ? 'The gate held' : 'Overrun in wave ' + state.wave} · ${results.kills} kills${mvp ? ` · MVP ${mvp.name}` : ''}`;
  if ($('horde-summary').textContent !== text) $('horde-summary').textContent = text;
  if (isGM && !endHandled && session?.phase === 'running') { endHandled = true; endHordeSession(session.id, compactResults(state)).catch(error => message(error.message)); }
}

// --- frame loop
let frame;
function animate() {
  frame = requestAnimationFrame(animate);
  if (!timeline || !session || document.hidden) { if (!session) view.draw(emptyState, 0, { status: 'waiting', note: isGM ? 'Create a game below' : 'Waiting for a game from the tabletop' }); return; }
  const running = session.phase === 'running' && startsAt() !== null;
  // Ended games freeze on their last frame; lobbies show the starting line-up.
  const frozen = session.phase === 'ended' && startsAt() !== null && Number.isFinite(session.endedAt);
  const clock = running ? serverNow() : frozen ? session.endedAt : startsAt();
  const exact = running || frozen ? Math.max(0, (clock - startsAt()) * TICKS_PER_SECOND / 1000 - (frozen ? 0 : RENDER_LAG)) : 0;
  const whole = Math.floor(exact), state = timeline.stateAt(whole + 1);
  const { all, inRange } = words();
  const status = running || frozen ? 'running' : 'waiting';
  const roll = rollState(), role = myRole();
  view.draw(state, exact - whole, { me: playerIdentity?.pcId, typed, candidates: all.length ? inRange : null, status, showWords: role === 'striker' || isBardRole(role) && myMode() === 0 || audienceMode(), prompt: roll.can ? 'Rolling…' : undefined, note: session.phase === 'ended' ? 'Game ended' : undefined });
  tune(state);
  renderSpells(state); renderResults(state); renderPanels(); autoRoll();
  if (session.phase === 'running' && (canPlay() || canWatchType()) && (typesWords(role) || audienceMode()) && document.activeElement !== $('minigame-input') && !$('minigame-input').disabled) $('minigame-input').focus({ preventScroll: true });
}
const emptyState = { tick: 0, phase: 'countdown', timer: 150, wave: 0, gate: { hp: 100, max: 100 }, buffs: { haste: 0, bless: 0 }, players: [], zombies: [], arrows: [], crowd: [], log: [] };

// --- audio: Simon's notes and the bards' metronome (browsers only allow sound after a key press or click).
let audio = null;
function ensureAudio() {
  if (!['pitch', 'cutter', 'simon'].includes(myRole())) return;
  try { audio ||= new AudioContext(); if (audio.state === 'suspended') audio.resume(); } catch { audio = null; }
}
// Simon's pads each have a note (C E G A), heard when you press one and as the pattern is shown.
const PAD_NOTES = [261.63, 329.63, 392, 440];
function playNote(pad) {
  if (!audio || !(pad in PAD_NOTES)) return;
  const osc = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
  osc.type = 'triangle'; osc.frequency.value = PAD_NOTES[pad];
  gain.gain.setValueAtTime(0.12, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  osc.connect(gain).connect(audio.destination); osc.start(now); osc.stop(now + 0.4);
}
let lastLit = -1, lastBeat = null;
function click(accent) {
  const osc = audio.createOscillator(), gain = audio.createGain(), now = audio.currentTime;
  osc.type = 'square'; osc.frequency.value = accent ? 1200 : 800;
  gain.gain.setValueAtTime(0.06, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  osc.connect(gain).connect(audio.destination); osc.start(now); osc.stop(now + 0.06);
}
function tune(state) {
  if (!audio) return;
  const simon = state.players.find(p => p.pcId === playerIdentity?.pcId && p.role === 'simon');
  if (simon) {
    const m = simon.mech, step = simonStep(simon.tier);
    const lit = m.phase === 'show' && (state.tick - m.at) % step < step * 0.7 ? m.seq[Math.floor((state.tick - m.at) / step)] : -1;
    if (lit !== lastLit) { lastLit = lit; if (lit >= 0) playNote(lit); }
  }
  const bard = state.players.find(p => p.pcId === playerIdentity?.pcId && isBardRole(p.role));
  if (bard && state.phase === 'wave' && !bard.downed) {
    const n = Math.floor(state.tick / runeBeat(bard.tier));
    if (n !== lastBeat) { lastBeat = n; click(n % 4 === 0); }
  } else lastBeat = null;
}

// --- start up
// Debug hook: compare two browsers by asking each for the game state at the same tick.
window.hordeState = tick => timeline ? JSON.stringify(timeline.stateAt(tick)) : null;
// Local only (nothing is posted): lets a test page drive every role from one visible tab.
window.hordeInject = event => !!timeline?.addEvent(event);
window.hordeLive = () => timeline?.head ? JSON.stringify({ tick: currentTick(), state: timeline.head }) : null;
renderPanels();
const stopHorde = watchHorde({ onSession: receiveSession, onLog: receiveLog, onError: message });
syncClock().catch(error => message(error.message));
const clockTimer = setInterval(() => syncClock().catch(() => {}), 60000);
frame = requestAnimationFrame(animate);
window.addEventListener('player-signed-in', () => { renderPanels(); });
window.addEventListener('pagehide', () => { stopHorde(); clearInterval(clockTimer); cancelAnimationFrame(frame); view.destroy(); }, { once: true });
if (isGM) $('minigame-back').search = '?gm=jonny';
const params = new URLSearchParams(location.search);
if (!isGM && params.has('campaign') && params.has('character')) {
  const campaign = $('player-campaign'), character = $('player-character');
  if ([...campaign.options].some(option => option.value === params.get('campaign'))) {
    campaign.value = params.get('campaign'); campaign.dispatchEvent(new Event('change'));
    if ([...character.options].some(option => option.value === params.get('character'))) character.value = params.get('character');
  }
}
