// Live-state banners, floating buttons, and the on-screen eye and sneak indicator.
import { closeMenu, taunt } from './stealth2-actions.js';
import { openTray, toggleTray } from './stealth2-dice.js';
import { playerView, threat, togglePlayerView } from './stealth2-draw.js';
import { renderPanel, renderTools, toggleEdit } from './stealth2-editor.js';
import { resetScene, resolveSpot, togglePause } from './stealth2-guards.js';
import { hearingRange, perceptionScore } from './stealth2-model.js';
import { listen, toggleSneak } from './stealth2-play.js';
import { $, L, M, clamp, editing, esc, isGM, me, now } from './stealth2-state.js';

/* ===================================================================
   LIVE STATE CHANGES
   =================================================================== */
export let wasPaused = null, wasEdit = false, lastSpotId = null;
export function onLive() {
  const p = !!L.paused;
  $("pauseBanner").classList.toggle("hidden", !p || !!L.spotted);
  $("pauseBanner").textContent = L.edit ? "GM is editing the map" : "Paused";
  if (wasPaused !== null && p && !wasPaused && !L.edit) openTray(true);
  if (wasPaused && !p) openTray(false);
  wasPaused = p;
  if (L.edit !== wasEdit) {
    wasEdit = L.edit;
    $("tools").classList.toggle("hidden", !editing());
    if (editing()) { renderTools(); renderPanel(); } else $("panel").classList.add("hidden");
  }
  if (p) closeMenu();
  const sb = $("spotBox");
  if (L.spotted) {
    const s = L.spotted;
    sb.innerHTML = spotHTML(s);
    sb.classList.remove("hidden");
    const key = s.why + s.gid + s.pid;
    if (key !== lastSpotId) { lastSpotId = key; openTray(true); }
  } else { sb.classList.add("hidden"); lastSpotId = null; }
}
const signed = n => `${n >= 0 ? "+" : ""}${Number(n)}`;
// What the GM is being asked to rule on, with the choices that fit.
function spotHTML(s) {
  const guard = esc(s.gname), who = esc(s.pname);
  const stealth = s.stealth == null ? "" : ` · Stealth ${signed(s.stealth)}${s.dis ? " (disadvantage)" : ""}`;
  const moving = `${s.md === "sneak" ? "Sneaking" : "Moving normally"} · light ${Number(s.light)}%${stealth}`;
  const pp = isGM ? ` · ${guard}'s Passive Perception ${Number(s.pp)}` : "";
  const cases = {
    seen: [`${guard} spotted ${who}!`, moving + pp, [["notseen", "Not seen"], ["invest", "Investigates"], ["chase", "Gives chase"], ["caught", "Caught → cell"], ["hold", "Stay paused"]]],
    fooled: [`${guard} isn't fooled by ${who}`, `${esc(s.skill)} ${Number(s.total)}${isGM ? ` against DC ${Number(s.pp) || 10}` : ""}`, [["notseen", "Lets it go"], ["invest", "Investigates"], ["chase", "Gives chase"], ["caught", "Caught → cell"]]],
    reached: [`${guard} caught up with ${who}!`, moving, [["notseen", "Breaks free"], ["caught", "Caught → cell"], ["hold", "Stay paused"]]],
    attack: [`${who} attacks ${guard}`, `${esc(s.weapon)} · ${Number(s.total)} to hit${Number(s.face) === 20 ? " (natural 20)" : Number(s.face) === 1 ? " (natural 1)" : ""} · ${Number(s.damage)} damage${s.unseen ? " · unseen" : ""}`, [["miss", "Miss"], ["wounded", "Wounded (chases)"], ["down", "Knocked out"]]]
  };
  const [title, detail, choices] = cases[s.why] || cases.seen;
  return `<div class="t">${title}</div><div class="s">${detail}</div>` +
    (isGM ? `<div class="btns">${choices.map(([ruling, text]) => `<button data-ruling="${ruling}">${text}</button>`).join("")}</div>`
          : `<div class="s wait">Roll it out. The GM decides.</div>`);
}

/* ===================================================================
   FLOATING BUTTONS
   =================================================================== */
let lastActions = "";
export function drawHUD(dt) {
  let h = "";
  if (isGM) {
    if (me && !L.edit) h += `<button class="${playerView ? "on" : ""}" data-act="view">Player view</button>`;
    h += `<button class="${L.edit ? "on" : ""}" data-act="edit">${L.edit ? "Done editing" : "Edit map"}</button>`;
    if (!L.edit) h += `<button data-act="pause">${L.paused ? "Resume" : "Pause"} <kbd>P</kbd></button><button data-act="reset">Reset</button>`;
  }
  h += `<button data-act="dice">Dice</button>`;
  if (h !== lastActions) $("actions").innerHTML = lastActions = h;
  drawStealth(dt);
}

/* ===================================================================
   THE EYE: closed while hidden, opening as a guard gets close to seeing me
   =================================================================== */
const EYE_TEXT = { hidden: "Hidden", near: "Careful", seen: "Seen", caught: "Caught" };
let eyeOpen = 0, lastEye = "";
export function drawStealth(dt) {
  const show = !!(me && M && !L.edit);
  $("stealth").classList.toggle("hidden", !show);
  if (!show) return;
  const spotted = !!L.spotted && L.spotted.pid === me.id;
  const state = me.caught ? "caught" : spotted || threat >= 1 ? "seen" : threat > .05 ? "near" : "hidden";
  const target = me.caught ? 0 : state === "seen" ? 1 : threat;
  eyeOpen += clamp(target - eyeOpen, -dt * 1.5, dt * 1.5); // eases open and shut
  const t = now(), score = perceptionScore(me, t), listening = !!me.listen && me.listen.until > t, wait = Math.ceil((me.listenReady - t) / 1000);
  const listenText = listening ? `Listening ${hearingRange(score) * 5} ft` : wait > 0 ? `Listen (${wait}s)` : "Listen";
  const busy = Math.ceil((me.actReady - t) / 1000), tauntText = busy > 0 ? `Taunt (${busy}s)` : "Taunt";
  const tip = isGM && !playerView ? "Right-click a guard or torch to act" : "Click a guard or torch to act";
  const key = `${state}|${eyeOpen.toFixed(2)}|${me.md}|${listenText}|${me.passive}|${tauntText}|${me.match}|${tip}`;
  if (key === lastEye) return;
  lastEye = key;
  // Lids: both sag into a closed curve at 0 and part into an almond at 1.
  const sag = 20 + 10 * (1 - eyeOpen), spread = 22 * eyeOpen;
  const shape = `M4 20 Q32 ${sag - spread} 60 20 Q32 ${sag + spread} 4 20 Z`;
  $("eyeShape").setAttribute("d", shape);
  $("eyeLid").setAttribute("d", shape);
  $("eyeLashes").style.display = eyeOpen < .12 ? "" : "none";
  $("stealth").dataset.state = state;
  $("eyeText").textContent = EYE_TEXT[state];
  $("sneakText").textContent = me.md === "sneak" ? "Sneaking" : "Normal";
  $("sneakBtn").classList.toggle("on", me.md === "sneak");
  $("listenText").textContent = listenText;
  $("listenBtn").classList.toggle("on", listening);
  $("listenBtn").classList.toggle("waiting", !listening && wait > 0);
  $("tauntText").textContent = tauntText;
  $("tauntBtn").classList.toggle("waiting", busy > 0);
  $("matchTag").classList.toggle("hidden", !me.match);
  $("actTip").textContent = tip;
  $("listenBtn").title = `Stand still and roll Perception. Passively you hear guards within ${hearingRange(me.passive) * 5} ft, half that through walls.`;
}

const ACTIONS = { dice: toggleTray, view: togglePlayerView, edit: toggleEdit, pause: togglePause, reset: resetScene };
$("actions").addEventListener("click", e => { const b = e.target.closest("[data-act]"); if (b) ACTIONS[b.dataset.act](); });
$("sneakBtn").addEventListener("click", toggleSneak);
$("listenBtn").addEventListener("click", listen);
$("tauntBtn").addEventListener("click", () => taunt());
$("spotBox").addEventListener("click", e => { const b = e.target.closest("[data-ruling]"); if (b) resolveSpot(b.dataset.ruling); });
