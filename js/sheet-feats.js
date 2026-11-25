import { updatePCFeat } from './pc-inventory.js';
import { canControlPC } from './session-role.js';
import { featEntries, featUses } from './feats-model.js';

export function mountFeats(container, getToken, getPC, status, onSaved) {
  let busy = false;
  container.addEventListener('click', async event => {
    const button = event.target.closest('[data-feat-details], [data-feat-use], [data-feat-pip]');
    if (!button || button.disabled || !container.contains(button)) return;
    const row = button.closest('[data-feat-id]'), description = row.querySelector('[data-feat-description]');
    if (button.hasAttribute('data-feat-details')) {
      description.hidden = !description.hidden;
      button.setAttribute('aria-expanded', String(!description.hidden));
      return;
    }
    const token = getToken();
    if (busy || !token || !canControlPC(token)) return;
    const feat = featEntries(getPC() || {}).find(feat => feat.id === row.dataset.featId);
    if (!feat) return;
    const tracked = featUses(feat), effect = Array.isArray(feat.modifiers);
    if (!tracked && !effect) {
      description.hidden = false;
      row.querySelector('[data-feat-details]').setAttribute('aria-expanded', 'true');
      return;
    }
    busy = true; status.textContent = 'Saving…';
    const controls = [...container.querySelectorAll('[data-feat-use], [data-feat-pip]')].map(control => [control, control.disabled]);
    controls.forEach(([control]) => { control.disabled = true; });
    try {
      const pc = await updatePCFeat(token, { id: feat.id, type: button.hasAttribute('data-feat-pip') ? 'pip' : 'use', pip: Number(button.dataset.featPip) });
      if (getToken()?.npcId === token.npcId) {
        await onSaved(pc, token);
        status.textContent = 'Saved.';
      }
    } catch (error) {
      if (getToken()?.npcId === token.npcId) status.textContent = `${error.message} Check the feat before retrying.`;
    } finally {
      busy = false;
      controls.forEach(([control, disabled]) => { control.disabled = disabled; });
    }
  });
}
