// GM map editor, import and export.
import { openTray } from './stealth2-dice.js';
import { addFloat, fitCamera, setFollow } from './stealth2-draw.js';
import { buildGuards } from './stealth2-guards.js';
import { blankMap, demoMap, derive, distToSeg, isLinked, lightKind, normalizeMap, propRect } from './stealth2-model.js';
import { Net, loadBg, saveMap } from './stealth2-net.js';
import { ptr, selGuard } from './stealth2-play.js';
import { $, FLOOR_STYLES, L, LIGHT_KINDS, M, PROP_KINDS, bgImg, editing, esc, isGM, setBg, setM, snap, uid } from './stealth2-state.js';

export function updateGmHint() {
  const h = $("gmHint");
  let txt = "";
  if (isGM && !editing() && selGuard) { const g = M.guards.find(x => x.id === selGuard); txt = `${g ? g.name : "Guard"}: click a spot to send him there · click him again to send him home · Esc to cancel`; }
  if (editing() && tool === "wall" && wallChain) txt = "Click to add wall points · right-click or Esc to finish";
  if (editing() && tool === "door" && doorStart) txt = "Click the door's other end";
  if (editing() && tool === "link" && linkLever) txt = "Click doors, chests or lights to link them to this lever · Esc when done";
  if (editing() && pathEdit) txt = "Click to add patrol points · drag points to move them · Esc when done";
  h.textContent = txt; h.classList.toggle("hidden", !txt);
}

/* ===================================================================
   EDITOR
   =================================================================== */
export const TOOLS = [
  ["select","Select / move"],["wall","Wall"],["door","Door"],["floor","Floor paint"],["light","Light"],["lever","Lever"],
  ["link","Link lever"],["prop","Prop / chest"],["guard","Guard"],["token","Token"],["spawn","Spawn / cell"],["erase","Erase"]
];
export let tool = "select", sel = null, wallChain = null, doorStart = null, linkLever = null, pathEdit = false, dragInfo = null;
export let floorStyle = "stone", propKind = "crate", spawnKind = "spawn", newLight = "torch";

export function endWallChain() {
  if (!wallChain) return false;
  wallChain = null; updateGmHint(); return true;
}
export function renderTools() {
  const t = $("tools");
  t.innerHTML = TOOLS.map(([k, n]) => `<button class="${tool === k ? "on" : "ghost"}" data-t="${k}">${n}</button>`).join("") +
    `<hr><button class="ghost" id="tImport">Import dd2vtt</button><button class="ghost" id="tBg">Background image</button>` +
    `<button class="ghost" id="tExport">Save map file</button><button class="ghost" id="tLoad">Load map file</button><button class="ghost" id="tNew">New blank map</button><button class="ghost" id="tDemo">Demo map</button>`;
  t.querySelectorAll("[data-t]").forEach(b => b.onclick = () => { cancelTool(); tool = b.dataset.t; renderTools(); renderPanel(); });
  $("tImport").onclick = () => pickFile(".dd2vtt,.df2vtt,.uvtt,.json", importDd2vtt);
  $("tBg").onclick = () => pickFile("image/*", importBgImage);
  $("tExport").onclick = exportMap;
  $("tLoad").onclick = () => pickFile(".json", importMapFile);
  $("tNew").onclick = () => {
    const s = prompt("Map size in squares (width x height)", "30x20"); if (!s) return;
    const [w, h] = s.toLowerCase().split("x").map(n => parseInt(n));
    if (!(w > 0 && h > 0 && w <= 200 && h <= 200)) return alert("Use something like 30x20 (max 200x200).");
    setM(blankMap(w, h)); Net.img(null); setBg(null); sel = null; saveMap(true); fitCamera(); renderPanel();
  };
  $("tDemo").onclick = () => { if (!confirm("Replace this map with the demo map?")) return; setM(demoMap()); Net.img(null); setBg(null); sel = null; saveMap(true); fitCamera(); renderPanel(); };
}
export function cancelTool() { wallChain = null; doorStart = null; linkLever = null; pathEdit = false; renderPanel(); updateGmHint(); }

export function field(label, key, type, extra) {
  const o = sel && sel.o; const v = o[key];
  const id = "f_" + key;
  if (type === "check") return `<label class="chk"><input type="checkbox" id="${id}" ${v ? "checked" : ""}> ${label}</label>`;
  if (type === "select") return `<label>${label}</label><select id="${id}">${extra.map(([k, n]) => `<option value="${k}" ${k === v ? "selected" : ""}>${n}</option>`).join("")}</select>`;
  if (type === "area") return `<label>${label}</label><textarea id="${id}">${esc(v)}</textarea>`;
  return `<label>${label}</label><input id="${id}" type="${type}" value="${esc(v)}" ${extra || ""}>`;
}
export function bindFields(keysTypes) {
  for (const [key, type] of keysTypes) {
    const el = $("f_" + key); if (!el) continue;
    el.oninput = el.onchange = () => {
      const o = sel.o;
      if (type === "check") o[key] = el.checked;
      else if (type === "number") o[key] = parseFloat(el.value) || 0;
      else o[key] = el.value;
      if (sel.k === "props" && key === "kind") { const k = PROP_KINDS[o.kind]; o.w = k.w; o.h = k.h; o.tall = k.tall; saveMap(); renderPanel(); return; }
      if (sel.k === "guards" && key === "mode") { saveMap(); renderPanel(); return; }
      saveMap();
    };
  }
}
export function renderPanel() {
  const p = $("panel");
  if (!editing()) { p.classList.add("hidden"); return; }
  p.classList.remove("hidden");
  let h = "";
  const toolHelp = {
    select:"Click to select, drag to move. Delete removes. Right-drag pans, wheel zooms. Hold Alt to place freely without snapping.",
    wall:"Click points to draw a chain of walls. Points snap to the half-grid and to existing wall ends. Right-click or Esc ends the chain.",
    door:"Click both ends of a door. Doors open with E. Link a lever to make it lever-only (an iron gate).",
    floor:"Drag to paint floor squares. Shadow floor makes anyone standing on it much harder to see.",
    light:"Click to place a torch or brazier. Players put them out with E; click one during play to relight it. Guards see further in light.",
    lever:"Click to place a lever, then use Link lever to connect doors, chests or lights to it.",
    link:"Click a lever, then click doors, chests or lights to link or unlink them. A linked thing flips when ALL its levers are on.",
    prop:"Click to place. Tall props (crates, shelves, pillars) block sight, so players can hide behind them. Chests hold loot; a match table lets players relight torches.",
    guard:"Click to place a guard, then set patrol points, sight and Passive Perception in the panel.",
    token:"Click to place an NPC or marker token. You can drag it during play.",
    spawn:"Click to place a player spawn, or a cell where caught players get sent.",
    erase:"Click anything to delete it."
  };
  h += `<h3>${TOOLS.find(t => t[0] === tool)[1]}</h3><div class="hint">${toolHelp[tool]}</div>`;
  if (tool === "floor") h += `<label>Floor style</label><select id="optFloor">${["none", ...Object.keys(FLOOR_STYLES)].map(k => `<option ${k === floorStyle ? "selected" : ""}>${k}</option>`).join("")}</select>`;
  if (tool === "prop") h += `<label>Prop</label><select id="optProp">${Object.entries(PROP_KINDS).map(([k, v]) => `<option value="${k}" ${k === propKind ? "selected" : ""}>${v.label}</option>`).join("")}</select>`;
  if (tool === "light") h += `<label>Source</label><select id="optLight">${Object.entries(LIGHT_KINDS).map(([k, v]) => `<option value="${k}" ${k === newLight ? "selected" : ""}>${v.label}</option>`).join("")}</select>`;
  if (tool === "spawn") h += `<label>Kind</label><select id="optSpawn"><option value="spawn" ${spawnKind === "spawn" ? "selected" : ""}>Player spawn</option><option value="cell" ${spawnKind === "cell" ? "selected" : ""}>Cell (caught players go here)</option></select>`;
  h += `<hr><label>Map title</label><input id="mTitle" value="${esc(M.title)}">`;
  h += `<label>Darkness: <span id="mDarkV">${Math.round(M.dark * 100)}%</span></label><input id="mDark" type="range" min="0" max="1" step="0.05" value="${M.dark}">`;
  h += `<label class="chk"><input type="checkbox" id="mGrid" ${M.grid ? "checked" : ""}> Show grid</label>`;
  h += `<div class="hint">Map ${M.w} × ${M.h} squares · ${M.walls.length} walls · ${M.doors.length} doors · ${M.guards.length} guards</div>`;

  if (sel) {
    const o = sel.o, k = sel.k;
    h += `<hr>`;
    const names = {walls:"Wall", doors:"Door", lights:"Light", levers:"Lever", props:"Prop", guards:"Guard", tokens:"Token", spawns:"Spawn"};
    h += `<h3>${names[k]}</h3>`;
    const binds = [];
    if (k === "doors") { h += field("Name", "name", "text") + field("Starts open", "open", "check"); binds.push(["name","text"],["open","check"]); derive(); if (isLinked(o.id)) h += `<div class="hint">Lever-controlled (iron gate).</div>`; }
    if (k === "lights") { o.kind = lightKind(o); h += field("Source", "kind", "select", Object.entries(LIGHT_KINDS).map(([kk, v]) => [kk, v.label])); binds.push(["kind","select"]); h += `<div class="row"><div>${field("Radius", "r", "number", 'step="0.5" min="0.5"')}</div><div>${field("Color", "color", "color")}</div></div>` + field("Starts on", "on", "check"); binds.push(["r","number"],["color","text"],["on","check"]); }
    if (k === "levers") { h += field("Name", "name", "text"); binds.push(["name","text"]); h += `<div class="hint">Linked to ${o.targets.length} thing(s).</div><div class="btns"><button id="bLink">Link things to this lever</button></div>`; }
    if (k === "props") {
      h += field("Kind", "kind", "select", Object.entries(PROP_KINDS).map(([kk, v]) => [kk, v.label]));
      h += `<div class="row"><div>${field("Width", "w", "number", 'step="0.25" min="0.25"')}</div><div>${field("Height", "h", "number", 'step="0.25" min="0.25"')}</div></div>`;
      h += field("Tall: blocks sight (cover)", "tall", "check");
      binds.push(["kind","select"],["w","number"],["h","number"],["tall","check"]);
      if (o.kind === "chest") { h += field("Loot (shown to whoever opens it)", "loot", "area") + field("Locked", "locked", "check"); binds.push(["loot","text"],["locked","check"]); }
      h += `<div class="btns"><button class="ghost" id="bRot">Rotate 90°</button></div>`;
    }
    if (k === "guards") {
      h += `<div class="row"><div>${field("Name", "name", "text")}</div><div>${field("Passive Perc.", "pp", "number")}</div></div>`;
      h += `<div class="row"><div>${field("Sight (squares)", "sight", "number", 'step="0.5"')}</div><div>${field("Field of view°", "fov", "number")}</div></div>`;
      h += field("Behaviour", "mode", "select", [["patrol","Patrol a path"],["survey","Survey (sweep an area)"],["stand","Stand watch"]]);
      binds.push(["name","text"],["pp","number"],["sight","number"],["fov","number"],["mode","select"]);
      if (o.mode === "patrol") {
        h += field("Walk speed (squares/s)", "speed", "number", 'step="0.1"'); binds.push(["speed","number"]);
        h += `<div class="hint">${o.path.length} patrol point(s). The guard loops through them.</div><div class="btns"><button id="bPath" class="${pathEdit ? "on" : ""}">${pathEdit ? "Done editing path" : "Edit patrol path"}</button><button class="ghost" id="bClear">Clear path</button></div>`;
      } else {
        h += `<div class="row"><div>${field("Facing° (0 = east)", "face", "number")}</div><div>${o.mode === "survey" ? field("Sweep°", "sweep", "number") : ""}</div></div>`;
        binds.push(["face","number"],["sweep","number"]);
        h += `<div class="hint">He stands at his post. Drag him to move the post.</div>`;
      }
    }
    if (k === "tokens") { h += `<div class="row"><div>${field("Name", "name", "text")}</div><div>${field("Color", "color", "color")}</div></div>`; binds.push(["name","text"],["color","text"]); }
    if (k === "spawns") { h += field("Kind", "kind", "select", [["spawn","Player spawn"],["cell","Cell"]]); binds.push(["kind","select"]); }
    h += `<div class="btns"><button class="ghost" id="bDel">Delete</button></div>`;
    p.innerHTML = h;
    bindFields(binds);
    if ($("bDel")) $("bDel").onclick = () => deleteObj(sel);
    if ($("bRot")) $("bRot").onclick = () => { const t = o.w; o.w = o.h; o.h = t; saveMap(); renderPanel(); };
    if ($("bLink")) $("bLink").onclick = () => { tool = "link"; linkLever = o.id; renderTools(); renderPanel(); updateGmHint(); };
    if ($("bPath")) $("bPath").onclick = () => { pathEdit = !pathEdit; renderPanel(); updateGmHint(); };
    if ($("bClear")) $("bClear").onclick = () => { o.path = []; saveMap(); renderPanel(); };
  } else p.innerHTML = h;
  if ($("optFloor")) $("optFloor").onchange = e => floorStyle = e.target.value;
  if ($("optProp")) $("optProp").onchange = e => propKind = e.target.value;
  if ($("optLight")) $("optLight").onchange = e => newLight = e.target.value;
  if ($("optSpawn")) $("optSpawn").onchange = e => spawnKind = e.target.value;
  $("mTitle").oninput = e => { M.title = e.target.value; saveMap(); };
  $("mDark").oninput = e => { M.dark = parseFloat(e.target.value); $("mDarkV").textContent = Math.round(M.dark * 100) + "%"; saveMap(); };
  $("mGrid").onchange = e => { M.grid = e.target.checked; saveMap(); };
}
export function deleteObj(s) {
  if (!s) return;
  const arr = M[s.k], i = arr.indexOf(s.o); if (i >= 0) arr.splice(i, 1);
  for (const l of M.levers) l.targets = l.targets.filter(t => t !== s.o.id);
  if (sel && sel.o === s.o) sel = null;
  pathEdit = false;
  saveMap(); renderPanel(); updateGmHint();
}
export function hitEdit(x, y) {
  if (sel && sel.k === "guards") { const i = sel.o.path.findIndex(p => Math.hypot(p[0] - x, p[1] - y) < .3); if (i >= 0) return {k:"waypoint", o:sel.o, i}; }
  const pts = [["guards", .45], ["tokens", .45], ["levers", .4], ["lights", .35], ["spawns", .4]];
  for (const [k, r] of pts) for (const o of M[k]) if (Math.hypot(o.x - x, o.y - y) < r) return {k, o};
  for (const o of M.props.slice().reverse()) { const rr = propRect(o); if (x >= rr[0] && x <= rr[2] && y >= rr[1] && y <= rr[3]) return {k:"props", o}; }
  for (const o of M.doors) if (distToSeg(x, y, o.a[0], o.a[1], o.b[0], o.b[1]) < .25) return {k:"doors", o};
  for (const o of M.walls) if (distToSeg(x, y, o.a[0], o.a[1], o.b[0], o.b[1]) < .2) return {k:"walls", o};
  return null;
}
export function snapPt(w, e, step) {
  if (e && e.altKey) return [+w.x.toFixed(2), +w.y.toFixed(2)];
  // snap to existing wall/door ends first
  for (const o of M.walls.concat(M.doors)) for (const p of [o.a, o.b]) if (Math.hypot(p[0] - w.x, p[1] - w.y) < .25) return [p[0], p[1]];
  return [snap(w.x, step || .5), snap(w.y, step || .5)];
}
export function editDown(w, e) {
  const s = snapPt(w, e), c = e.altKey ? [w.x, w.y] : [Math.floor(w.x) + .5, Math.floor(w.y) + .5], centre = e.altKey ? [w.x, w.y] : [snap(w.x, .25), snap(w.y, .25)];
  if (pathEdit && sel && sel.k === "guards") {
    const h = hitEdit(w.x, w.y);
    if (h && h.k === "waypoint") { dragInfo = {type:"waypoint", h}; return; }
    sel.o.path.push(centre); saveMap(); renderPanel(); return;
  }
  switch (tool) {
    case "select": {
      const h = hitEdit(w.x, w.y);
      if (!h) { sel = null; renderPanel(); ptr.pan = true; return; }
      if (h.k !== "waypoint") { sel = h; renderPanel(); }
      dragInfo = {type:"move", h, ox:w.x, oy:w.y};
      return;
    }
    case "wall":
      if (wallChain) { if (wallChain[0] !== s[0] || wallChain[1] !== s[1]) M.walls.push({id:uid(), a:wallChain, b:s}); saveMap(); }
      wallChain = s; updateGmHint(); return;
    case "door":
      if (!doorStart) { doorStart = s; updateGmHint(); return; }
      if (doorStart[0] !== s[0] || doorStart[1] !== s[1]) { const d = {id:uid(), a:doorStart, b:s, open:false, name:"Door"}; M.doors.push(d); sel = {k:"doors", o:d}; saveMap(); renderPanel(); }
      doorStart = null; updateGmHint(); return;
    case "floor": paintFloor(w); dragInfo = {type:"paint"}; return;
    case "light": { const o = {id:uid(), kind:newLight, x:centre[0], y:centre[1], r:5, color:"#ffcf8a", on:true}; M.lights.push(o); sel = {k:"lights", o}; saveMap(); renderPanel(); return; }
    case "lever": { const o = {id:uid(), x:centre[0], y:centre[1], name:"Lever", targets:[]}; M.levers.push(o); sel = {k:"levers", o}; saveMap(); renderPanel(); return; }
    case "link": {
      const h = hitEdit(w.x, w.y);
      if (h && h.k === "levers") { linkLever = h.o.id; sel = h; renderPanel(); updateGmHint(); return; }
      if (!linkLever || !h) return;
      const lever = M.levers.find(l => l.id === linkLever);
      const ok = h.k === "doors" || h.k === "lights" || (h.k === "props" && h.o.kind === "chest");
      if (!ok) { addFloat(w.x, w.y - .4, "Only doors, chests and lights can be linked", "#a89a87"); return; }
      const i = lever.targets.indexOf(h.o.id);
      if (i >= 0) lever.targets.splice(i, 1); else lever.targets.push(h.o.id);
      addFloat(w.x, w.y - .4, i >= 0 ? "Unlinked" : "Linked", "#e0a243");
      saveMap(); return;
    }
    case "prop": {
      const k = PROP_KINDS[propKind];
      const o = {id:uid(), kind:propKind, x:centre[0], y:centre[1], w:k.w, h:k.h, tall:k.tall, loot:"", locked:false};
      M.props.push(o); sel = {k:"props", o}; saveMap(); renderPanel(); return;
    }
    case "guard": {
      const o = {id:uid(), name:"Guard " + (M.guards.length + 1), pp:12, sight:6, speed:1.6, fov:70, mode:"patrol", x:c[0], y:c[1], face:0, sweep:90, path:[[c[0], c[1]]]};
      M.guards.push(o); sel = {k:"guards", o}; pathEdit = true; saveMap(); renderPanel(); updateGmHint(); return;
    }
    case "token": { const o = {id:uid(), name:"NPC", color:"#d9d5cc", x:c[0], y:c[1]}; M.tokens.push(o); sel = {k:"tokens", o}; saveMap(); renderPanel(); return; }
    case "spawn": { const o = {id:uid(), x:c[0], y:c[1], kind:spawnKind}; M.spawns.push(o); sel = {k:"spawns", o}; saveMap(); renderPanel(); return; }
    case "erase": { const h = hitEdit(w.x, w.y); if (h && h.k !== "waypoint") deleteObj(h); dragInfo = {type:"erase"}; return; }
  }
}
export function paintFloor(w) {
  const x = Math.floor(w.x), y = Math.floor(w.y); if (x < 0 || y < 0 || x >= M.w || y >= M.h) return;
  const k = x + "_" + y;
  if (floorStyle === "none") { if (M.floors[k]) { delete M.floors[k]; saveMap(); } }
  else if (M.floors[k] !== floorStyle) { M.floors[k] = floorStyle; saveMap(); }
}
export function editMove(w, e) {
  if (!dragInfo) return;
  if (dragInfo.type === "paint") { paintFloor(w); return; }
  if (dragInfo.type === "erase") { const h = hitEdit(w.x, w.y); if (h && h.k !== "waypoint") deleteObj(h); return; }
  if (dragInfo.type === "waypoint") { const h = dragInfo.h; h.o.path[h.i] = e.altKey ? [w.x, w.y] : [snap(w.x, .25), snap(w.y, .25)]; return; }
  if (dragInfo.type === "move" && ptr.moved) {
    const h = dragInfo.h, o = h.o;
    if (h.k === "waypoint") { o.path[h.i] = e.altKey ? [w.x, w.y] : [snap(w.x, .25), snap(w.y, .25)]; return; }
    let dx = w.x - dragInfo.ox, dy = w.y - dragInfo.oy;
    if (h.k === "walls" || h.k === "doors") {
      if (!e.altKey) { dx = snap(dx, .5); dy = snap(dy, .5); }
      if (!dx && !dy) return;
      o.a = [o.a[0] + dx, o.a[1] + dy]; o.b = [o.b[0] + dx, o.b[1] + dy];
    } else {
      if (!e.altKey) { const nx = snap(o.x + dx, .25), ny = snap(o.y + dy, .25); dx = nx - o.x; dy = ny - o.y; }
      if (!dx && !dy) return;
      o.x += dx; o.y += dy;
      if (h.k === "guards" && o.mode === "patrol" && o.path.length === 1) o.path[0] = [o.x, o.y];
    }
    dragInfo.ox += dx; dragInfo.oy += dy;
  }
}
export function editUp(w, p) {
  if (dragInfo && (dragInfo.type === "move" || dragInfo.type === "waypoint") && p.moved) saveMap();
  dragInfo = null;
}

/* ---------- import / export ---------- */
export function pickFile(accept, cb) {
  const f = $("fileIn"); f.value = ""; f.accept = accept;
  f.onchange = () => { const file = f.files[0]; if (file) cb(file); };
  f.click();
}
export function compressImage(src, maxSide) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => {
      const s = Math.min(1, maxSide / Math.max(im.width, im.height));
      const c = document.createElement("canvas"); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      res({data:c.toDataURL("image/jpeg", 0.82), w:im.width, h:im.height});
    };
    im.onerror = rej; im.src = src;
  });
}
export function argbToHex(s) { if (!s || s.length < 6) return "#ffcf8a"; const h = s.length === 8 ? s.slice(2) : s.slice(0, 6); return "#" + h; }
export async function importDd2vtt(file) {
  let j;
  try { j = JSON.parse(await file.text()); } catch (e) { return alert("That file isn't valid dd2vtt JSON."); }
  const res = j.resolution || {}, o = res.map_origin || {x:0, y:0}, size = res.map_size || {x:20, y:15};
  const m = blankMap(Math.ceil(size.x), Math.ceil(size.y));
  m.title = file.name.replace(/\.[^.]+$/, "");
  const P = p => [+(p.x - o.x).toFixed(3), +(p.y - o.y).toFixed(3)];
  for (const line of (j.line_of_sight || []).concat(j.objects_line_of_sight || [])) {
    for (let i = 0; i < line.length - 1; i++) m.walls.push({id:uid(), a:P(line[i]), b:P(line[i + 1])});
  }
  for (const p of j.portals || []) {
    if (!p.bounds || p.bounds.length < 2) continue;
    m.doors.push({id:uid(), a:P(p.bounds[0]), b:P(p.bounds[1]), open:!p.closed, name:p.freestanding ? "Door" : "Door"});
  }
  for (const l of j.lights || []) m.lights.push({id:uid(), x:P(l.position)[0], y:P(l.position)[1], r:Math.max(1, l.range || 4), color:argbToHex(l.color), on:true});
  m.dark = j.environment && j.environment.baked_lighting ? 0.35 : 0.55;
  m.grid = false;
  setM(m); sel = null;
  if (j.image) {
    try {
      const out = await compressImage("data:image/png;base64," + j.image, 4096);
      setBg(null); loadBg(out.data); Net.img(out.data);
    } catch (e) { alert("Walls imported, but the map image couldn't be read."); }
  } else { Net.img(null); setBg(null); }
  saveMap(true); fitCamera(); renderPanel();
  addFloat(M.w / 2, M.h / 2, `Imported ${m.walls.length} walls, ${m.doors.length} doors, ${m.lights.length} lights`, "#3fb899");
}
export async function importBgImage(file) {
  const ppg = parseFloat(prompt("Pixels per grid square in this image?", "70")); if (!(ppg > 0)) return;
  const url = URL.createObjectURL(file);
  try {
    const out = await compressImage(url, 4096);
    M.w = Math.max(1, Math.round(out.w / ppg)); M.h = Math.max(1, Math.round(out.h / ppg));
    loadBg(out.data); Net.img(out.data); saveMap(true); fitCamera(); renderPanel();
  } catch (e) { alert("Couldn't read that image."); }
}
export function exportMap() {
  const blob = new Blob([JSON.stringify({stealthMap:1, map:M, img:bgImg ? bgImg.src : null})], {type:"application/json"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = (M.title || "map").replace(/[^\w-]+/g, "_") + ".stealth.json"; a.click();
}
export async function importMapFile(file) {
  let j; try { j = JSON.parse(await file.text()); } catch (e) { return alert("Not a valid map file."); }
  if (j.resolution && (j.line_of_sight || j.image)) return importDd2vtt(file);
  if (!j.map) return alert("Not a stealth map file.");
  setM(normalizeMap(j.map)); sel = null; loadBg(j.img); Net.img(j.img || null); saveMap(true); fitCamera(); renderPanel();
}

/* ---------- edit mode toggle ---------- */
export function toggleEdit() {
  if (!isGM) return;
  const on = !L.edit;
  Net.live("edit", on); Net.live("paused", true); Net.live("spotted", null);
  if (on) { fitCamera(); setFollow(false); openTray(false); }
  else { cancelTool(); sel = null; buildGuards(false); setFollow(true); }
}
