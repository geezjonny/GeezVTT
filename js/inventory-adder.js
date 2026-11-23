import { isGM } from './session-role.js';
import { addPCInventoryItem } from './pc-inventory.js';
import { loadSheetReference } from './sheet-view.js';

export function mountInventoryAdder(container, getToken, onSaved) {
  if (!isGM) return;
  const form = document.createElement('form');
  form.className = 'sheet-inventory-add';
  form.innerHTML = `<label>SRD item <input name="item" list="sheet-srd-items" autocomplete="off" required></label>
    <datalist id="sheet-srd-items"></datalist>
    <label>Quantity <input name="qty" type="number" min="1" max="9999" step="1" value="1" required></label>
    <button type="submit" disabled>Add to bag</button><p role="status" aria-live="polite"></p>`;
  container.append(form);
  const name = form.elements.namedItem('item'), quantity = form.elements.namedItem('qty'), button = form.querySelector('button'), status = form.querySelector('[role="status"]');
  let items, pending, saving = false;
  async function load() {
    status.textContent = 'Loading SRD…';
    try {
      const reference = await loadSheetReference();
      items = new Map(Object.values(reference).filter(item => item.equipment_category).map(item => [item.name.toLowerCase(), item]));
      form.querySelector('datalist').replaceChildren(...[...items.values()].sort((a, b) => a.name.localeCompare(b.name)).map(item => new Option(item.name, item.name)));
      button.disabled = false; status.textContent = '';
    } catch (error) { status.textContent = error.message; }
  }
  name.addEventListener('focus', () => { if (!items) load(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!isGM || saving) return;
    const token = getToken(), item = items?.get(name.value.trim().toLowerCase()), qty = Number(quantity.value);
    if (!token || !item) { status.textContent = 'Choose an SRD item and a linked PC.'; return; }
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 9999) { status.textContent = 'Quantity must be 1–9999.'; return; }
    if (!pending || pending.pc !== token.npcId || pending.name !== item.name || pending.qty !== qty) {
      pending = { pc: token.npcId, name: item.name, qty, key: crypto.randomUUID() };
    }
    saving = true; button.disabled = true; status.textContent = 'Saving…';
    name.disabled = quantity.disabled = true;
    try {
      await addPCInventoryItem(token, item, qty, pending.key);
      pending = null; name.value = ''; quantity.value = '1';
      status.textContent = `Added ${qty} × ${item.name}.`;
      try { await onSaved(token); }
      catch (error) { status.textContent = `Item saved; refresh failed: ${error.message}`; }
    } catch (error) { status.textContent = `Could not add item: ${error.message}`; }
    finally { saving = false; button.disabled = false; name.disabled = quantity.disabled = false; }
  });
  load();
}
