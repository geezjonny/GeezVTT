// Firebase side of Zombie Horde: one session record, one append-only input log per session. See horde-design.md.
import { encodeKey } from './firebase-codec.js';
import { watchTabletop } from './tabletop-stream.js';
import { ROLES, SPEED_DEFAULT, SPEED_MAX, SPEED_MIN, TICKS_PER_SECOND, normalizeName, roleForClass, validEvent } from './horde-model.js';

export const hordeBase = `${window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, '')}/v2/worlds/gaia/vtt`;
const base = () => hordeBase;
const timeout = () => AbortSignal.timeout(15000);

async function send(path, method, body) {
  const response = await fetch(`${base()}/${path}.json`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: timeout() });
  if (!response.ok) throw new Error(`Horde sync failed (${response.status}).`);
  return method === 'DELETE' ? null : response.json();
}

// A usable session has an id, a seed and 1-12 participants with distinct letter names.
export function validHordeSession(value) {
  if (!value || typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value.id) || !Number.isInteger(value.seed)) return false;
  const list = Object.values(value.participants || {});
  const names = new Set(list.map(p => normalizeName(p?.name)));
  return list.length >= 1 && list.length <= 12 && names.size === list.length && !names.has('') &&
    list.every(p => (p.role === undefined || ROLES.includes(p.role)) && typeof p.pcId === 'string' && /^[^.#$\[\]/\s]{1,200}$/.test(p.pcId)) &&
    ['lobby', 'running', 'ended'].includes(value.phase) && (value.startsAt === undefined || value.startsAt === null || Number.isFinite(value.startsAt)) &&
    (value.speed === undefined || validSpeed(value.speed)) && (value.createdAt === undefined || Number.isFinite(value.createdAt)) && (value.endedAt === undefined || Number.isFinite(value.endedAt));
}
// Sessions older than two hours are stale leftovers and are ignored everywhere.
export const HORDE_MAX_AGE = 2 * 60 * 60 * 1000;
export const freshHordeSession = (value, now = Date.now()) => validHordeSession(value) && (!Number.isFinite(value.createdAt) || now - value.createdAt < HORDE_MAX_AGE);
export const sessionConfig = session => ({
  seed: session.seed, speed: validSpeed(session.speed) ? session.speed : SPEED_DEFAULT,
  participants: Object.values(session.participants).map(p => ({ pcId: p.pcId, name: String(p.name).slice(0, 40), cls: String(p.cls ?? ''), role: p.role || roleForClass(p.cls) }))
});

// --- GM actions
export async function createHordeSession(participants, speed = SPEED_DEFAULT) {
  const id = crypto.randomUUID();
  const seed = crypto.getRandomValues(new Int32Array(1))[0];
  const session = { id, seed, speed, phase: 'lobby', startsAt: null, createdAt: Date.now(), participants: participants.map(p => ({ pcId: p.pcId, name: p.name, cls: p.cls || '', role: ROLES.includes(p.role) ? p.role : roleForClass(p.cls) })) };
  if (!validHordeSession(session)) throw new Error('Choose 1-12 PCs with distinct names.');
  await send('hordeEvents', 'DELETE');
  await send('horde', 'PUT', { ...session, createdAt: { '.sv': 'timestamp' } });
  return session;
}
export const validSpeed = value => Number.isInteger(value) && value >= SPEED_MIN && value <= SPEED_MAX;
// The GM can change zombie speed until the game starts; everyone replays with the new setting.
export async function setHordeSpeed(speed) {
  if (!validSpeed(speed)) throw new Error('Zombie speed is 1 to 5.');
  return send('horde/speed', 'PUT', speed);
}
export const startHordeSession = id => send('horde', 'PATCH', { phase: 'running', startsAt: { '.sv': 'timestamp' } }).then(() => id);
export const endHordeSession = (id, results) => send('horde', 'PATCH', { phase: 'ended', endedAt: { '.sv': 'timestamp' }, ...(results ? { results } : {}) });

// --- clock: server time minus local time, so every client agrees which tick it is.
let offset = 0;
export async function syncClock() {
  const key = encodeKey(crypto.randomUUID());
  const t0 = Date.now();
  const server = await send(`clock/${key}`, 'PUT', { '.sv': 'timestamp' });
  const t1 = Date.now();
  if (Number.isFinite(server)) offset = server - Math.round((t0 + t1) / 2);
  send(`clock/${key}`, 'DELETE').catch(() => {});
  return offset;
}
export const serverNow = () => Date.now() + offset;
export const tickAt = (startsAt, now = serverNow()) => Math.floor((now - startsAt) * TICKS_PER_SECOND / 1000);

// --- the input log
export function postEvent(sessionId, event) {
  return send(`hordeEvents/${sessionId}/${encodeKey(event.pcId)}/${event.seq}`, 'PUT', event);
}
// Firebase returns dense numeric keys as arrays, so accept both shapes.
export function eventsFromLog(log, session) {
  const participants = sessionConfig(session).participants, out = [];
  for (const perPc of Object.values(log?.[session.id] || {})) {
    for (const event of Object.values(perPc || {})) if (validEvent(event, participants)) out.push(event);
  }
  return out;
}
export function nextSeq(events, pcId) {
  return events.reduce((max, event) => event.pcId === pcId ? Math.max(max, event.seq + 1) : max, 0);
}

export function watchHorde({ onSession, onLog, onError }) {
  const stops = [watchTabletop('horde', value => onSession(freshHordeSession(value) ? value : null), onError),
    watchTabletop('hordeEvents', onLog, onError)];
  return () => stops.forEach(stop => stop());
}
