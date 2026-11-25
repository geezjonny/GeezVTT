import { updatePCEffects } from './pc-inventory.js';
import { isGM, canControlPC } from './session-role.js';
import { BARK_ARM, effectDefinitions } from './effects-model.js';
import { modifierRow } from './effects-view.js';

export function mountEffects(container, getToken, getPC, status, onSaved) {
  let busy = false;
  async function run(action) {
    const token = getToken();
    if (!token || !canControlPC(token) || busy || ['advance', 'reset'].includes(action.type) && !isGM) return;
    busy = true; status.textContent = 'Saving…';
    const controls = [...container.querySelectorAll('button, input, select')].map(control => [control, control.disabled]);
    controls.forEach(([control]) => { control.disabled = true; });
    try {
      const drained = [];
      if (action.type === 'advance') action.onDrain = found => drained.push(...found); // life-drain effects bite as game time passes
      const pc = await updatePCEffects(token, action);
      if (getToken()?.npcId === token.npcId) {
        await onSaved(pc, token);
        status.textContent = drained.length ? drained.map(hit => `${hit.label} drained ${hit.taken} HP (${hit.rolls.map(r => `d${hit.sides}: ${r}`).join(', ')}).`).join(' ') : 'Saved.';
      }
    } catch (error) { if (getToken()?.npcId === token.npcId) status.textContent = `${error.message} Check effects before retrying.`; }
    finally { busy = false; controls.forEach(([control, disabled]) => { control.disabled = disabled; }); }
  }
  function fill(form, value = {}) {
    for (const [key, fallback] of Object.entries({ label: '', description: '', category: 'Ability', mode: 'activated', inventoryKey: '', max: 0, recharge: 'none', duration_minutes: 0 })) {
      const field = form.elements.namedItem(key);
      field.value = value[key] ?? fallback;
      if (field.tagName === 'SELECT' && field.selectedIndex < 0) field.value = fallback;
    }
    form.elements.namedItem('consume').checked = value.consume === true;
    form.querySelector('[data-effect-modifiers]').innerHTML = (Array.isArray(value.modifiers) && value.modifiers.length ? value.modifiers : [undefined]).map(modifierRow).join('');
  }
  container.addEventListener('change', event => {
    if (!event.target.matches('[name="definition"]')) return;
    const form = event.target.closest('[data-effect-form]');
    if (form) fill(form, effectDefinitions(getPC() || {}).find(effect => effect.id === event.target.value));
  });
  container.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || busy || !canControlPC(getToken())) return;
    const form = button.closest('[data-effect-form]');
    if (button.hasAttribute('data-effect-preset')) {
      form.elements.namedItem('definition').value = '';
      fill(form, BARK_ARM);
    } else if (button.hasAttribute('data-effect-add')) form.querySelector('[data-effect-modifiers]').insertAdjacentHTML('beforeend', modifierRow());
    else if (button.hasAttribute('data-effect-remove')) button.closest('.effect-modifier').remove();
    else if (button.dataset.effectAction) {
      if (button.dataset.effectAction === 'delete' && !window.confirm('Delete this effect and end it if active?')) return;
      run({ type: button.dataset.effectAction, id: button.dataset.effectId });
    } else if (button.dataset.effectReset) run({ type: 'reset', recharge: button.dataset.effectReset });
  });
  container.addEventListener('submit', event => {
    const form = event.target;
    if (!form.matches('[data-effect-form], [data-effect-time]')) return;
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    if (form.hasAttribute('data-effect-time')) { run({ type: 'advance', minutes: Number(form.elements.namedItem('minutes').value) }); return; }
    const field = name => form.elements.namedItem(name);
    const value = Object.fromEntries(['label', 'description', 'category', 'mode', 'inventoryKey', 'recharge'].map(key => [key, field(key).value]));
    for (const key of ['max', 'duration_minutes']) value[key] = Number(field(key).value);
    value.consume = field('consume').checked;
    value.modifiers = [...form.querySelectorAll('.effect-modifier')].map(row => ({ target: row.querySelector('[data-effect-target]').value,
      operation: row.querySelector('[data-effect-operation]').value, value: Number(row.querySelector('[data-effect-value]').value) }));
    run({ type: 'save', id: field('definition').value || `effects:${crypto.randomUUID()}`, value });
  });
}
