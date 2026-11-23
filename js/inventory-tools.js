import { mountInventoryAdder } from './inventory-adder.js';
import { updatePCInventory } from './pc-inventory.js';
import { loadSheetReference } from './sheet-view.js';
import { showMapMenu } from './map-object-menu.js';

export function mountInventoryTools(container, getToken, getPCs, onSaved) {
  const controls = document.createElement('div');
  container.append(controls);
  const add = mountInventoryAdder(controls, getToken, onSaved);
  const status = document.createElement('p');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  controls.append(status);
  let busy = false, transferForm;
  async function run(token, action) {
    if (busy) return false;
    busy = true; status.textContent = 'Saving…';
    try {
      const reference = await loadSheetReference();
      await updatePCInventory(token, action, reference);
      status.textContent = 'Saved.';
      transferForm?.remove();
      try { await onSaved?.(token); }
      catch (error) { status.textContent = `Saved; refresh failed: ${error.message}`; }
      return true;
    } catch (error) { status.textContent = `${error.message} Check the bag before retrying.`; return false; }
    finally { busy = false; }
  }
  async function transfer(token, key) {
    try {
      const entities = await getPCs();
      const recipients = Object.entries(entities || {}).filter(([id, pc]) => `v2:${id}` !== token.npcId && pc?.kind === 'pc' && pc.data && !pc.data._sheetsDeleted);
      if (!recipients.length) { status.textContent = 'No other PCs available.'; return; }
      transferForm?.remove();
      transferForm = document.createElement('form');
      transferForm.className = 'sheet-inventory-add';
      transferForm.innerHTML = '<label>Transfer to <select name="recipient" required></select></label><button type="submit">Transfer stack</button><button type="button">Cancel</button>';
      const select = transferForm.elements.namedItem('recipient');
      select.replaceChildren(...recipients.map(([id, pc]) => new Option(pc.name || id, id)));
      transferForm.addEventListener('submit', event => { event.preventDefault(); run(token, { type: 'transfer', key, to: select.value }); });
      transferForm.querySelector('[type="button"]').addEventListener('click', () => transferForm.remove());
      controls.append(transferForm); select.focus();
    } catch (error) { status.textContent = error.message; }
  }
  function menu(event, row) {
    if (busy) return;
    const token = getToken();
    if (!token) return;
    event.preventDefault(); event.stopPropagation();
    const key = row.dataset.bagKey, rect = row.getBoundingClientRect();
    showMapMenu(event.clientX ?? rect.right, event.clientY ?? rect.top, [
      { label: 'Remove', action: () => run(token, { type: 'remove', key }) },
      { label: 'Add', action: () => run(token, { type: 'add', key }) },
      { label: 'Transfer', action: () => transfer(token, key) }
    ], row);
  }
  container.addEventListener('contextmenu', event => {
    const row = event.target.closest('[data-bag-key]');
    if (row && container.contains(row)) menu(event, row);
    else if (event.target.closest('[data-bag]')) {
      event.preventDefault(); event.stopPropagation();
      showMapMenu(event.clientX, event.clientY, [{ label: 'Add', action: () => add() }], event.target);
    }
  });
  container.addEventListener('keydown', event => {
    const row = event.target.closest('[data-bag-key]');
    if (row && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) menu(event, row);
  });
  container.addEventListener('click', event => {
    const button = event.target.closest('[data-bag-menu]');
    if (button) menu(event, button.closest('[data-bag-key]'));
  });
  container.addEventListener('change', async event => {
    const select = event.target.closest('[data-equipment-slot]');
    const token = getToken();
    if (select && token) {
      select.disabled = true;
      const saved = await run(token, { type: 'equip', slot: select.dataset.equipmentSlot, key: select.value });
      if (!saved) select.value = select.dataset.currentKey;
      else select.dataset.currentKey = select.value;
      select.disabled = false;
    }
  });
  return controls;
}
