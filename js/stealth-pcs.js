// Read-only access to our PCs. The sheet maths is the character sheet's own, so the numbers match what players see there.
import { decodeTree } from './firebase-codec.js';
import { sheetRolls } from './sheet-rolls.js';
import { loadSheetReference } from './sheet-view.js';
import { characterVision } from './vision-model.js';

const DEFAULT_COLOR = '#8f87e6';

// -> sorted [{ id, name, campaign, color, darkvision (feet), passive, stealth, perception }]
// stealth and perception are { bonus, disadvantage, detail }, or null without the skill reference.
export function stealthPCs(entities, reference = {}) {
  const pcs = [];
  for (const [id, entity] of Object.entries(entities || {})) {
    try {
      const data = entity?.data, name = typeof entity?.name === 'string' ? entity.name.trim() : '';
      if (entity?.kind !== 'pc' || !data || data._sheetsDeleted || !name || !/^[^.#$\[\]\/\s]{1,200}$/.test(id)) continue;
      const campaign = String(entity.campaign ?? data.campaign ?? '').toLowerCase().replace(/^world__/, '');
      if (!campaign) continue;
      const vision = characterVision(data), perception = skillOf(data, reference, 'perception');
      const stored = Number.parseInt(data.senses?.passive_perception, 10);
      pcs.push({ id, name, campaign,
        color: /^#[0-9a-f]{6}$/i.test(data.token_color) ? data.token_color : DEFAULT_COLOR,
        darkvision: Math.max(vision.darkvision, vision.blindsight, vision.truesight),
        passive: Number.isFinite(stored) ? stored : 10 + (perception?.bonus ?? 0),
        stealth: skillOf(data, reference, 'stealth'), perception });
    } catch (error) { console.warn(`Skipped PC ${id}: ${error.message}`); }
  }
  return pcs.sort((a, b) => a.name.localeCompare(b.name));
}

function skillOf(data, reference, skill) {
  try {
    const roll = sheetRolls(data, reference)['Skill Checks'].find(check => check.key === `skill:${skill}`);
    return Number.isFinite(roll?.bonus) ? { bonus: roll.bonus, disadvantage: !!roll.disadvantage, detail: roll.detail || '' } : null;
  } catch { return null; }
}

export async function loadStealthPCs() {
  const base = window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, '');
  const [entities, reference] = await Promise.all([
    fetch(`${base}/v2/worlds/gaia/entities.json`, { signal: AbortSignal.timeout(15000) }).then(response => {
      if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
      return response.json();
    }),
    loadSheetReference().catch(() => ({})) // without it PCs still load; only the skill bonuses are missing
  ]);
  return stealthPCs(decodeTree(entities), reference);
}
