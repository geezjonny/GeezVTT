import { consumableDefinition } from './consumables.js';
import { requestItemUse } from './item-use.js';
import { mountInventoryAdder } from './inventory-adder.js';
import { updatePCInventory, consumePCItem, readPC } from './pc-inventory.js';
import { effectDefinitions } from './effects-model.js';
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
  let busy = false, transferForm, editForm, useForm;
  async function run(token, action) {
    if (busy) return false;
    busy = true; status.textContent = 'Saving…';
    try {
      const reference = ['consume'].includes(action.type) ? {} : await loadSheetReference();
      const pc = action.type === 'throw' ? await requestItemUse(token,action) : action.type === 'consume'
        ? await consumePCItem(token, action)
        : await updatePCInventory(token, action, reference);
      status.textContent = 'Saved.';
      transferForm?.remove();
      useForm?.remove();
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
        <label>Weight each (lb; blank = reference)<input name="weight" type="number" min="0" max="999999" step="any"></label>
        <label>AC modifier<input name="ac" type="number" min="-999" max="999" step="1" value="0" required></label>
        <details><summary>Stat score modifiers</summary><div class="sheet-modifiers">${modifierFields('stats', ITEM_STATS)}</div></details>
        <details><summary>Skill modifiers</summary><div class="sheet-modifiers">${modifierFields('skills', ITEM_SKILLS)}</div></details>
        <label>Immediate use<select name="consumeKind"><option value="">Automatic / configured effect</option><option value="healing">Healing</option><option value="damage">Damage</option></select></label><label>Use amount<input name="consumeDice" maxlength="100" placeholder="2d4+2"></label>
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
      field('weight').value = item.weight ?? '';
      field('consumeKind').value = item.consumable?.kind || '';
      field('consumeDice').value = item.consumable?.dice || '';
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
        const value = { consumable:field('consumeKind').value?{kind:field('consumeKind').value,dice:field('consumeDice').value}:null, name: field('name').value, category: field('category').value, qty: Number(field('qty').value), weight: field('weight').value.trim() ? Number(field('weight').value) : null, desc: field('desc').value, modifiers,
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
  async function useItem(token, key, effect) {
    if (busy) return;
    busy = true;
    try {
      const entities = await getPCs();
      if (getToken()?.npcId !== token.npcId) return;
      const placed=document.getElementById('floor')?.tabletopMap?.tokens;
      const targets = Object.entries(entities || {}).filter(([id, entity]) => entity?.kind === 'pc' && entity.data && !entity.data._sheetsDeleted && (!placed || placed.some(token=>token.npcId===`v2:${id}` && !token.hidden)));
      if (!targets.length) throw new Error('No target PCs available.');
      useForm?.remove();
      const form = useForm = document.createElement('form');
      form.className = 'sheet-inventory-add';
      const title = document.createElement('strong'); title.textContent = `Use: ${effect.label}`;
      form.innerHTML = '<label>Target<select name="target" required></select></label><button type="submit">Confirm use</button><button type="button">Cancel</button>';
      form.prepend(title);
      const select = form.elements.namedItem('target');
      select.replaceChildren(...targets.map(([id, entity]) => new Option(entity.name || id, id)));
      select.value = token.npcId.slice(3);
      if (select.selectedIndex < 0) select.selectedIndex = 0;
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy || !form.reportValidity()) return;
        if (getToken()?.npcId !== token.npcId) { status.textContent = 'Character changed; reopen Use.'; return; }
        const buttons = [...form.querySelectorAll('button')];
        buttons.forEach(button => { button.disabled = true; });
        const saved = await run(token, { type: 'consume', key, id: effect.id, to: select.value });
        if (!saved) buttons.forEach(button => { button.disabled = false; });
      });
      form.querySelector('[type="button"]').addEventListener('click', () => form.remove());
      controls.append(form); select.focus();
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; }
  }
  function pickThrow(token,key) {
    const floor=document.getElementById('floor'), svg=document.getElementById('map-view'), scene=floor.sceneDocument;
    status.textContent='Click a destination; Escape cancels.';
    const cancel=()=>{ window.removeEventListener('pointerdown',pick,true); window.removeEventListener('keydown',escape,true); floor.removeEventListener('map-ready',cancel); };
    const escape=event=>{ if(event.key==='Escape') { cancel(); status.textContent='Throw cancelled.'; } };
    const pick=async event=>{
      if(event.button!==0 || !event.target.closest('#map-view')) return;
      event.preventDefault(); event.stopImmediatePropagation(); cancel();
      if(floor.sceneDocument!==scene || getToken()?.npcId!==token.npcId) { status.textContent='Scene or character changed.'; return; }
      const matrix=svg.getScreenCTM();
      const point=matrix && new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
      if(point) run(token,{type:'throw',key,x:Math.floor(point.x)+.5,y:Math.floor(point.y)+.5});
    };
    window.addEventListener('pointerdown',pick,true); window.addEventListener('keydown',escape,true); floor.addEventListener('map-ready',cancel,{once:true});
  }
  async function transfer(token, key) {
    try {
      const pc = await readPC(token), item = pc.inventory?.[key];
      if (!item || typeof item.name !== 'string') throw new Error('Item is no longer in this bag.');
      const available = Number(item.qty ?? 1);
      if (!Number.isSafeInteger(available) || available < 1) throw new Error('No items available to transfer.');
      const entities = await getPCs();
      const recipients = Object.entries(entities || {}).filter(([id, pc]) => `v2:${id}` !== token.npcId && pc?.kind === 'pc' && pc.data && !pc.data._sheetsDeleted);
      if (!recipients.length) { status.textContent = 'No other PCs available.'; return; }
      transferForm?.remove();
      transferForm = document.createElement('form');
      transferForm.className = 'sheet-inventory-add';
      transferForm.innerHTML = '<label>Transfer to <select name="recipient" required></select></label><label>Quantity<input name="qty" type="number" min="1" step="1" value="1" required></label><button type="submit">Transfer</button><button type="button">Cancel</button>';
      const form = transferForm;
      const quantity = form.elements.namedItem('qty');
      quantity.max = available;
      const select = transferForm.elements.namedItem('recipient');
      select.replaceChildren(...recipients.map(([id, pc]) => new Option(pc.name || id, id)));
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        if (getToken()?.npcId !== token.npcId) { status.textContent = 'Character changed; reopen the transfer.'; return; }
        run(token, { type: 'transfer', key, to: select.value, qty: Number(quantity.value) });
      });
      transferForm.querySelector('[type="button"]').addEventListener('click', () => transferForm.remove());
      controls.append(transferForm); select.focus();
    } catch (error) { status.textContent = error.message; }
  }
  async function menu(event, row) {
    if (busy) return;
    const token = getToken();
    if (!token || !canControlPC(token)) return;
    event.preventDefault(); event.stopPropagation();
    const key = row.dataset.bagKey, rect = row.getBoundingClientRect();
    const x = event.clientX ?? rect.right, y = event.clientY ?? rect.top;
    let effects, automatic;
    busy = true;
    try {
      const pc = await readPC(token);
      if (getToken()?.npcId !== token.npcId || !row.isConnected) return;
      automatic = consumableDefinition(pc.inventory?.[key]);
      effects = effectDefinitions(pc).filter(effect => effect.mode === 'activated' && effect.consume === true && effect.inventoryKey === key);
    } catch (error) { status.textContent = error.message; return; }
    finally { busy = false; }
    showMapMenu(x, y, [
      ...(automatic ? [{ label: 'Use', action: () => useItem(token,key,automatic) }] : []),
      ...effects.map(effect => ({ label: effects.length === 1 ? 'Use' : `Use: ${effect.label}`, action: () => useItem(token, key, effect) })),
      ...(isGM ? [{ label: 'Edit item', action: () => editItem(token, key) }] : []),
      { label: 'Remove', action: () => run(token, { type: 'remove', key }) },
      ...(isGM ? [{ label: 'Add', action: () => run(token, { type: 'add', key }) }] : []),
      { label: 'Transfer', action: () => transfer(token, key) },
      ...(document.getElementById('floor')?.tabletopMap ? [{ label: 'Throw', action: () => pickThrow(token,key) }] : [])
    ], row);
  }
  container.addEventListener('contextmenu', event => {
    const row = event.target.closest('[data-bag-key]');
    if (row && container.contains(row)) menu(event, row);
    else if (isGM && event.target.closest('[data-bag]')) {
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
