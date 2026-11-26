// Sync: Firebase rooms, or an offline stub with the same API.
import { onDice } from './stealth-dice.js';
import { addFloat, addRing, camInit, fitCamera } from './stealth-draw.js';
import { renderPanel } from './stealth-editor.js';
import { buildGuards, hostNoise, onHost } from './stealth-guards.js';
import { onLive } from './stealth-hud.js';
import { demoMap, normalizeMap } from './stealth-model.js';
import { applyCmd, respawn } from './stealth-play.js';
import {
  DB_ROOT, L, M, PLAYERS, bumpMap, editing, isGM, isHost, me, myId, now, setBg, setGuardsSync, setHost, setL, setM, setPlayers, setTimeOffset,
  solo
} from './stealth-state.js';

/* ===================================================================
   NETWORK (Firebase or offline stub, same API)
   =================================================================== */
export const Net = {
  ref: null,
  connect(room) {
    if (solo) return;
    if (!firebase.apps.length) firebase.initializeApp(window.GEEZ_FIREBASE_CONFIG);
    const db = firebase.database();
    db.ref(".info/serverTimeOffset").on("value", s => setTimeOffset(s.val() || 0));
    const r = this.ref = db.ref(DB_ROOT + "/" + room);
    r.child("map/json").on("value", s => {
      const v = s.val();
      if (!v) { if (isGM && !M) { setMap(demoMap()); saveMap(true); } return; }
      if (isGM && M && mapLoadedOnce) return; // the GM is the source of truth while editing
      mapLoadedOnce = true; setMap(JSON.parse(v));
    });
    r.child("map/img").on("value", s => loadBg(s.val()));
    r.child("live").on("value", s => { const v = s.val() || {}; setL({levers:v.levers||{}, doors:v.doors||{}, chests:v.chests||{}, unlock:v.unlock||{}, lights:v.lights||{}, tokens:v.tokens||{}, paused:v.paused !== false, spotted:v.spotted||null, edit:!!v.edit}); onLive(); });
    r.child("players").on("value", s => { setPlayers(s.val() || {}); });
    r.child("guards").on("value", s => { if (!isHost()) setGuardsSync(s.val() || {}); });
    r.child("host").on("value", s => { setHost(s.val()); onHost(); });
    r.child("cmds/" + myId).on("value", s => { const c = s.val(); if (!c) return; applyCmd(c); s.ref.remove(); }); // consumed, so it can't replay on rejoin
    r.child("dice").limitToLast(12).on("child_added", s => { const d = s.val(); if (d) onDice(d); });
    r.child("fx").on("child_added", s => { const f = s.val(); if (f) addFloat(f.x, f.y, f.text, f.color); if (isHost()) setTimeout(() => s.ref.remove(), 3000); });
    r.child("noises").on("child_added", s => { const n = s.val(); if (!n) return; addRing(n.x, n.y, n.r, "#e0a243"); if (isHost()) { hostNoise(n); s.ref.remove(); } });
    if (me) r.child("players/" + myId).onDisconnect().remove();
  },
  live(path, val) {
    if (solo) {
      const parts = path.split("/"); let o = L;
      for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] || {};
      const k = parts[parts.length - 1];
      if (val == null) delete o[k]; else o[k] = val;
      onLive(); return;
    }
    this.ref.child("live/" + path).set(val == null ? null : val);
  },
  liveAll(v) { if (solo) { setL(v); onLive(); return; } this.ref.child("live").set(v); },
  player(p) { if (solo) { PLAYERS[myId] = p; return; } this.ref.child("players/" + myId).set(p); },
  guards(g) { setGuardsSync(g); if (!solo) this.ref.child("guards").set(g); },
  map(json) {
    if (solo) { try { localStorage.setItem("mg2_map", json); } catch (e) {} return; }
    this.ref.child("map/json").set(json);
  },
  img(data) {
    if (solo) { try { localStorage.setItem("mg2_img", data || ""); } catch (e) { addFloat(M.w / 2, M.h / 2, "Image too big to keep offline; it's loaded for this session", "#e0a243"); } return; }
    this.ref.child("map/img").set(data || null);
  },
  cmd(pid, c) { c.t = now() + Math.random(); if (solo || pid === myId) { applyCmd(c); return; } this.ref.child("cmds/" + pid).set(c); },
  dice(d) { if (solo) { onDice(d); return; } this.ref.child("dice").push(d); },
  clearDice() { if (!solo) this.ref.child("dice").set(null); },
  fx(x, y, text, color) { if (solo) { addFloat(x, y, text, color); return; } this.ref.child("fx").push({x, y, text, color: color || "#efe6d8"}); },
  noise(n) { if (solo) { addRing(n.x, n.y, n.r, "#e0a243"); hostNoise(n); return; } this.ref.child("noises").push(n); },
  claimHost(force) {
    if (solo) { setHost({id:myId, gm:true}); onHost(); return; }
    const hr = this.ref.child("host");
    hr.transaction(h => (force || !h || (!h.gm && !PLAYERS[h.id])) ? {id:myId, gm:isGM} : undefined)
      .then(res => { const v = res.snapshot.val(); if (res.committed && v && v.id === myId) hr.onDisconnect().remove(); });
  }
};
export let mapLoadedOnce = false;

export function setMap(m) {
  const first = !M;
  setM(normalizeMap(m)); bumpMap();
  if (isHost()) buildGuards(false);
  if (!camInit) fitCamera();
  if (first) respawn(); // a player who just joined starts on a spawn point
  if (editing()) renderPanel();
}
export let saveTimer = null;
export function saveMap(immediate) {
  bumpMap();
  if (isHost()) buildGuards(false);
  clearTimeout(saveTimer);
  const go = () => Net.map(JSON.stringify(M));
  if (immediate) go(); else saveTimer = setTimeout(go, 350);
}
export function loadBg(data) {
  if (!data) { setBg(null); return; }
  const im = new Image(); im.onload = () => setBg(im); im.src = data;
}
