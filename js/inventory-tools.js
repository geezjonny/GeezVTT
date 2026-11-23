import { mountInventoryAdder } from './inventory-adder.js';
import { updatePCInventory, readPC } from './pc-inventory.js';
import { loadSheetReference } from './sheet-view.js';
import { showMapMenu } from './map-object-menu.js';
import { isGM, canControlPC } from './session-role.js';
import { ITEM_CATEGORIES, ITEM_STATS, ITEM_SKILLS } from './item-modifiers.js';

export function mountInventoryTools(container, getToken, getPCs, onSaved) {
  const controls = document.createElement('div');
  container.append(controls);
  const add = mountInventoryAdder(controls, getToken, onSaved);
  const status = document.createElement('p');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  controls.append(status);
  let busy = false, transferForm, editForm;
  async function run(token, action) {
    if (busy) return false;
    busy = true; status.textContent = 'Saving…';
    try {
      const reference = action.type === 'coin' ? {} : await loadSheetReference();
      const pc = await updatePCInventory(token, action, reference);
      status.textContent = 'Saved.';
      transferForm?.remove();
      try { await onSaved?.(token, pc); }
      catch (error) { status.textContent = `Saved; refresh failed: ${error.message}`; }
      return true;
    } catch (error) { status.textContent = `${error.message} Check the bag before retrying.`; return false; }
    finally { busy = false; }
  }
  async function editItem(token, key) {
    if (!isGM || busy) return;
    try {
      const pc = await readPC(token), item = pc.inventory?.[key];
      if (!item || typeof item.name !== 'string') throw new Error('Item is no longer in this bag.');
      if (getToken()?.npcId !== token.npcId) return;
      editForm?.remove();
      const form = editForm = document.createElement('form');
      form.className = 'sheet-inventory-add';
      const modifierFields = (group, keys) => keys.map(key => `<label>${key.replace(/_/g, ' ')}<input name="${group}:${key}" type="number" min="-999" max="999" step="1" value="0" required></label>`).join('');
      form.innerHTML = `<strong>Edit item</strong><label>Name<input name="name" maxlength="100" required></label>
        <label>Category<select name="category"></select></label>
        <label>Quantity<input name="qty" type="number" min="0" max="9999" step="1" required></label>
        <label>AC modifier<input name="ac" type="number" min="-999" max="999" step="1" value="0" required></label>
        <details><summary>Stat score modifiers</summary><div class="sheet-modifiers">${modifierFields('stats', ITEM_STATS)}</div></details>
        <details><summary>Skill modifiers</summary><div class="sheet-modifiers">${modifierFields('skills', ITEM_SKILLS)}</div></details>
        <label>Description<textarea name="desc" maxlength="20000" rows="4"></textarea></label>
        <button type="submit">Save item</button><button type="button">Cancel</button>`;
      const armorFields = document.createElement('details');
      armorFields.innerHTML = '<summary>Armor calculation</summary><label>Armor base AC (blank = reference)<input name="armorBase" type="number" min="0" max="999" step="1"></label><label><input name="armorDex" type="checkbox">Add DEX modifier</label><label>Maximum DEX bonus (blank = uncapped)<input name="armorCap" type="number" min="0" max="999" step="1"></label>';
      form.insertBefore(armorFields, form.querySelector('[type="submit"]'));
      const field = name => form.elements.namedItem(name);
      field('name').value = item.name;
      const categories = [...new Set([...ITEM_CATEGORIES, item.category || ''])];
      field('category').replaceChildren(...categories.map(category => new Option(category || 'Other', category)));
      field('category').value = item.category || '';
      field('qty').value = item.qty ?? 1;
      field('desc').value = Array.isArray(item.desc) ? item.desc.join('\n\n') : item.desc || '';
      field('ac').value = item.modifiers?.ac ?? 0;
      field('armorBase').value = item.armor_class?.base ?? '';
      field('armorDex').checked = item.armor_class?.dex_bonus ?? true;
      field('armorCap').value = item.armor_class?.max_bonus ?? '';
      for (const [group, keys] of [['stats', ITEM_STATS], ['skills', ITEM_SKILLS]]) {
        for (const key of keys) field(`${group}:${key}`).value = item.modifiers?.[group]?.[key] ?? 0;
      }
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy || !form.reportValidity()) return;
        if (getToken()?.npcId !== token.npcId) { status.textContent = 'Character changed; reopen the item editor.'; return; }
        const modifiers = { ac: Number(field('ac').value), stats: {}, skills: {} };
        for (const [group, keys] of [['stats', ITEM_STATS], ['skills', ITEM_SKILLS]]) {
          for (const key of keys) modifiers[group][key] = Number(field(`${group}:${key}`).value);
        }
        const value = { name: field('name').value, category: field('category').value, qty: Number(field('qty').value), desc: field('desc').value, modifiers,
          armor_class: field('armorBase').value.trim() ? { base: Number(field('armorBase').value), dex_bonus: field('armorDex').checked,
            ...(field('armorCap').value.trim() ? { max_bonus: Number(field('armorCap').value) } : {}) } : null };
        const buttons = [...form.querySelectorAll('button')];
        buttons.forEach(button => { button.disabled = true; });
        const saved = await run(token, { type: 'edit', key, value });
        if (saved) form.remove();
        else buttons.forEach(button => { button.disabled = false; });
      });
      form.querySelector('[type="button"]').addEventListener('click', () => form.remove());
      controls.append(form); field('name').focus();
    } catch (error) { status.textContent = error.message; }
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
    if (!token || !canControlPC(token)) return;
    event.preventDefault(); event.stopPropagation();
    const key = row.dataset.bagKey, rect = row.getBoundingClientRect();
    showMapMenu(event.clientX ?? rect.right, event.clientY ?? rect.top, [
      ...(isGM ? [{ label: 'Edit item', action: () => editItem(token, key) }] : []),
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
    const coin = event.target.closest('[data-coin-delta]');
    const token = getToken();
    if (coin && token && canControlPC(token) && !busy) {
      coin.disabled = true;
      run(token, { type: 'coin', coin: coin.dataset.coin, delta: Number(coin.dataset.coinDelta) }).finally(() => { coin.disabled = false; });
    }
    const button = event.target.closest('[data-bag-menu]');
    if (button) menu(event, button.closest('[data-bag-key]'));
  });
  container.addEventListener('change', async event => {
    const select = event.target.closest('[data-equipment-slot]');
    const token = getToken();
    if (select && token && canControlPC(token)) {
      select.disabled = true;
      const saved = await run(token, { type: 'equip', slot: select.dataset.equipmentSlot, key: select.value });
      if (!saved) select.value = select.dataset.currentKey;
      else select.dataset.currentKey = select.value;
      select.disabled = false;
    }
  });
  return controls;
}
