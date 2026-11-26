// Shared state, tuning and tiny helpers. This module imports nothing, so every other stealth module can rely on it.
// Imported bindings are read-only: another module changes one of these variables through its setter.

export const DB_ROOT = 'minigame2/rooms';

/* Tuning (1 unit = 1 grid square = 5 ft) */
export const SPEED = { normal: 4.0, sneak: 1.4 };            // squares per second
export const NOISE = { normal: 4.0, sneak: 0.7 };            // squares a guard can hear you from (halved through walls)
export const P_RAD = 0.3;                                    // player token radius
export const SPOT_COOLDOWN = 5000;                           // ms the same guard ignores the same player after the GM rules
// A character hears a walking guard within (Perception score - offset) squares, halved through walls.
export const HEARING = {
  offset: 8,
  rushBonus: 2,          // extra squares for a guard hurrying to investigate
  listenMs: 6000,        // how long a Listen roll replaces the passive score (if it is higher)
  cooldownMs: 12000      // from the start of one Listen to the next
};
// Light sources. Torches and braziers are things players can put out; a glow is plain light (moonlight, magic).
export const LIGHT_KINDS = {
  torch:   { label: 'Torch', noise: 1.5, scale: 1.35 },
  brazier: { label: 'Brazier', noise: 3, scale: 1.25 },
  glow:    { label: 'Glow only (no object)' }
};
export const PROP_KINDS = {
  crate:     { w: 1,   h: 1,   tall: true,  fill: '#7a5a35', label: 'Crate' },
  barrel:    { w: 0.8, h: 0.8, tall: true,  fill: '#6b4a2c', label: 'Barrel', round: true },
  table:     { w: 2,   h: 1,   tall: false, fill: '#5e4630', label: 'Table' },
  pillar:    { w: 1,   h: 1,   tall: true,  fill: '#6d6760', label: 'Pillar', round: true },
  bookshelf: { w: 2,   h: 0.5, tall: true,  fill: '#4d3a2a', label: 'Bookshelf' },
  bed:       { w: 1,   h: 2,   tall: false, fill: '#56483e', label: 'Bed' },
  chest:     { w: 1,   h: 0.7, tall: false, fill: '#9a6b2f', label: 'Chest' },
  statue:    { w: 1,   h: 1,   tall: true,  fill: '#8a8780', label: 'Statue', round: true }
};
export const FLOOR_STYLES = { stone: '#34302c', wood: '#4a3626', dirt: '#3d3424', grass: '#2e3b26', water: '#203845', shadow: '#17151a' };

/* Session */
export let M = null;               // map document (what the GM edits)
export let mapVer = 0;             // bumps on every map change
export let bgImg = null;           // background image
export let L = { levers: {}, doors: {}, chests: {}, unlock: {}, lights: {}, tokens: {}, paused: true, spotted: null, edit: false };
export let PLAYERS = {};           // everyone's synced player tokens
export let GUARDS_SYNC = {};       // guard positions as the host publishes them
export let HOST = null;
export let me = null, myId = null, isGM = false, solo = false, roomName = '';
export let timeOffset = 0;

export const setM = value => { M = value; };
export const bumpMap = () => { mapVer++; };
export const setBg = value => { bgImg = value; };
export const setL = value => { L = value; };
export const setPlayers = value => { PLAYERS = value; };
export const setGuardsSync = value => { GUARDS_SYNC = value; };
export const setHost = value => { HOST = value; };
export const setTimeOffset = value => { timeOffset = value; };
export const setSession = session => ({ me = null, myId, isGM, solo, roomName } = session);

export const isHost = () => !!(HOST && HOST.id === myId);
export const editing = () => isGM && L.edit;

/* Helpers */
export const now = () => Date.now() + timeOffset;
export const uid = () => Math.random().toString(36).slice(2, 9);
export const $ = id => document.getElementById(id);
export const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const snap = (v, s) => Math.round(v / s) * s;
export const keys = {};            // keyboard keys currently held
export const cv = globalThis.document?.getElementById('c');
