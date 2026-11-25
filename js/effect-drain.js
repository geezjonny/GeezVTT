// Life-drain effects (effects-model.js `drain`): at the start of a PC's turn the GM's browser rolls the drain, saves the lower HP to the
// character, refreshes token HP and announces the roll to the table. Time-based drain happens inside the Effects tab's time advance.
import { readPC, updatePCEffects } from './pc-inventory.js';
import { isGM } from './session-role.js';
import { appliedEffects } from './effects-model.js';

const floor = document.getElementById('floor');
let queue = Promise.resolve();
export const drainText = (name, hit) => `${name} · ${hit.label} drains ${hit.taken} HP (${hit.rolls.map(r => `d${hit.sides}: ${r}`).join(', ')}) → ${hit.to} HP`;

// Call on the GM after a new turn starts. Resolves quietly for tokens that aren't linked PCs or have no draining effect active.
export function drainOnTurn(token) {
  if (!isGM || token?.kind !== 'pc' || !token.npcId?.startsWith('v2:')) return;
  queue = queue.then(async () => {
    if (!appliedEffects(await readPC(token)).some(effect => effect.drain?.perTurn)) return; // nothing draining: skip the write
    let hits = [];
    const pc = await updatePCEffects(token, { type: 'drain-turn', onDrain: found => { hits = found; } });
    const map = floor.tabletopMap;
    for (const copy of map?.tokens.filter(copy => copy.npcId === token.npcId) || []) copy.hp = pc.combat.hp_current;
    if (map) floor.dispatchEvent(new Event('map-changed'));
    for (const hit of hits) {
      const text = drainText(token.name, hit);
      document.getElementById('session-status').textContent = text;
      floor.dispatchEvent(new CustomEvent('session-dice', { detail: text }));
      floor.dispatchEvent(new CustomEvent('session-action', { detail: { type: 'dice', text } }));
    }
  }).catch(error => { document.getElementById('session-status').textContent = `Life drain: ${error.message} Check HP before retrying.`; });
}
