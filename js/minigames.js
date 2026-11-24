import { openPanel } from './menu-bar.js';
import { isGM, playerIdentity } from './session-role.js';
import { watchTabletop } from './tabletop-stream.js';
import { validMinigameSession } from './typing-game-model.js';
import { writeMinigame, renderMinigameResults } from './minigame-session.js';

const $ = id => document.getElementById(id), floor = $('floor'), panel = $('minigame-panel');
let session, runs = {}, busy = false, sceneDocument;
const message = text => { $('minigame-status').textContent = text; };
const pcs = () => [...new Map((floor.tabletopMap?.tokens || []).filter(token => token.kind === 'pc' && token.npcId?.startsWith('v2:')).map(token => [token.npcId.slice(3), token])).values()];

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

function render() {
  $('minigame-session').hidden = !session;
  $('minigame-push').disabled = busy;
  $('minigame-end').disabled = busy || !session || session.stopped;
  if (!session) return;
  const url = new URL('minigame.html', location.href);
  url.searchParams.set('session', session.id);
  if (isGM) url.searchParams.set('gm', 'jonny');
  else if (playerIdentity) {
    url.searchParams.set('campaign', playerIdentity.campaign);
    url.searchParams.set('character', playerIdentity.character);
  }
  $('minigame-open').href = url.href;
  renderMinigameResults(session, runs, $('minigame-results'), $('minigame-team'));
}
function receiveSession(value) {
  if (!validMinigameSession(value)) { session = null; render(); return; }
  const changed = session?.id !== value.id;
  session = value;
  if (changed && !value.stopped) { openPanel(panel); message('Game ready.'); }
  render();
}

$('scene-minigame').addEventListener('click', () => { if (isGM) { recipients(); render(); openPanel(panel); } });
$('open-minigame').addEventListener('click', () => { if (isGM) recipients(); render(); openPanel(panel); });
$('minigame-setup').addEventListener('submit', async event => {
  event.preventDefault();
  if (!isGM || busy) return;
  const ids = new Set([...$('minigame-recipients').querySelectorAll('input:checked')].map(input => input.value));
  const participants = pcs().filter(token => ids.has(token.npcId.slice(3))).map(token => ({ pcId: token.npcId.slice(3), name: token.name.slice(0, 120) }));
  const next = { id: crypto.randomUUID(), type: 'typing', participants, stopped: false };
  if (!validMinigameSession(next)) { message('Choose 1–32 linked PCs.'); return; }
  busy = true; render();
  try {
    await writeMinigame('minigame', next);
    sceneDocument = floor.sceneDocument; receiveSession(next); message('Pushed.');
  } catch (error) { message(error.message); }
  finally { busy = false; render(); }
});
$('minigame-end').addEventListener('click', async () => {
  if (!isGM || !session || busy || session.stopped) return;
  busy = true; render();
  try {
    const next = { ...session, stopped: true };
    await writeMinigame('minigame', next); receiveSession(next); message('Ended.');
  } catch (error) { message(error.message); }
  finally { busy = false; render(); }
});
window.addEventListener('player-signed-in', render);
floor.addEventListener('map-ready', () => {
  recipients();
  if (isGM && sceneDocument && sceneDocument !== floor.sceneDocument && session && !session.stopped) $('minigame-end').click();
});
const stopSession = watchTabletop('minigame', receiveSession, message);
const stopRuns = watchTabletop('minigameRuns', value => { runs = value || {}; render(); }, message);
window.addEventListener('pagehide', () => { stopSession(); stopRuns(); }, { once: true });
