// Shared dice tray.
import { Net } from './stealth-net.js';
import { $, clamp, esc, isGM, me, now, uid } from './stealth-state.js';

/* ===================================================================
   DICE TRAY (shared 2D dice)
   =================================================================== */
export const DICE = [4, 6, 8, 10, 12, 20];
export let dSel = 20, dMode = "normal";
$("dbtns").innerHTML = DICE.map(d => `<div class="dbtn s${d}" data-d="${d}">d${d}</div>`).join("");
export function refreshTray() {
  document.querySelectorAll(".dbtn").forEach(b => b.classList.toggle("sel", +b.dataset.d === dSel));
  $("dAdv").className = dMode === "adv" ? "on" : "ghost"; $("dDis").className = dMode === "dis" ? "on" : "ghost";
  $("dAdv").disabled = $("dDis").disabled = dSel !== 20;
}
document.querySelectorAll(".dbtn").forEach(b => b.onclick = () => { dSel = +b.dataset.d; if (dSel !== 20) dMode = "normal"; refreshTray(); });
$("dAdv").onclick = () => { dMode = dMode === "adv" ? "normal" : "adv"; refreshTray(); };
$("dDis").onclick = () => { dMode = dMode === "dis" ? "normal" : "dis"; refreshTray(); };
$("trayClose").onclick = () => openTray(false);
export function openTray(on) {
  if (!on && $("tray").contains(document.activeElement)) document.activeElement.blur();
  $("tray").classList.toggle("hidden", !on);
}
export function toggleTray() { openTray($("tray").classList.contains("hidden")); }
refreshTray();
export function rollDice({ die, count = 1, mod = 0, mode = "normal", note = "", asCharacter = !isGM }) {
  if (mode !== "normal") count = 2;
  const rolls = Array.from({length:count}, () => 1 + Math.floor(Math.random() * die));
  let kept = rolls.map((_, i) => i);
  if (mode === "adv") kept = [rolls[0] >= rolls[1] ? 0 : 1];
  if (mode === "dis") kept = [rolls[0] <= rolls[1] ? 0 : 1];
  const total = kept.reduce((a, i) => a + rolls[i], 0) + mod;
  const mine = asCharacter && me;
  Net.dice({ id:uid(), who: mine ? me.name : "GM", color: mine ? me.color : "#e0a243",
    die, count: mode === "normal" ? count : 1, mod, mode, rolls, kept, total, note, t:now() });
  return total;
}
$("dRoll").onclick = () => {
  rollDice({ die:dSel, count:clamp(parseInt($("dCount").value) || 1, 1, 10), mod:parseInt($("dMod").value) || 0,
    mode:dSel === 20 ? dMode : "normal", note:$("dNote").value.trim() });
  $("dNote").value = "";
};
// A Perception roll to listen harder, straight from the sheet. The tray's advantage toggle applies.
export const rollListen = () => rollDice({ die:20, mod:me.perception?.bonus || 0, mode:dMode, note:"Listen", asCharacter:true });
// The signed-in PC's Stealth check, straight from their sheet.
export function refreshStealthButton() {
  const s = me && me.stealth, b = $("dStealth");
  b.classList.toggle("hidden", !s);
  if (!s) return;
  b.textContent = `Stealth check ${s.bonus >= 0 ? "+" : ""}${s.bonus}${s.disadvantage ? " (disadvantage)" : ""}`;
  b.title = s.detail || "";
}
$("dStealth").onclick = () => {
  const s = me && me.stealth; if (!s) return;
  // Advantage cancels the sheet's disadvantage; otherwise the sheet or the tray toggle decides.
  const mode = s.disadvantage ? (dMode === "adv" ? "normal" : "dis") : dMode;
  rollDice({ die:20, mod:s.bonus, mode, note:"Stealth", asCharacter:true });
};
export const diceLog = [];
export let bigTimer = null, flickTimer = null;
export const diceLabel = d => `${Number(d.count)}d${Number(d.die)}${Number(d.mod) ? (d.mod > 0 ? "+" : "") + Number(d.mod) : ""}${d.mode === "adv" ? " (adv)" : d.mode === "dis" ? " (dis)" : ""}`;
export function onDice(d) {
  diceLog.push(d); if (diceLog.length > 12) diceLog.shift();
  $("log").innerHTML = diceLog.slice().reverse().map(x =>
    `<div><b style="color:${esc(x.color)}">${esc(x.who)}</b> ${diceLabel(x)} = <b>${Number(x.total)}</b>${x.note ? " · " + esc(x.note) : ""}</div>`).join("");
  if (now() - d.t > 6000) return;
  const box = $("bigRoll");
  const head = `<div class="who"><b style="color:${esc(d.color)}">${esc(d.who)}</b> rolls ${diceLabel(d)}${d.note ? " · " + esc(d.note) : ""}</div>`;
  const die = Number(d.die);
  const faces = () => d.rolls.map((v, i) => `<div class="face s${die} ${d.mode === "normal" || d.kept.includes(i) ? "kept" : "drop"}">${Number(v)}</div>`).join("");
  clearInterval(flickTimer); clearTimeout(bigTimer);
  box.classList.remove("hidden");
  let n = 0;
  flickTimer = setInterval(() => {
    if (++n < 10) box.innerHTML = head + `<div class="faces">${d.rolls.map(() => `<div class="face s${die}">${1 + Math.floor(Math.random() * die)}</div>`).join("")}</div><div class="tot">…</div>`;
    else { clearInterval(flickTimer); box.innerHTML = head + `<div class="faces">${faces()}</div><div class="tot">${Number(d.total)}</div>`; bigTimer = setTimeout(() => box.classList.add("hidden"), 5000); }
  }, 60);
}
