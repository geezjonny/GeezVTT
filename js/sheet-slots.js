import { updatePCSpellSlot, updatePCCombat } from './pc-inventory.js';
import { canControlPC } from './session-role.js';

export function mountSpellSlots(container, getToken, status, onSaved) {
  let busy = false;
  const selector = '[data-slot-level], [data-combat-field], [data-exhaustion-delta], [data-condition-toggle], [data-base-stat], [data-ac-mode]';
  async function save(control, change) {
    const token = getToken();
    if (!token || !canControlPC(token) || busy) return;
    busy = true;
    status.textContent = 'Saving…';
    const controls = [...container.querySelectorAll(selector)].map(element => [element, element.disabled]);
    controls.forEach(([element]) => { element.disabled = true; });
    try {
      const pc = await change(token);
      await onSaved(pc, token);
      if (getToken()?.npcId === token.npcId) status.textContent = 'Saved.';
    } catch (error) {
      if (getToken()?.npcId === token.npcId) {
        status.textContent = `${error.message} Check the sheet before retrying.`;
        if (control.matches('[data-condition-toggle]')) control.value = '';
        if (control.matches('[data-ac-mode]')) control.value = [...control.options].find(option => option.defaultSelected)?.value || 'stored';
        if (control.matches('[data-combat-field], [data-base-stat]')) control.value = control.defaultValue;
      }
    } finally {
      busy = false;
      controls.forEach(([element, disabled]) => { element.disabled = disabled; });
    }
  }
  container.addEventListener('click', event => {
    const button = event.target.closest('[data-slot-level], [data-exhaustion-delta]');
    if (!button) return;
    if (button.matches('[data-slot-level]')) save(button, token => updatePCSpellSlot(token, Number(button.dataset.slotLevel), Number(button.dataset.slotPip)));
    else save(button, token => updatePCCombat(token, { type: 'exhaustion', delta: Number(button.dataset.exhaustionDelta) }));
  });
  container.addEventListener('change', event => {
    const control = event.target.closest('[data-combat-field], [data-condition-toggle], [data-base-stat], [data-ac-mode]');
    if (!control || !canControlPC(getToken())) return;
    if (control.matches('[data-ac-mode]')) {
      save(control, token => updatePCCombat(token, { type: 'ac-mode', value: control.value }));
    } else if (control.matches('[data-base-stat]')) {
      if (!control.reportValidity()) return;
      save(control, token => updatePCCombat(token, { type: 'base-stat', field: control.dataset.baseStat, value: control.value.trim() ? Number(control.value) : NaN }));
    } else if (control.matches('[data-combat-field]')) {
      if (!control.reportValidity()) return;
      save(control, token => updatePCCombat(token, { type: 'set', field: control.dataset.combatField, value: control.value.trim() ? Number(control.value) : NaN }));
    } else if (control.value) {
      const action = { type: 'condition', name: control.value, enabled: control.selectedOptions[0].dataset.enabled === 'true' };
      save(control, token => updatePCCombat(token, action));
    }
  });
}
