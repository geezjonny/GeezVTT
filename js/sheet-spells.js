import { castPCSpell } from './pc-inventory.js';
import { canControlPC } from './session-role.js';
import { spellInfo } from './spell-model.js';
import { spellGlossaryHTML } from './spell-view.js';
import { buildExpressionRoll } from './dice-roll.js';

export function mountSpells(container, { getToken, getPC, getReference, status, onSaved, openGlossary, onRoll }) {
  const panel = document.getElementById('spell-glossary-panel'), content = document.getElementById('spell-glossary-content');
  const rollResult = document.getElementById('spell-roll-result');
  const castStatus = document.getElementById('spell-cast-status'), rollButtons = document.getElementById('spell-cast-rolls');
  let busy = false, origin, castToken, castRolls = [];
  function show(info) {
    content.innerHTML = spellGlossaryHTML(info);
    castStatus.textContent = ''; rollResult.textContent = ''; rollButtons.replaceChildren(); castRolls = []; castToken = null;
    if (openGlossary) openGlossary(panel);
    else {
      panel.hidden = false;
      panel.style.left = Math.max(0, Math.min(panel.offsetLeft, innerWidth-panel.offsetWidth)) + 'px';
      panel.style.top = Math.max(0, Math.min(panel.offsetTop, innerHeight-panel.offsetHeight)) + 'px';
    }
    panel.querySelector('.editor-titlebar').focus({ preventScroll: true });
  }
  function roll(index) {
    if (!castToken || !canControlPC(castToken)) return;
    const selected = castRolls[index];
    if (!selected) return;
    if (onRoll) onRoll(selected, castToken);
    else {
      try {
        const result = buildExpressionRoll(selected.expression, 'normal');
        rollResult.textContent = `${selected.label}: ${result.label} = ${result.total}${result.sub ? ` [${result.sub}]` : ''}`;
      } catch (error) { rollResult.textContent = error.message; }
    }
  }
  rollButtons.addEventListener('click', event => {
    const button = event.target.closest('[data-spell-roll]');
    if (button) roll(Number(button.dataset.spellRoll));
  });
  if (!openGlossary) {
    const grip = panel.querySelector('.editor-titlebar'); let drag;
    panel.querySelector('.editor-close').addEventListener('click', () => { panel.hidden = true; origin?.focus(); });
    grip.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button')) return;
      event.preventDefault(); grip.focus();
      drag = { x: event.clientX-panel.offsetLeft, y: event.clientY-panel.offsetTop };
      grip.setPointerCapture(event.pointerId);
    });
    const position = (x, y) => { panel.style.left = Math.max(0, Math.min(x, innerWidth-panel.offsetWidth))+'px'; panel.style.top = Math.max(0, Math.min(y, innerHeight-panel.offsetHeight))+'px'; };
    grip.addEventListener('pointermove', event => { if (drag) position(event.clientX-drag.x, event.clientY-drag.y); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) grip.addEventListener(type, () => { drag = null; });
    grip.addEventListener('keydown', event => {
      const step = { ArrowLeft: [-10,0], ArrowRight: [10,0], ArrowUp: [0,-10], ArrowDown: [0,10] }[event.key];
      if (step && event.target === grip) { event.preventDefault(); position(panel.offsetLeft+step[0], panel.offsetTop+step[1]); }
      if (event.key === 'Escape') { panel.hidden = true; origin?.focus(); }
    });
  }
  window.addEventListener('player-signed-in', () => { panel.hidden = true; castToken = null; castRolls = []; });
  container.addEventListener('click', async event => {
    const button = event.target.closest('[data-spell-use], [data-spell-glossary]');
    if (!button || button.disabled || !container.contains(button)) return;
    const row = button.closest('[data-spell-key]'), token = getToken(), pc = getPC();
    if (!row || !token || !pc) return;
    origin = button;
    try {
      if (button.hasAttribute('data-spell-glossary')) { show(spellInfo(pc, row.dataset.spellKey, getReference())); return; }
      if (busy || !canControlPC(token)) return;
      const level = Number(row.querySelector('[data-spell-cast-level]')?.value ?? 0);
      busy = true; status.textContent = 'Casting…';
      const controls = [...container.querySelectorAll('[data-spell-use], [data-slot-level], [data-spell-cast-level]')].map(control => [control, control.disabled]);
      controls.forEach(([control]) => { control.disabled = true; });
      let saved;
      try { saved = await castPCSpell(token, row.dataset.spellKey, level, getReference()); }
      finally { busy = false; controls.forEach(([control, disabled]) => { control.disabled = disabled; }); }
      // Finish presenting a committed cast even if refreshing its sheet fails.
      let refreshError;
      try { await onSaved(saved.pc, token); } catch (error) { refreshError = error; }
      if (getToken()?.npcId !== token.npcId) return;
      show(saved.cast.info); castToken = token; castRolls = saved.cast.rolls;
      const message = `${saved.cast.name}: ${saved.cast.level === 0 ? 'cantrip' : `level ${saved.cast.level}`}. ${saved.cast.message}`;
      status.textContent = message + (refreshError ? ' Saved; reopen the sheet to refresh slots.' : '');
      castStatus.textContent = message;
      for (const [index, value] of castRolls.entries()) {
        const control = document.createElement('button'); control.type = 'button'; control.dataset.spellRoll = index;
        control.textContent = `Roll ${value.label}`; rollButtons.append(control);
      }
      if (castRolls.length) roll(0);
    } catch (error) { if (getToken()?.npcId === token.npcId) status.textContent = `${error.message} Check spell slots before retrying.`; }
  });
}
