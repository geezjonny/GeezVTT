import { openPanel } from './menu-bar.js';
import { isGM, playerIdentity, sessionClient } from './session-role.js';
import { watchTabletop } from './tabletop-stream.js';
import { readPC } from './pc-inventory.js';
import { loadSheetReference } from './sheet-view.js';
import { sheetRolls } from './sheet-rolls.js';
import { buildExpressionRoll } from './dice-roll.js';
import { encodeKey } from './firebase-codec.js';
import { createTypingGame, advanceTypingGame, typeZombieWord, validTypingSnapshot, TYPING_WAVE, ZOMBIE_TRAVEL } from './typing-game-model.js';

const $ = id => document.getElementById(id), floor = $('floor'), panel = $('minigame-panel');
const base = `${window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, '')}/v2/worlds/gaia/vtt`;
const svgNS = 'http://www.w3.org/2000/svg';
let session, runs = {}, local, starting = false, pushing = false, writing = false, lastSent = '', lastFrame = performance.now(), receivedAt = performance.now(), sceneDocument;
const message = text => { if ($('minigame-status').textContent !== text) $('minigame-status').textContent = text; };
const pcKey = id => encodeKey(id);
const runPath = (id, pcId) => `minigameRuns/${id}/${encodeURIComponent(pcKey(pcId))}`;
const pcs = () => [...new Map((floor.tabletopMap?.tokens || []).filter(token => token.kind === 'pc' && token.npcId?.startsWith('v2:')).map(token => [token.npcId.slice(3), token])).values()];
const selectedPC = () => session?.participants.find(pc => pc.pcId === $('minigame-player').value);
const canPlay = pc => pc && (isGM || playerIdentity?.pcId === pc.pcId);
const paused = () => document.hidden || panel.hidden || $('minigame-body').hidden || $('minigame-player').value !== local?.pcId;

async function write(path, value, etag, method = 'PUT') {
  const response = await fetch(`${base}/${path}.json`, { method, headers: { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) }, body: JSON.stringify(value), signal: AbortSignal.timeout(15000) });
  if (response.status === 412) throw new Error('This PC already started in another window.');
  if (!response.ok) throw new Error(`Minigame sync failed (${response.status}).`);
}

function recipients() {
  const checked = new Set([...$('minigame-recipients').querySelectorAll('input:checked')].map(input => input.value));
  const legend = document.createElement('legend'); legend.textContent = 'Who?';
  $('minigame-recipients').replaceChildren(legend);
  for (const token of pcs()) {
    const label = document.createElement('label'), input = document.createElement('input');
    input.type = 'checkbox'; input.value = token.npcId.slice(3);
    input.checked = checked.has(input.value) || token.id === floor.selectedTokenId;
    label.append(input, document.createTextNode(token.name)); $('minigame-recipients').append(label);
  }
}

$('scene-minigame').addEventListener('click', () => {
  if (!isGM) return;
  recipients(); openPanel(panel);
});
$('minigame-setup').addEventListener('submit', async event => {
  event.preventDefault();
  if (!isGM || pushing) return;
  const ids = new Set([...$('minigame-recipients').querySelectorAll('input:checked')].map(input => input.value));
  const participants = pcs().filter(token => ids.has(token.npcId.slice(3))).map(token => ({ pcId: token.npcId.slice(3), name: token.name.slice(0, 120) }));
  if (!participants.length || participants.length > 32) { message('Choose 1–32 PCs.'); return; }
  pushing = true; $('minigame-push').disabled = true;
  const next = { id: crypto.randomUUID(), type: 'typing', participants, stopped: false };
  try {
    await write('minigame', next);
    sceneDocument = floor.sceneDocument;
    receiveSession(next); message('Pushed. Waiting for Dexterity rolls.');
  } catch (error) { message(error.message); }
  finally { pushing = false; $('minigame-push').disabled = false; }
});
$('minigame-end').addEventListener('click', async () => {
  if (!isGM || !session || pushing) return;
  pushing = true; $('minigame-push').disabled = true;
  const next = { ...session, stopped: true };
  try { await write('minigame', next); receiveSession(next); message('Ended.'); }
  catch (error) { message(error.message); }
  finally { pushing = false; $('minigame-push').disabled = false; render(); }
});

function receiveSession(value) {
  if (!value || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id) || value.type !== 'typing' ||
      typeof value.stopped !== 'boolean' || !Array.isArray(value.participants) || !value.participants.length || value.participants.length > 32 ||
      value.participants.some(pc => typeof pc?.pcId !== 'string' || !pc.pcId || pc.pcId.length > 200 || typeof pc.name !== 'string' || pc.name.length > 120) ||
      new Set(value.participants.map(pc => pc.pcId)).size !== value.participants.length) return;
  const changed = session?.id !== value.id;
  session = value;
  if (changed) {
    local = null; lastSent = '';
    $('minigame-player').replaceChildren(...value.participants.map(pc => new Option(pc.name, pc.pcId)));
    if (value.participants.some(pc => pc.pcId === playerIdentity?.pcId)) $('minigame-player').value = playerIdentity.pcId;
    $('minigame-input').value = ''; message('Waiting for Dexterity rolls.');
    if (!value.stopped) openPanel(panel);
  }
  if (value.stopped && local?.game.status === 'playing') { local.game.status = 'stopped'; publish(); }
  $('minigame-session').hidden = false;
  $('minigame-end').disabled = value.stopped;
  render();
}

function displayed() {
  const pc = selectedPC();
  if (local && local.pcId === pc?.pcId) return { ...local, typed: $('minigame-input').value, paused: paused() };
  const value = runs[session?.id]?.[pcKey(pc?.pcId)];
  return validTypingSnapshot(value) ? value : null;
}

$('minigame-roll').addEventListener('click', async () => {
  const pc = selectedPC(), current = session;
  if (!canPlay(pc) || current.stopped || starting || displayed() || local?.game.status === 'playing') return;
  starting = true; render(); message('Loading Dexterity…');
  try {
    if (local && !await publish()) throw new Error('Wait for the previous result to sync.');
    const [data, reference] = await Promise.all([readPC({ npcId: `v2:${pc.pcId}` }), loadSheetReference()]);
    const check = sheetRolls(data, reference)['Ability Checks'].find(roll => roll.key === 'ability:dex');
    const path = runPath(current.id, pc.pcId);
    const response = await fetch(`${base}/${path}.json`, { headers: { 'X-Firebase-ETag': 'true' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Minigame sync failed (${response.status}).`);
    if (await response.json()) throw new Error('This PC already rolled.');
    const etag = response.headers.get('ETag');
    if (!etag) throw new Error('Cannot reserve this attempt. Try again.');
    if (session?.id !== current.id || session.stopped || !canPlay(pc)) return;
    const roll = buildExpressionRoll(check.expression, check.disadvantage ? 'disadvantage' : 'normal');
    const natural = roll.dice.find(die => !die.drop).v;
    const attempt = { owner: sessionClient, pcId: pc.pcId, natural, total: roll.total, roll: `${roll.label} = ${roll.total} [${roll.sub}]`, typed: '', paused: false, game: createTypingGame(natural, roll.total) };
    await write(path, attempt, etag);
    if (session?.id !== current.id || session.stopped || !canPlay(pc)) return;
    local = attempt; lastSent = ''; lastFrame = performance.now();
    const text = `${pc.name} · Typing DEX: ${attempt.roll}`;
    floor.dispatchEvent(new CustomEvent('session-dice', { detail: text }));
    floor.dispatchEvent(new CustomEvent('session-action', { detail: { type: 'dice', text } }));
    $('minigame-input').value = ''; render(); $('minigame-input').focus(); message('');
  } catch (error) { message(error.message); }
  finally { starting = false; render(); }
});

function typeWord(event) {
  if (event?.isComposing || !local || session?.stopped || !canPlay(selectedPC()) || selectedPC()?.pcId !== local.pcId || paused()) return;
  const input = $('minigame-input');
  input.value = input.value.toLowerCase().replace(/[^a-z]/g, '').slice(0, 12);
  // Resolve movement first so a word cannot kill a zombie that has already arrived.
  tick(performance.now());
  if (typeZombieWord(local.game, input.value)) { input.value = ''; publish(); }
  render();
}
$('minigame-input').addEventListener('input', typeWord);
$('minigame-input').addEventListener('compositionend', typeWord);
for (const type of ['paste', 'drop']) $('minigame-input').addEventListener(type, event => event.preventDefault());
$('minigame-input').addEventListener('keydown', event => event.stopPropagation());
$('minigame-input').closest('form').addEventListener('submit', event => event.preventDefault());
$('minigame-player').addEventListener('change', () => { lastFrame = performance.now(); render(); });

async function publish() {
  if (!local || !session || writing || !canPlay({ pcId: local.pcId })) return;
  const path = runPath(session.id, local.pcId);
  const snapshot = JSON.stringify({ ...local, paused: paused(), typed: $('minigame-input').value });
  if (snapshot === lastSent) return true;
  writing = true;
  try { await write(path, JSON.parse(snapshot)); lastSent = snapshot; message(''); return true; }
  catch (error) { message(`${error.message} Playing locally; retrying.`); }
  finally { writing = false; }
}

function svgElement(name, attributes = {}, text) {
  const node = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}
const zombies = new Map();
function render() {
  const pc = selectedPC(), value = displayed(), game = value?.game;
  $('minigame-roll').hidden = !canPlay(pc) || !!value || session?.stopped;
  $('minigame-roll').disabled = starting || local?.game.status === 'playing';
  $('minigame-end').disabled = pushing || !session || session.stopped;
  $('minigame-input').disabled = !local || local.pcId !== pc?.pcId || game?.status !== 'playing' || session?.stopped;
  $('minigame-entry').hidden = !local || local.pcId !== pc?.pcId;
  const tierLabel = { long: 'Long words', medium: 'Medium words', short: 'Short words', letter: 'Single letters' };
  $('minigame-roll-result').textContent = value ? `DEX ${value.total} · d20: ${value.natural} · ${tierLabel[game.tier]}` : '';
  const status = session?.stopped || game?.status === 'stopped' ? 'Ended' : !game ? 'Waiting for roll' : game.status === 'won' ? 'Wave cleared' : game.status === 'lost' ? 'Overrun' : value.paused ? 'Paused' : 'Incoming';
  const score = `${status}${game ? ` · ${game.kills}/${TYPING_WAVE} kills · ${game.lives} lives` : ''}`;
  if ($('minigame-score').textContent !== score) $('minigame-score').textContent = score;
  const elapsed = (game?.elapsed || 0) + (game?.status === 'playing' && !value.paused && local?.pcId !== pc?.pcId && !session?.stopped ? Math.min(500, performance.now() - receivedAt) : 0);
  const active = new Set();
  for (const zombie of game?.zombies || []) {
    active.add(zombie.id);
    let group = zombies.get(zombie.id);
    if (!group) {
      group = svgElement('g');
      group.append(svgElement('use', { href: '#typing-zombie' }), svgElement('text', { y: -29, 'text-anchor': 'middle', class: 'typing-word' }));
      zombies.set(zombie.id, group); $('typing-zombies').append(group);
    }
    const progress = Math.max(0, Math.min(1, (elapsed - zombie.born) / ZOMBIE_TRAVEL));
    group.setAttribute('transform', `translate(${zombie.id % 2 ? 205 : 95} ${42 + progress * 280})`);
    const prefix = value.typed && zombie.word.startsWith(value.typed) ? value.typed.length : 0;
    const label = `${zombie.word}:${prefix}`;
    if (group.dataset.label !== label) {
      group.lastChild.replaceChildren(svgElement('tspan', { fill: '#fbd878' }, zombie.word.slice(0, prefix)), svgElement('tspan', { fill: '#fff' }, zombie.word.slice(prefix)));
      group.dataset.label = label;
    }
  }
  for (const [id, node] of zombies) if (!active.has(id)) { node.remove(); zombies.delete(id); }
}

function tick(now) {
  if (local?.game.status === 'playing' && !session?.stopped && !paused()) advanceTypingGame(local.game, now - lastFrame);
  lastFrame = now;
}
let frame;
function animate(now) {
  tick(now);
  if (!panel.hidden && !$('minigame-body').hidden) render();
  frame = requestAnimationFrame(animate);
}
frame = requestAnimationFrame(animate);
const timer = setInterval(publish, 500);
document.addEventListener('visibilitychange', () => { lastFrame = performance.now(); publish(); });
window.addEventListener('player-signed-in', () => {
  if (local && !canPlay({ pcId: local.pcId })) local = null;
  if (session?.participants.some(pc => pc.pcId === playerIdentity?.pcId)) $('minigame-player').value = playerIdentity.pcId;
  render();
});
floor.addEventListener('map-ready', () => {
  recipients();
  if (isGM && sceneDocument && sceneDocument !== floor.sceneDocument && session && !session.stopped) $('minigame-end').click();
});
const stopSession = watchTabletop('minigame', receiveSession, message);
// shortcut: snapshots remain per session; add retention limits if this table accumulates many games.
const stopRuns = watchTabletop('minigameRuns', value => { runs = value || {}; receivedAt = performance.now(); render(); }, message);
window.addEventListener('pagehide', () => { stopSession(); stopRuns(); clearInterval(timer); cancelAnimationFrame(frame); }, { once: true });
