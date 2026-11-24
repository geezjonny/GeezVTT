import { distance, crosses, segments } from './map-editor-model.js';
import { PROPS, propDimensions } from './prop-model.js';
import { buildExpressionRoll } from './dice-roll.js';

export const TRIGGER_LAYERS = ['props', 'doors', 'tokens', 'lights', 'portals', 'floors', 'walls'];
const validRef = ref => ref && TRIGGER_LAYERS.includes(ref.layer) && typeof ref.id === 'string' && ref.id.length > 0 && ref.id.length <= 100;
export const sameObject = (a, b) => !!a && !!b && a.layer === b.layer && a.id === b.id;
export const triggerObject = (map, ref) => validRef(ref) ? map?.[ref.layer]?.find(object => object.id === ref.id) : null;
export const objectRef = (layer, object) => ({ layer, id: object.id });
export function triggerName(map, ref) {
  const object = triggerObject(map, ref);
  return object ? object.name || PROPS[object.kind]?.name || ref.layer.slice(0, -1) : 'Missing object';
}
export function triggerRule(rule) {
  if (!rule || !validRef(rule.source) || !validRef(rule.target) || !['collision', 'interact'].includes(rule.event)) throw new Error('Choose two objects and a trigger.');
  if (!['state', 'damage', 'move'].includes(rule.effect)) throw new Error('Choose an effect.');
  const result = { id: rule.id, source: { layer:rule.source.layer,id:rule.source.id }, target: { layer:rule.target.layer,id:rule.target.id }, event: rule.event, effect: rule.effect };
  if (typeof result.id !== 'string' || !/^[\w-]{1,100}$/.test(result.id)) throw new Error('Invalid connection ID.');
  if (rule.effect === 'state') {
    if (!['props', 'doors', 'lights'].includes(rule.target.layer) || !['toggle', 'open', 'close', 'lock', 'unlock', 'toggle-lock'].includes(rule.state) || rule.target.layer === 'lights' && ['lock', 'unlock', 'toggle-lock'].includes(rule.state)) throw new Error('Choose a prop, door, or light for this state.');
    result.state = rule.state;
  } else if (rule.effect === 'damage') {
    if (!['self', 'target'].includes(rule.damageTarget) || rule.damageTarget === 'target' && rule.target.layer !== 'tokens') throw new Error('Choose a token for specific damage.');
    if (typeof rule.damage !== 'string') throw new Error('Enter fixed damage or a dice formula.');
    buildExpressionRoll(rule.damage, 'normal', () => 1);
    result.damage = rule.damage.trim(); result.damageTarget = rule.damageTarget;
  } else {
    if (!['props', 'tokens'].includes(rule.target.layer) || !Number.isFinite(rule.x) || !Number.isFinite(rule.y) || Math.abs(rule.x) > 10000 || Math.abs(rule.y) > 10000) throw new Error('Choose a prop/token and a destination.');
    result.x = rule.x; result.y = rule.y;
  }
  return result;
}
export function importedTriggers(value) {
  const ids = new Set();
  return (Array.isArray(value) ? value.slice(0, 256) : []).flatMap(rule => {
    try { const clean = triggerRule(rule); if (ids.has(clean.id)) return []; ids.add(clean.id); return [clean]; } catch { return []; }
  });
}

function touches(object, layer, from, to) {
  if (layer === 'walls' || layer === 'doors') return segments(object.points).some(([a,b]) => crosses(from,to,a,b) || distance(to,a,b) < .12);
  if (layer !== 'props' && layer !== 'floors') return distance(object,from,to) < (layer === 'tokens' ? object.size / 2 : .2);
  const angle = -(object.rotation || 0) * Math.PI / 180;
  const local = p => ({ x: (p.x-object.x)*Math.cos(angle)-(p.y-object.y)*Math.sin(angle), y: (p.x-object.x)*Math.sin(angle)+(p.y-object.y)*Math.cos(angle) });
  const a = local(from), b = local(to), dimensions = layer === 'props' ? propDimensions(object) : { width: 1, depth: 1 };
  const w = dimensions.width * (object.size || 1) / 2, h = dimensions.depth * (object.size || 1) / 2;
  const inside = p => Math.abs(p.x) < w && Math.abs(p.y) < h;
  return inside(a) || inside(b) || segments([{x:-w,y:-h},{x:w,y:-h},{x:w,y:h},{x:-w,y:h},{x:-w,y:-h}]).some(([c,d]) => crosses(a,b,c,d));
}
export function collisionSources(map, token, from, path) {
  if (token.kind !== 'pc') return [];
  const refs = [], seen = new Set();
  for (const to of path) {
    for (const rule of map.triggers || []) {
      if (rule.event !== 'collision' || sameObject(rule.source, objectRef('tokens', token))) continue;
      const source = triggerObject(map, rule.source), key = `${rule.source.layer}:${rule.source.id}`;
      if (source && !seen.has(key) && !touches(source,rule.source.layer,from,from) && touches(source,rule.source.layer,from,to)) {
        refs.push(rule.source); seen.add(key);
      }
    }
    from = to;
  }
  return refs;
}

// Effects never emit interaction events; only a player's explicit toggle does.
export function activateTriggers(map, event, sources, actor) {
  const damage = [], fired = new Set(), queue = sources.map(source => ({ event, source, actor }));
  while (queue.length) {
    const activation = queue.shift();
    for (const raw of map.triggers || []) {
      if (fired.has(raw.id) || raw.event !== activation.event || !sameObject(raw.source, activation.source)) continue;
      let rule;
      try { rule = triggerRule(raw); } catch { continue; }
      const source = triggerObject(map,rule.source), target = triggerObject(map,rule.target);
      if (!source || !target) continue;
      fired.add(rule.id);
      if (rule.effect === 'damage') {
        const token = rule.damageTarget === 'self' ? activation.actor : rule.target.layer === 'tokens' ? target : null;
        damage.push({ token, formula: rule.damage });
      } else if (rule.effect === 'move') {
        if (rule.target.layer === 'tokens' && (rule.x < target.size/2 || rule.y < target.size/2 || rule.x > map.width-target.size/2 || rule.y > map.height-target.size/2)) continue;
        const before = {x:target.x,y:target.y};
        const portal = rule.target.layer === 'props' && ['ladder','stairs'].includes(target.kind) && map.portals?.find(portal => Math.hypot(portal.x-target.x,portal.y-target.y)<.5);
        target.x = rule.x; target.y = rule.y;
        if (portal) { portal.x = target.x; portal.y = target.y; }
        if (rule.target.layer === 'tokens') for (const ref of collisionSources(map,target,before,[target])) queue.push({event:'collision',source:ref,actor:target});
      } else if (rule.target.layer === 'lights') {
        target.off = rule.state === 'toggle' ? !target.off : rule.state === 'close';
      } else {
        if (rule.target.layer === 'doors' && target.type === 'window') continue;
        if (rule.state === 'lock' || rule.state === 'unlock' || rule.state === 'toggle-lock') {
          target.locked = rule.state === 'toggle-lock' ? !target.locked : rule.state === 'lock';
          if (target.locked) target.open = false;
        } else {
          const open = rule.state === 'toggle' ? !target.open : rule.state === 'open';
          if (!open || !target.locked) target.open = open;
        }
      }
    }
  }
  return damage;
}

export function applyTrapDamage(pc, amount) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Invalid trap damage.');
  pc.combat ||= {};
  const hp = Number(pc.combat.hp_current ?? pc.combat.hp_max ?? 0), temp = Number(pc.combat.temp_hp ?? 0);
  if (!Number.isSafeInteger(hp) || hp < 0 || !Number.isSafeInteger(temp) || temp < 0) throw new Error('Invalid current HP.');
  pc.combat.temp_hp = Math.max(0,temp-amount);
  pc.combat.hp_current = Math.max(0,hp-Math.max(0,amount-temp));
}
