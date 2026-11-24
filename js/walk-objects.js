import { PROPS, PROP_CATEGORIES, propProperties } from './prop-model.js';
import { propIcon } from './prop-icons.js';
import { TOKEN_ICONS, TOKEN_SYMBOLS, npcCatalog, tokenIcon, tokenProperties } from './token-model.js';
import { tokenImage, tokenImages } from './token-art.js';
import { loadSheetReference } from './sheet-view.js';
import { TILE_W, TILE_H } from './walk-model.js';

const $ = id => document.getElementById(id);
let sources = [], loading;
export function mountWalkObjects() {
  $('walk-prop-category').append(...Object.keys(PROP_CATEGORIES).map(name => new Option(name, name)));
  $('walk-prop-kind').append(...Object.entries(PROPS).map(([kind, prop]) => new Option(prop.name, kind)));
  const palette = () => {
    const kinds = PROP_CATEGORIES[$('walk-prop-category').value];
    if (!kinds.includes($('walk-prop-kind').value)) $('walk-prop-kind').value = kinds[0];
    $('walk-prop-palette').replaceChildren(...kinds.map(kind => {
      const button = document.createElement('button'); button.type = 'button'; button.title = PROPS[kind].name;
      button.setAttribute('aria-label', PROPS[kind].name); button.setAttribute('aria-pressed', String(kind === $('walk-prop-kind').value));
      button.append(propIcon(kind));
      button.addEventListener('click', () => { $('walk-prop-kind').value = kind; palette(); });
      return button;
    }));
  };
  $('walk-prop-category').addEventListener('change', palette); palette();
  $('walk-token-icon').append(...TOKEN_ICONS.map(name => new Option(name, name.toLowerCase())));
  for (const id of ['walk-token-pc', 'walk-token-npc']) $(id).addEventListener('change', () => {
    $(id === 'walk-token-pc' ? 'walk-token-npc' : 'walk-token-pc').value = '';
    const source = sources.find(t => t.npcId === $(id).value);
    $('walk-token-name').value = source?.name || 'Blank Token'; $('walk-token-size').value = source?.size || 1; $('walk-token-hp').value = source?.hp || 0;
    $('walk-token-icon').value = tokenIcon(source?.name?.toLowerCase());
  });
}
export function loadWalkTokenSources() {
  return loading ||= (async () => {
    const base = window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, '');
    const read = async path => {
      const response = await fetch(`${base}/${path}.json`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Character source returned ${response.status}`);
      return response.json();
    };
    const results = await Promise.allSettled([read('v2/worlds/gaia/entities'), read('characters/npcs'), loadSheetReference(), tokenImages()]);
    sources = npcCatalog(results[0].status === 'fulfilled' ? results[0].value : {}, results[1].status === 'fulfilled' ? results[1].value : {}, results[2].status === 'fulfilled' ? results[2].value : {});
    for (const id of ['walk-token-pc', 'walk-token-npc']) {
      const list = sources.filter(t => (t.kind === 'pc') === (id === 'walk-token-pc'));
      $(id).replaceChildren(new Option(id === 'walk-token-pc' ? 'Select PC' : 'Blank Token', ''), ...list.map(t => new Option(t.name, t.npcId)));
    }
    if (results[3].status === 'fulfilled') $('walk-token-art').replaceChildren(new Option('Select image', ''), ...results[3].value.map(file => new Option(file, file)));
    if (results.some(r => r.status === 'rejected')) throw new Error('Some token sources could not load. Reopen Tokens to retry.');
  })().catch(error => { loading = null; throw error; });
}
export function walkObjectSettings(layer) {
  if (layer === 'props') return propProperties($('walk-prop-kind').value, Number($('walk-prop-size').value), Number($('walk-prop-rotation').value));
  const source = sources.find(t => t.npcId === ($('walk-token-pc').value || $('walk-token-npc').value));
  const rotation = Number($('walk-token-rotation').value);
  if (!Number.isFinite(rotation)) throw new Error('Enter a rotation in degrees.');
  return { ...source, ...tokenProperties($('walk-token-name').value, Number($('walk-token-size').value), Number($('walk-token-hp').value)), icon: tokenIcon($('walk-token-icon').value), rotation,
    ...($('walk-token-art').value ? { imageName: $('walk-token-art').value } : {}) };
}
export function selectWalkObject(layer, object) {
  if (layer === 'props') {
    $('walk-prop-kind').value = object.kind;
    $('walk-prop-category').value = Object.keys(PROP_CATEGORIES).find(category => PROP_CATEGORIES[category].includes(object.kind));
    $('walk-prop-category').dispatchEvent(new Event('change'));
    $('walk-prop-size').value = object.size; $('walk-prop-rotation').value = object.rotation;
  } else {
    $('walk-token-pc').value = object.kind === 'pc' ? object.npcId || '' : '';
    $('walk-token-npc').value = object.kind === 'pc' ? '' : object.npcId || '';
    $('walk-token-name').value = object.name; $('walk-token-size').value = object.size; $('walk-token-hp').value = object.hp;
    $('walk-token-icon').value = tokenIcon(object.icon); $('walk-token-art').value = object.imageName || ''; $('walk-token-rotation').value = object.rotation || 0;
  }
}
const propPaths = new Map(), images = new Map();
export function drawWalkProp(ctx, prop, origin) {
  const definition = PROPS[prop.kind];
  if (!definition) return;
  if (!propPaths.has(prop.kind)) propPaths.set(prop.kind, new Path2D(definition.path));
  ctx.save(); ctx.translate(origin.x + prop.x * TILE_W, origin.y + prop.y * TILE_H); ctx.rotate(prop.rotation * Math.PI / 180);
  ctx.scale(definition.width * prop.size * TILE_W / 24, definition.depth * prop.size * TILE_H / 24); ctx.translate(-12, -12);
  ctx.fillStyle = prop.active ? '#7ee09a' : prop.colors?.base || definition.color; ctx.strokeStyle = '#201c18'; ctx.lineWidth = 0.8;
  ctx.fill(propPaths.get(prop.kind)); ctx.stroke(propPaths.get(prop.kind)); ctx.restore();
}
export function drawWalkToken(ctx, token, origin) {
  const x = origin.x + token.x * TILE_W, y = origin.y + token.y * TILE_H, r = token.size * TILE_W * 0.4;
  const url = tokenImage(token);
  if (url && !images.has(url)) { const img = new Image(); images.set(url, img); img.src = url; }
  const img = images.get(url);
  ctx.save(); ctx.translate(x, y); ctx.rotate((token.rotation || 0) * Math.PI / 180);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fillStyle = token.colors?.base || '#49688c'; ctx.fill();
  if (img?.complete && img.naturalWidth) { ctx.save(); ctx.clip(); ctx.drawImage(img, -r, -r, r * 2, r * 2); ctx.restore(); }
  else { ctx.fillStyle = '#fff'; ctx.font = `bold ${r}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(TOKEN_SYMBOLS[token.icon] || token.name.slice(0, 1), 0, 0); }
  ctx.lineWidth = 2; ctx.strokeStyle = '#c6d7eb'; ctx.stroke(); ctx.restore();
  ctx.font = '700 12px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff';
  ctx.strokeText(token.name, x, y - r - 6); ctx.fillText(token.name, x, y - r - 6);
  ctx.font = '11px system-ui'; const hp = `${token.hp}${token.hpMax ? `/${token.hpMax}` : ''} HP`;
  ctx.strokeText(hp, x, y + r + 14); ctx.fillText(hp, x, y + r + 14);
}
