import { readPC } from './pc-inventory.js';
import { SHEET_SECTIONS, sheetHTML, loadSheetReference } from './sheet-view.js';
import { mountInventoryAdder } from './inventory-adder.js';

const $ = id => document.getElementById(id);
const query = new URLSearchParams(location.search);
const id = query.get('pc') || query.get('char');
let section = SHEET_SECTIONS.find(name => name.toLowerCase() === query.get('section')?.toLowerCase()) || 'Stats';
let pc, reference = {}, reading = false, dirty = false, stream;
const inventoryAdder = document.createElement('div');
$('sheet-content').after(inventoryAdder);
mountInventoryAdder(inventoryAdder, () => id && pc ? { npcId: `v2:${id}` } : null, refresh);
function draw() {
  inventoryAdder.hidden = section !== 'Inventory' || !pc;
  if (pc) $('sheet-content').innerHTML = sheetHTML(pc, section, reference);
  for (const button of $('sheet-sections').children) button.setAttribute('aria-pressed', String(button.textContent === section));
}
for (const name of SHEET_SECTIONS) {
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = name;
  button.addEventListener('click', () => { section = name; draw(); });
  $('sheet-sections').append(button);
}
async function refresh() {
  dirty = true;
  if (reading) return;
  reading = true;
  try {
    while (dirty) {
      dirty = false;
      pc = await readPC({ npcId: `v2:${id}` });
      $('sheet-name').textContent = pc.name || id;
      $('sheet-status').textContent = '';
      draw();
    }
  } catch (error) {
    pc = null;
    $('sheet-content').replaceChildren();
    $('sheet-status').textContent = error.message;
  } finally { reading = false; }
}
draw();
if (!id) $('sheet-status').textContent = 'Open with ?pc=<Firebase character ID>.';
else {
  refresh();
  const base = window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, '');
  stream = new EventSource(`${base}/v2/worlds/gaia/entities/${encodeURIComponent(id)}.json`);
  for (const type of ['put', 'patch']) stream.addEventListener(type, refresh);
  stream.addEventListener('error', () => { $('sheet-status').textContent = 'Disconnected; reconnecting…'; });
  for (const type of ['cancel', 'auth_revoked']) stream.addEventListener(type, () => {
    stream.close(); pc = null; $('sheet-content').replaceChildren();
    $('sheet-status').textContent = 'Firebase access denied.';
  });
  window.addEventListener('pagehide', () => stream.close());
  loadSheetReference().then(data => { reference = data; draw(); }).catch(error => { $('sheet-status').textContent = error.message; });
}
