import { openPanel } from './menu-bar.js';
import { isGM, playerIdentity } from './session-role.js';
import { readPC } from './pc-inventory.js';
import { createHordeSession, endHordeSession, watchHorde } from './horde-sync.js';

const $ = id => document.getElementById(id), floor = $('floor'), panel = $('minigame-panel');
let session, busy = false, sceneDocument;
const message = text => { $('minigame-status').textContent = text; };
const pcs = () => [...new Map((floor.tabletopMap?.tokens || []).filter(token => token.kind === 'pc' && token.npcId?.startsWith('v2:')).map(token => [token.npcId.slice(3), token])).values()];
const ROLE_NAME = { tank: 'Tank (charge)', healer: 'Healer (type names)', cutter: 'Bard (words, hold person)', simon: 'Simon (heal)', pitch: 'Bard (words, hold person)', striker: 'Striker (type to shoot)', support: 'Support (spell words)' };

function recipients() {
  const checked = new Set([...$('minigame-recipients').querySelectorAll('input:checked')].map(input => input.value));
  const roles = new Map([...$('minigame-recipients').querySelectorAll('select')].map(select => [select.dataset.pc, select.value]));
  const legend = document.createElement('legend'); legend.textContent = 'Who?';
  $('minigame-recipients').replaceChildren(legend);
  for (const token of pcs()) {
    const label = document.createElement('label'), input = document.createElement('input');
    input.type = 'checkbox'; input.value = token.npcId.slice(3);
    input.checked = checked.has(input.value) || token.id === floor.selectedTokenId;
    const role = document.createElement('select');
    role.dataset.pc = input.value; role.setAttribute('aria-label', `${token.name} role`);
    role.append(new Option('Role from class', ''), ...Object.entries(ROLE_NAME).map(([value, text]) => new Option(text, value)));
    role.value = roles.get(input.value) || '';
    label.append(input, document.createTextNode(token.name), role); $('minigame-recipients').append(label);
  }
}

function summary(value) {
  const results = value.results;
  if (value.phase === 'lobby') return `Lobby · ${Object.values(value.participants).length} players · speed ${value.speed ?? 1}`;
  if (value.phase === 'running') return `Horde in progress · speed ${value.speed ?? 1}`;
  if (!results) return 'Game ended';
  const mvp = results.players?.find(p => p.pcId === results.mvp);
  return `${results.phase === 'won' ? 'The gate held' : `Overrun in wave ${results.wave}`} · ${results.kills} kills${mvp ? ` · MVP ${mvp.name}` : ''}`;
}
function render() {
  $('minigame-session').hidden = !session;
  $('minigame-push').disabled = busy;
  $('minigame-end').disabled = busy || !session || session.phase === 'ended';
  if (!session) return;
  const url = new URL('minigame.html', location.href);
  if (isGM) url.searchParams.set('gm', 'jonny');
  else if (playerIdentity) {
    url.searchParams.set('campaign', playerIdentity.campaign);
    url.searchParams.set('character', playerIdentity.character);
  }
  $('minigame-open').href = url.href;
  $('minigame-team').textContent = summary(session);
  const rows = session.results?.players || Object.values(session.participants);
  $('minigame-results').replaceChildren(...rows.map(player => {
    const item = document.createElement('li'), name = document.createElement('strong'), detail = document.createElement('span');
    name.textContent = player.name;
    detail.textContent = `${ROLE_NAME[player.role] || ''}${player.kills !== undefined ? ` · ${player.kills} kills · ${player.healed || 0} healed` : ''}`;
    item.append(name, detail); return item;
  }));
}
function receiveSession(value) {
  const changed = session?.id !== value?.id;
  session = value;
  if (changed && value && value.phase !== 'ended') { openPanel(panel); message('Game ready.'); }
  render();
}

$('scene-minigame').addEventListener('click', () => { if (isGM) { recipients(); render(); openPanel(panel); } });
$('open-minigame').addEventListener('click', () => { if (isGM) recipients(); render(); openPanel(panel); });
$('minigame-setup').addEventListener('submit', async event => {
  event.preventDefault();
  if (!isGM || busy) return;
  const ids = new Set([...$('minigame-recipients').querySelectorAll('input:checked')].map(input => input.value));
  const chosen = pcs().filter(token => ids.has(token.npcId.slice(3)));
  busy = true; render(); message('Reading classes…');
  try {
    const participants = await Promise.all(chosen.map(async token => ({ pcId: token.npcId.slice(3), name: token.name.slice(0, 40), cls: String((await readPC(token)).class ?? ''), role: $('minigame-recipients').querySelector(`select[data-pc="${token.npcId.slice(3)}"]`)?.value || undefined })));
    sceneDocument = floor.sceneDocument; receiveSession(await createHordeSession(participants, Number($('minigame-speed').value))); message('Pushed. Open the minigame, let everyone roll, then press Start.');
  } catch (error) { message(error.message); }
  finally { busy = false; render(); }
});
$('minigame-end').addEventListener('click', async () => {
  if (!isGM || !session || busy || session.phase === 'ended') return;
  busy = true; render();
  try { await endHordeSession(session.id); message('Ended.'); }
  catch (error) { message(error.message); }
  finally { busy = false; render(); }
});
window.addEventListener('player-signed-in', render);
floor.addEventListener('map-ready', () => {
  recipients();
  if (isGM && sceneDocument && sceneDocument !== floor.sceneDocument && session?.phase === 'running') $('minigame-end').click();
});
const stop = watchHorde({ onSession: receiveSession, onLog() {}, onError: message });
window.addEventListener('pagehide', stop, { once: true });
