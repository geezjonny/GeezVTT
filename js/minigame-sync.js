// Minigame sync over the shared Firebase stream. The GM publishes the whole map; everyone patches live door/lever state.
// shortcut: no auth, anyone with the URL can write (same as presence); add Firebase rules before opening to untrusted users.
import { watchTabletop } from './tabletop-stream.js';

const base = () => `${window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, '')}/v2/worlds/gaia/vtt/minigame`;
const put = (path, body, method = 'PUT') => fetch(`${base()}/${path}.json`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
  .then(r => { if (!r.ok) throw new Error(`Firebase returned ${r.status}`); });

// onMap(raw) gets a map another client published; onState({doors, levers}) gets live states keyed by index. Returns senders.
export function syncMinigame({ onMap, onState, onPlayers, onError }) {
  let lastVersion = null;
  watchTabletop('minigame', value => {
    const m = value?.map;
    if (m?.json && m.v !== lastVersion) { lastVersion = m.v; onMap(JSON.parse(m.json), m.v); }
    onState({ doors: value?.doors || {}, levers: value?.levers || {} });
    onPlayers(value?.players || {});
  }, onError);
  return {
    // Publishing a map resets the live door/lever state, since the map itself already carries the current open/closed values.
    async publishMap(raw) {
      const v = `${Date.now()}-${Math.random().toString(36).slice(2)}`; lastVersion = v;
      await put('map', { json: JSON.stringify(raw, (k, val) => (k === 'image' ? undefined : val)), v });
      await Promise.all([put('doors', null), put('levers', null)]);
    },
    // Player positions in grid units; `beat` changes on every send so a standing player still counts as online.
    setPlayer: (id, data) => put(`players/${id}`, data).catch(e => onError?.(`Sync failed: ${e.message}`)),
    leave: id => fetch(`${base()}/players/${id}.json`, { method: 'DELETE', keepalive: true }).catch(() => {}),
    setDoor: (i, closed) => put('doors', { [i]: closed }, 'PATCH').catch(e => onError?.(`Sync failed: ${e.message}`)),
    setLever: (i, on) => put('levers', { [i]: on }, 'PATCH').catch(e => onError?.(`Sync failed: ${e.message}`))
  };
}
