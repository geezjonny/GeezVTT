// Map tokens for the minigame, mirroring index.html: a token is a PC, an NPC (both from the shared character catalog) or a
// plain picture from token/index.json. They live in raw.geezvtt_editor.tokens as { x, y, kind, name, image?, size, geezvtt_hidden? }.
import { tokenImages, tokenImage } from './token-art.js';
import { decodeTree } from './firebase-codec.js';

const SIZES = { tiny: .5, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 };
const base = () => window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, '');
async function read(path) {
  const response = await fetch(`${base()}/${path}.json`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
  return decodeTree(await response.json());
}
const sizeOf = data => {
  const v = data?.size ?? data?.basic?.size, n = SIZES[String(v).toLowerCase()] ?? Number(v);
  return Number.isFinite(n) && n >= .5 && n <= 20 && Number.isInteger(n * 2) ? n : 1;
};

let catalog;
// -> { pc: [{ name, size }], npc: [{ name, size }], images: [filename] } (each part empty if its source is unreachable)
export function tokenCatalog() {
  return catalog ||= (async () => {
    const out = { pc: [], npc: [], images: [] };
    const [entities, legacy, images] = await Promise.allSettled([read('v2/worlds/gaia/entities'), read('characters/npcs'), tokenImages()]);
    const seen = new Set();
    if (entities.status === 'fulfilled') for (const e of Object.values(entities.value || {})) {
      if (!['pc', 'npc'].includes(e?.kind) || e.data?._sheetsDeleted || typeof e.name !== 'string' || !e.name.trim()) continue;
      out[e.kind].push({ name: e.name.trim(), size: sizeOf(e.data) }); seen.add(e.name.trim().toLowerCase());
    }
    if (legacy.status === 'fulfilled') for (const n of Object.values(legacy.value || {})) {
      const name = typeof n?.name === 'string' ? n.name.trim() : '';
      if (name && !n._sheetsDeleted && !seen.has(name.toLowerCase())) out.npc.push({ name, size: sizeOf(n) });
    }
    if (images.status === 'fulfilled') out.images = images.value;
    for (const k of ['pc', 'npc']) out[k].sort((a, b) => a.name.localeCompare(b.name));
    return out;
  })().catch(error => { catalog = null; throw error; });
}

// Picture for a token, or null while loading / when it has none. PCs and NPCs use token/<name>.png; plain tokens use their chosen file.
const cache = new Map();
export function tokenPicture(t) {
  const url = tokenImage({ name: t.kind === 'token' ? '' : t.name, imageName: t.kind === 'token' ? t.image : '' });
  if (!url) return null;
  let img = cache.get(url);
  if (!img) { img = new Image(); img.onerror = () => { img.failed = true; }; img.src = url; cache.set(url, img); }
  return img.complete && img.naturalWidth && !img.failed ? img : null;
}
