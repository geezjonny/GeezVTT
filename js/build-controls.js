import { openPanel } from './menu-bar.js';
import { isGM } from './session-role.js';
import { PROPS, PROP_CATEGORIES } from './prop-model.js';
import { propIcon } from './prop-icons.js';
import { showMapMenu, closeMapMenu } from './map-object-menu.js';

const $=id=>document.getElementById(id);
const floor=$('floor'), panel=$('build-panel');
const buttons=[...panel.querySelectorAll('[data-build-layer]')];
$('open-build').addEventListener('click',()=>{openPanel(panel); $('build-collapse').focus();});
function start(layer) {
  if(!isGM || !floor.tabletopMap || floor.getAttribute('aria-busy')==='true') return;
  floor.dispatchEvent(new CustomEvent('build-start',{detail:layer}));
  ($('map-view').hidden ? $('view-3d').querySelector('canvas') : $('map-view'))?.focus({preventScroll:true});
}
for(const button of buttons) {
  const layer=button.dataset.buildLayer;
  if(layer==='floors') button.title='Floors: click to paint one cell; hold and drag to paint; Left Shift-click to fill a room';
  const swatches=['walls','floors','doors'].includes(layer)?$(`${layer}-panel`):null;
  if(swatches) {
    button.setAttribute('aria-controls',swatches.id);
    const sync=()=>button.setAttribute('aria-expanded',String(!swatches.hidden));
    new MutationObserver(sync).observe(swatches,{attributes:true,attributeFilter:['hidden']});
    sync();
  } else if(layer==='props') button.setAttribute('aria-haspopup','menu');
  button.addEventListener('click',()=>{
    if(!isGM || button.disabled || floor.getAttribute('aria-busy')==='true') return;
    const rect=button.getBoundingClientRect();
    if(layer==='props') {
      showMapMenu(rect.left,rect.bottom,Object.entries(PROP_CATEGORIES).map(([category,kinds])=>({
        label:category,action:()=>showMapMenu(rect.left,rect.bottom,kinds.map(kind=>({
        label:PROPS[kind].name,icon:propIcon(kind),action:()=>{
          $('prop-kind').value=kind; $('prop-kind').dispatchEvent(new Event('input')); start(layer);
        }
      })),button,rect)
      })),button,rect);
    } else if(swatches) {
      closeMapMenu();
      if(!swatches.hidden) { swatches.hidden=true; return; }
      start(layer);
      openPanel(swatches);
      swatches.querySelector('[data-material]').focus();
    } else start(layer);
  });
}
$('vtt-tokens').addEventListener('click',()=>$('open-tokens').click());
function state() {
  const disabled=!floor.tabletopMap;
  for(const button of buttons) {
    button.disabled=disabled;
    button.setAttribute('aria-pressed',String(floor.buildLayer===button.dataset.buildLayer));
  }
  $('vtt-tokens').disabled=$('open-tokens').disabled;
}
for(const type of ['map-ready','build-state']) floor.addEventListener(type,state);
new MutationObserver(()=>{closeMapMenu(); state();}).observe($('toggle-3d'),{attributes:true,attributeFilter:['aria-pressed']});
new MutationObserver(state).observe($('open-tokens'),{attributes:true,attributeFilter:['disabled']});
state();
