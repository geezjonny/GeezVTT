import { openPanel } from './menu-bar.js';
import { isGM, playerIdentity } from './session-role.js';
import { activePresence } from './player-session-model.js';
import { watchTabletop } from './tabletop-stream.js';
import { randomDie } from './dice-roll.js';
import { WORD_COUNT, WORD_LABELS, revealBargain } from './devils-deck-model.js';
import { pushChance, pickChance, closeChance, watchChance } from './chance-sync.js';
import { readPC } from './pc-inventory.js';
import { loadSheetReference, sheetHTML } from './sheet-view.js';
import { mountEffects } from './effects-editor.js';

const $ = id => document.getElementById(id), floor = $('floor'), panel = $('chance-panel'), recipient = $('chance-recipient');
let records = {}, presence = {}, busy = false, ready = false, pendingOffer, pendingChoice, notice, syncRevision = 0;
let effectsPC, effectsId, reference = {}, effectsVersion = 0;
const currentId = () => recipient.value;
const current = () => Object.hasOwn(records, currentId()) ? records[currentId()] : null;
const message = value => { $('chance-status').textContent = value; };
function clearEffects() {
  effectsVersion++; effectsPC = null; effectsId = null;
  $('chance-effects').open = false; $('chance-effects-content').replaceChildren(); $('chance-effects-status').textContent = '';
}
function recipients() {
  const selected = recipient.value, options = new Map();
  for (const token of floor.tabletopMap?.tokens || []) {
    if (token.kind === 'pc' && token.npcId?.startsWith('v2:')) options.set(token.npcId.slice(3), token.name);
  }
  for (const player of Object.values(presence)) if (activePresence(player)) options.set(player.pcId, player.character);
  for (const [id, record] of Object.entries(records)) if (!options.has(id)) options.set(id, record.name);
  recipient.replaceChildren(new Option('Choose character', ''), ...[...options].sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(([id, name]) => new Option(name, id)));
  const selectedToken = floor.tabletopMap?.tokens.find(token => token.id === floor.selectedTokenId);
  const preferred = isGM ? selectedToken?.npcId?.slice(3) : playerIdentity?.pcId;
  recipient.value = options.has(selected) ? selected : options.has(preferred) ? preferred : '';
  if (recipient.value !== selected) { pendingOffer = null; notice = null; clearEffects(); }
}
function render() {
  const record = current(), hand = record?.hand;
  const active = hand && ['offered', 'revealed'].includes(hand.phase);
  recipient.disabled = busy;
  $('chance-push').disabled = !ready || busy || !recipient.value || active;
  $('chance-cancel').hidden = !isGM || hand?.phase !== 'offered'; $('chance-cancel').disabled = busy;
  $('chance-handled').hidden = !isGM || hand?.phase !== 'revealed'; $('chance-handled').disabled = busy;
  $('chance-effects').hidden = !isGM || !recipient.value;
  $('chance-summary').textContent = hand
    ? `${record.name} · Draw ${hand.drawNumber} · ×${hand.drawNumber} · ${{ offered: 'Choose a card', revealed: 'Revealed', handled: 'Handled manually', cancelled: 'Cancelled' }[hand.phase]}`
    : isGM && recipient.value ? 'Next draw: ×1' : isGM ? 'Choose a character.' : playerIdentity ? 'Waiting for the dealer.' : 'Sign in to receive a draw.';
  $('chance-cards').hidden = hand?.phase !== 'offered';
  for (const button of $('chance-cards').querySelectorAll('button')) {
    button.disabled = busy || isGM || playerIdentity?.pcId !== record?.pcId || !ready || hand?.phase !== 'offered' || pendingChoice && (pendingChoice.id !== hand.id || pendingChoice.choice !== Number(button.dataset.chanceCard));
    button.textContent = pendingChoice?.id === hand?.id && pendingChoice.choice === Number(button.dataset.chanceCard) ? 'Retry pick' : `✧ ${Number(button.dataset.chanceCard) + 1}`;
  }
  const revealed = hand && ['revealed', 'handled'].includes(hand.phase);
  $('chance-result').hidden = !revealed;
  if (revealed) {
    const bargain = revealBargain(hand.cards[hand.chosen]);
    $('chance-result-name').textContent = bargain.name;
    $('chance-flavor').textContent = bargain.flavor;
    $('chance-words').replaceChildren(...bargain.words.map(([word, meaning], index) => {
      const row = document.createElement('div'), term = document.createElement('dt'), detail = document.createElement('dd');
      term.textContent = `${WORD_LABELS[index]} · ${word}`; detail.textContent = meaning; row.append(term, detail); return row;
    }));
  }
  const nextNotice = record && active ? `${record.pcId}:${hand.id}:${hand.phase}` : null;
  if (nextNotice && notice !== nextNotice) { notice = nextNotice; openPanel(panel); }
  $('chance-table').replaceChildren(...Object.values(records).filter(record => record.hand.phase !== 'cancelled')
    .sort((a, b) => b.hand.createdAt - a.hand.createdAt).map(record => {
      const row = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.dataset.chanceView = record.pcId; button.disabled = busy;
      button.textContent = `${record.name} · ×${record.hand.drawNumber} · ${record.hand.phase === 'offered' ? 'Choosing…' : revealBargain(record.hand.cards[record.hand.chosen]).name}`;
      button.setAttribute('aria-pressed', String(record.pcId === currentId())); row.append(button); return row;
    }));
}
function received(value) {
  const changed = Object.values(value).filter(record => ['offered', 'revealed'].includes(record.hand.phase) &&
    (records[record.pcId]?.hand.id !== record.hand.id || records[record.pcId]?.hand.phase !== record.hand.phase))
    .sort((a, b) => b.hand.createdAt - a.hand.createdAt)[0];
  records = value; ready = true; syncRevision++;
  recipients();
  if (changed) {
    if (!busy && !isGM) { recipient.value = changed.pcId; notice = null; }
    else if (!recipient.value) recipient.value = changed.pcId;
    openPanel(panel);
  } else if (!recipient.value) {
    const latest = Object.values(records).sort((a, b) => b.hand.createdAt - a.hand.createdAt)[0];
    if (latest) recipient.value = latest.pcId;
  }
  if (pendingChoice && current()?.hand.id !== pendingChoice.id) pendingChoice = null;
  render();
}
async function run(work) {
  if (busy) return;
  const revision = syncRevision;
  busy = true; render(); message('Saving…');
  try {
    const record = await work();
    // A newer stream update may already include the player's pick or the GM's acknowledgement.
    if (syncRevision === revision) records = { ...records, [record.pcId]: record };
    message('');
  }
  catch (error) { message(error.message); }
  finally { busy = false; recipients(); render(); }
}
$('open-chance').addEventListener('click', () => { recipients(); render(); openPanel(panel); });
recipient.addEventListener('change', () => { pendingOffer = null; pendingChoice = null; notice = null; clearEffects(); message(''); render(); });
$('chance-table').addEventListener('click', event => {
  const button = event.target.closest('[data-chance-view]');
  if (!button || busy) return;
  recipient.value = button.dataset.chanceView;
  recipient.dispatchEvent(new Event('change'));
});
$('chance-setup').addEventListener('submit', event => {
  event.preventDefault();
  if (!isGM || busy || !recipient.value || !ready) return;
  if (!pendingOffer || pendingOffer.pcId !== recipient.value) pendingOffer = { id: crypto.randomUUID(), pcId: recipient.value,
    name: recipient.selectedOptions[0].textContent.slice(0, 80), createdAt: Date.now(),
    cards: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => randomDie(WORD_COUNT))) };
  const offer = pendingOffer;
  run(async () => { const record = await pushChance(offer); pendingOffer = null; clearEffects(); return record; });
});
$('chance-cards').addEventListener('click', event => {
  const button = event.target.closest('[data-chance-card]'), record = current();
  if (!button || button.disabled || busy || isGM || !record || playerIdentity?.pcId !== record.pcId || !ready) return;
  pendingChoice ||= { id: record.hand.id, choice: Number(button.dataset.chanceCard) };
  const choice = pendingChoice, id = record.pcId;
  run(async () => { const result = await pickChance(id, choice.id, choice.choice); pendingChoice = null; return result; });
});
for (const [id, phase] of [['chance-cancel', 'cancelled'], ['chance-handled', 'handled']]) $(id).addEventListener('click', () => {
  const record = current(); if (!isGM || !record || busy) return;
  run(() => closeChance(record.pcId, record.hand.id, phase));
});

function drawEffects() {
  $('chance-effects-content').innerHTML = sheetHTML(effectsPC, 'Effects', reference, false, true, true);
}
mountEffects($('chance-effects-content'), () => isGM && effectsPC && effectsId === currentId() ? { npcId: `v2:${effectsId}` } : null,
  () => effectsPC, $('chance-effects-status'), (pc, token) => {
    if (token.npcId === `v2:${effectsId}` && effectsId === currentId()) { effectsPC = pc; drawEffects(); }
  });
$('chance-effects').addEventListener('toggle', async () => {
  if (!$('chance-effects').open || !isGM || !currentId()) return;
  const id = currentId(), version = ++effectsVersion;
  $('chance-effects-status').textContent = 'Loading…';
  try {
    const [pc, loadedReference] = await Promise.all([readPC({ npcId: `v2:${id}` }), loadSheetReference()]);
    if (version !== effectsVersion || currentId() !== id) return;
    effectsPC = pc; effectsId = id; reference = loadedReference; drawEffects();
    const hand = current()?.hand;
    if (hand && ['revealed', 'handled'].includes(hand.phase)) {
      const bargain = revealBargain(hand.cards[hand.chosen]), form = $('chance-effects-content').querySelector('[data-effect-form]');
      form.elements.namedItem('label').value = bargain.name;
      const card = pc.inventory?.[hand.inventoryKey];
      form.elements.namedItem('description').value = card?.desc || bargain.flavor;
      if (card) {
        form.elements.namedItem('mode').value = 'equipped';
        form.elements.namedItem('category').value = 'Equipment';
        form.elements.namedItem('inventoryKey').value = hand.inventoryKey;
      }
      form.closest('details').open = true;
    }
    $('chance-effects-status').textContent = '';
  } catch (error) { if (version === effectsVersion && currentId() === id) $('chance-effects-status').textContent = error.message; }
});
floor.addEventListener('map-ready', () => { recipients(); render(); });
window.addEventListener('player-signed-in', () => { pendingChoice = null; notice = null; clearEffects(); recipients(); render(); });
const stopPresence = watchTabletop('presence', value => { presence = value || {}; recipients(); render(); });
const stopChance = watchChance(received, message);
window.addEventListener('pagehide', () => { stopChance(); stopPresence(); }, { once: true });
render();
