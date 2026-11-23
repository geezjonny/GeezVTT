import { isGM, sessionClient, playerIdentity, setPlayerIdentity } from './session-role.js';
import { CAMPAIGNS, CHARACTERS, resolvePlayer, activePresence } from './player-session-model.js';
import { watchTabletop } from './tabletop-stream.js';

const $ = id => document.getElementById(id);
const base = window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, '');
// shortcut: character selection trusts players; add Firebase Auth and ownership rules before opening to untrusted users.
const url = `${base}/v2/worlds/gaia/vtt/presence/${sessionClient}.json`;
const dialog = $('player-login'), form = $('player-login-form');
const campaign = $('player-campaign'), character = $('player-character');
let presence = {}, joined = false, saving = false, stopped = false;
export const playerPresence = client => activePresence(presence[client]) ? presence[client] : null;
campaign.append(...CAMPAIGNS.map(name => new Option(name, name)));
character.append(...CHARACTERS.map(name => new Option(name, name)));
campaign.addEventListener('change', () => { character.disabled = !campaign.value; character.value = ''; });
function draw() {
  const players = Object.values(presence).filter(active => activePresence(active) && (isGM || joined && active.campaign === playerIdentity?.campaign));
  const labels = [...new Set(players.map(player => `${player.character} (${player.campaign})`))].sort();
  $('presence-online').textContent = `Online: ${labels.join(', ') || 'None'}`;
}
async function publish(player) {
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...player, lastSeen: { '.sv': 'timestamp' } }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
}
function prompt() {
  campaign.value = playerIdentity?.campaign || '';
  character.disabled = !campaign.value;
  character.value = playerIdentity?.character || '';
  $('player-login-status').textContent = '';
  dialog.showModal(); campaign.focus();
}
dialog.addEventListener('cancel', event => { if (!joined) event.preventDefault(); });
$('player-sign-in').hidden = isGM;
$('player-sign-in').addEventListener('click', prompt);
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving || !form.reportValidity()) return;
  saving = true; form.querySelector('button').disabled = true;
  let step = 'Loading characters';
  $('player-login-status').textContent = `${step}…`;
  try {
    const response = await fetch(`${base}/v2/worlds/gaia/entities.json`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
    const player = resolvePlayer(await response.json(), campaign.value, character.value);
    step = 'Registering presence';
    $('player-login-status').textContent = `${step}…`;
    await publish(player);
    if (stopped) return;
    joined = true;
    setPlayerIdentity(player);
    $('player-sign-in').textContent = `${player.character} · ${player.campaign}`;
    $('presence-status').textContent = '';
    dialog.close(); draw();
  } catch (error) {
    $('player-login-status').textContent = error.name === 'TimeoutError'
      ? `${step} timed out. Reload all open GeezVTT tabs, then try again.` : error.message;
  }
  finally { saving = false; form.querySelector('button').disabled = false; }
});
const stopPresence = watchTabletop('presence', value => {
  presence = value || {}; draw(); $('presence-status').textContent = '';
}, message => { $('presence-status').textContent = message; });
const timer = setInterval(async () => {
  draw();
  if (!joined || saving || stopped) return;
  saving = true;
  try { await publish(playerIdentity); $('presence-status').textContent = ''; }
  catch (error) { $('presence-status').textContent = `Presence failed: ${error.message}`; }
  finally { saving = false; }
}, 25000);
window.addEventListener('pagehide', () => {
  stopped = true; clearInterval(timer); stopPresence();
  if (joined || saving) fetch(url, { method: 'DELETE', keepalive: true }).catch(() => {});
});
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
if (!isGM) prompt();
