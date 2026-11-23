import { applyFirebaseEvent } from './firebase-events.js';

const listeners = new Set();
let stream, value, received = false;
// Share one connection across scene, live state, actions and presence.
export function watchTabletop(path, onValue, onError) {
  const listener = { path, onValue, onError };
  listeners.add(listener);
  if (!stream) {
    const base = window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, '');
    stream = new EventSource(`${base}/v2/worlds/gaia/vtt.json`);
    const report = message => { for (const listener of listeners) listener.onError?.(message); };
    const update = event => {
      try {
        const message = JSON.parse(event.data);
        value = applyFirebaseEvent(value, event.type, message);
        received = true;
        const paths = event.type === 'patch' ? Object.keys(message.data).map(key => `${message.path}/${key}`) : [message.path];
        const roots = new Set(paths.map(path => path.split('/').filter(Boolean)[0]));
        for (const listener of listeners) {
          if (!roots.has(undefined) && !roots.has(listener.path)) continue;
          try { listener.onValue(value?.[listener.path] ?? null); }
          catch (error) { listener.onError?.(`Sync failed: ${error.message}`); }
        }
      } catch (error) { report(`Sync failed: ${error.message}`); }
    };
    stream.addEventListener('put', update);
    stream.addEventListener('patch', update);
    stream.addEventListener('error', () => report('Sync disconnected; reconnecting…'));
    for (const type of ['cancel', 'auth_revoked']) stream.addEventListener(type, () => {
      stream.close(); report('Firebase sync denied. Reload to retry.');
    });
  } else if (received) {
    queueMicrotask(() => {
      if (!listeners.has(listener)) return;
      try { onValue(value?.[path] ?? null); }
      catch (error) { onError?.(`Sync failed: ${error.message}`); }
    });
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { stream?.close(); stream = null; value = null; received = false; }
  };
}
window.addEventListener('pagehide', () => { stream?.close(); });
