import { isGM, canControlPC } from './session-role.js';
import { openPanel } from './menu-bar.js';
import { showMapMenu, closeMapMenu } from './map-object-menu.js';
import { triggerRule, triggerObject, triggerName, objectRef, sameObject } from './trigger-model.js';

const $ = id => document.getElementById(id);
export function triggerMenuItem(ref) {
  return { label: 'Trigger', action: () => $('floor').dispatchEvent(new CustomEvent('trigger-menu', { detail: ref })) };
}
export function requestObjectInteraction(ref) {
  const floor = $('floor'), tokens = floor.tabletopMap?.tokens || [];
  const token = tokens.find(token => token.id === floor.selectedTokenId && token.kind === 'pc' && canControlPC(token)) ||
    (!isGM && tokens.find(token => token.kind === 'pc' && canControlPC(token)));
  if (!token && !isGM) { $('session-status').textContent = 'Select a PC you control first.'; return; }
  floor.dispatchEvent(new CustomEvent(isGM ? 'vtt-object-interact' : 'session-action', {
    detail: {type:'interact',ref,tokenId:token?.id ?? null}
  }));
}
export function interactionMenuItems(ref) {
  return ($('floor').tabletopMap?.triggers || []).some(rule => rule.event === 'interact' && sameObject(rule.source,ref)) ?
    [{ label:'Interact', action:() => requestObjectInteraction(ref) }] : [];
}
export function mountTriggers(getMap, change, stopEditing) {
  const floor = $('floor'), panel = $('trigger-panel'), svg = $('map-view');
  let draft, picking = null, sceneMap;
  function reset() { picking = null; draft = null; panel.hidden = true; }
  function status(text) { $('trigger-status').textContent = text; $('session-status').textContent = text; }
  function labels() {
    $('trigger-source').textContent = `From: ${triggerName(getMap(),draft.source)}`;
    $('trigger-target').textContent = `To: ${draft.target ? triggerName(getMap(),draft.target) : 'Choose object'}`;
    $('trigger-connect').disabled = !triggerObject(getMap(),draft.target);
  }
  function fields() {
    const effect = $('trigger-effect').value;
    $('trigger-state-label').hidden = effect !== 'state';
    $('trigger-damage-fields').hidden = effect !== 'damage';
    $('trigger-move-fields').hidden = effect !== 'move' && effect !== 'spawn';
  }
  function pick(mode) {
    stopEditing(); closeMapMenu(); picking = mode;
    status(mode === 'target' ? 'Click an object to connect.' : 'Click the destination cell.');
  }
  function edit(rule, source) {
    reset(); stopEditing(); sceneMap = getMap();
    draft = { id: crypto.randomUUID(), source, event: 'collision', effect: 'state', state: 'toggle', damageTarget: 'self', damage: '1d6', ...(rule ? structuredClone(rule) : {}) };
    labels(); $('trigger-form').hidden = !rule; $('trigger-connect').hidden = !!rule;
    $('trigger-delete').hidden = !rule;
    for (const key of ['event','effect','state','damageTarget','damage','x','y']) $(key === 'damageTarget' ? 'trigger-damage-target' : `trigger-${key}`).value = draft[key] ?? '';
    fields(); openPanel(panel); status('');
    if (!rule) pick('target');
  }
  floor.addEventListener('trigger-menu', event => {
    const source = event.detail;
    if (!isGM || !triggerObject(getMap(),source)) return;
    const rect = svg.getBoundingClientRect();
    showMapMenu(rect.left + 24,rect.top + 24,[
      { label: 'Connect to...', action: () => edit(null,source) },
      ...(getMap().triggers || []).filter(rule => sameObject(rule.source,source)).map(rule => ({
        label: `${rule.event}: ${rule.effect} → ${triggerName(getMap(),rule.target)}`, action: () => edit(rule,source)
      }))
    ]);
  });
  function refAt(event) {
    const target = event.target.closest('[data-trigger-id]');
    return target ? {layer:target.dataset.triggerLayer,id:target.dataset.triggerId} : null;
  }
  window.addEventListener('pointerdown', event => {
    if (!picking || event.button !== 0 || !event.target.closest('#map-view')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!isGM || getMap() !== sceneMap || floor.getAttribute('aria-busy') === 'true') { reset(); return; }
    if (picking === 'target') {
      const ref = refAt(event);
      if (!ref || !triggerObject(getMap(),ref)) { status('Choose an object.'); return; }
      draft.target = ref; labels();
    } else {
      const point = new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());
      if (!point) return;
      $('trigger-x').value = Math.floor(point.x) + .5; $('trigger-y').value = Math.floor(point.y) + .5;
    }
    picking = null; status(''); openPanel(panel);
  },true);
  $('trigger-pick-target').addEventListener('click', () => { if (draft) pick('target'); });
  $('trigger-pick-destination').addEventListener('click', () => pick('destination'));
  $('trigger-connect').addEventListener('click', () => {
    if (!draft?.target) return;
    picking = null; $('trigger-form').hidden = false; $('trigger-connect').hidden = true;
    const target = triggerObject(getMap(),draft.target);
    $('trigger-x').value = target?.x ?? ''; $('trigger-y').value = target?.y ?? '';
    $('trigger-event').focus();
  });
  $('trigger-effect').addEventListener('change', fields);
  $('trigger-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!isGM || !draft || getMap() !== sceneMap) return;
    try {
      if (!triggerObject(getMap(),draft.source) || !triggerObject(getMap(),draft.target)) throw new Error('An object was removed. Reconnect it.');
      const rule = triggerRule({...draft,event:$('trigger-event').value,effect:$('trigger-effect').value,state:$('trigger-state').value,
        damageTarget:$('trigger-damage-target').value,damage:$('trigger-damage').value,
        x:$('trigger-x').value === '' ? NaN : Number($('trigger-x').value),y:$('trigger-y').value === '' ? NaN : Number($('trigger-y').value)});
      const target=triggerObject(getMap(),rule.target);
      if(rule.effect==='state' && rule.target.layer==='doors' && target.type==='window') throw new Error('Choose a door instead of a window.');
      if(rule.effect==='spawn' && target.kind==='pc') throw new Error('Choose a prop or NPC token to spawn.');
      if(rule.effect==='spawn' && (rule.x<0 || rule.y<0 || rule.x>getMap().width || rule.y>getMap().height)) throw new Error('Spawn destination must stay within the map.');
      if(['move','spawn'].includes(rule.effect) && rule.target.layer==='tokens' && (rule.x<target.size/2 || rule.y<target.size/2 || rule.x>getMap().width-target.size/2 || rule.y>getMap().height-target.size/2)) throw new Error('Token destination must stay within the map.');
      if (!getMap().triggers.some(item => item.id === rule.id) && getMap().triggers.length >= 256) throw new Error('Maximum 256 connections per floor.');
      change(() => { getMap().triggers = getMap().triggers.filter(item => item.id !== rule.id); getMap().triggers.push(rule); });
      reset(); $('session-status').textContent = 'Trigger saved.';
    } catch (error) { status(error.message); }
  });
  $('trigger-delete').addEventListener('click', () => {
    if (!isGM || !draft || getMap() !== sceneMap) return;
    try { change(() => { getMap().triggers = getMap().triggers.filter(rule => rule.id !== draft.id); }); reset(); }
    catch (error) { status(error.message); }
  });
  $('trigger-cancel').addEventListener('click', reset);
  panel.querySelector('.editor-close').addEventListener('click', reset);
  new MutationObserver(() => { if (panel.hidden) picking = null; }).observe(panel,{attributes:true,attributeFilter:['hidden']});
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && draft) { event.preventDefault(); reset(); } },true);
  floor.addEventListener('map-ready', reset);
}
