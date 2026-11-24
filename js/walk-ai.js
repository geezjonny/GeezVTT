import { isGM, sessionClient } from './session-role.js';
import { hordeBase, serverNow } from './horde-sync.js';
import { updateConditionally } from './firebase-update.js';
import { smooth, world } from './walk-model.js';
import { activeNPC, advanceNPC, npcSpec, npcState } from './walk-ai-model.js';

export function createWalkAI({ mapKey, active, pcs, onError }) {
  let runtime = null, busy = false, receivedMap = null, lastError = 0;
  const shown = new Map(), routes = new Map();
  const fresh = () => runtime && Number.isFinite(runtime.until) && runtime.until > serverNow() && runtime.until < serverNow() + 15000;
  const recorded = token => token.walkAI && !token.walkDeleted && runtime?.npcs?.[token.id]?.spec === npcSpec(token) ? npcState(token, runtime.npcs[token.id]) : null;
  const state = token => {
    if (!activeNPC(token) || !fresh()) return null;
    const value = recorded(token);
    if (!value) return null;
    if (world.chains.some(c => c.id === token.walkAI.chain && c.locked)) return { ...value, mode: 'chained', captured: null };
    if (token.walkAI.disposition === 'friendly') value.captured = null;
    return value;
  };
  const report = error => { if (Date.now() - lastError > 5000) { onError(`NPC AI: ${error.message}`); lastError = Date.now(); } };
  async function tick() {
    const key = mapKey();
    if (!isGM || busy || !key || !active() || !world.tokens.some(activeNPC)) return;
    if (fresh() && runtime.owner !== sessionClient) return;
    busy = true;
    try {
      const result = await updateConditionally(`${hordeBase}/walk/ai/${key}.json`, current => {
        if (key !== mapKey() || !active()) return { result: null, write: null };
        const now = serverNow();
        if (current?.owner !== sessionClient && Number.isFinite(current?.until) && current.until > now && current.until < now + 15000) return { result: current, write: null };
        const previousTime = Number.isFinite(current?.at) ? current.at : now - 200;
        const dt = Math.max(0.02, Math.min(0.35, (now - previousTime) / 1000));
        const available = pcs(), captured = new Set(), npcs = Object.create(null);
        const tokens = world.tokens.filter(activeNPC).sort((a, b) => Number(!!current?.npcs?.[b.id]?.captured) - Number(!!current?.npcs?.[a.id]?.captured));
        for (const token of tokens) {
          const candidates = token.walkAI.disposition === 'friendly' ? available : available.filter(p => !captured.has(p.pcId));
          npcs[token.id] = advanceNPC(token, current?.npcs?.[token.id], candidates, dt, routes);
          if (npcs[token.id].captured) captured.add(npcs[token.id].captured);
        }
        const next = { owner: sessionClient, until: now + 8000, at: now, npcs };
        return { result: next, write: next };
      }, 'NPC AI changed elsewhere; retrying.', { raw: true });
      if (key === mapKey() && result) receive(result);
    } catch (error) { report(error); }
    finally { busy = false; }
  }
  function receive(value) {
    const key = mapKey();
    if (key !== receivedMap) { shown.clear(); routes.clear(); receivedMap = key; }
    runtime = value;
    const ids = new Set(world.tokens.map(t => t.id));
    for (const id of shown.keys()) if (!ids.has(id)) { shown.delete(id); routes.delete(id); }
    for (const token of world.tokens) {
      const target = recorded(token);
      if (!target) { shown.delete(token.id); continue; }
      const old = shown.get(token.id);
      if (old) old.target = target;
      else shown.set(token.id, { shown: { x: target.x, y: target.y }, target });
    }
  }
  const timer = setInterval(tick, 200);
  addEventListener('pagehide', () => clearInterval(timer));
  return {
    receive,
    frame(seconds) { for (const value of shown.values()) value.shown = smooth(value.shown, value.target, seconds); },
    position(token) { const value = recorded(token); return value ? shown.get(token.id)?.shown || value : token; },
    status(token) { return state(token); },
    held(pcId) { return world.tokens.find(token => state(token)?.captured === pcId) || null; },
    async reset() {
      if (!isGM || !mapKey()) return;
      const key = mapKey(), now = serverNow(), value = { owner: sessionClient, until: now + 8000, at: now, npcs: {} };
      try {
        await updateConditionally(`${hordeBase}/walk/ai/${key}.json`, () => key === mapKey() ? { result: value, write: value } : { result: null, write: null }, 'Could not reset NPC AI.', { raw: true });
        if (key === mapKey()) receive(value);
      } catch (error) { report(error); }
    },
    async release(pcId) {
      if (!isGM || !mapKey()) return;
      const key = mapKey();
      try {
        const result = await updateConditionally(`${hordeBase}/walk/ai/${key}.json`, current => {
          if (!current || key !== mapKey()) return { result: null, write: null };
          for (const npc of Object.values(current.npcs || {})) if (npc?.captured === pcId) { npc.captured = null; npc.ignore = pcId; npc.target = null; npc.mode = 'wandering'; }
          return { result: current };
        }, 'NPC AI changed elsewhere; try releasing again.', { raw: true });
        if (key === mapKey() && result) receive(result);
      } catch (error) { report(error); }
    }
  };
}
