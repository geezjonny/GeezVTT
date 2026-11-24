import { encodeKey } from './firebase-codec.js';
import { minigameResults } from './typing-game-model.js';

export const minigameBase = `${window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, '')}/v2/worlds/gaia/vtt`;
export const minigameRunPath = (id, pcId) => `minigameRuns/${id}/${encodeURIComponent(encodeKey(pcId))}`;
export async function writeMinigame(path, value, etag) {
  const response = await fetch(`${minigameBase}/${path}.json`, { method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) },
    body: JSON.stringify(value), signal: AbortSignal.timeout(15000) });
  if (response.status === 412) throw new Error('This PC already started in another window.');
  if (!response.ok) throw new Error(`Minigame sync failed (${response.status}).`);
}

export function renderMinigameResults(session, runs, list, output) {
  const snapshots = Object.fromEntries((session?.participants || []).map(pc => [pc.pcId, runs?.[session.id]?.[encodeKey(pc.pcId)]]));
  const result = minigameResults(session, snapshots);
  const signature = JSON.stringify(result);
  if (list.dataset.result === signature) return;
  list.dataset.result = signature;
  const labels = { waiting: 'Waiting for DEX', playing: 'Playing', won: 'Wave cleared', lost: 'Overrun', stopped: 'Ended' };
  list.replaceChildren(...result.players.map(pc => {
    const item = document.createElement('li'), name = document.createElement('strong'), details = document.createElement('span');
    name.textContent = pc.name;
    details.textContent = `${pc.paused && pc.status === 'playing' ? 'Paused' : labels[pc.status]} · ${pc.kills} kills${pc.total !== null ? ` · DEX ${pc.total} (d20: ${pc.natural}) · ${pc.lives} lives` : ''}`;
    item.append(name, details); return item;
  }));
  output.textContent = `${result.complete ? 'Final' : 'Team'}: ${result.kills} kills · ${result.finished}/${result.players.length} finished`;
}
