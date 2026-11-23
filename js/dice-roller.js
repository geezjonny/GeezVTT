import { buildRoll } from './dice-roll.js';

const form = document.querySelector('#dice-form');
const diceButtons = [...document.querySelectorAll('[data-dice-sides]')];
const count = document.querySelector('#dice-count');
const mode = document.querySelector('#dice-mode');
const status = document.querySelector('#dice-status');
const history = document.querySelector('#dice-history');
let tray, busy = false, version = 0, clearTimer;
document.querySelector('#floor').addEventListener('session-dice', event => {
  const entry = document.createElement('li');
  entry.textContent = event.detail;
  history.prepend(entry);
  while (history.children.length > 10) history.lastElementChild.remove();
  status.textContent = entry.textContent;
});

function clearTray() {
  clearTimeout(clearTimer);
  version++;
  tray?.clear();
}
form.addEventListener('submit', event => event.preventDefault());
for (const button of diceButtons) button.addEventListener('click', async () => {
  if (busy || !form.reportValidity()) return;
  const sides = Number(button.dataset.diceSides);
  if (sides === 100 && Number(count.value) > 6) count.value = '6';
  let roll;
  try {
    roll = buildRoll({ sides, count: sides === 20 && mode.value !== 'normal' ? 1 : Number(count.value),
      modifier: Number(document.querySelector('#dice-modifier').value), mode: sides === 20 ? mode.value : 'normal' });
  } catch (error) {
    status.textContent = error.message;
    return;
  }
  const entry = document.createElement('li');
  entry.textContent = `${roll.label} = ${roll.total} [${roll.sub}]`;
  if (roll.cls) entry.className = roll.cls === 'crit' ? 'roll-critical' : 'roll-fumble';
  history.prepend(entry);
  while (history.children.length > 10) history.lastElementChild.remove();
  status.textContent = entry.textContent;
  document.querySelector('#floor').dispatchEvent(new CustomEvent('session-action', { detail: { type: 'dice', text: entry.textContent } }));
  clearTray();
  const token = version;
  busy = true;
  diceButtons.forEach(button => { button.disabled = true; });
  try {
    if (!tray) {
      // dice3d.js loads its compatible Three.js r128 and Cannon only on demand.
      const { createDiceTray3D } = await import('./dice3d.js');
      tray = await createDiceTray3D(document.querySelector('#dice-overlay'));
    }
    if (token === version) {
      await tray.throwGroup([roll]);
      if (token === version) clearTimer = setTimeout(clearTray, 3000);
    }
  } catch (error) {
    console.warn('3D dice unavailable:', error);
    tray?.destroy();
    tray = null;
    if (token === version) status.textContent = `${entry.textContent}. 3D unavailable; your roll is recorded.`;
  } finally {
    busy = false;
    diceButtons.forEach(button => { button.disabled = false; });
  }
});
