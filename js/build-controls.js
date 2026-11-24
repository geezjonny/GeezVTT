import { openPanel } from './menu-bar.js';
import { isGM } from './session-role.js';
import { MATERIAL_LAYERS } from './map-editor-model.js';
import { PROPS } from './prop-model.js';
import { propIcon } from './prop-icons.js';
import { materialURL } from './material-textures.js';
import { showMapMenu, closeMapMenu } from './map-object-menu.js';

const $=id=>document.getElementById(id);
const floor=$('floor'), panel=$('build-panel');
const buttons=[...panel.querySelectorAll('[data-build-layer]')];
$('open-build').addEventListener('click',()=>{openPanel(panel); $('build-collapse').focus();});
function start(layer) {
  if(!isGM || !floor.tabletopMap || floor.getAttribute('aria-busy')==='true') return;
  for(const settings of document.querySelectorAll('[data-swatch-layer]')) settings.hidden=true;
  floor.dispatchEvent(new CustomEvent('build-start',{detail:layer}));
  ($('map-view').hidden ? $('view-3d').querySelector('canvas') : $('map-view'))?.focus({preventScroll:true});
}
for(const button of buttons) {
  const layer=button.dataset.buildLayer;
  if(layer==='floors') button.title='Floors: click to place; Left Shift-click to fill a room';
  if(!['lights','portals'].includes(layer)) button.setAttribute('aria-haspopup','menu');
  button.addEventListener('click',()=>{
    if(!isGM || button.disabled || floor.getAttribute('aria-busy')==='true') return;
    const rect=button.getBoundingClientRect();
    if(layer==='props') {
      showMapMenu(rect.left,rect.bottom,Object.entries(PROPS).map(([kind,prop])=>({
        label:prop.name,icon:propIcon(kind),action:()=>{
          $('prop-kind').value=kind; $('prop-kind').dispatchEvent(new Event('input')); start(layer);
        }
      })),button,rect);
    } else if(['walls','floors','doors'].includes(layer)) {
      const input=$(layer==='walls'?'edit-material':layer==='floors'?'edit-floor-material':'edit-door-material');
      showMapMenu(rect.left,rect.bottom,MATERIAL_LAYERS[layer].map(material=>{
        const icon=document.createElement('span'); icon.className='material-swatch'; icon.setAttribute('aria-hidden','true');
        icon.style.backgroundImage=`url("${materialURL(material)}")`;
        return {label:material,icon,action:()=>{input.value=material; input.dispatchEvent(new Event('change')); start(layer);}};
      }),button,rect);
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
