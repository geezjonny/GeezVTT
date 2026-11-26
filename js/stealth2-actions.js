// What my character can do to guards and lights: taunt, distract, attack and shoot, with the menu that offers them.
import { rollCheck, rollDamage } from './stealth2-dice.js';
import { addFloat, iCanSee } from './stealth2-draw.js';
import { HG } from './stealth2-guards.js';
import { canSnuff, guardSees, inEarshot, lightKind, reachCheck, snuffedValue } from './stealth2-model.js';
import { Net } from './stealth2-net.js';
import { SOCIAL_SKILLS, bestWeapon } from './stealth2-pcs.js';
import { $, ACT, GUARDS_SYNC, L, M, clamp, esc, isHost, me, now } from './stealth2-state.js';

// Where a guard is, whether I run the guards or only receive them.
export function guardPose(def) {
  const live = isHost() && HG ? HG.find(g => g.id === def.id) : GUARDS_SYNC[def.id];
  return live || { x: def.x, y: def.y, a: def.face * Math.PI / 180, st: "home" };
}
const signed = n => `${n >= 0 ? "+" : ""}${n}`;
const say = text => addFloat(me.x, me.y - .7, text, "#ffa53d");
const canAct = () => !!(me && M && !L.paused && !L.edit && !me.caught);
const waiting = () => Math.max(0, Math.ceil((me.actReady - now()) / 1000));
// One action per "round".
function spend() {
  if (!canAct()) return false;
  if (waiting()) { say(`Ready in ${waiting()}s`); return false; }
  me.actReady = now() + ACT.cooldownMs;
  return true;
}
const act = a => Net.act({ ...a, pid: me.id });

export function taunt(gid) {
  if (!spend()) return;
  Net.fx(me.x, me.y - .9, me.name + ": \"Over here!\"", "#ffa53d");
  act({ type: "taunt", gid: gid || null });
}
export function distract(gid, skill) {
  const def = M.guards.find(g => g.id === gid);
  if (!canAct() || !def) return;
  if (!inEarshot(me, guardPose(def), ACT.distractRange)) return say(`${def.name} can't hear you`);
  if (!spend()) return;
  const bonus = me.social?.[skill];
  const { total } = rollCheck(bonus?.bonus || 0, capital(skill), false, !!bonus?.disadvantage);
  act({ type: "distract", gid, skill: capital(skill), total });
}
export function attackGuard(def, kind) {
  const pose = guardPose(def), weapon = bestWeapon(me.weapons, kind);
  if (!weapon || pose.st === "down") return;
  const reach = reachCheck(me, pose, weapon, kind);
  if (!reach.ok) return say(reach.reason);
  if (!spend()) return;
  // 5e: an attacker the target can't see has advantage; long range and shooting point-blank give disadvantage.
  const unseen = pose.st === "distract" ? pose.focus !== me.id : !guardSees(pose, def, me);
  const pointBlank = kind === "ranged" && !weapon.melee && Math.hypot(pose.x - me.x, pose.y - me.y) <= 1.2;
  const roll = rollCheck(weapon.bonus, `${weapon.name} vs ${def.name}`, unseen, reach.long || pointBlank || weapon.disadvantage);
  const damage = rollDamage(weapon.damage, `${weapon.name} damage`);
  act({ type: "attack", gid: def.id, weapon: weapon.name, total: roll.total, face: roll.face, damage, unseen });
}
export function shootLight(light) {
  const weapon = bestWeapon(me.weapons, "ranged");
  if (!weapon || !canSnuff(light) || lightKind(light) !== "torch") return;
  const reach = reachCheck(me, light, weapon, "ranged", "light");
  if (!reach.ok) return say(reach.reason);
  if (!spend()) return;
  const roll = rollCheck(weapon.bonus, `${weapon.name} vs torch`, false, reach.long || weapon.disadvantage);
  const hit = roll.face === 20 || (roll.face !== 1 && roll.total >= ACT.torchAC);
  if (hit) Net.live("lights/" + light.id, snuffedValue(light));
  Net.fx(light.x, light.y - .6, hit ? "The torch is shot out" : "Clatter! Missed", hit ? "#3fb899" : "#e0a243");
  Net.noise({ x: light.x, y: light.y, r: hit ? 3 : 2.5 }); // the noise lands where the shot does
}
const capital = word => word.charAt(0).toUpperCase() + word.slice(1);

/* ---------- the menu ---------- */
let menuTarget = null;
export function closeMenu() { menuTarget = null; $("actMenu").classList.add("hidden"); }
// The guard or torch under a point, if my character can see it.
export function targetAt(w) {
  for (const def of M.guards) { const p = guardPose(def); if (Math.hypot(p.x - w.x, p.y - w.y) < .55 && iCanSee(p.x, p.y)) return { type: "guard", id: def.id }; }
  for (const l of M.lights) if (lightKind(l) === "torch" && Math.hypot(l.x - w.x, l.y - w.y) < .55 && iCanSee(l.x, l.y)) return { type: "light", id: l.id };
  return null;
}
export function openMenu(target, clientX, clientY) {
  if (!target || !canAct()) return closeMenu();
  menuTarget = target;
  const rows = [];
  const row = (action, text, off) => rows.push(`<button data-do="${action}" ${off ? "disabled" : ""}><span>${esc(text)}</span>${off ? `<small>${esc(off)}</small>` : ""}</button>`);
  let title = "";
  if (target.type === "guard") {
    const def = M.guards.find(g => g.id === target.id), pose = guardPose(def);
    title = def.name;
    if (pose.st === "down") rows.push(`<p>Down for the count.</p>`);
    else {
      row("taunt", "Taunt: make them chase you", inEarshot(me, pose, ACT.tauntRange) ? "" : "Can't hear you");
      const earshot = inEarshot(me, pose, ACT.distractRange) ? "" : "Can't hear you";
      for (const skill of SOCIAL_SKILLS) row("distract:" + skill, `Distract: ${capital(skill)} ${signed(me.social?.[skill]?.bonus || 0)}`, earshot);
      for (const kind of ["melee", "ranged"]) {
        const weapon = bestWeapon(me.weapons, kind); if (!weapon) continue;
        row("attack:" + kind, `${kind === "melee" ? "Attack" : weapon.melee ? "Throw" : "Shoot"}: ${weapon.name} ${signed(weapon.bonus)}`, reachCheck(me, pose, weapon, kind).reason);
      }
    }
  } else {
    const light = M.lights.find(l => l.id === target.id), weapon = bestWeapon(me.weapons, "ranged");
    title = "Torch";
    if (!canSnuff(light)) rows.push("<p>Already out.</p>");
    else if (!weapon) rows.push("<p>You have nothing to shoot or throw.</p>");
    else row("shoot", `${weapon.melee ? "Throw at it" : "Shoot it out"}: ${weapon.name} ${signed(weapon.bonus)}`, reachCheck(me, light, weapon, "ranged", "light").reason);
  }
  const menu = $("actMenu");
  menu.innerHTML = `<b>${esc(title)}</b>${rows.join("")}`;
  menu.classList.remove("hidden");
  // Beside the click, kept on screen.
  menu.style.left = clamp(clientX + 12, 8, innerWidth - menu.offsetWidth - 8) + "px";
  menu.style.top = clamp(clientY - 20, 8, innerHeight - menu.offsetHeight - 8) + "px";
}
globalThis.document?.getElementById("actMenu").addEventListener("click", e => {
  const b = e.target.closest("[data-do]"); if (!b || !menuTarget) return;
  const [verb, detail] = b.dataset.do.split(":"), target = menuTarget;
  closeMenu();
  if (target.type === "light") { shootLight(M.lights.find(l => l.id === target.id)); return; }
  const def = M.guards.find(g => g.id === target.id);
  if (verb === "taunt") taunt(def.id);
  if (verb === "distract") distract(def.id, detail);
  if (verb === "attack") attackGuard(def, detail);
});
