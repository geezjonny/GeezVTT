// Per-browser graphics quality. Local presentation only: never shared through Firebase.
export const GRAPHICS_LEVELS = ['low', 'medium', 'high'];
export const GRAPHICS = {
  low: { label: 'Low', pixelRatio: 1, shadows: false, sunShadowSize: 1024, pointShadows: 0, pointShadowSize: 256, weatherParticles: 50 },
  medium: { label: 'Medium', pixelRatio: 1.5, shadows: true, sunShadowSize: 1024, pointShadows: 2, pointShadowSize: 256, weatherParticles: 100 },
  high: { label: 'High', pixelRatio: 2, shadows: true, sunShadowSize: 2048, pointShadows: 8, pointShadowSize: 512, weatherParticles: 160 }
};
const KEY = 'geezvtt.graphics';

export function normalizeGraphicsLevel(value, fallback = 'high') {
  return GRAPHICS_LEVELS.includes(value) ? value : fallback;
}
export function nextGraphicsLevel(level) {
  return GRAPHICS_LEVELS[(GRAPHICS_LEVELS.indexOf(normalizeGraphicsLevel(level)) + 1) % GRAPHICS_LEVELS.length];
}

let level;
function defaultLevel() {
  // Touch devices start lower; anyone can change it from View > Graphics.
  try { return globalThis.matchMedia?.('(pointer: coarse)').matches ? 'medium' : 'high'; } catch { return 'high'; }
}
export function graphicsLevel() {
  if (level) return level;
  let stored = null;
  try { stored = globalThis.localStorage?.getItem(KEY); } catch { /* storage can be blocked */ }
  level = normalizeGraphicsLevel(stored, defaultLevel());
  return level;
}
export const graphicsSettings = () => GRAPHICS[graphicsLevel()];

export function setGraphicsLevel(next) {
  level = normalizeGraphicsLevel(next, graphicsLevel());
  try { globalThis.localStorage?.setItem(KEY, level); } catch { /* keep the choice for this session only */ }
  globalThis.dispatchEvent?.(new CustomEvent('geez:graphics', { detail: { level, settings: GRAPHICS[level] } }));
  return level;
}
export function onGraphicsChange(listener) {
  const handler = event => listener(event.detail.settings, event.detail.level);
  globalThis.addEventListener?.('geez:graphics', handler);
  return () => globalThis.removeEventListener?.('geez:graphics', handler);
}
