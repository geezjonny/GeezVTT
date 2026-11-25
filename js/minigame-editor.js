// GM-only map building for the minigame, modelled on index.html's editor: Build Controls (layers, tools, snap, grid),
// Scene Controls (new / import / save / undo / redo) and one options window per layer, all floating and draggable.
// Edits the dd2vtt JSON in place; per-object data that dd2vtt has no field for lives in parallel arrays in raw.geezvtt_editor.
import { MATERIALS, MATERIAL_LAYERS, cutDoorOpening, bucketCells, floorBrushCells } from './map-editor-model.js';
import { materialCanvas } from './material-textures.js';
import { showMapMenu } from './map-object-menu.js';
import { isGM } from './session-role.js';
import { tokenCatalog } from './minigame-tokens.js';
import { makeWindow, iconButton } from './minigame-ui.js';

const FIELDS = ['line_of_sight', 'portals', 'lights', 'geezvtt_editor'];
const LAYERS = [['walls', 'Walls'], ['floors', 'Floors'], ['doors', 'Doors'], ['lights', 'Lights'], ['levers', 'Levers'], ['tokens', 'Tokens']];
const TOOLS = [['select', 'Select', 'V'], ['erase', 'Erase', 'E'], ['paint', 'Paint', 'P'], ['fill', 'Paint bucket', 'B'], ['connect', 'Connect a lever to a door', 'C']];
const LIGHT_PRESETS = { Torch: ['#ffb45c', 5, 1], Lantern: ['#ffe6bf', 7, .9], Candle: ['#ffd27a', 2.5, .8], Moonlight: ['#a9c4ff', 10, .5] };
const mat = (layer, m) => MATERIAL_LAYERS[layer].includes(m) ? m : MATERIAL_LAYERS[layer][0];
const segDist = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const setAt = (arr, i, v) => { while (arr.length < i) arr.push(null); arr[i] = v; };
const same = (a, b) => a.layer === b.layer && a.i === b.i;

// Fold object polygons into line_of_sight so wall indices (and their materials) stay aligned as walls are added.
export function normalizeMap(raw) {
  raw.line_of_sight = [...(raw.line_of_sight || []), ...(raw.objects_line_of_sight || [])]; raw.objects_line_of_sight = [];
  raw.portals ||= []; raw.lights ||= [];
  const ed = raw.geezvtt_editor ||= {};
  ed.floors ||= []; ed.levers ||= []; ed.tokens ||= []; ed.wallMaterials ||= []; ed.doorMaterials ||= []; ed.wallHidden ||= []; ed.objectColors ||= {};
  for (const k of ['floors', 'walls', 'doors', 'lights']) ed.objectColors[k] ||= [];
  return raw;
}
export const blankMap = (w = 24, h = 18) => normalizeMap({ format: 0.3, resolution: { map_size: { x: w, y: h }, pixels_per_grid: 70 }, line_of_sight: [], portals: [], lights: [] });

// api: { canvas, cam, view, status, getMap, setRaw(raw), changed(), fit(), importFile() }
export function mountEditor(api) {
  const none = { active: () => false, contextMenu: () => false, drawOverlay() {} };
  if (!isGM) return none; // players never get editing controls
  const { canvas, view } = api;
  const st = { layer: null, mode: 'paint', mat: { walls: 'stone', floors: 'stone', doors: 'wood' }, pend: null, lever: null, cursor: null, hover: null,
    undo: [], redo: [], painting: false, sel: [], drag: null, box: null, snap: true, last: null };
  const opt = {}, wins = {}, layerBtn = new Map(), toolBtn = new Map();
  const mk = (tag, props) => Object.assign(document.createElement(tag), props);
  const field = (label, el) => { const l = mk('label'); l.append(label, el); return l; };
  const input = (type, attrs) => mk('input', { type, ...attrs });
  const map = () => api.getMap();
  const hint = text => { document.getElementById('hint').textContent = text || ''; };

  // Per-object data kept in parallel arrays, by layer. replaceAt(layer, i, n) swaps entry i for n copies (0 deletes, 2 splits).
  const parallel = (ed, layer) => ({ walls: [ed.wallMaterials, ed.wallHidden, ed.objectColors.walls], doors: [ed.doorMaterials, ed.objectColors.doors], lights: [ed.objectColors.lights], floors: [ed.objectColors.floors] }[layer] || []);
  function replaceAt(layer, i, n) {
    const ed = map().raw.geezvtt_editor;
    for (const arr of parallel(ed, layer)) { while (arr.length <= i) arr.push(null); arr.splice(i, 1, ...Array(n).fill(arr[i])); }
  }
  const list = (raw, layer) => ({ walls: raw.line_of_sight, doors: raw.portals, lights: raw.lights, floors: raw.geezvtt_editor.floors, levers: raw.geezvtt_editor.levers, tokens: raw.geezvtt_editor.tokens }[layer]);

  // ---------- windows ----------
  const build = makeWindow({ id: 'build', title: 'Build Controls', left: 12, top: 52, width: 188 });
  build.show();
  const label = (text) => build.body.append(mk('div', { className: 'group-label', textContent: text }));
  label('Build');
  const layerBox = mk('div', { className: 'icons' }); build.body.append(layerBox);
  for (const [layer, name] of LAYERS) {
    const b = iconButton(layer, `${name} (${LAYERS.findIndex(l => l[0] === layer) + 1})`, () => select(st.layer === layer ? null : layer));
    b.setAttribute('aria-pressed', 'false'); layerBtn.set(layer, b); layerBox.append(b);
  }
  label('Tool');
  const toolBox = mk('div', { className: 'icons tools' }); build.body.append(toolBox);
  for (const [t, name, key] of TOOLS) {
    const b = iconButton(t === 'fill' ? 'bucket' : t, `${name} (${key})`, () => setTool(t)); toolBtn.set(t, b); toolBox.append(b);
  }
  label('View');
  const viewBox = mk('div', { className: 'icons tools' }); build.body.append(viewBox);
  const snapBtn = iconButton('snap', 'Snap to grid. Walls and doors snap to grid points; hold Shift for half-cell points', () => { st.snap = !st.snap; snapBtn.setAttribute('aria-pressed', st.snap); });
  const gridBtn = iconButton('grid', 'Toggle grid (G)', () => toggleGrid());
  snapBtn.setAttribute('aria-pressed', 'true'); gridBtn.setAttribute('aria-pressed', 'true');
  viewBox.append(snapBtn, gridBtn, iconButton('fit', 'Fit map to window (Home)', () => api.fit()));
  const toggleGrid = () => { view.grid = !view.grid; gridBtn.setAttribute('aria-pressed', view.grid); };

  const scene = makeWindow({ id: 'scene', title: 'Scene Controls', left: 12, top: 330, width: 188 });
  scene.show();
  const sceneBox = mk('div', { className: 'icons tools' }); scene.body.append(sceneBox);
  const undoBtn = iconButton('undo', 'Undo (Ctrl+Z)', () => undo()), redoBtn = iconButton('redo', 'Redo (Ctrl+Y)', () => redo());
  sceneBox.append(
    iconButton('blank', 'New blank map', () => { st.undo = []; st.redo = []; st.sel = []; api.setRaw(blankMap()); api.status.textContent = 'New blank map.'; }),
    iconButton('import', 'Import a .geezmg, .dd2vtt or .geezvtt map', () => api.importFile()),
    iconButton('save', 'Save map as .geezmg', saveMap), undoBtn, redoBtn);

  const swatches = (layer, body) => {
    const box = mk('div', { className: 'swatches' });
    for (const m of MATERIAL_LAYERS[layer]) {
      const b = mk('button', { type: 'button', title: m }); b.setAttribute('aria-label', m);
      const c = mk('canvas', { width: 48, height: 34 }); c.getContext('2d').drawImage(materialCanvas(m), 0, 0, 48, 34); b.append(c);
      b.onclick = () => { // also re-materials the selected objects, like index.html's swatch windows
        st.mat[layer] = m; [...box.children].forEach(x => x.setAttribute('aria-pressed', x === b));
        if (st.layer === layer && st.sel.length) { snapshot(); for (const s of st.sel) applyMaterial(layer, s.i, m); api.changed(); }
      };
      b.setAttribute('aria-pressed', m === st.mat[layer]); box.append(b);
    }
    body.append(box);
  };
  function applyMaterial(layer, i, m) {
    const ed = map().raw.geezvtt_editor;
    if (layer === 'floors') ed.floors[i].material = m; else setAt(layer === 'walls' ? ed.wallMaterials : ed.doorMaterials, i, m);
  }
  const layerWindow = (layer, title, fill) => {
    const w = makeWindow({ id: layer, title, left: 212, top: 52, width: 210, onClose: () => select(null) });
    fill(w.body); wins[layer] = w;
  };
  layerWindow('walls', 'Walls', b => { swatches('walls', b); b.append(mk('p', { textContent: 'Pick a material to paint with, or select walls and pick one to change them.' })); });
  layerWindow('floors', 'Floors', b => {
    swatches('floors', b);
    b.append(mk('p', { textContent: 'Click or drag to paint tiles. Use the paint bucket to fill a walled-in room.' }));
  });
  layerWindow('doors', 'Doors', b => {
    swatches('doors', b);
    opt.type = mk('select', { innerHTML: '<option value="door">Door</option><option value="window">Window</option>' });
    opt.pane = mk('select', { innerHTML: '<option value="glass">Glass</option><option value="open">Opening</option>' });
    opt.state = mk('select', { innerHTML: '<option value="closed">Closed</option><option value="open">Open</option>' });
    opt.locked = input('checkbox');
    for (const el of [opt.type, opt.pane, opt.state, opt.locked]) el.onchange = () => { applyToSelection(); opt.pane.parentElement.hidden = opt.type.value !== 'window'; };
    b.append(field('Type ', opt.type), field('Pane ', opt.pane), field('State ', opt.state), field('Locked ', opt.locked));
    opt.pane.parentElement.hidden = true;
  });
  layerWindow('lights', 'Lights', b => {
    opt.color = input('color', { value: '#ffe6bf' }); opt.range = input('number', { min: .25, max: 100, step: .25, value: 5 }); opt.intensity = input('number', { min: 0, max: 1, step: .1, value: 1 });
    for (const el of [opt.color, opt.range, opt.intensity]) el.onchange = () => applyToSelection();
    const presets = mk('div', { className: 'icons' }); presets.style.gridTemplateColumns = '1fr 1fr';
    for (const [name, [c, r, i]] of Object.entries(LIGHT_PRESETS)) {
      const p = mk('button', { type: 'button', textContent: name }); p.style.aspectRatio = 'auto';
      p.onclick = () => { opt.color.value = c; opt.range.value = r; opt.intensity.value = i; applyToSelection(); };
      presets.append(p);
    }
    b.append(presets, field('Color ', opt.color), field('Range ', opt.range), field('Intensity ', opt.intensity));
  });
  layerWindow('levers', 'Levers', b => b.append(mk('p', { textContent: 'Click to place a lever, then click a door or window to link it. Players pull it with Space.' })));

  layerWindow('tokens', 'Tokens', b => {
    opt.tKind = mk('select', { innerHTML: '<option value="pc">PC</option><option value="npc">NPC</option><option value="token">Token (picture)</option>' });
    opt.tName = mk('select'); opt.tSize = mk('select', { innerHTML: [.5, 1, 2, 3, 4].map(n => `<option value="${n}"${n === 1 ? ' selected' : ''}>${n} cell${n === 1 ? '' : 's'}</option>`).join('') });
    const note = mk('p', { textContent: 'Loading characters…' });
    let cat = null;
    const fillNames = (keep) => { // names for the chosen source; pictures are listed by file name
      const k = opt.tKind.value, items = !cat ? [] : k === 'token' ? cat.images.map(f => ({ name: f.replace(/\.[^.]+$/, ''), file: f, size: 1 })) : cat[k];
      opt.tName.replaceChildren(...items.map(it => Object.assign(new Option(it.name, it.file || it.name), { _it: it })));
      if (keep && [...opt.tName.options].some(o => o.value === keep)) opt.tName.value = keep;
      const it = opt.tName.selectedOptions[0]?._it; if (it) opt.tSize.value = String(it.size);
      note.textContent = !cat ? 'Loading characters…' : items.length ? 'Click the map to place. Select a token to change it here, or right-click for Hide/Delete.' : `No ${k === 'token' ? 'pictures in token/' : k.toUpperCase() + 's'} found.`;
    };
    opt.tKind.onchange = () => { fillNames(); applyToSelection(); };
    opt.tName.onchange = () => { const it = opt.tName.selectedOptions[0]?._it; if (it) opt.tSize.value = String(it.size); applyToSelection(); };
    opt.tSize.onchange = () => applyToSelection();
    tokenCatalog().then(c => { cat = c; fillNames(); }).catch(e => { note.textContent = `Characters unavailable: ${e.message}`; });
    opt.tFill = fillNames;
    b.append(field('Type ', opt.tKind), field('Name ', opt.tName), field('Size ', opt.tSize), note);
  });
  const tokenFromOptions = p => {
    const k = opt.tKind.value, it = opt.tName.selectedOptions[0]?._it;
    return { x: p.x, y: p.y, kind: k, name: it?.name || opt.tName.value, ...(k === 'token' ? { image: it?.file || opt.tName.value } : {}), size: +opt.tSize.value || 1 };
  };

  // Edits the selected lights/doors from the option fields; with nothing selected the fields just set what Paint places.
  function applyToSelection() {
    if (!st.sel.length) return;
    const { raw } = map(); snapshot();
    for (const { layer, i } of st.sel) {
      const o = list(raw, layer)[i];
      if (layer === 'lights') {
        o.range = +opt.range.value || o.range; o.color = lightColor();
      } else if (layer === 'tokens') {
        if (opt.tName.value) { const n = tokenFromOptions(o); delete o.image; Object.assign(o, { kind: n.kind, name: n.name, size: n.size }, n.image ? { image: n.image } : {}); }
      } else if (layer === 'doors') {
        const win = opt.type.value === 'window';
        Object.assign(o, { geezvtt_type: win ? 'window' : 'door', geezvtt_pane: opt.pane.value, closed: !win && opt.state.value === 'closed', geezvtt_locked: !win && opt.locked.checked });
      }
    }
    api.changed();
  }
  const lightColor = () => Math.round(Math.min(1, +opt.intensity.value || 0) * 255).toString(16).padStart(2, '0') + opt.color.value.slice(1);
  function syncOptions() { // show the single selected light/door's values in its window
    const { raw } = map(); if (!raw || st.sel.length !== 1) return;
    const { layer, i } = st.sel[0], o = list(raw, layer)[i]; if (!o) return;
    if (layer === 'lights') { opt.color.value = '#' + String(o.color).slice(-6); opt.range.value = o.range; opt.intensity.value = (parseInt(String(o.color).slice(0, 2), 16) / 255 || 1).toFixed(1); }
    if (layer === 'tokens') { opt.tKind.value = o.kind || 'token'; opt.tFill(o.kind === 'token' ? o.image : o.name); opt.tSize.value = String(o.size || 1); }
    if (layer === 'doors') { opt.type.value =o.geezvtt_type === 'window' ? 'window' : 'door'; opt.pane.value = o.geezvtt_pane === 'open' ? 'open' : 'glass'; opt.state.value = o.closed ? 'closed' : 'open'; opt.locked.checked = !!o.geezvtt_locked; opt.pane.parentElement.hidden = opt.type.value !== 'window'; }
  }

  // ---------- tool / layer state ----------
  function setTool(t) {
    if (t === 'fill' && st.layer !== 'floors') { hint('The paint bucket fills a walled-in room, so it only works on Floors.'); return; }
    st.mode = t; st.pend = null; st.lever = null; st.box = null;
    for (const [k, b] of toolBtn) b.setAttribute('aria-pressed', k === t);
    updateHint();
  }
  function select(layer) {
    st.layer = layer; st.pend = null; st.lever = null; st.sel = []; st.hover = null;
    if (layer === 'walls') explodeWalls();
    for (const [k, w] of Object.entries(wins)) { if (k === layer) w.show(); else w.hide(); }
    for (const [k, b] of layerBtn) b.setAttribute('aria-pressed', k === layer);
    toolBtn.get('fill').disabled = layer !== 'floors';
    if (st.mode === 'fill' && layer !== 'floors') setTool('paint'); else updateHint();
  }
  function updateHint() {
    if (!st.layer) { hint('Choose Walls, Floors, Doors, Lights, Levers or Tokens in Build Controls to start building. Scroll to zoom, right-drag to pan, Home to fit.'); return; }
    const L = st.layer;
    hint({
      select: 'Click to select, Shift-click to add, drag empty space to box-select, drag a selection to move it, Delete to remove. Right-click for more.',
      erase: 'Click an object to remove it.' + (L === 'floors' ? ' Drag to erase several tiles.' : ''),
      fill: 'Click inside a walled-in room to fill it with the chosen floor.',
      connect: st.lever != null ? 'Now click the door or window it controls (click its current door to unlink). Click a different lever to switch, empty space or Esc to cancel.' : 'Click a lever, then click the door or window it controls.',
      paint: L === 'walls' ? (st.pend ? 'Click to add the next wall point. Esc or double-click to finish; Backspace undoes the last wall.' : 'Click to start a wall. Hold Shift to snap to half-cell points.')
        : L === 'doors' ? (st.pend ? 'Click the other end of the doorway. Esc cancels.' : 'Click one end of the doorway, then the other. It cuts the wall.')
        : L === 'floors' ? 'Click or drag to paint floor tiles.' : L === 'lights' ? 'Click to place a light.' : L === 'tokens' ? 'Pick a PC, NPC or picture in the Tokens window, then click the map to place it.' : (st.lever != null ? 'Now click the door or window to link.' : 'Click to place a lever, then click a door or window to link it.')
    }[st.mode]);
  }

  // Dungeondraft polylines become one segment each so every wall is individually selectable, as in index.html.
  function explodeWalls() {
    const { raw } = map(); if (!raw) return;
    const ed = raw.geezvtt_editor, segs = [];
    raw.line_of_sight.forEach((poly, i) => { for (let k = 0; k < poly.length - 1; k++) segs.push({ pts: [poly[k], poly[k + 1]], m: ed.wallMaterials[i] ?? null, h: ed.wallHidden[i] ?? null, c: ed.objectColors.walls[i] ?? null }); });
    if (segs.length === raw.line_of_sight.length) return;
    raw.line_of_sight = segs.map(s => s.pts); ed.wallMaterials = segs.map(s => s.m); ed.wallHidden = segs.map(s => s.h); ed.objectColors.walls = segs.map(s => s.c);
    api.rebuild(); // same walls, just re-indexed: no need to publish
  }

  // ---------- history ----------
  const current = () => { const { raw } = map(); return JSON.stringify(Object.fromEntries(FIELDS.map(k => [k, raw[k]]))); };
  const snapshot = () => { st.undo.push(current()); if (st.undo.length > 100) st.undo.shift(); st.redo = []; };
  function restore(json) { Object.assign(map().raw, JSON.parse(json)); st.pend = null; st.lever = null; st.sel = []; st.hover = null; api.changed(); updateHint(); }
  function undo() { const { raw } = map(), prev = st.undo.pop(); if (!raw || !prev) return; st.redo.push(current()); restore(prev); }
  function redo() { const { raw } = map(), next = st.redo.pop(); if (!raw || !next) return; st.undo.push(current()); restore(next); }
  function saveMap() {
    const { raw } = map(); if (!raw) return;
    const a = mk('a', { href: URL.createObjectURL(new Blob([JSON.stringify(raw)], { type: 'application/json' })), download: 'minigame-map.geezmg' });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- geometry helpers ----------
  const snapPt = (p, layer, e) => layer === 'floors' ? { x: Math.floor(p.x) + .5, y: Math.floor(p.y) + .5 }
    : ['lights', 'levers', 'tokens'].includes(layer) ? { x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2 }
    : !st.snap ? { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }
    : e?.shiftKey ? { x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2 } : { x: Math.round(p.x), y: Math.round(p.y) };
  const world = e => {
    const r = canvas.getBoundingClientRect(), { scale } = map(), c = api.cam;
    return { x: ((e.clientX - r.left) * canvas.width / r.width - c.x) / c.z / scale, y: ((e.clientY - r.top) * canvas.height / r.height - c.y) / c.z / scale };
  };
  const bounds = () => { const { raw } = map(); return raw.resolution.map_size; };
  const inMap = p => { const b = bounds(); return p.x >= 0 && p.y >= 0 && p.x <= b.x && p.y <= b.y; };

  // Finds the object of the active layer under world point p -> { layer, i } or null.
  function find(p, layer = st.layer) {
    if (layer === 'walls') explodeWalls(); // a remote map update can bring polylines back
    const { raw, scale } = map(), items = list(raw, layer);
    const r = Math.min(.3, Math.max(.1, 9 * (window.devicePixelRatio || 1) / (api.cam.z * (scale || 70)))); // ~9 screen px, so zooming out doesn't widen the pick area
    // Nearest object within its pick radius wins (not the first in the list), so a neighbouring wall is never taken by mistake.
    const dist = layer === 'floors' ? f => (Math.abs(f.x - p.x) <= (f.size || 1) / 2 && Math.abs(f.y - p.y) <= (f.size || 1) / 2 ? Math.hypot(f.x - p.x, f.y - p.y) : Infinity)
      : layer === 'lights' ? l => { const d = Math.hypot(l.position.x - p.x, l.position.y - p.y); return d < .5 ? d : Infinity; }
      : layer === 'levers' ? v => { const d = Math.hypot(v.x - p.x, v.y - p.y); return d < .5 ? d : Infinity; }
      : layer === 'tokens' ? t => { const d = Math.hypot(t.x - p.x, t.y - p.y); return d < Math.max(.4, (t.size || 1) * .45) ? d : Infinity; }
      : layer === 'doors' ? d => { const x = segDist(p, d.bounds[0], d.bounds[1]); return x < Math.max(.3, r) ? x : Infinity; }
      : poly => { const x = segDist(p, poly[0], poly[1]); return x < r ? x : Infinity; };
    let idx = -1, best = Infinity;
    items.forEach((o, k) => { const d = dist(o); if (d < best) { best = d; idx = k; } });
    return idx < 0 ? null : { layer, i: idx };
  }
  const centre = (layer, o) => layer === 'walls' ? { x: (o[0].x + o[1].x) / 2, y: (o[0].y + o[1].y) / 2 } : layer === 'doors' || layer === 'lights' ? o.position || o.bounds[0] : o;
  const inBox = (layer, o, a, b) => {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y), inside = q => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1;
    const pts = layer === 'walls' ? [...o, centre(layer, o)] : layer === 'doors' ? [...o.bounds, o.position] : [centre(layer, o)];
    return pts.some(inside);
  };

  // Door openings cut the wall they sit in (as in index.html).
  function cutWalls(a, b) {
    const { raw } = map(), ed = raw.geezvtt_editor;
    const segs = raw.line_of_sight.map((pts, i) => ({ points: pts, m: ed.wallMaterials[i], h: ed.wallHidden[i], c: ed.objectColors.walls[i] }));
    const cut = cutDoorOpening(segs, [a, b]);
    raw.line_of_sight = cut.map(s => s.points); ed.wallMaterials = cut.map(s => s.m ?? null); ed.wallHidden = cut.map(s => s.h ?? null); ed.objectColors.walls = cut.map(s => s.c ?? null);
  }

  // ---------- operations ----------
  function paint(p) {
    const { raw } = map(), ed = raw.geezvtt_editor, L = st.layer;
    if (!inMap(p)) return false;
    if (L === 'floors') {
      const i = ed.floors.findIndex(f => Math.abs(f.x - p.x) < .01 && Math.abs(f.y - p.y) < .01), m = mat('floors', st.mat.floors);
      if (i >= 0 && ed.floors[i].material === m) return false;
      const f = { x: p.x, y: p.y, size: 1, material: m };
      if (i >= 0) ed.floors[i] = f; else ed.floors.push(f);
      return true;
    }
    if (L === 'levers') {
      if (st.lever != null) { // second click: link the lever just placed to the nearest door
        const di = raw.portals.findIndex(d => segDist(p, d.bounds[0], d.bounds[1]) < .6);
        if (di < 0) { hint('No door there. Click a door or window to link the lever.'); return false; }
        ed.levers[st.lever].door = di; st.lever = null; updateHint(); return true;
      }
      ed.levers.push({ x: p.x, y: p.y, door: null, on: false }); st.lever = ed.levers.length - 1; updateHint(); return true;
    }
    if (L === 'tokens') {
      if (!opt.tName.value) { hint('Pick a character or picture in the Tokens window first.'); return false; }
      ed.tokens.push(tokenFromOptions(p)); return true;
    }
    if (L === 'lights') { raw.lights.push({ position: p, range: +opt.range.value || 5, intensity: 1, color: lightColor(), shadows: true }); return true; }
    if (!st.pend) { st.pend = p; updateHint(); return false; }
    if (st.pend.x === p.x && st.pend.y === p.y) return false;
    const a = st.pend;
    if (L === 'walls') { raw.line_of_sight.push([a, p]); setAt(ed.wallMaterials, raw.line_of_sight.length - 1, mat('walls', st.mat.walls)); st.pend = p; return true; }
    const win = opt.type.value === 'window';
    cutWalls(a, p);
    raw.portals.push({ bounds: [a, p], position: { x: (a.x + p.x) / 2, y: (a.y + p.y) / 2 }, rotation: Math.atan2(p.y - a.y, p.x - a.x), closed: !win && opt.state.value === 'closed', geezvtt_type: win ? 'window' : 'door', geezvtt_pane: opt.pane.value, geezvtt_locked: !win && opt.locked.checked });
    setAt(ed.doorMaterials, raw.portals.length - 1, mat('doors', st.mat.doors)); st.pend = null; updateHint();
    return true;
  }
  function fill(p) { // flood-fill the walled-in room under the cursor with the chosen floor material
    const { raw } = map(), ed = raw.geezvtt_editor, size = raw.resolution.map_size;
    const model = { width: size.x, height: size.y,
      walls: raw.line_of_sight.flatMap(w => w.slice(1).map((b, k) => ({ points: [w[k], b] }))),
      doors: raw.portals.map(d => ({ points: d.bounds, type: d.geezvtt_type, open: !d.closed })) };
    let cells;
    try { cells = bucketCells(model, p, 1); } catch (error) { api.status.textContent = error.message; return false; }
    const m = mat('floors', st.mat.floors); let changed = false;
    for (const c of cells) {
      const i = ed.floors.findIndex(f => Math.abs(f.x - c.x) < .01 && Math.abs(f.y - c.y) < .01);
      if (i >= 0) { if (ed.floors[i].material !== m) { ed.floors[i].material = m; changed = true; } } else { ed.floors.push({ x: c.x, y: c.y, size: 1, material: m }); changed = true; }
    }
    return changed;
  }
  function removeOne({ layer, i }) { // delete one object, keeping parallel arrays and lever links consistent
    const { raw } = map(), ed = raw.geezvtt_editor;
    replaceAt(layer, i, 0); list(raw, layer).splice(i, 1);
    if (layer === 'doors') ed.levers = ed.levers.filter(v => v.door !== i).map(v => (v.door > i ? { ...v, door: v.door - 1 } : v));
    if (layer === 'levers') st.lever = null;
  }
  const removeMany = hits => { for (const h of [...hits].sort((a, b) => b.i - a.i)) removeOne(h); st.sel = []; st.hover = null; };
  function erase(p) {
    const hit = find(p); if (!hit) return false;
    removeMany([hit]); return true;
  }
  function move(hits, dx, dy) {
    const { raw } = map(), sh = pt => { pt.x += dx; pt.y += dy; };
    for (const { layer, i } of hits) {
      const o = list(raw, layer)[i];
      if (layer === 'walls') o.forEach(sh); else if (layer === 'doors') { o.bounds.forEach(sh); sh(o.position); } else if (layer === 'lights') sh(o.position); else sh(o);
    }
  }

  // ---------- pointer input ----------
  const pickSelection = (hit, additive) => {
    if (!hit) { if (!additive) st.sel = []; return; }
    const at = st.sel.findIndex(s => same(s, hit));
    if (additive) { if (at >= 0) st.sel.splice(at, 1); else st.sel.push(hit); } else if (at < 0) st.sel = [hit];
  };
  // Connect tool: pick a lever, then the door/window it operates. Works from any layer.
  function connectClick(w) {
    const { raw } = map(), ed = raw.geezvtt_editor, lev = find(w, 'levers'), door = find(w, 'doors');
    if (lev) { st.lever = st.lever === lev.i ? null : lev.i; st.sel = st.lever == null ? [] : [lev]; updateHint(); return; }
    if (st.lever == null) { hint(door ? 'Click a lever first, then the door.' : 'Click a lever to start a connection.'); return; }
    if (!door) { st.lever = null; st.sel = []; updateHint(); return; }
    const v = ed.levers[st.lever]; if (!v) { st.lever = null; return; }
    snapshot(); v.door = v.door === door.i ? null : door.i; // clicking the linked door again unlinks it
    hint(v.door == null ? 'Lever unlinked.' : (raw.portals[door.i].geezvtt_type === 'window' ? 'Lever linked to the window.' : 'Lever linked to the door.'));
    st.lever = null; st.sel = []; api.changed();
  }
  canvas.addEventListener('mousedown', e => {
    if (e.button !== 0 || !st.layer || !map().raw) return;
    e.preventDefault(); const w = world(e), p = snapPt(w, st.layer, e);
    if (st.mode === 'select') {
      const hit = find(w);
      if (hit && !st.sel.some(s => same(s, hit)) || !hit) pickSelection(hit, e.shiftKey);
      if (hit && st.sel.some(s => same(s, hit))) { snapshot(); st.drag = { from: p, moved: false }; syncOptions(); }
      else if (!hit) st.box = { a: w, b: w, add: e.shiftKey };
      return;
    }
    if (st.mode === 'connect') { connectClick(w); return; }
    snapshot();
    const did = st.mode === 'erase' ? erase(w) : st.mode === 'fill' ? fill(w) : paint(p);
    if (!did) { st.undo.pop(); if (st.pend) st.cursor = p; return; }
    st.painting = st.layer === 'floors' && st.mode !== 'fill'; st.last = p; api.changed();
  });
  addEventListener('mousemove', e => {
    if (!st.layer || !map().raw) return;
    const w = world(e); st.cursor = snapPt(w, st.layer, e);
    if (st.mode === 'select' || st.mode === 'erase') st.hover = find(w);
    else if (st.mode === 'connect') st.hover = find(w, 'levers') || (st.lever != null ? find(w, 'doors') : null);
    canvas.style.cursor = st.mode === 'select' ? (st.hover ? 'move' : 'default') : st.mode === 'erase' || st.mode === 'connect' ? (st.hover ? 'pointer' : 'default') : 'crosshair';
    if (st.drag && e.buttons & 1) {
      const dx = st.cursor.x - st.drag.from.x, dy = st.cursor.y - st.drag.from.y;
      if (dx || dy) { move(st.sel, dx, dy); st.drag.from = st.cursor; st.drag.moved = true; api.changed(); }
    } else if (st.box && e.buttons & 1) { st.box.b = w; }
    else if (st.painting && e.buttons & 1) { // tiles along the drag path, so fast strokes leave no gaps
      const cells = floorBrushCells(st.last || st.cursor, st.cursor); st.last = st.cursor; let changed = false;
      snapshot(); for (const c of cells) changed = (st.mode === 'erase' ? erase(c) : paint(c)) || changed;
      if (changed) api.changed(); else st.undo.pop();
    }
  });
  addEventListener('mouseup', () => {
    if (st.box) {
      const { raw } = map(), { a, b, add } = st.box, hits = [];
      if (raw && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > .1) list(raw, st.layer).forEach((o, i) => { if (inBox(st.layer, o, a, b)) hits.push({ layer: st.layer, i }); });
      st.sel = add ? [...st.sel, ...hits.filter(h => !st.sel.some(s => same(s, h)))] : hits; st.box = null; syncOptions();
    }
    if (st.drag && !st.drag.moved) st.undo.pop();
    st.drag = null; st.painting = false;
  });
  canvas.addEventListener('dblclick', () => { if (st.pend && st.layer === 'walls') { st.pend = null; updateHint(); } });
  addEventListener('keydown', e => {
    if (e.target.closest?.('input,select,textarea')) return;
    const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
    if (k === 'escape') { st.pend = null; st.sel = []; st.box = null; st.lever = null; updateHint(); }
    else if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (ctrl && k === 'y') { e.preventDefault(); redo(); }
    else if (ctrl || e.altKey) return;
    else if (k === 'enter' && st.pend) { st.pend = null; updateHint(); }
    else if (k === 'backspace' && st.pend && st.layer === 'walls') { e.preventDefault(); undo(); st.pend = null; updateHint(); }
    else if ((k === 'delete' || k === 'backspace') && st.sel.length && map().raw) { e.preventDefault(); snapshot(); removeMany(st.sel); api.changed(); }
    else if (k === 'g') toggleGrid();
    else if (/^[1-6]$/.test(k)) select(LAYERS[+k - 1][0]);
    else if (st.layer && TOOLS.some(t => t[2].toLowerCase() === k)) setTool(TOOLS.find(t => t[2].toLowerCase() === k)[0]);
  });

  // Right-click an object of the active layer (no drag): hide / colour / lock / delete, via index.html's popup menu.
  function contextMenu(e) {
    const { raw } = map(); if (!raw) return false;
    const p = world(e); // any object, whatever layer is active: the active layer wins, then doors, lights, levers, walls, floors
    let hit = null;
    for (const layer of [st.layer, 'doors', 'lights', 'levers', 'walls', 'floors']) if (layer && (hit = find(p, layer))) break;
    if (!hit) return false;
    const L = hit.layer, { i } = hit, o = list(raw, L)[i], ed = raw.geezvtt_editor;
    if (!st.sel.some(s => same(s, hit))) st.sel = [hit];
    const targets = st.sel.filter(s => s.layer === L), plural = targets.length > 1 ? ` (${targets.length})` : '';
    const hidden = (h = hit) => { const t = list(raw, L)[h.i]; return L === 'walls' ? ed.wallHidden[h.i] : t.hidden || t.geezvtt_hidden; };
    const flag = (h, v) => { const t = list(raw, L)[h.i]; if (L === 'walls') setAt(ed.wallHidden, h.i, v); else if (L === 'floors') t.hidden = v; else t.geezvtt_hidden = v; };
    const items = [];
    if (L !== 'levers') {
      items.push({ label: (hidden() ? 'Reveal' : 'Hide') + plural, action: () => { snapshot(); const v = !hidden(); targets.forEach(h => flag(h, v)); api.changed(); } });
      if (L !== 'tokens') { // tokens take their colour from their kind or picture
        items.push({ label: 'Edit color...' + plural, action: () => {
          const c = input('color', { value: ed.objectColors[L][i]?.base || '#ffffff' });
          c.onchange = () => { snapshot(); targets.forEach(h => setAt(ed.objectColors[L], h.i, { base: c.value })); api.changed(); }; c.click();
        } }, { label: 'Reset color' + plural, disabled: !targets.some(h => ed.objectColors[L][h.i]), action: () => { snapshot(); targets.forEach(h => { ed.objectColors[L][h.i] = null; }); api.changed(); } });
      }
    }
    if (L === 'doors' && o.geezvtt_type !== 'window') items.push(
      { label: (o.closed ? 'Open' : 'Close') + plural, action: () => { snapshot(); const v = !o.closed; targets.forEach(h => { raw.portals[h.i].closed = v; }); api.changed(); syncOptions(); } },
      { label: (o.geezvtt_locked ? 'Unlock' : 'Lock') + plural, action: () => { snapshot(); const v = !o.geezvtt_locked; targets.forEach(h => { raw.portals[h.i].geezvtt_locked = v; }); api.changed(); syncOptions(); } });
    items.push({ label: 'Delete' + plural, action: () => { snapshot(); removeMany(targets); api.changed(); } });
    showMapMenu(e.clientX, e.clientY, items, canvas);
    return true;
  }

  // ---------- overlay ----------
  function outline(ctx, s, layer, i) {
    const { raw } = map(), o = list(raw, layer)?.[i]; if (!o) return;
    if (layer === 'walls' || layer === 'doors') { const pts = layer === 'walls' ? o : o.bounds; ctx.beginPath(); pts.forEach((q, k) => (k ? ctx.lineTo(q.x * s, q.y * s) : ctx.moveTo(q.x * s, q.y * s))); ctx.stroke(); return; }
    const q = layer === 'lights' ? o.position : o, r = layer === 'floors' ? .5 : layer === 'tokens' ? (o.size || 1) * .4 + .06 : .28;
    ctx.strokeRect((q.x - r) * s, (q.y - r) * s, 2 * r * s, 2 * r * s);
  }
  updateHint();
  return { active: () => !!st.layer, contextMenu, drawOverlay(ctx, s, zoom, dpr = 1) {
    if (!st.layer) return;
    const { raw } = map(), px = n => n * dpr / zoom;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (st.hover && !st.sel.some(x => same(x, st.hover))) { ctx.strokeStyle = st.mode === 'erase' ? '#f87171' : '#ffffff'; ctx.globalAlpha = .75; ctx.lineWidth = px(2); outline(ctx, s, st.hover.layer, st.hover.i); ctx.globalAlpha = 1; }
    ctx.strokeStyle = '#facc15'; ctx.lineWidth = px(3.5); for (const { layer, i } of st.sel) outline(ctx, s, layer, i);
    if (st.box) {
      const { a, b } = st.box; ctx.fillStyle = 'rgba(56,189,248,.12)'; ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = px(1.5); ctx.setLineDash([px(5), px(4)]);
      ctx.fillRect(a.x * s, a.y * s, (b.x - a.x) * s, (b.y - a.y) * s); ctx.strokeRect(a.x * s, a.y * s, (b.x - a.x) * s, (b.y - a.y) * s);
    }
    if (raw && (st.mode === 'connect' || st.layer === 'levers')) { // lever -> door links, plus a rubber-band line while connecting
      const mid = d => ({ x: (d.bounds[0].x + d.bounds[1].x) / 2, y: (d.bounds[0].y + d.bounds[1].y) / 2 });
      ctx.strokeStyle = '#c084fc'; ctx.lineWidth = px(2); ctx.setLineDash([px(6), px(4)]);
      (raw.geezvtt_editor.levers || []).forEach(v => { const d = raw.portals[v.door]; if (!d) return; const m = mid(d); ctx.beginPath(); ctx.moveTo(v.x * s, v.y * s); ctx.lineTo(m.x * s, m.y * s); ctx.stroke(); });
      const v = st.lever != null && raw.geezvtt_editor.levers[st.lever];
      if (v && st.cursor) { ctx.strokeStyle = '#facc15'; ctx.beginPath(); ctx.moveTo(v.x * s, v.y * s); ctx.lineTo(st.cursor.x * s, st.cursor.y * s); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    if (st.cursor && raw && st.mode !== 'select' && st.mode !== 'connect' && inMap(st.cursor)) {
      const c = st.cursor; ctx.strokeStyle = ctx.fillStyle = st.mode === 'erase' ? '#f87171' : '#38bdf8'; ctx.lineWidth = px(2); ctx.setLineDash([]);
      if (st.pend) { ctx.setLineDash([px(6), px(4)]); ctx.beginPath(); ctx.moveTo(st.pend.x * s, st.pend.y * s); ctx.lineTo(c.x * s, c.y * s); ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(st.pend.x * s, st.pend.y * s, px(4), 0, 7); ctx.fill(); }
      if (st.layer === 'floors') ctx.strokeRect((c.x - .5) * s, (c.y - .5) * s, s, s);
      else { ctx.beginPath(); ctx.arc(c.x * s, c.y * s, px(4.5), 0, 7); ctx.fill(); }
    }
    ctx.restore();
  } };
}
