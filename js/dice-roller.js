import { buildRoll } from './dice-roll.js';

const form = document.querySelector('#dice-form');
const sides = document.querySelector('#dice-sides');
const count = document.querySelector('#dice-count');
const mode = document.querySelector('#dice-mode');
const animated = document.querySelector('#dice-animated');
const rollButton = document.querySelector('#roll-dice');
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

function updateOptions() {
  mode.disabled = Number(sides.value) !== 20;
  if (mode.disabled) mode.value = 'normal';
  count.max = sides.value === '100' ? '6' : '12';
  count.disabled = mode.value !== 'normal';
  if (count.disabled) count.value = '1';
  else if (Number(count.value) > Number(count.max)) count.value = count.max;
}
sides.addEventListener('change', updateOptions);
mode.addEventListener('change', updateOptions);
updateOptions();

function clearTray() {
  clearTimeout(clearTimer);
  version++;
  tray?.clear();
}
document.querySelector('#clear-dice').addEventListener('click', () => {
  clearTray();
  status.textContent = 'Tray cleared. Recent rolls are kept below.';
});
animated.addEventListener('change', () => { if (!animated.checked) clearTray(); });

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !form.reportValidity()) return;
  let roll;
  try {
    roll = buildRoll({ sides: Number(sides.value), count: Number(count.value),
      modifier: Number(document.querySelector('#dice-modifier').value), mode: mode.value });
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
  if (!animated.checked) return;
  const token = version;
  busy = true;
  rollButton.disabled = true;
  rollButton.textContent = 'Rolling…';
  try {
    if (!tray) {
      // dice3d.js loads its compatible Three.js r128 and Cannon only on demand.
      const { createDiceTray3D } = await import('./dice3d.js');
      tray = await createDiceTray3D(document.querySelector('#dice-overlay'));
    }
    if (token === version && animated.checked) {
      await tray.throwGroup([roll]);
      if (token === version && animated.checked) clearTimer = setTimeout(clearTray, 3000);
    }
  } catch (error) {
    console.warn('3D dice unavailable:', error);
    tray?.destroy();
    tray = null;
    if (token === version) status.textContent = `${entry.textContent}. 3D unavailable; your roll is recorded.`;
  } finally {
    busy = false;
    rollButton.disabled = false;
    rollButton.textContent = 'Roll dice';
  }
});
