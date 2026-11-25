// Canvas port of the index.html map renderer (floors, walls, doors, windows, lights) for the minigame.
import { MATERIALS } from './map-editor-model.js';
import { materialCanvas } from './material-textures.js';
import { objectColors, objectLightColor } from './object-appearance.js';
import { tokenPicture } from './minigame-tokens.js';

const allLights = (raw, geo) => geo.lights.map((l, i) => ({ l, src: raw.lights?.[i] || {}, i }));
export const visibleLights = (raw, geo) => geo.lights.map((l, i) => ({ l, src: raw.lights?.[i] || {}, i })).filter(({ src }) => !src.geezvtt_hidden && !src.geezvtt_off);
const material = name => MATERIALS[name] || MATERIALS.stone;
// Textured material fills, the same procedural tiles index.html uses; one tile = one grid cell. Cached per context.
const patterns = new WeakMap();
function texture(ctx, name, s) {
  let byName = patterns.get(ctx); if (!byName || byName.s !== s) patterns.set(ctx, byName = { s, map: new Map() });
  const key = MATERIALS[name] ? name : 'stone';
  if (!byName.map.has(key)) {
    const p = ctx.createPattern(materialCanvas(key), 'repeat'); p.setTransform(new DOMMatrix().scale(s / 128));
    byName.map.set(key, p);
  }
  return byName.map.get(key);
}
const fillFor = (ctx, custom, name, s, fallback) => custom || (name || fallback ? texture(ctx, name || fallback, s) : '#e2e8f0');
const hex = c => '#' + String(c || 'ffffffff').slice(-6);
const alpha = c => (String(c || '').length === 8 ? parseInt(String(c).slice(0, 2), 16) / 255 : 1);

// raw = the dd2vtt JSON (with optional geezvtt_editor extras); geo = parseDD2VTT(raw); s = px per grid cell; z = camera zoom.
// Hidden objects are skipped (players must not see them); the GM sees them dimmed. opts.grid draws the cell grid.
export function drawScene(ctx, raw, geo, s, z, showHidden = false, opts = {}) {
  const dpr = ctx.canvas.width / (ctx.canvas.clientWidth || ctx.canvas.width) || 1;
  const ed = raw.geezvtt_editor || {}, px = n => n * dpr / z; // px(): constant on-screen line width
  const W = geo.mapSize.x * s, H = geo.mapSize.y * s;
  ctx.fillStyle = '#1b222b'; ctx.fillRect(0, 0, W, H); // the playable area stands out from the surrounding stage
  const cols = (layer, i) => objectColors(ed.objectColors?.[layer]?.[i]);

  (ed.floors || []).forEach((f, i) => {
    if ((f.hidden && !showHidden) || !Number.isFinite(f.x) || !Number.isFinite(f.y)) return;
    ctx.globalAlpha = f.hidden ? 0.3 : 1; // GM sees hidden objects dimmed
    const size = f.size || 1;
    ctx.fillStyle = fillFor(ctx, cols('floors', i).base, f.material, s, 'stone');
    ctx.fillRect((f.x - size / 2) * s, (f.y - size / 2) * s, size * s, size * s);
    ctx.lineWidth = px(1); ctx.strokeStyle = 'rgba(0,0,0,.3)';
    ctx.strokeRect((f.x - size / 2) * s, (f.y - size / 2) * s, size * s, size * s);
    ctx.globalAlpha = 1;
  });

  if (opts.grid) {
    ctx.lineWidth = px(1); ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.beginPath();
    for (let x = 0; x <= geo.mapSize.x; x++) { ctx.moveTo(x * s, 0); ctx.lineTo(x * s, H); }
    for (let y = 0; y <= geo.mapSize.y; y++) { ctx.moveTo(0, y * s); ctx.lineTo(W, y * s); }
    ctx.stroke();
  }
  ctx.lineWidth = px(2); ctx.strokeStyle = 'rgba(162,203,255,.35)'; ctx.strokeRect(0, 0, W, H);

  const line = (a, b) => { ctx.beginPath(); ctx.moveTo(a.x1 * s, a.y1 * s); ctx.lineTo(a.x2 * s, a.y2 * s); ctx.stroke(); };
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  geo.walls.forEach(w => {
    const i = w.poly;
    if (w.perimeter) return; // the synthetic map-edge box is only for light and sight; the map border is drawn above
    if (ed.wallHidden?.[i] && !showHidden) return;
    ctx.globalAlpha = ed.wallHidden?.[i] ? 0.3 : 1;
    const m = ed.wallMaterials?.[i];
    ctx.lineWidth = px(3.5); ctx.strokeStyle = fillFor(ctx, cols('walls', i).base, m, s, 'stone'); // unmarked walls are stone, as in index.html
    ctx.setLineDash(m === 'broken wall' ? [9, 3, 4, 2].map(px) : ['wooden fence', 'iron fence', 'barricade'].includes(m) ? [3, 2].map(n => px(n * 3)) : []);
    line(w);
  });

  geo.doors.forEach((d, i) => {
    const src = raw.portals?.[i] || {};
    if (src.geezvtt_hidden && !showHidden) return;
    ctx.globalAlpha = src.geezvtt_hidden ? 0.3 : 1;
    const win = src.geezvtt_type === 'window' || d.isWindow, c = fillFor(ctx, cols('doors', i).base, ed.doorMaterials?.[i], s, 'wood');
    if (win) {
      ctx.setLineDash([]); ctx.lineWidth = px(7); ctx.strokeStyle = c; line(d);
      ctx.lineWidth = px(3); ctx.strokeStyle = src.geezvtt_pane === 'open' ? '#15191f' : '#8bd9f2'; line(d);
      return;
    }
    ctx.lineWidth = px(6);
    ctx.setLineDash(d.closed ? [] : [px(5), px(5)]);
    ctx.strokeStyle = d.closed ? c : '#75f0b1'; line(d);
  });
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  geo.doors.forEach((d, i) => { // padlock dot on locked closed doors
    if (!d.closed || !raw.portals?.[i]?.geezvtt_locked || raw.portals[i].geezvtt_hidden) return;
    ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc((d.x1 + d.x2) / 2 * s, (d.y1 + d.y2) / 2 * s, 0.13 * s, 0, Math.PI * 2); ctx.fill();
  });
  for (const v of ed.levers || []) { // base plate + handle tilted by state
    ctx.save(); ctx.translate(v.x * s, v.y * s);
    ctx.fillStyle = '#475569'; ctx.fillRect(-.18 * s, -.08 * s, .36 * s, .16 * s);
    ctx.strokeStyle = v.on ? '#84cc16' : '#f97316'; ctx.lineWidth = px(3); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo((v.on ? .22 : -.22) * s, -.24 * s); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc((v.on ? .22 : -.22) * s, -.24 * s, .06 * s, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  for (const t of ed.tokens || []) { // map tokens (PC / NPC / picture); the GM sees hidden ones faded, players don't see them
    if (t.geezvtt_hidden && !showHidden) continue;
    const r = (t.size || 1) * 0.4 * s, img = tokenPicture(t);
    ctx.globalAlpha = t.geezvtt_hidden ? 0.35 : 1;
    ctx.save(); ctx.beginPath(); ctx.arc(t.x * s, t.y * s, r, 0, Math.PI * 2);
    ctx.fillStyle = t.kind === 'pc' ? '#38bdf8' : t.kind === 'npc' ? '#f87171' : '#a78bfa'; ctx.fill();
    if (img) { ctx.clip(); ctx.drawImage(img, t.x * s - r, t.y * s - r, 2 * r, 2 * r); }
    ctx.restore();
    ctx.strokeStyle = '#0b1220'; ctx.lineWidth = px(2); ctx.beginPath(); ctx.arc(t.x * s, t.y * s, r, 0, Math.PI * 2); ctx.stroke();
    if (!img) { ctx.fillStyle = '#0b1220'; ctx.font = `700 ${r * 0.9}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(t.name || '?').charAt(0).toUpperCase(), t.x * s, t.y * s + r * 0.05); ctx.textBaseline = 'alphabetic'; }
    ctx.font = `600 ${px(12)}px system-ui`; ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1220'; ctx.lineWidth = px(3);
    ctx.strokeText(t.name || '', t.x * s, t.y * s - r - px(5)); ctx.fillStyle = '#f1f5f9'; ctx.fillText(t.name || '', t.x * s, t.y * s - r - px(5));
    ctx.globalAlpha = 1;
  }
  if (showHidden) for (const { l, i, src } of allLights(raw, geo)) { // light markers are GM-only; showHidden is true only for the GM
    const color = objectLightColor({ colors: ed.objectColors?.lights?.[i], color: hex(l.color) });
    ctx.globalAlpha = src.geezvtt_hidden || src.geezvtt_off ? 0.3 : 1;
    ctx.fillStyle = color; ctx.strokeStyle = '#15191f'; ctx.lineWidth = px(1.5);
    ctx.beginPath(); ctx.arc(l.x * s, l.y * s, 0.12 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// Visibility polygon from (ox,oy): nearest hit along rays aimed at every nearby segment endpoint, capped by a box of half-size `range`.
function visibility(ox, oy, range, segs) {
  const box = [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]].map(([a, b, c, d]) => [ox + a * range, oy + b * range, ox + c * range, oy + d * range]);
  const near = segs.filter(g => Math.max(g[0], g[2]) >= ox - range && Math.min(g[0], g[2]) <= ox + range && Math.max(g[1], g[3]) >= oy - range && Math.min(g[1], g[3]) <= oy + range).concat(box);
  const angles = [];
  for (const g of near) for (const [x, y] of [[g[0], g[1]], [g[2], g[3]]]) { const t = Math.atan2(y - oy, x - ox); angles.push(t - 1e-4, t, t + 1e-4); }
  angles.sort((a, b) => a - b);
  return angles.map(t => {
    const dx = Math.cos(t), dy = Math.sin(t); let best = Infinity;
    for (const [x1, y1, x2, y2] of near) {
      const sx = x2 - x1, sy = y2 - y1, den = dx * sy - dy * sx;
      if (Math.abs(den) < 1e-9) continue;
      const u = ((x1 - ox) * dy - (y1 - oy) * dx) / den, r = ((x1 - ox) * sy - (y1 - oy) * sx) / den;
      if (r >= 0 && u >= 0 && u <= 1 && r < best) best = r;
    }
    return [ox + dx * best, oy + dy * best];
  });
}

export { visibility }; // exported for tests
// Segments that stop light and sight, in canvas px: walls and closed doors (windows and open doors let both through).
const blockers = (raw, geo, s) => [...geo.walls, ...geo.doors.filter((x, i) => x.closed && raw.portals?.[i]?.geezvtt_type !== 'window' && !x.isWindow)]
  .map(g => [g.x1 * s, g.y1 * s, g.x2 * s, g.y2 * s]);

let dark, fog;
// Per-token vision: everything is black except what each token (px positions in `origins`) has line of sight to. Skip for the GM.
export function drawVision(ctx, raw, geo, s, cam, origins) {
  const cv = ctx.canvas;
  fog ||= document.createElement('canvas');
  if (fog.width !== cv.width || fog.height !== cv.height) { fog.width = cv.width; fog.height = cv.height; }
  const f = fog.getContext('2d'), segs = blockers(raw, geo, s), reach = Math.max(geo.mapSize.x, geo.mapSize.y) * s * 2;
  f.setTransform(1, 0, 0, 1, 0, 0); f.globalCompositeOperation = 'source-over'; f.fillStyle = '#000'; f.fillRect(0, 0, fog.width, fog.height);
  f.setTransform(cam.z, 0, 0, cam.z, cam.x, cam.y); f.globalCompositeOperation = 'destination-out'; f.fillStyle = '#000';
  for (const o of origins) {
    const poly = visibility(o.x, o.y, reach, segs);
    f.beginPath(); poly.forEach(([x, y], k) => (k ? f.lineTo(x, y) : f.moveTo(x, y))); f.closePath(); f.fill();
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(fog, 0, 0); ctx.restore();
}

// Real lighting: everything is dimmed to `ambient` darkness, then each light carves a shadow-cast, falloff-shaded pool out of it.
// Closed doors and walls cast shadows; open doors and windows do not. Call after drawScene, with the camera transform still set.
export function drawLighting(ctx, raw, geo, s, cam, ambient = 0.88) {
  const cv = ctx.canvas;
  dark ||= document.createElement('canvas');
  if (dark.width !== cv.width || dark.height !== cv.height) { dark.width = cv.width; dark.height = cv.height; }
  const d = dark.getContext('2d'), ed = raw.geezvtt_editor || {};
  const segs = blockers(raw, geo, s);
  d.setTransform(1, 0, 0, 1, 0, 0); d.globalCompositeOperation = 'source-over'; d.clearRect(0, 0, dark.width, dark.height);
  d.fillStyle = `rgba(6,8,18,${ambient})`; d.fillRect(0, 0, dark.width, dark.height);
  for (const { l, i } of visibleLights(raw, geo)) {
    const ox = l.x * s, oy = l.y * s, range = l.range * s, strength = Math.min(1, (l.intensity ?? 1) * alpha(l.color));
    const poly = visibility(ox, oy, range, segs);
    const color = objectLightColor({ colors: ed.objectColors?.lights?.[i], color: hex(l.color) });
    for (const [target, op] of [[d, 'destination-out'], [ctx, 'lighter']]) {
      target.save();
      target.setTransform(cam.z, 0, 0, cam.z, cam.x, cam.y);
      target.beginPath(); poly.forEach(([x, y], k) => (k ? target.lineTo(x, y) : target.moveTo(x, y))); target.closePath(); target.clip();
      target.globalCompositeOperation = op;
      const g = target.createRadialGradient(ox, oy, 0, ox, oy, range);
      const a = op === 'lighter' ? 0.25 * strength : strength;
      g.addColorStop(0, op === 'lighter' ? color : '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, op === 'lighter' ? color : `rgba(0,0,0,${0.7})`);
      target.globalAlpha = a; target.fillStyle = g; target.fillRect(ox - range, oy - range, range * 2, range * 2);
      target.restore();
    }
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(dark, 0, 0); ctx.restore();
}
