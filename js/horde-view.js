// Zombie Horde renderer: pixel art drawn procedurally onto a 320x180 canvas, scaled up by CSS.
// It only reads game state; effects come from the model's event log. Nothing here affects the result.
import { ARENA, CHARGE_MAX, IDEAL_CHARGE, MODE_NAMES, PLANT_PERIOD, SLASH_LEAD, plantWindow, slashWindow, BAR_SLOTS, runeBeat, SPELLS, chargeWindow, simonStep, spellsFor } from './horde-model.js';
import { graphicsSettings } from './graphics-settings.js';
import { mix, personColors, rgba } from './horde-colors.js';

export const VIEW = { width: 320, height: 180 };
const PX = 16;
// Arrow key -> rune lane and Simon pad, shared with the page so the keys and the pictures agree.
export const LANE_KEYS = { ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 };
export const PAD_KEYS = { ArrowUp: 0, ArrowLeft: 1, ArrowDown: 2, ArrowRight: 3 }; // glyphs sit N, W, S, E
const LANE_GLYPH = ['←', '↓', '↑', '→'];
export const PAD_NAMES = ['sun', 'moon', 'star', 'rune'];
const MODE_SHORT = { tank: ['Attack', 'Hold line'], cutter: ['Cut words', 'Hold'], pitch: ['Cut words', 'Hold'], simon: ['Touch', 'Glyphs'], striker: ['Arrows', 'Slash'] };
const PAD_COLOR = ['#e0524a', '#4a8ae0', '#5ac26a', '#e6c04a'];
const NOTES = ['♪', '♫', '♬'];
const ZOMBIE_LOOK = {
  walker: { skin: '#8fb06b', cloth: '#6a5a50', scale: 1 },
  runner: { skin: '#a9c27a', cloth: '#7a4a4a', scale: 1 },
  brute: { skin: '#6f8f5a', cloth: '#5a5f68', scale: 2 }
};

const rect = (ctx, color, x, y, w, h) => { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), w, h); };

function drawHumanoid(ctx, x, y, look, frame, skin, extra) {
  const lift = frame ? 1 : 0;
  rect(ctx, '#141018', x - 5, y - 2, 10, 17);                // outline
  rect(ctx, look.dark, x - 4, y + 10 + lift, 3, 4 - lift);    // legs
  rect(ctx, look.dark, x + 1, y + 10 + (1 - lift), 3, 4 - (1 - lift));
  rect(ctx, look.body, x - 4, y + 4, 8, 7);                   // torso
  rect(ctx, look.dark, x - 4, y + 9, 8, 1);                   // belt
  rect(ctx, look.body, x - 6, y + 5, 2, 5);                   // arms
  rect(ctx, look.body, x + 4, y + 5, 2, 5);
  rect(ctx, skin, x - 3, y - 1, 6, 5);                        // head
  rect(ctx, look.hair, x - 3, y - 2, 6, 2);
  rect(ctx, '#1b1b22', x - 2, y + 1, 1, 1);
  rect(ctx, '#1b1b22', x + 1, y + 1, 1, 1);
  extra?.(ctx, x, y, frame);
}
const roleExtras = {
  tank: (ctx, x, y) => { rect(ctx, '#9aa5b5', x - 4, y - 3, 8, 2); rect(ctx, '#c9d2de', x - 9, y + 4, 4, 7); rect(ctx, '#e6c35a', x - 8, y + 6, 2, 2); rect(ctx, '#d8dde6', x + 6, y + 1, 1, 9); },
  striker: (ctx, x, y) => { rect(ctx, '#2f6a39', x - 4, y - 3, 8, 3); rect(ctx, '#8b5a2b', x + 6, y + 1, 1, 9); rect(ctx, '#8b5a2b', x + 5, y, 1, 1); rect(ctx, '#8b5a2b', x + 5, y + 10, 1, 1); rect(ctx, '#e6e0cc', x + 5, y + 5, 1, 1); },
  healer: (ctx, x, y, frame) => { rect(ctx, '#ffe9a0', x - 3, y - 5 - frame, 6, 1); rect(ctx, '#fff7d6', x - 2, y - 6 - frame, 4, 1); rect(ctx, '#e8c85a', x + 6, y + 2, 1, 9); rect(ctx, '#ffd84a', x + 5, y + 1, 3, 1); },
  cutter: (ctx, x, y) => { rect(ctx, '#2a1a2e', x - 4, y - 3, 8, 2); rect(ctx, '#ffd84a', x + 3, y - 6, 1, 4); rect(ctx, '#8b5a2b', x + 6, y + 4, 3, 5); rect(ctx, '#d8c9a8', x + 8, y + 1, 1, 4); },
  simon: (ctx, x, y) => { rect(ctx, '#3a3a44', x - 4, y - 2, 8, 2); rect(ctx, '#7ad0ff', x - 3, y + 1, 2, 1); rect(ctx, '#7ad0ff', x + 1, y + 1, 2, 1); rect(ctx, '#8a8f99', x + 6, y + 4, 3, 4); rect(ctx, '#e0524a', x + 7, y + 5, 1, 1); },
  pitch: (ctx, x, y) => { rect(ctx, '#e8e8f0', x - 4, y - 3, 8, 3); rect(ctx, '#c8c8d8', x + 6, y + 1, 1, 9); rect(ctx, '#c8c8d8', x + 5, y + 1, 3, 1); rect(ctx, '#c8c8d8', x + 5, y - 1, 1, 3); rect(ctx, '#c8c8d8', x + 7, y - 1, 1, 3); },
  support: (ctx, x, y) => { rect(ctx, '#593a80', x - 4, y - 3, 8, 2); rect(ctx, '#593a80', x - 2, y - 5, 4, 2); rect(ctx, '#593a80', x - 1, y - 7, 2, 2); rect(ctx, '#ffd84a', x, y - 8, 1, 1); rect(ctx, '#d9b3ff', x + 6, y + 3, 2, 6); rect(ctx, '#d9b3ff', x + 8, y + 3, 1, 2); }
};
function drawZombie(ctx, z, x, y, frame, flash) {
  const look = ZOMBIE_LOOK[z.type], s = look.scale, lift = frame ? s : 0, w = 8 * s;
  rect(ctx, '#0e120e', x - w / 2 - 1, y - 2 * s - 1, w + 2, 16 * s + 2);
  rect(ctx, '#3a2f2a', x - 3 * s, y + 10 * s + lift, 3 * s, 4 * s - lift);
  rect(ctx, '#3a2f2a', x, y + 10 * s + (s - lift), 3 * s, 4 * s - (s - lift));
  rect(ctx, flash ? '#ffffff' : look.cloth, x - w / 2, y + 4 * s, w, 7 * s);
  const swing = frame ? -s : s;                                    // arms stretched forward, swinging
  rect(ctx, look.skin, x - w / 2 - 2 * s, y + 4 * s + swing, 2 * s, 6 * s);
  rect(ctx, look.skin, x + w / 2, y + 4 * s - swing, 2 * s, 6 * s);
  rect(ctx, flash ? '#ffffff' : look.skin, x - 3 * s, y - s, 6 * s, 5 * s);
  rect(ctx, '#d94a3a', x - 2 * s, y + s, s, s);
  rect(ctx, '#d94a3a', x + s, y + s, s, s);
  rect(ctx, '#2a1a1a', x - s, y + 3 * s, 2 * s, s);
  if (z.type === 'brute') { rect(ctx, '#8a9099', x - 4 * s, y + 4 * s, 8 * s, 2 * s); rect(ctx, '#8a9099', x - 3 * s, y - 2 * s, 6 * s, 2 * s); }
  if (z.boss) rect(ctx, '#e6c35a', x - 3 * s, y - 3 * s, 6 * s, s);
}

export function createHordeView(canvas, textCanvas) {
  canvas.width = VIEW.width; canvas.height = VIEW.height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  // All text lives on its own full-resolution layer above the pixel art, so it stays sharp at any window size.
  const tctx = textCanvas.getContext('2d');
  let T = { scale: 1, ox: 0, oy: 0 };
  function layoutText() {
    const dpr = window.devicePixelRatio || 1, w = textCanvas.clientWidth, h = textCanvas.clientHeight;
    if (textCanvas.width !== Math.round(w * dpr) || textCanvas.height !== Math.round(h * dpr)) { textCanvas.width = Math.round(w * dpr); textCanvas.height = Math.round(h * dpr); }
    const scale = Math.min(w / VIEW.width, h / VIEW.height);
    T = { scale, ox: (w - VIEW.width * scale) / 2, oy: (h - VIEW.height * scale) / 2 };
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tctx.clearRect(0, 0, w, h);
  }
  const fontFor = (size, mono) => `700 ${Math.max(11, size * T.scale)}px ${mono ? 'ui-monospace, Consolas, "Courier New", monospace' : 'system-ui, "Segoe UI", sans-serif'}`;
  // Draw outlined text at arena coordinates (x, y is the baseline).
  function say(str, x, y, { color = '#fff', size = 6, align = 'center', mono = false, fade = 1 } = {}) {
    tctx.save();
    tctx.globalAlpha = fade; tctx.font = fontFor(size, mono); tctx.textAlign = align; tctx.lineJoin = 'round';
    const px = T.ox + x * T.scale, py = T.oy + y * T.scale;
    tctx.lineWidth = Math.max(3, Math.max(11, size * T.scale) * 0.26); tctx.strokeStyle = 'rgba(0,0,0,0.85)'; tctx.strokeText(str, px, py);
    tctx.fillStyle = color; tctx.fillText(str, px, py);
    tctx.restore();
  }
  const floor = makeFloor();
  const particles = [], seen = new Set();
  let shake = 0, lastTime = performance.now(), banner = null;
  const padFlash = [0, 0, 0, 0];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  function makeFloor() {
    const layer = document.createElement('canvas'); layer.width = VIEW.width; layer.height = VIEW.height;
    const g = layer.getContext('2d');
    g.fillStyle = '#0d0f15'; g.fillRect(0, 0, VIEW.width, VIEW.height); // opaque, so old frames never show through the mortar
    let seed = 7;
    const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let y = 0; y < VIEW.height; y += 12) for (let x = (y / 12 % 2) * 8; x < VIEW.width; x += 16) {
      const v = Math.round(22 + noise() * 12);
      g.fillStyle = `rgb(${v},${v + 2},${v + 8})`; g.fillRect(x, y, 15, 11);
      g.fillStyle = `rgba(255,255,255,${0.03 + noise() * 0.03})`; g.fillRect(x, y, 15, 1);
    }
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(0,0,0,${0.15 + noise() * 0.2})`; g.fillRect(Math.floor(noise() * VIEW.width), Math.floor(noise() * VIEW.height), 2 + Math.floor(noise() * 4), 1); }
    return layer;
  }
  // Simon's four glyphs, drawn as crisp vector shapes in a -1..1 box.
  function glyphPath(g, pad) {
    g.beginPath();
    if (pad === 0) { g.arc(0, 0, 0.32, 0, 6.2832); for (let i = 0; i < 8; i++) { const a = i * 0.7854; g.moveTo(Math.cos(a) * 0.5, Math.sin(a) * 0.5); g.lineTo(Math.cos(a) * 0.78, Math.sin(a) * 0.78); } }
    else if (pad === 1) { g.moveTo(0.3, -0.52); g.arc(0, 0, 0.6, -1.0472, 1.0472, true); g.arc(0.62, 0, 0.61, 2.122, 4.161, false); g.closePath(); }
    else if (pad === 2) { for (let i = 0; i < 8; i++) { const a = i * 0.7854 - 1.5708, r = i % 2 ? 0.2 : 0.72; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); }
    else { g.moveTo(0, 0.7); g.lineTo(0, -0.7); g.moveTo(-0.5, -0.62); g.lineTo(0, 0); g.lineTo(0.5, -0.62); g.moveTo(-0.38, 0.12); g.lineTo(0.38, 0.12); }
  }
  function drawGlyphPad(cx, cy, half, pad, on) {
    const px = T.ox + cx * T.scale, py = T.oy + cy * T.scale, r = half * T.scale;
    tctx.save();
    tctx.translate(px, py);
    tctx.fillStyle = on ? PAD_COLOR[pad] : PAD_COLOR[pad] + '55';
    tctx.strokeStyle = on ? '#fff' : PAD_COLOR[pad] + 'aa'; tctx.lineWidth = Math.max(2, r * 0.1);
    tctx.beginPath(); tctx.roundRect(-r, -r, r * 2, r * 2, r * 0.3); tctx.fill(); tctx.stroke();
    tctx.scale(r * 0.62, r * 0.62);
    tctx.lineWidth = 0.17; tctx.lineCap = 'round'; tctx.lineJoin = 'round';
    tctx.strokeStyle = on ? '#fff' : 'rgba(255,255,255,0.78)'; tctx.fillStyle = on ? '#fff' : 'rgba(255,255,255,0.78)';
    glyphPath(tctx, pad); if (pad === 1 || pad === 2) tctx.fill(); tctx.stroke();
    tctx.restore();
  }
  // The mage hand (Lark's Hold Person, Rurik's inspiration): a spectral glove in its caster's colour.
  function drawHand(cx, cy, alpha, color = '#a8e8ff') {
    const outline = mix(color, '#000000', 0.6), fill = mix(color, '#ffffff', 0.6), shade = mix(color, '#000000', 0.12);
    ctx.save(); ctx.globalAlpha = alpha;
    rect(ctx, rgba(color, 0.3), cx - 10, cy - 10, 20, 18);
    rect(ctx, outline, cx - 7, cy - 3, 14, 10);
    for (let i = 0; i < 4; i++) rect(ctx, outline, cx - 8 + i * 4, cy - 10, 4, 8);
    rect(ctx, outline, cx + 6, cy - 1, 4, 5);
    rect(ctx, fill, cx - 6, cy - 2, 12, 8);
    for (let i = 0; i < 4; i++) rect(ctx, fill, cx - 7 + i * 4, cy - 9, 3, 7);
    rect(ctx, fill, cx + 6, cy, 3, 3);
    rect(ctx, shade, cx - 6, cy + 4, 12, 2);
    rect(ctx, '#ffffff', cx - 5, cy - 1, 3, 1);
    ctx.restore();
  }
  function flames(x, y, color, count = 10) {
    const palette = [color, mix(color, '#ffe066', 0.55), mix(color, '#ff3a1a', 0.5), '#fff3b0'];
    const n = Math.max(3, Math.round(count * Math.min(1, graphicsSettings().weatherParticles / 160) * (reduced.matches ? 0.4 : 1)));
    for (let i = 0; i < n; i++) spawn({ x: x + ((i * 7) % 9) - 4, y, vx: (((i * 13) % 7) - 3) * 0.06, vy: -0.35 - (i % 4) * 0.12, color: palette[i % 4], size: 2 + (i % 2), life: 0.55, kind: 'flame' });
  }
  let padRects = [], modeRects = [];
  const toPx = v => v / PX;
  const spawn = (p) => { if (particles.length < 600) particles.push({ life: 1, ...p, max: p.life ?? 1 }); };
  const burst = (x, y, color, count, speed = 1.2, life = 0.5) => {
    const n = Math.max(2, Math.round(count * Math.min(1, graphicsSettings().weatherParticles / 160) * (reduced.matches ? 0.4 : 1)));
    for (let i = 0; i < n; i++) { const a = i * 2.399, s = speed * (0.4 + (i % 5) / 5); spawn({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.3, color, size: 1 + (i % 2), life, kind: 'spark' }); }
  };
  const text = (x, y, value, color) => spawn({ x, y, vx: 0, vy: -0.35, color, text: String(value), life: 0.9, kind: 'text' });
  const ring = (x, y, color, radius, life = 0.6) => spawn({ x, y, vx: 0, vy: 0, color, radius, life, kind: 'ring' });

  const near = (a, b, r) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= r * r;
  function react(state, positions, hud) {
    for (const entry of state.log) {
      const key = `${entry.t}|${entry.type}|${entry.a}|${entry.b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const player = state.players[entry.a], at = positions.players[entry.a];
      const zombie = positions.zombies.get(entry.b) || positions.zombies.get(entry.a);
      const mc = player ? personColors(player.name, player.role).magic : '#ffffff';
      if (entry.type === 'fire' && at) { burst(at.x + 6, at.y + 4, mc, 5, 0.9, 0.3); if (entry.c) text(at.x, at.y - 12, 'On beat!', mix(mc, '#ffffff', 0.4)); }
      else if (entry.type === 'hit' && positions.zombies.get(entry.a)) { const z = positions.zombies.get(entry.a); burst(z.x, z.y + 5, '#e8f5c8', 6, 1.2, 0.3); }
      else if (entry.type === 'kill') { burst(entry.b, entry.c + 6, '#9bc47a', 10, 1.5, 0.6); burst(entry.b, entry.c + 6, '#5a3030', 5, 1, 0.6); }
      else if (entry.type === 'heal') {
        const t = positions.players[entry.b];
        if (t && at) { burst(t.x, t.y + 4, mc, 9, 0.7, 0.8); text(t.x, t.y - 12, `+${entry.c}`, mc); ring(t.x, t.y + 8, mc, 12, 0.5); spawn({ kind: 'beam', x0: at.x, y0: at.y + 2, x1: t.x, y1: t.y + 2, color: mc, life: 0.35 }); }
      } else if (entry.type === 'mend' || entry.type === 'revive') {
        const t = positions.players[entry.b];
        if (t) { burst(t.x, t.y + 4, mc, entry.type === 'revive' ? 16 : 6, 1, 0.9); if (entry.type === 'revive') text(t.x, t.y - 14, 'Up!', mc); }
      } else if (entry.type === 'cast' && at && player) {
        const name = spellsFor(player.cls)[entry.b];
        ring(at.x, at.y + 8, mc, 40, 0.7); burst(at.x, at.y, mc, 12, 1.1, 0.8); text(at.x, at.y - 14, name, mc);
        if (player.cls.toLowerCase() === 'bard') for (let i = 0; i < 4; i++) spawn({ x: at.x - 10 + i * 7, y: at.y - 4, vx: 0.15, vy: -0.5 - i * 0.05, color: mc, text: NOTES[i % 3], life: 1, kind: 'text' });
      } else if (entry.type === 'bite' && at && entry.c > 0) { text(at.x, at.y - 10, `-${entry.c}`, '#ff6b5a'); burst(at.x, at.y + 4, '#ff6b5a', 4, 0.8, 0.3); }
      else if (entry.type === 'gate') { shake = Math.max(shake, 2); burst(entry.a, 164, '#c98b4a', 5, 1, 0.4); }
      else if (entry.type === 'down' && at) { text(at.x, at.y - 12, 'Down!', '#ff6b5a'); shake = Math.max(shake, 3); }
      else if (entry.type === 'slam' && at && player) {
        // Seris: purple slashes across everything in reach.
        const radius = 36 + 3 * player.tier;
        ring(at.x, at.y + 8, mc, radius, 0.6); spawn({ kind: 'slash', big: true, x: at.x, y: at.y, color: mc, life: 0.35 });
        for (const z of positions.zombies.values()) if (near(z, at, radius * 1.05)) { spawn({ kind: 'slash', x: z.x, y: z.y + 4, color: mc, life: 0.32 }); burst(z.x, z.y + 4, mc, 5, 1.3, 0.4); }
        text(at.x, at.y - 14, entry.c ? 'PERFECT!' : `-${entry.b}`, entry.c ? mix(mc, '#ffffff', 0.5) : mc); shake = Math.max(shake, entry.c ? 4 : 2);
      } else if (entry.type === 'slash' && at && player) {
        // Liora blinks onto the target: a flash where she lands and green cuts across everything around it.
        const radius = 30 + 3 * player.tier;
        ring(at.x, at.y + 8, mc, radius, 0.5); spawn({ kind: 'slash', big: true, x: at.x, y: at.y, color: mc, life: 0.3 });
        for (const z of positions.zombies.values()) if (near(z, at, radius * 1.05)) { spawn({ kind: 'slash', x: z.x, y: z.y + 4, color: mc, life: 0.3 }); burst(z.x, z.y + 4, mc, 5, 1.3, 0.4); }
        burst(at.x, at.y + 4, '#ffffff', 8, 1.6, 0.4); if (entry.c) text(at.x, at.y - 14, 'PERFECT!', mix(mc, '#ffffff', 0.5)); shake = Math.max(shake, entry.c ? 3 : 1.5);
      } else if (entry.type === 'slashmiss' && at) text(at.x, at.y - 12, 'Missed', '#ff8fb0');
      else if (entry.type === 'plant' && at && player) {
        // Seris smashes her shield into the ground: it drops from above, the arena shakes, and zombies start coming.
        const reach = 48 + 3 * player.tier;
        spawn({ kind: 'shield', drop: true, x: at.x, y: at.y + 6, color: mc, life: 0.7, scale: 1.7 });
        ring(at.x, at.y + 10, mc, reach, 0.8); text(at.x, at.y - 18, 'Shield down!', mc); shake = Math.max(shake, 6);
        for (let i = -4; i <= 4; i++) burst(at.x + i * 7, at.y + 12, mix(mc, '#ffffff', 0.4), 2, 1.6, 0.5);
      } else if (entry.type === 'clang' && at && player) {
        // A tap in the green: the shield rings, shoves and staggers what is near, and shields the allies beside her.
        const reach = 48 + 3 * player.tier, color = entry.b ? mix(mc, '#ffffff', 0.55) : mc;
        ring(at.x, at.y + 10, color, reach, 0.5); burst(at.x, at.y + 4, color, entry.b ? 14 : 8, 1.5, 0.45); text(at.x, at.y - 18, entry.b ? 'PERFECT!' : 'CLANG!', color); shake = Math.max(shake, entry.b ? 4 : 2.5);
        positions.players.forEach((t, i) => { if (i !== entry.a && !state.players[i].downed && near(t, at, reach * 1.05)) spawn({ kind: 'shield', x: t.x, y: t.y - 4, color: mc, life: 0.6, scale: 0.55 }); });
      } else if (entry.type === 'clank' && at) {
        text(at.x, at.y - 18, entry.b ? 'Too slow!' : 'Too early!', '#ff8fb0'); shake = Math.max(shake, 1.5);
      } else if (entry.type === 'shatter' && at) {
        burst(at.x, at.y + 6, mc, 22, 2, 0.7); burst(at.x, at.y + 6, '#ffffff', 8, 1.6, 0.5); text(at.x, at.y - 18, 'Shield broken!', '#ff8fb0'); shake = Math.max(shake, 4);
      } else if (entry.type === 'cut' && at) {
        // Lark and Rurik: music notes in their own colour fly to the target.
        const z = positions.zombies.get(entry.b), color = entry.c ? mix(mc, '#ffffff', 0.35) : mc;
        if (z) { const dx = z.x - at.x, dy = z.y - at.y, len = Math.max(1, Math.abs(dx) + Math.abs(dy)); spawn({ x: at.x, y: at.y - 4, vx: dx / len * 3.5, vy: dy / len * 3.5, color, text: NOTES[(entry.t + entry.b) % 3], life: 0.35, kind: 'text' }); burst(z.x, z.y + 4, color, entry.c ? 7 : 3, 1.1, 0.35); }
      } else if (entry.type === 'simonok' && player && hud.me === player.pcId) padFlash[entry.b] = 0.25;
      else if (entry.type === 'simonwin' && at) {
        // Ashara's colours burst around her; the beam or fireball that carries them is drawn from the game state.
        [mc, mix(mc, '#ffe066', 0.5), mix(mc, '#ff3a1a', 0.45), '#fff3b0'].forEach(color => burst(at.x, at.y + 4, color, 5, 1.2, 0.7)); ring(at.x, at.y + 8, mc, 16, 0.5);
      } else if (entry.type === 'simonfail' && at) text(at.x, at.y - 12, 'Oops', '#ff6b5a');
      else if (entry.type === 'orbhit') {
        const z = positions.zombies.get(entry.b);
        if (z) { flames(z.x, z.y + 8, mc, 14); text(z.x, z.y - 12, `-${entry.c}`, mix(mc, '#ffe066', 0.4)); shake = Math.max(shake, 1.5); }
      } else if (entry.type === 'hold') {
        const z = positions.zombies.get(entry.b);
        if (z) { spawn({ x: z.x, y: z.y, life: 0.5, kind: 'hand', color: mc }); text(z.x, z.y - 14, 'Held', mc); }
      } else if (entry.type === 'inspire' && at) {
        // Rurik: cyan hands bless everyone, with cyan notes rising.
        ring(at.x, at.y + 8, mc, 120, 0.9); text(at.x, at.y - 16, 'Inspired!', mc);
        positions.players.forEach((t, i) => { if (!state.players[i].downed) { burst(t.x, t.y + 2, mc, 7, 0.9, 0.9); spawn({ x: t.x, y: t.y, life: 1, kind: 'hand', pose: 'bless', color: mc }); spawn({ x: t.x - 4, y: t.y - 4, vx: 0.1, vy: -0.45, color: mc, text: NOTES[i % 3], life: 1, kind: 'text' }); } });
      }
      else if (entry.type === 'between') banner = { text: 'Wave cleared!', life: 2.5 };
      else if (entry.type === 'wave') banner = { text: `Wave ${entry.a}`, life: 2 };
      else if (entry.type === 'miss' && at) text(at.x, at.y - 10, '…', '#8a8f99');
    }
    if (seen.size > 600) { const keep = new Set(state.log.map(e => `${e.t}|${e.type}|${e.a}|${e.b}`)); for (const key of seen) if (!keep.has(key)) seen.delete(key); }
  }

  function draw(state, frac, hud) {
    layoutText();
    const now = performance.now(), dt = Math.min(0.1, (now - lastTime) / 1000); lastTime = now;
    const lerp = (a, b) => toPx(a + (b - a) * frac);
    const positions = { players: state.players.map(p => ({ x: lerp(p.ox, p.x), y: lerp(p.oy, p.y) })), zombies: new Map(state.zombies.map(z => [z.id, { x: lerp(z.ox, z.x), y: lerp(z.oy, z.y) }])) };
    react(state, positions, hud);
    const shaking = shake > 0 && !reduced.matches;
    ctx.save();
    if (shaking) ctx.translate(Math.round((Math.random() - 0.5) * shake), Math.round((Math.random() - 0.5) * shake));
    ctx.drawImage(floor, 0, 0);
    drawFog(now);
    drawGate(state, now);
    const frame = Math.floor(state.tick / 8) % 2;
    // Taunt rings and buff auras go under the characters.
    state.players.forEach((p, i) => {
      if (p.role === 'tank' && !p.downed) { const r = 50 + 10 * p.tier; ctx.strokeStyle = 'rgba(143,180,255,0.35)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(positions.players[i].x, positions.players[i].y + 8, r, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]); }
    });
    const actors = [];
    state.zombies.forEach(z => { const at = positions.zombies.get(z.id); actors.push({ y: at.y, draw: () => drawZombie(ctx, z, at.x, at.y, (frame + z.id) % 2, state.log.some(e => e.type === 'hit' && e.a === z.id && e.t >= state.tick - 3)), z, at }); });
    state.players.forEach((p, i) => { const at = positions.players[i]; actors.push({ y: at.y, draw: () => drawPlayer(p, at, i, frame, state, hud), p, at }); });
    actors.sort((a, b) => a.y - b.y).forEach(actor => actor.draw());
    // A planted shield pulls every zombie toward the tank: faint dashed lines show it.
    state.players.forEach((p, i) => {
      if (p.role !== 'tank' || !p.mech.plant || p.downed) return;
      const at = positions.players[i], color = personColors(p.name, p.role).magic;
      ctx.save(); ctx.setLineDash([2, 4]); ctx.lineDashOffset = -(state.tick % 12); ctx.strokeStyle = rgba(color, 0.22); ctx.lineWidth = 1;
      for (const z of positions.zombies.values()) { ctx.beginPath(); ctx.moveTo(z.x, z.y + 6); ctx.lineTo(at.x, at.y + 6); ctx.stroke(); }
      ctx.restore();
    });
    drawArrows(state, lerp, positions);
    for (const actor of actors) if (actor.z) { if (actor.z.frozen > 0) drawHeld(actor.z, actor.at, state); if (hud.showWords) drawWord(actor.z, actor.at, hud); }
    state.players.forEach((p, i) => drawMechanic(p, positions.players[i], state, frac));
    state.players.forEach((p, i) => drawRollDie(p, positions.players[i], state, frac, i));
    drawParticles(dt);
    ctx.restore();
    drawRoleHud(state, frac, hud, dt);
    shake = Math.max(0, shake - dt * 14);
    drawHud(state, hud, dt);
  }

  function drawFog(now) {
    if (reduced.matches) return;
    ctx.fillStyle = 'rgba(120,140,170,0.05)';
    for (let i = 0; i < 4; i++) { const x = ((now / 90 + i * 110) % 420) - 50; ctx.fillRect(x, 30 + i * 35, 90, 14); }
  }
  function drawGate(state, now) {
    const y = ARENA.gateY / PX, hurt = 1 - state.gate.hp / state.gate.max;
    rect(ctx, '#2a1d12', 0, y + 2, VIEW.width, VIEW.height - y - 2);
    for (let x = 0; x < VIEW.width; x += 10) { rect(ctx, hurt > 0.6 && x % 30 === 0 ? '#4a3321' : '#6b4a2b', x, y + 2, 9, VIEW.height - y - 2); rect(ctx, '#3a2a1a', x + 9, y + 2, 1, VIEW.height - y - 2); rect(ctx, '#8a8f99', x + 3, y - 3, 3, 5); }
    rect(ctx, '#1b130b', 0, y + 8, VIEW.width, 1);
    const w = 120, x = (VIEW.width - w) / 2;
    rect(ctx, '#0e0a08', x - 1, VIEW.height - 8, w + 2, 6);
    rect(ctx, hurt > 0.66 ? '#d9533a' : hurt > 0.33 ? '#e0b43a' : '#7bc96b', x, VIEW.height - 7, Math.max(0, Math.round(w * state.gate.hp / state.gate.max)), 4);
  }
  function drawPlayer(p, at, i, frame, state, hud) {
    const look = personColors(p.name, p.role), x = Math.round(at.x), y = Math.round(at.y);
    if (p.downed) {
      rect(ctx, '#141018', x - 8, y + 6, 17, 7); rect(ctx, look.dark, x - 7, y + 7, 15, 5); rect(ctx, '#d8c9a8', x + 5, y + 7, 4, 4);
      rect(ctx, '#ff6b5a', x - 2, y + 4, 1, 1); rect(ctx, '#ff6b5a', x, y + 4, 1, 1);
      for (let n = 0; n < p.revive; n++) rect(ctx, '#9bff9b', x - 4 + n * 4, y - 2, 3, 3);
    } else {
      const moving = p.dx || p.dy;
      drawHumanoid(ctx, x, y, look, moving ? frame : 0, '#e7bf9b', roleExtras[p.role]);
      if (state.buffs.haste > 0 && moving) { rect(ctx, 'rgba(255,224,102,0.6)', x - 8 - p.dx * 4, y + 12, 3, 1); rect(ctx, 'rgba(255,224,102,0.6)', x - 6 - p.dx * 6, y + 8, 3, 1); }
      if (state.buffs.bless > 0) { rect(ctx, 'rgba(255,243,176,0.8)', x - 7, y - 6 - (state.tick >> 2) % 2, 1, 1); rect(ctx, 'rgba(255,243,176,0.8)', x + 7, y - 4, 1, 1); }
      if (p.shield > 0) { ctx.strokeStyle = rgba(look.magic, 0.85); ctx.strokeRect(x - 7.5, y - 3.5, 15, 19); rect(ctx, rgba(look.magic, 0.14), x - 7, y - 3, 14, 18); }
    }
    // Near the top edge there is no room above the head, so the name goes below the feet instead.
    const below = y - 9 < 16, nameY = below ? y + 27 : y - 9, labelX = Math.max(14, Math.min(VIEW.width - 14, x));
    say(p.name, labelX, nameY, { color: hud.me === p.pcId ? '#ffe066' : look.label, size: 5.5 });
    if (MODE_NAMES[p.role]) say(MODE_NAMES[p.role][p.mech.mode], labelX, nameY + (below ? 7 : -7), { size: 4, color: 'rgba(255,255,255,0.78)' });
    const w = 14;
    rect(ctx, '#0e0a08', x - w / 2 - 1, y + 16, w + 2, 4); rect(ctx, '#d9533a', x - w / 2, y + 17, Math.round(w * p.hp / p.max), 2);
  }
  function drawArrows(state, lerp, positions) {
    for (const a of state.arrows) {
      const x = lerp(a.ox, a.x), y = lerp(a.oy, a.y), dx = a.x - a.ox, dy = a.y - a.oy, angle = Math.atan2(dy, dx);
      const caster = a.from >= 0 ? state.players[a.from] : null, mc = caster ? personColors(caster.name, caster.role).magic : '#fff3b0';
      if (a.kind === 'orb') {
        const src = positions.players[a.from], len = Math.max(1, Math.abs(dx) + Math.abs(dy));
        if (a.effect === 'heal') {
          // Ashara's heal beam: a flickering orange line from her to the orb that carries it to the target.
          if (src) {
            ctx.save(); ctx.lineCap = 'round';
            ctx.strokeStyle = rgba(mc, state.tick % 4 < 2 ? 0.55 : 0.4); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(src.x, src.y + 2); ctx.lineTo(x, y); ctx.stroke();
            ctx.strokeStyle = rgba(mix(mc, '#ffffff', 0.7), 0.9); ctx.lineWidth = 1; ctx.stroke();
            ctx.restore();
          }
          rect(ctx, rgba(mc, 0.3), x - 5, y - 5, 10, 10); rect(ctx, mc, x - 3, y - 3, 6, 6); rect(ctx, mix(mc, '#ffffff', 0.7), x - 1, y - 1, 3, 3);
          if (!reduced.matches) spawn({ x, y, vx: (Math.random() - 0.5) * 0.5, vy: -0.2, color: mix(mc, '#ffffff', 0.4), size: 1, life: 0.35, kind: 'spark' });
        } else {
          // Damage mode: a fireball with a flame trail.
          const flick = (state.tick + a.id) % 3;
          rect(ctx, rgba(mc, 0.3), x - 6, y - 6, 12, 12); rect(ctx, mix(mc, '#ff3a1a', 0.45), x - 4 + flick - 1, y - 4, 8, 8); rect(ctx, mc, x - 3, y - 3, 6, 6); rect(ctx, mix(mc, '#ffe066', 0.7), x - 1, y - 1 - flick % 2, 3, 3);
          for (let i = 1; i <= 3; i++) rect(ctx, i === 1 ? mix(mc, '#ffe066', 0.4) : mix(mc, '#ff3a1a', 0.4), Math.round(x - (dx / len) * i * 4 - 1), Math.round(y - (dy / len) * i * 4 - 1 + (i + flick) % 2), 3 - (i > 2 ? 1 : 0), 3 - (i > 2 ? 1 : 0));
          if (!reduced.matches) spawn({ x, y, vx: 0, vy: -0.4, color: mix(mc, '#ffe066', 0.5), size: 2, life: 0.4, kind: 'flame' });
        }
        continue;
      }
      ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
      // Liora's green arrows: a green glow trail, a pale shaft, and a bright head.
      rect(ctx, rgba(mc, 0.28), -15, -1, 9, 3); rect(ctx, rgba(mc, 0.55), -9, 0, 6, 1);
      rect(ctx, mix(mc, '#ffffff', 0.6), -5, 0, 9, 1); rect(ctx, mix(mc, '#ffffff', 0.9), 4, -1, 2, 3); rect(ctx, mc, 6, 0, 1, 1); rect(ctx, mc, -6, -1, 2, 1); rect(ctx, mc, -6, 1, 2, 1);
      ctx.restore();
      if (Math.random() < 0.5 && !reduced.matches) spawn({ x, y, vx: 0, vy: 0.1, color: mc, size: 1, life: 0.25, kind: 'spark' });
    }
  }
  function drawHeld(z, at, state) {
    const x = Math.round(at.x), y = Math.round(at.y), owner = z.holdBy >= 0 ? state.players[z.holdBy] : null;
    // Only Hold Person leaves a hand on the zombie; a stagger or short stun just shows a faint ring.
    const color = owner ? personColors(owner.name, owner.role).magic : '#cfe0ff';
    ctx.strokeStyle = rgba(color, 0.7); ctx.beginPath(); ctx.ellipse(x, y + 14, 9, 3.5, 0, 0, 6.2832); ctx.stroke();
    if (owner) drawHand(x, y + 2 + ((state.tick >> 3) % 2), 0.85, color);
  }
  // The d20 above a character's head: tossed up from their hands, tumbling through random faces, then settling on the
  // real result with the total and tier underneath. Drawn from the game state, so every screen shows the same roll.
  const ROLL_TOSS = 10, ROLL_TUMBLE = 36, ROLL_HOLD = 140, ROLL_END = 165; // ticks since the roll
  const face = (n, seed) => ((Math.imul(n + seed, 2654435761) >>> 0) % 20) + 1;
  function drawRollDie(p, at, state, frac, slot) {
    if (!p.roll) return;
    const elapsed = state.tick - 1 + frac - p.roll.at;
    if (elapsed < 0 || elapsed > ROLL_END) return;
    const look = personColors(p.name, p.role), calm = reduced.matches, settled = calm || elapsed >= ROLL_TUMBLE;
    const homeY = Math.max(26, at.y - 52), startY = at.y - 4, rise = calm ? 1 : Math.min(1, elapsed / ROLL_TOSS);
    const bounce = settled && !calm && elapsed < ROLL_TUMBLE + 12 ? Math.abs(Math.sin((elapsed - ROLL_TUMBLE) * 0.5)) * 3 * (1 - (elapsed - ROLL_TUMBLE) / 12) : 0;
    const cy = startY + (homeY - startY) * (1 - (1 - rise) ** 2) - (settled ? 0 : Math.sin(rise * Math.PI) * 10) - bounce;
    const fade = elapsed > ROLL_HOLD ? Math.max(0, 1 - (elapsed - ROLL_HOLD) / (ROLL_END - ROLL_HOLD)) : 1;
    const step = 1 + Math.floor(elapsed / 9), shown = settled ? p.roll.nat : face(Math.floor(elapsed / step), slot * 7);
    const crit = p.roll.nat === 20, fumble = p.roll.nat === 1, color = settled && crit ? '#e6b422' : settled && fumble ? '#b8343a' : look.body;
    const spin = settled ? 0 : elapsed * 0.5 * (1 - elapsed / ROLL_TUMBLE), x = Math.max(10, Math.min(VIEW.width - 10, at.x));
    const px = T.ox + x * T.scale, py = T.oy + cy * T.scale, r = 11 * T.scale * (settled ? 1 + bounce * 0.04 : 1);
    tctx.save(); tctx.globalAlpha = fade; tctx.translate(px, py); tctx.rotate(spin);
    tctx.beginPath(); for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * Math.PI / 3; tctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); } tctx.closePath();
    tctx.fillStyle = color; tctx.fill(); tctx.lineJoin = 'round'; tctx.lineWidth = Math.max(2, r * 0.14); tctx.strokeStyle = mix(color, '#000000', 0.6); tctx.stroke();
    tctx.beginPath(); for (let k = 0; k < 6; k += 2) { const a = -Math.PI / 2 + k * Math.PI / 3; tctx[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78); } tctx.closePath();
    tctx.lineWidth = Math.max(1, r * 0.07); tctx.strokeStyle = 'rgba(255,255,255,0.45)'; tctx.stroke();
    tctx.restore();
    say(String(shown), x, cy + 3.4, { size: shown > 9 ? 9 : 10, color: '#ffffff', fade });
    if (!settled) return;
    // Just the total: the die already shows the natural roll, and the characters stand close together.
    say(`= ${p.roll.total}`, x, cy + 19, { size: 6, color: '#ffffff', fade });
    say(`Tier ${p.tier}`, x, cy + 25.5, { size: 4.6, color: look.label, fade });
    if (crit || fumble) say(crit ? 'CRIT!' : 'Fumble', x, cy - 15, { size: 6, color: crit ? '#ffd84a' : '#ff8f8f', fade });
  }
  // Public per-role indicators: everyone can see what a teammate is doing.
  function drawMechanic(p, at, state, frac) {
    const x = Math.round(at.x), y = Math.round(at.y);
    if (p.role === 'tank' && p.mech.plant && !p.downed) {
      const pl = p.mech.plant, mc = personColors(p.name, p.role).magic, now = state.tick - 1 + frac, span = PLANT_PERIOD / 0.85;
      const f = Math.max(0, Math.min(1.05, 0.85 - (pl.next - now) / span)), half = plantWindow(p.tier) / span;
      // The shield stands in the ground in front of her and pulses with the beat.
      ctx.save(); ctx.translate(x, y + 9); ctx.scale(1.5, 1.5); ctx.globalAlpha = 0.85;
      ctx.beginPath(); ctx.moveTo(-9, -10); ctx.lineTo(9, -10); ctx.lineTo(9, 3); ctx.lineTo(0, 13); ctx.lineTo(-9, 3); ctx.closePath();
      ctx.fillStyle = rgba(mc, state.tick % 18 < 9 ? 0.5 : 0.38); ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = mc; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(0, 8); ctx.moveTo(-5, -2); ctx.lineTo(5, -2); ctx.lineWidth = 1; ctx.strokeStyle = '#ffffff'; ctx.stroke(); ctx.restore();
      const bw = 34, bx = x - 17, by = y + 21;
      rect(ctx, '#0e0a08', bx - 1, by - 1, bw + 2, 6); rect(ctx, '#243024', bx, by, bw, 4);
      rect(ctx, '#3ddc6a', Math.round(bx + (0.85 - half) * bw), by, Math.max(2, Math.round(2 * half * bw)), 4);
      rect(ctx, '#c9ffd8', Math.round(bx + (0.85 - half / 2) * bw), by, Math.max(1, Math.round(half * bw)), 4);
      rect(ctx, '#ffffff', Math.round(bx + f * bw) - 1, by - 1, 2, 6);
      for (let i = 0; i < pl.max; i++) rect(ctx, i < pl.dur ? mc : 'rgba(255,255,255,0.2)', Math.round(x - pl.max * 3 + i * 6), by + 7, 4, 2);
    } else if ((p.role === 'tank' || p.role === 'simon') && p.mech.charge >= 0 && !p.downed) {
      const held = state.tick - p.mech.charge + frac, w = 30, lo = IDEAL_CHARGE - chargeWindow(p.tier), hi = IDEAL_CHARGE + chargeWindow(p.tier);
      rect(ctx, '#0e0a08', x - w / 2 - 1, y + 21, w + 2, 5);
      rect(ctx, '#5a4a1a', x - w / 2 + Math.round(w * lo / CHARGE_MAX), y + 22, Math.max(1, Math.round(w * (hi - lo) / CHARGE_MAX)), 3);
      rect(ctx, held >= lo && held <= hi ? '#ffd84a' : held > hi ? '#d9533a' : '#9ad0ff', x - w / 2, y + 22, Math.min(w, Math.round(w * held / CHARGE_MAX)), 3);
      ctx.strokeStyle = held >= lo && held <= hi ? 'rgba(255,216,74,0.9)' : rgba(personColors(p.name, p.role).magic, 0.6); ctx.beginPath(); ctx.arc(x, y + 8, 6 + held / 5, 0, 6.2832); ctx.stroke();
    } else if (p.role === 'simon' && p.mech.mode === 1 && p.mech.phase !== 'rest' && !p.downed) {
      const on = p.mech.phase === 'show' ? p.mech.seq[Math.floor((state.tick - p.mech.at) / simonStep(p.tier))] : -1;
      for (let i = 0; i < 4; i++) rect(ctx, i === on ? PAD_COLOR[i] : 'rgba(255,255,255,0.18)', x - 7 + i * 4, y - 24, 3, 3);
      // Each correct glyph adds a coloured orb that circles her, ready to be sent off.
      if (p.mech.phase === 'input') for (let i = 0; i < p.mech.progress; i++) {
        const a = state.tick * 0.14 + (i * 6.2832) / Math.max(3, p.mech.len), ox = x + Math.cos(a) * 11, oy = y + 8 + Math.sin(a) * 5;
        const tint = mix(personColors(p.name, p.role).magic, '#ffe066', (i % 3) * 0.28);
        rect(ctx, rgba(tint, 0.4), Math.round(ox) - 2, Math.round(oy) - 2, 5, 5); rect(ctx, tint, Math.round(ox) - 1, Math.round(oy) - 1, 3, 3);
      }
    } else if (p.role === 'striker' && p.mech.slash && !p.downed) {
      // Two rings close on the target; Space when the outer one meets the inner (green) one.
      const z = state.zombies.find(zombie => zombie.id === p.mech.slash.zid);
      if (z) {
        const zx = Math.round(z.x / PX), zy = Math.round(z.y / PX) + 6, now = state.tick - 1 + frac, left = p.mech.slash.at - now, mc = personColors(p.name, p.role).magic;
        const inner = 7, outer = inner + Math.max(0, left) / SLASH_LEAD * 26, ready = Math.abs(left) <= slashWindow(p.tier);
        ctx.save(); ctx.lineWidth = 1.5;
        ctx.strokeStyle = ready ? '#ffffff' : rgba(mc, 0.9); ctx.beginPath(); ctx.arc(zx, zy, inner, 0, 6.2832); ctx.stroke();
        ctx.strokeStyle = ready ? '#9bff9b' : rgba(mc, 0.6); ctx.beginPath(); ctx.arc(zx, zy, outer, 0, 6.2832); ctx.stroke();
        ctx.setLineDash([2, 4]); ctx.strokeStyle = rgba(mc, 0.25); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y + 6); ctx.lineTo(zx, zy); ctx.stroke();
        ctx.restore();
      }
    }
  }
  // The personal panel for the role you are playing, on the right side of the arena.
  function drawRoleHud(state, frac, hud, dt) {
    padRects = []; modeRects = [];
    const me = state.players.find(p => p.pcId === hud.me);
    for (let i = 0; i < 4; i++) padFlash[i] = Math.max(0, padFlash[i] - dt);
    if (!me || me.downed || hud.status !== 'running' || state.phase !== 'wave') return;
    if (MODE_NAMES[me.role]) drawModeButtons(me);
    if (me.role === 'tank' && me.mech.plant) drawHoldBar(me, state.tick - 1 + frac);
    if (!['cutter', 'simon', 'pitch'].includes(me.role) || me.role === 'simon' && me.mech.mode === 0) return;
    const px = VIEW.width - 76, now = state.tick - 1 + frac;
    if ((me.role === 'cutter' || me.role === 'pitch') && me.mech.mode === 0) {
      // Typing stance: only a small pendulum in the corner, so it never covers a word.
      const tick = now / runeBeat(me.tier), cx = VIEW.width - 14, swing = Math.cos(tick * Math.PI) * 0.7, tipX = cx + Math.sin(swing) * 9, tipY = 30 - Math.cos(swing) * 9;
      rect(ctx, 'rgba(8,8,14,0.6)', cx - 10, 14, 20, 20);
      ctx.save(); ctx.strokeStyle = '#d8c9a8'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, 30); ctx.lineTo(tipX, tipY); ctx.stroke(); ctx.restore();
      rect(ctx, tick - Math.floor(tick) < 0.25 ? '#ffe066' : personColors(me.name, me.role).magic, Math.round(tipX) - 1, Math.round(tipY) - 1, 3, 3);
      return;
    }
    rect(ctx, 'rgba(8,8,14,0.72)', px, 18, 72, 126);
    if (me.role === 'cutter' || me.role === 'pitch') {
      // The metronome: a pendulum that clicks on every beat, and one bar of eight beats. Press each arrow as the playhead crosses it.
      const m = me.mech, bar = m.bar, color = personColors(me.name, me.role).magic, beat = runeBeat(me.tier), tick = now / beat, n = bar ? (now - bar.at) / bar.beat : 0, cx = px + 36;
      const swing = Math.cos(tick * Math.PI) * 0.7, tipX = cx + Math.sin(swing) * 30, tipY = 84 - Math.cos(swing) * 30;
      rect(ctx, '#3a2a1a', cx - 8, 84, 16, 6); rect(ctx, '#5a4a2a', cx - 6, 80, 12, 4);
      ctx.save(); ctx.strokeStyle = '#d8c9a8'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx, 84); ctx.lineTo(tipX, tipY); ctx.stroke(); ctx.restore();
      rect(ctx, tick - Math.floor(tick) < 0.25 ? '#ffe066' : color, Math.round(tipX) - 2, Math.round(tipY) - 2, 5, 5);
      if (bar) {
        for (let i = 0; i < BAR_SLOTS; i++) {
          const x = px + 4 + i * 8, lane = bar.lanes[i], res = bar.res[i];
          rect(ctx, 'rgba(255,255,255,0.1)', x, 104, 7, 14);
          if (lane >= 0) say(LANE_GLYPH[lane], x + 3.5, 114, { size: 7, color: res === 2 ? '#ffe066' : res === 1 ? '#9bff9b' : res < 0 ? '#ff6b5a' : '#ffffff' });
          else rect(ctx, 'rgba(255,255,255,0.3)', x + 3, 110, 2, 2);
        }
        rect(ctx, '#ffffff', Math.round(px + 7.5 + Math.max(-2, Math.min(BAR_SLOTS - 0.5, n)) * 8), 101, 1, 20);
      }
      say(m.mode === 0 ? 'Type on the beat' : m.combo > 1 ? `combo ${m.combo}` : bar ? (n < 0 ? 'Count in…' : 'Arrows on the beat') : 'Rest…', cx, 14, { size: 5.5 });
    } else if (me.role === 'simon') {
      const m = me.mech, step = simonStep(me.tier);
      const lit = m.phase === 'show' ? ((state.tick - m.at) % step < step * 0.7 ? m.seq[Math.floor((state.tick - m.at) / step)] : -1) : -1;
      // A diamond (N, W, S, E) matching the arrow keys; also the layout the page hit-tests against.
      const spots = [[px + 36, 50], [px + 16, 82], [px + 36, 114], [px + 56, 82]];
      padRects = spots.map(([cx, cy], pad) => ({ pad, x: cx - 14, y: cy - 14, size: 28 }));
      spots.forEach(([cx, cy], pad) => drawGlyphPad(cx, cy, 13, pad, lit === pad || padFlash[pad] > 0));
      say(m.phase === 'show' ? 'Watch…' : m.phase === 'input' ? 'Arrows or click' : 'Get ready', px + 36, 14, { size: 5 });
      for (let i = 0; i < m.len && m.phase !== 'rest'; i++) rect(ctx, i < m.progress ? '#9bff9b' : 'rgba(255,255,255,0.3)', px + 36 - m.len * 4 + i * 8, 136, 6, 4);
    }
  }
  // Seris's own timing bar, big and at the top of the arena: tap Space while the marker is in the green.
  function drawHoldBar(me, now) {
    const pl = me.mech.plant, mc = personColors(me.name, me.role).magic, span = PLANT_PERIOD / 0.85;
    const f = Math.max(0, Math.min(1.05, 0.85 - (pl.next - now) / span)), half = plantWindow(me.tier) / span, bw = 150, bx = (VIEW.width - bw) / 2, by = 26;
    rect(ctx, 'rgba(8,8,14,0.78)', bx - 6, by - 14, bw + 12, 34);
    rect(ctx, '#0e0a08', bx - 1, by - 1, bw + 2, 10); rect(ctx, '#243024', bx, by, bw, 8);
    rect(ctx, '#3ddc6a', Math.round(bx + (0.85 - half) * bw), by, Math.max(3, Math.round(2 * half * bw)), 8);
    rect(ctx, '#c9ffd8', Math.round(bx + (0.85 - half / 2) * bw), by, Math.max(2, Math.round(half * bw)), 8);
    rect(ctx, '#ffffff', Math.round(bx + f * bw) - 1, by - 2, 3, 12);
    say('Tap Space in the green', VIEW.width / 2, by - 4, { size: 5 });
    for (let i = 0; i < pl.max; i++) rect(ctx, i < pl.dur ? mc : 'rgba(255,255,255,0.2)', Math.round(VIEW.width / 2 - pl.max * 4 + i * 8), by + 12, 6, 3);
  }
  // Two stance buttons (Q / E, or click) under the role panel.
  function drawModeButtons(me) {
    const x0 = VIEW.width - 76;
    MODE_SHORT[me.role].forEach((label, i) => {
      const bx = x0 + i * 37, on = me.mech.mode === i;
      modeRects.push({ mode: i, x: bx, y: 146, w: 35, h: 12 });
      rect(ctx, on ? 'rgba(255,224,102,0.95)' : 'rgba(8,8,14,0.8)', bx, 146, 35, 12);
      rect(ctx, on ? '#fff3b0' : '#61758f', bx, 146, 35, 1); rect(ctx, on ? '#fff3b0' : '#61758f', bx, 157, 35, 1);
      say(`${i ? 'E' : 'Q'} ${label}`, bx + 17.5, 154.6, { size: 4.2, color: on ? '#1b1b22' : '#e8e8f0' });
    });
  }
  function drawWord(z, at, hud) {
    const typed = hud.typed || '', match = typed && z.word.startsWith(typed) && hud.candidates?.has(z.word), dim = hud.candidates && !hud.candidates.has(z.word);
    const size = 6.5, y = Math.max(13, Math.round(at.y) - (z.type === 'brute' ? 20 : 7));
    tctx.save();
    tctx.font = fontFor(size, true); tctx.textAlign = 'left';
    const width = tctx.measureText(z.word).width / T.scale, left = Math.max(2, Math.min(VIEW.width - width - 2, at.x - width / 2));
    const px = T.ox + left * T.scale, py = T.oy + y * T.scale, pad = 1.6 * T.scale, height = Math.max(11, size * T.scale);
    tctx.fillStyle = 'rgba(10,8,14,0.82)'; tctx.fillRect(px - pad, py - height * 0.92, width * T.scale + pad * 2, height * 1.28);
    tctx.fillStyle = dim ? '#7d838d' : '#f0f0f6'; tctx.fillText(z.word, px, py);
    if (match) { tctx.fillStyle = '#ffe066'; tctx.fillText(typed, px, py); }
    tctx.restore();
    if (z.max > 1) { rect(ctx, '#0e0a08', left - 1, y + 3, Math.ceil(width) + 2, 3); rect(ctx, '#d9533a', left, y + 4, Math.round(Math.ceil(width) * Math.max(0, z.hp) / z.max), 1); }
  }
  function drawParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt / (p.max || 1);
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += (p.vx || 0) * dt * 60; p.y += (p.vy || 0) * dt * 60;
      if (p.kind === 'spark') p.vy += 0.03;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.5));
      if (p.kind === 'slash') {
        const u = 1 - p.life; ctx.save(); ctx.lineCap = 'round'; ctx.globalAlpha = Math.min(1, p.life * 3);
        const stroke = (width, color) => { ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke(); };
        if (p.big) { ctx.beginPath(); ctx.arc(p.x, p.y + 8, 16 + u * 12, -2.7 + u * 1.4, -0.5 + u * 1.4); stroke(3, p.color); stroke(1, '#ffffff'); }
        else for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(p.x + (i - 1) * 4 - 6, p.y - 9 + u * 3); ctx.lineTo(p.x + (i - 1) * 4 + 6, p.y + 7 + u * 3); stroke(2, p.color); stroke(0.8, '#ffffff'); }
        ctx.restore();
      } else if (p.kind === 'shield') {
        const u = 1 - p.life, k = p.scale * (0.7 + 0.3 * Math.min(1, u * 4)), fade = Math.min(1, p.life * 2);
        const fall = p.drop ? -40 * (1 - Math.min(1, u * 3) ** 2) : -4 - u * 4;
        if (p.drop && !p.landed && u * 3 >= 1) { p.landed = true; shake = Math.max(shake, 5); }
        ctx.save(); ctx.translate(p.x, p.y + fall); ctx.scale(k, k); ctx.globalAlpha = fade;
        ctx.beginPath(); ctx.moveTo(-9, -10); ctx.lineTo(9, -10); ctx.lineTo(9, 3); ctx.lineTo(0, 13); ctx.lineTo(-9, 3); ctx.closePath();
        ctx.fillStyle = rgba(p.color, 0.3); ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = p.color; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(0, 8); ctx.moveTo(-5, -2); ctx.lineTo(5, -2); ctx.lineWidth = 1; ctx.strokeStyle = '#ffffff'; ctx.stroke();
        ctx.restore();
      } else if (p.kind === 'beam') {
        ctx.save(); ctx.lineCap = 'round'; ctx.globalAlpha = Math.min(1, p.life * 3);
        ctx.beginPath(); ctx.moveTo(p.x0, p.y0); ctx.lineTo(p.x1, p.y1); ctx.lineWidth = 3; ctx.strokeStyle = p.color; ctx.stroke(); ctx.lineWidth = 1; ctx.strokeStyle = '#ffffff'; ctx.stroke();
        ctx.restore();
      } else if (p.kind === 'flame') rect(ctx, p.color, p.x + Math.sin((p.y + p.max * 40) * 0.5) * 0.8, p.y, p.size || 2, p.size || 2);
      else if (p.kind === 'hand' && p.pose === 'bless') {
        // A blessing hand floats over the head, bobbing and fading.
        const u = 1 - p.life;
        drawHand(Math.round(p.x), Math.round(p.y - 34 - u * 5 + Math.sin(u * 9) * 1.5), Math.min(1, p.life * 2.5), p.color);
        if (!reduced.matches && Math.random() < 0.3) spawn({ x: p.x + (Math.random() - 0.5) * 12, y: p.y - 28, vx: 0, vy: -0.3, color: p.color, size: 1, life: 0.4, kind: 'spark' });
      } else if (p.kind === 'hand') {
        // Falls from above, lands with a slap, then fades; the lasting pressed hand is drawn on the held zombie.
        const u = 1 - p.life, fall = Math.min(1, u / 0.45);
        if (!p.landed && fall >= 1) { p.landed = true; burst(p.x, p.y + 6, mix(p.color, '#ffffff', 0.5), 12, 1.6, 0.45); ring(p.x, p.y + 14, p.color, 18, 0.4); shake = Math.max(shake, 2.5); }
        drawHand(Math.round(p.x), Math.round(p.y + 2 - 46 * (1 - fall * fall)), Math.min(1, p.life * 3), p.color);
      } else if (p.kind === 'text') say(p.text, Math.max(10, Math.min(VIEW.width - 10, p.x)), Math.max(12, p.y), { color: p.color, size: 6.5, fade: Math.max(0, Math.min(1, p.life * 1.5)) });
      else if (p.kind === 'ring') { ctx.strokeStyle = p.color; ctx.beginPath(); ctx.ellipse(p.x, p.y, p.radius * (1 - p.life), p.radius * (1 - p.life) * 0.5, 0, 0, 6.2832); ctx.stroke(); }
      else rect(ctx, p.color, p.x, p.y, p.size || 1, p.size || 1);
    }
    ctx.globalAlpha = 1;
  }
  function drawHud(state, hud, dt) {
    say(state.phase === 'countdown' ? 'Get ready' : `Wave ${Math.max(1, state.wave)} of 6`, 4, 10, { align: 'left', size: 7 });
    // Buffs and the audience count stack under the wave label, so they never run into the role panel on the right.
    const buffs = [state.buffs.haste > 0 && ['Haste', '#ffe066'], state.buffs.bless > 0 && ['Bless', '#fff3b0']].filter(Boolean);
    buffs.forEach(([name, color], i) => say(name, 4, 20 + i * 9, { align: 'left', size: 5.5, color }));
    if (state.crowd.length) say(`${state.crowd.length} in the audience`, 4, 20 + buffs.length * 9, { align: 'left', size: 5.5, color: '#bac8d8' });
    let message = null;
    if (hud.status === 'waiting') message = hud.note || 'Waiting for the GM to start';
    else if ((state.phase === 'countdown' || state.phase === 'between') && hud.prompt) message = hud.prompt;
    else if (state.phase === 'countdown') message = String(Math.max(1, Math.ceil(state.timer / 30)));
    else if (state.phase === 'won') message = 'The gate holds!';
    else if (state.phase === 'lost') message = 'Overrun';
    else if (banner) { banner.life -= dt; if (banner.life <= 0) banner = null; else message = banner.text; }
    if (message) say(message, VIEW.width / 2, 72, { size: 15, color: state.phase === 'lost' ? '#ff6b5a' : '#ffe066' });
  }
  // What the mouse is over: one of Simon's glyphs, a stance button, or nothing.
  function hudAt(clientX, clientY) {
    const box = textCanvas.getBoundingClientRect(), x = (clientX - box.left - T.ox) / T.scale, y = (clientY - box.top - T.oy) / T.scale;
    const pad = padRects.find(r => x >= r.x && x <= r.x + r.size && y >= r.y && y <= r.y + r.size);
    if (pad) return { type: 'pad', index: pad.pad };
    const mode = modeRects.find(r => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
    return mode ? { type: 'mode', index: mode.mode } : null;
  }
  const flashPad = pad => { padFlash[pad] = 0.25; };
  return { draw, hudAt, flashPad, destroy() { particles.length = 0; } };
}

export { SPELLS };
