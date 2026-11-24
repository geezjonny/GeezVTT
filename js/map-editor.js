import { visibleObject, visibilityFor } from './player-vision.js';
import { tokenImage } from './token-art.js';
import { resizeObject, resizeDoorWalls } from './object-size.js';
import { readPC, pcInventory, takeChestItems, damagePCFromTrap } from './pc-inventory.js';
import { loadSheetReference } from './sheet-view.js';
import { LOOT_TIERS, generateLoot, lootItem } from './loot-model.js';
import { COIN_TYPES } from './inventory-model.js';
import { buildRoll, buildExpressionRoll } from './dice-roll.js';
import { openPanel } from './menu-bar.js';
import { MATERIALS, MATERIAL_LAYERS, clone, segments, cutDoorOpening, distance, inBox, bucketCells, portalType } from './map-editor-model.js';
import { isGM, canControlPC } from './session-role.js';
import { importedTokens, tokenProperties, crossesWindow, pcTokenStatus, tokenIcon, TOKEN_SYMBOLS } from './token-model.js';
import { environmentSettings } from './environment-model.js';
import { importedPortals, portalDestination, PORTAL_ICONS } from './portal-model.js';
import { playerDestination } from './player-actions.js';
import { initiativeState } from './initiative-model.js';
import { onMapRightClick } from './map-right-click.js';
import { showMapMenu, closeMapMenu } from './map-object-menu.js';
import { installMaterialPatterns, materialURL } from './material-textures.js';
import { PROPS, PROP_CATEGORIES, hasCompartment, importedProps, propProperties, propDistance, propAppearance, propCorners } from './prop-model.js';
import { propIcon, propMarker } from './prop-icons.js';
import { tabletopPoint, previewPlacement } from './map-view-toggle.js';
import { importedTriggers, activateTriggers, collisionSources, objectRef, triggerObject } from './trigger-model.js';
import { mountTriggers, triggerMenuItem, requestObjectInteraction, interactionMenuItems } from './trigger-controls.js';

const $ = id => document.getElementById(id);
const floor=$('floor'), svg=$('map-view'), preview=$('edit-preview');
const controls=$('editor-controls'), layerInput=$('edit-layer'), toolInput=$('edit-tool');
const panel=$('editor-panel');
const host=$('view-3d');
const showHiddenPortals=()=>isGM || !panel.hidden && !$('portals-panel').hidden && layer()==='portals';
const showHiddenProps=()=>isGM || !panel.hidden && !$('props-panel').hidden && layer()==='props';
installMaterialPatterns(svg);
let model, selected=new Set(), undo=[], redo=[], chain=[], hover, gesture;
let pendingPortal, travelling=false, leftShift=false;
window.addEventListener('keydown',event=>{if(event.code==='ShiftLeft') leftShift=true;});
window.addEventListener('keyup',event=>{if(event.code==='ShiftLeft') leftShift=false;});
window.addEventListener('blur',()=>{leftShift=false;});
const layer=()=>layerInput.value, tool=()=>toolInput.value;
const pointLayer=()=>['lights','tokens','floors','portals','props'].includes(layer());
const drawingWire=()=>layer()==='props' && $('prop-kind').value==='tripwire';
const materialInput=(name=layer())=>$(name==='floors'?'edit-floor-material':name==='doors'?'edit-door-material':'edit-material');
const message=text=>{ $('editor-help').textContent=text; if(floor.buildLayer) $('session-status').textContent=text; };
const node=(tag,attrs={})=>{
  const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [key,value] of Object.entries(attrs)) el.setAttribute(key,value);
  return el;
};
const geometry=()=>clone({floors:model.floors,walls:model.walls,doors:model.doors,lights:model.lights,tokens:model.tokens,portals:model.portals,props:model.props,triggers:model.triggers});
function portalEntries() {
  return (floor.sceneDocument?.floors || []).flatMap((entry,index)=>
    (index===floor.activeFloorIndex?model.portals:importedPortals(entry.map.geezvtt_editor?.portals)).map(portal=>({portal,index,entry})));
}
function pendingNode() {
  const matches=pendingPortal?.scene===floor.sceneDocument?portalEntries().filter(({portal})=>portal.pairId===pendingPortal.pairId):[];
  return matches.length===1?matches[0]:null;
}
function remember() { undo.push(geometry()); if(undo.length>50) undo.shift(); redo=[]; }
let trapDamage = Promise.resolve();
const activatingPC=()=>model?.tokens.find(token=>token.id===floor.selectedTokenId && token.kind==='pc');
function fireTriggers(event,sources,actor) {
  if(!isGM || !model || !sources.length) return;
  const activeMap=model;
  for(const hit of activateTriggers(model,event,sources,actor)) {
    if(!hit.token) { $('session-status').textContent='Trap damage needs an activating PC. Select a PC before interacting.'; continue; }
    const roll=buildExpressionRoll(hit.formula), amount=Math.max(0,roll.total);
    trapDamage=trapDamage.then(async()=>{
      const linkedPC=hit.token.kind==='pc' && hit.token.npcId?.startsWith('v2:');
      const token=(model===activeMap && model.tokens.find(token=>token.id===hit.token.id)) || (linkedPC?hit.token:null);
      if(!token) throw new Error('Trap target changed scenes; damage was not applied.');
      if(token.kind==='pc' && token.npcId?.startsWith('v2:')) {
        const pc=await damagePCFromTrap(token,amount);
        if(model) for(const copy of model.tokens.filter(copy=>copy.npcId===token.npcId)) copy.hp=pc.combat.hp_current;
      } else token.hp=Math.max(0,token.hp-amount);
      if(model===activeMap || linkedPC && model) render();
      const text=`Trap → ${token.name}: ${roll.label} = ${amount} damage`;
      $('session-status').textContent=text;
      floor.dispatchEvent(new CustomEvent('session-dice',{detail:text}));
      floor.dispatchEvent(new CustomEvent('session-action',{detail:{type:'dice',text}}));
    }).catch(error=>{$('session-status').textContent=`Trap damage: ${error.message} Check HP before retrying.`;});
  }
}
function fireInteraction(layer,object,actor=activatingPC()) { fireTriggers('interact',[objectRef(layer,object)],actor); }
function fireCollision(token,before,path=[token]) { fireTriggers('collision',collisionSources(model,token,before,path),token); }
mountTriggers(()=>model, update=>{
  if(!isGM || !model || travelling || chestBusy || floor.equipmentBusy || floor.getAttribute('aria-busy')==='true') throw new Error('Table is busy; try again.');
  remember(); update(); render();
},()=>{stopBuild(); cancelGesture(); panel.hidden=true; $('fog-tool').value='off';});
function buttons() {
  $('edit-apply').disabled=$('edit-delete').disabled=!selected.size;
  if(layer()==='portals') $('edit-apply').disabled=true;
  const portal=layer()==='portals' && selected.size===1?model?.portals[[...selected][0]]:null;
  const destination=portal && portalDestination(portalEntries(),portal);
  $('portal-travel').disabled=travelling || !destination;
  const pending=model && pendingNode();
  $('portal-status').textContent=pending?`Unpaired portal: ${pending.entry.name}`:portal?
    destination?`Linked to ${destination.entry.name}`:'Unpaired portal':'';
  const category=Object.keys(PROP_CATEGORIES).find(name=>PROP_CATEGORIES[name].includes($('prop-kind').value));
  $('prop-category').value=category;
  document.querySelectorAll('[data-prop-kind]').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.propKind===$('prop-kind').value));
    button.hidden=!PROP_CATEGORIES[category].includes(button.dataset.propKind);
  });
  document.querySelectorAll('[data-tool]').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.tool===tool()));
    button.disabled=toolInput.querySelector(`[value="${button.dataset.tool}"]`).disabled;
  });
  document.querySelectorAll('[data-material]').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.material===materialInput(button.closest('[data-material-layer]').dataset.materialLayer).value));
  });
}
function settings() {
  if(layer()==='props') return propProperties($('prop-kind').value,Number($('prop-size').value),Number($('prop-rotation').value));
  if(layer()==='portals') return {};
  if(layer()==='tokens') return {...(floor.tokenTemplate || {name:'Blank Token',size:1,hp:0}),npcId:floor.tokenTemplate?.npcId ?? null};
  if(layer()==='lights') {
    const range=Number($('edit-range').value), intensity=Number($('edit-intensity').value);
    if(!Number.isFinite(range) || range<.25 || range>100 || !Number.isFinite(intensity) || intensity<0 || intensity>10) throw new Error('Use a light range of 0.25–100 and intensity of 0–10.');
    return {color:$('edit-color').value, range, intensity, opacity:1};
  }
  return {material:materialInput().value, ...(layer()==='doors'?{type:$('edit-door-type').value,open:$('edit-door-type').value==='door' && $('edit-door').value==='open'}:{})};
}
function attempt(fn) { try { fn(); } catch(error) { message(error.message); } }
function render(notify=true) {
  const canSee=visibilityFor({...floor.tabletopMap,tokens:model.tokens,walls:model.walls,doors:model.doors,lights:model.lights});
  model.lights=model.lights.filter(light=>!light.propId || model.props.some(prop=>prop.id===light.propId));
  for(const light of model.lights) if(light.propId) {
    const prop=model.props.find(prop=>prop.id===light.propId);
    Object.assign(light,{x:prop.x,y:prop.y,hidden:prop.hidden});
  }
  for(const name of ['floors','walls','doors','lights','props','portals','tokens']) {
    const group=$(name); group.replaceChildren();
    const ids=new Set();
    model[name].forEach((obj,index)=>{
      if(typeof obj.id!=='string' || !obj.id || obj.id.length>100 || ids.has(obj.id)) obj.id=crypto.randomUUID();
      ids.add(obj.id);
      if(!canSee(obj)) return;
      let el;
      if(name==='props') {
        if(obj.hidden && !showHiddenProps()) return;
        el=propMarker({...obj,...(obj.kind==='pressurePlate'?{open:model.tokens.some(token=>token.kind==='pc' && propDistance(obj,token)===0)}:{}),lightColor:model.lights.find(light=>light.propId===obj.id)?.color});
        el.setAttribute('opacity',obj.hidden?.3:1);
        el.setAttribute('tabindex','0'); el.setAttribute('role','button');
        el.setAttribute('aria-label',`${obj.hidden?'Hidden ':''}${PROPS[obj.kind].name}. ${isGM?'Left-drag to move. ':''}Right-click for actions.`);
        el.dataset.propId=obj.id;
      } else if(name==='portals') {
        if(obj.hidden && !showHiddenPortals()) return;
        const destination=portalDestination(portalEntries(),obj);
        el=node('g',{transform:`translate(${obj.x} ${obj.y}) scale(${obj.size || 1})`,opacity:obj.hidden?.3:1,tabindex:0,role:'button','aria-label':`${obj.hidden?'Hidden portal':'Portal'}. Right-click for actions.`});
        el.dataset.portalId=obj.id;
        el.append(node('circle',{r:.42,fill:'#502e73','fill-opacity':.75,stroke:destination?'#d4a0ff':'#ffce73','stroke-width':3,'stroke-dasharray':destination?'none':'4 3','vector-effect':'non-scaling-stroke'}));
        const text=node('text',{'text-anchor':'middle','dominant-baseline':'central','font-size':.3,fill:'#fff','pointer-events':'none'});
        const appearance=propAppearance(obj);
        if(appearance) el.append(propMarker({...appearance,x:0,y:0,size:1}));
        else { text.textContent=PORTAL_ICONS[obj.icon] || PORTAL_ICONS.portal; el.append(text); }
      } else if(name==='tokens') {
        el=node('g',{transform:`translate(${obj.x} ${obj.y})`,class:'map-token',tabindex:0,role:'button','aria-label':`${obj.name}, HP ${obj.hp}, size ${obj.size} squares. Enter to ${isGM?'edit':'select'}.`});
        el.dataset.tokenId=obj.id;
        el.append(node('circle',{r:obj.size/2,fill:'#344f70',stroke:'#a2cbff','stroke-width':2,'vector-effect':'non-scaling-stroke'}));
        el.append(node('path',{d:`M ${-obj.size*.08} ${obj.size*.39} L 0 ${obj.size*.49} L ${obj.size*.08} ${obj.size*.39} Z`,fill:'#a2cbff',transform:`rotate(${obj.rotation || 0})`,'pointer-events':'none'}));
        const text=node('text',{'text-anchor':'middle','dominant-baseline':'central','font-size':obj.size*.3,fill:'#fff','pointer-events':'none'});
        text.textContent=obj.name.split(/\s+/).slice(0,2).map(word=>Array.from(word)[0]).join('');
        const symbol=TOKEN_SYMBOLS[tokenIcon(obj.icon)];
        if(symbol) {
          text.setAttribute('y',obj.size*.32); text.setAttribute('font-size',obj.size*.14);
          const icon=node('text',{'text-anchor':'middle','dominant-baseline':'central',y:-obj.size*.06,'font-size':obj.size*.48,fill:'#fff','pointer-events':'none'});
          icon.textContent=symbol; el.append(icon);
        }
        el.append(text);
        const image=node('image',{href:tokenImage(obj),x:-obj.size/2,y:-obj.size/2,width:obj.size,height:obj.size,preserveAspectRatio:'xMidYMid slice','pointer-events':'none'});
        image.style.clipPath='circle(50%)';
        image.addEventListener('error',()=>image.remove(),{once:true});
        el.append(image);
        const status=pcTokenStatus(obj);
        if(status) {
          const width=obj.size*.9, top=obj.size*.56;
          el.append(node('rect',{x:-width/2,y:top,width,height:obj.size*.09,rx:obj.size*.025,fill:'#17212b','pointer-events':'none'}),
            node('rect',{x:-width/2,y:top,width:width*status.fraction,height:obj.size*.09,rx:obj.size*.025,fill:status.color,'pointer-events':'none'}));
          const label=node('text',{x:0,y:obj.size*.83,'text-anchor':'middle','font-size':obj.size*.14,'font-weight':'600',fill:'#fff',stroke:'#17212b','stroke-width':obj.size*.025,'paint-order':'stroke','pointer-events':'none'});
          label.textContent=status.label; el.append(label);
          el.setAttribute('aria-label',`${obj.name}, ${status.label}, size ${obj.size} squares. Enter to ${isGM?'edit':'select'}.`);
        }
      } else if(name==='floors') {
        el=node('rect',{x:obj.x-(obj.size || 1)/2,y:obj.y-(obj.size || 1)/2,width:obj.size || 1,height:obj.size || 1,fill:`url(#material-${Object.hasOwn(MATERIALS,obj.material)?obj.material:'stone'})`,'stroke-width':2,'vector-effect':'non-scaling-stroke'});
        el.dataset.floorIndex=index;
        el.setAttribute('tabindex','0'); el.setAttribute('role','button');
        el.setAttribute('aria-label',`Floor, ${obj.material}. Right-click for actions.`);
      } else if(name==='lights') {
        el=node('g',{tabindex:0,role:'button',opacity:obj.hidden?.3:1,'aria-label':'Light. Right-click for actions.'});
        el.dataset.lightIndex=index;
        el.append(node('circle',{cx:obj.x,cy:obj.y,r:obj.range,fill:obj.color,stroke:obj.color,opacity:obj.off?0:Math.min(1,(obj.opacity ?? 1)*(obj.intensity ?? 1)),class:'light-range'}));
        const appearance=propAppearance(obj);
        const marker=appearance?propMarker({...appearance,lightColor:obj.color}):node('circle',{cx:obj.x,cy:obj.y,r:.12,fill:obj.color});
        if(obj.propId) { marker.setAttribute('visibility','hidden'); el.setAttribute('pointer-events','none'); }
        marker.classList.add('light-source'); el.append(marker);
      } else {
        el=node('polyline',{points:obj.points.map(p=>`${p.x},${p.y}`).join(' '),class:`map-line${name==='doors'?` door${obj.type==='window'?' window':obj.open?' open':''}`:''}`});
        if(name==='doors') {
          el.dataset.doorIndex=index;
          el.setAttribute('tabindex','0');
          el.setAttribute('role','button');
          el.setAttribute('aria-label',`Door, ${obj.open?'open':'closed'}, ${obj.locked?'locked':'unlocked'}. Right-click for actions.`);
        }
        if(name==='walls' && ['wooden fence','iron fence','barricade','broken wall'].includes(obj.material)) el.setAttribute('stroke-dasharray',obj.material==='broken wall'?'9 3 4 2':'3 2');
        if(obj.type!=='window') el.style.stroke=`url(#material-${Object.hasOwn(MATERIALS,obj.material)?obj.material:name==='doors'?'wood':'stone'})`;
      }
      if(obj.hidden) el.setAttribute('opacity','.3');
      el.dataset.triggerLayer=name; el.dataset.triggerId=obj.id;
      if(name==='walls') { el.setAttribute('tabindex','0'); el.setAttribute('role','button'); el.setAttribute('aria-label','Wall. Right-click for actions.'); }
      const title=node('title'); title.textContent=name==='tokens'?`${obj.name} · HP ${obj.hp} · ${obj.size} squares`:name==='lights'?`Light · range ${obj.range} · intensity ${obj.intensity ?? 1}`:`${name==='floors'?'Floor':name==='walls'?'Wall':obj.type==='window'?'Window':'Door'} · ${obj.material || 'imported'}${name==='doors' && obj.type!=='window'?obj.open?' · open':' · closed':''}`;
      el.append(title);
      if(name==='props') title.textContent=`${obj.hidden?'Hidden · ':''}${PROPS[obj.kind].name}`;
      if(name==='doors' && obj.type!=='window') title.textContent+=obj.locked?' · locked':' · unlocked';
      if(name==='portals') title.textContent=(obj.hidden?'Hidden · ':'')+(portalDestination(portalEntries(),obj)?`Portal to ${portalDestination(portalEntries(),obj).entry.name}`:'Portal: waiting for second node');
      if(name===layer() && selected.has(index)) {
        if(name==='lights' || name==='tokens' || name==='portals') el.querySelector(name==='lights'?'.light-source':'circle').classList.add('edit-selected');
        else el.classList.add('edit-selected');
      }
      group.append(el);
    });
  }
  // Retain the current renderer contract, with material metadata alongside walls.
  floor.tabletopMap={...floor.tabletopMap,floors:model.floors,walls:model.walls.map(w=>w.points),wallMaterials:model.walls.map(w=>w.material),wallHidden:model.walls.map(w=>w.hidden===true),doors:model.doors,lights:model.lights,tokens:model.tokens,portals:model.portals,props:model.props,triggers:model.triggers};
  buttons();
  if(notify) floor.dispatchEvent(new Event('map-changed'));
}
function updateTools() {
  chain=[]; hover=null; gesture=null; clearPreview(); selected.clear();
  $('editor-title').textContent=`Tools — ${layerInput.selectedOptions[0].textContent}`;
  document.querySelectorAll('[data-swatch-layer]').forEach(panel=>{
    panel.dataset.active=String(panel.dataset.swatchLayer===layer());
  });
  toolInput.querySelector('[value="bucket"]').disabled=['walls','portals','props'].includes(layer());
  toolInput.querySelector('[value="replace"]').disabled=layer()==='portals';
  if(toolInput.selectedOptions[0].disabled) toolInput.value='paint';
  $('spacing-label').hidden=tool()!=='bucket' || layer()==='floors';
  message('');
  if(model) render(false);
}
function hit(p) {
  const matrix=svg.getScreenCTM(), tolerance=9/Math.max(.001,Math.hypot(matrix.a,matrix.b));
  let index=-1, best=tolerance;
  model[layer()].forEach((obj,i)=>{
    if(layer()==='portals' && obj.hidden && !showHiddenPortals()) return;
    if(layer()==='props' && obj.hidden && !showHiddenProps()) return;
    const appearance=['lights','portals'].includes(layer()) && propAppearance(obj);
    if(appearance) {
      const d=propDistance(appearance,p);
      if(d<=best) { best=d; index=i; }
      return;
    }
    const d=layer()==='props'?propDistance(obj,p):layer()==='floors'?Math.hypot(Math.max(0,Math.abs(p.x-obj.x)-.5),Math.max(0,Math.abs(p.y-obj.y)-.5)):pointLayer()?Math.hypot(p.x-obj.x,p.y-obj.y)-(layer()==='tokens'?obj.size/2:layer()==='portals'?.42:0):Math.min(...segments(obj.points).map(([a,b])=>distance(p,a,b)));
    if(d<=best) { best=d; index=i; }
  });
  return index;
}
function point(event,snap=false) {
  const p=svg.hidden?tabletopPoint(event):new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());
  if(!p) return null;
  if(!snap) return {x:p.x,y:p.y};
  if(['floors','portals','props'].includes(layer()) && !drawingWire()) return $('edit-snap').checked?{x:Math.floor(p.x)+.5,y:Math.floor(p.y)+.5}:{x:p.x,y:p.y};
  const clamp=(v,max)=>Math.max(0,Math.min(max,v));
  if(snap && (layer()==='walls' || drawingWire())) {
    const round=(v,max,step=1)=>clamp(Math.round(v/step),Math.floor(max/step))*step;
    const x=round(p.x,model.width), y=round(p.y,model.height);
    if(!event.shiftKey) return {x,y};
    const horizontal={x:round(p.x,model.width,.5),y};
    const vertical={x,y:round(p.y,model.height,.5)};
    return Math.hypot(p.x-horizontal.x,p.y-horizontal.y)<=Math.hypot(p.x-vertical.x,p.y-vertical.y)?horizontal:vertical;
  }
  const round=v=>layer()==='tokens'?Math.floor(v)+.5:Math.round(v);
  return {x:clamp(snap && $('edit-snap').checked?round(p.x):p.x,model.width),y:clamp(snap && $('edit-snap').checked?round(p.y):p.y,model.height)};
}
function contains(p) { return p.x>=-1e-7 && p.y>=-1e-7 && p.x<=model.width+1e-7 && p.y<=model.height+1e-7; }
function drawPreview() {
  clearPreview();
  if(svg.hidden) {
    if(!floor.buildLayer || !hover) return;
    const lines=[];
    if(chain.length) lines.push([...chain,hover]);
    if(layer()==='props' && !drawingWire()) attempt(()=>{
      const corners=propCorners({...hover,...settings()});
      lines.push([...corners,corners[0]]);
    });
    else if(layer()==='floors') lines.push([[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5],[-.5,-.5]].map(([x,y])=>({x:hover.x+x,y:hover.y+y})));
    else {
      const radius=layer()==='tokens'?settings().size/2:layer()==='portals'?.42:.12;
      lines.push(Array.from({length:33},(_,i)=>({x:hover.x+Math.cos(i*Math.PI/16)*radius,y:hover.y+Math.sin(i*Math.PI/16)*radius})));
      if(layer()==='portals') {
        const first=pendingNode();
        if(first?.index===floor.activeFloorIndex) lines.push([first.portal,hover]);
      }
    }
    previewPlacement(lines);
    return;
  }
  if(layer()==='props' && !drawingWire() && tool()==='paint' && hover) {
    attempt(()=>{ const marker=propMarker({...hover,...settings()}); marker.setAttribute('opacity','.55'); preview.append(marker); });
  }
  if(layer()==='portals' && tool()==='paint' && hover) {
    const first=pendingNode();
    if(first?.index===floor.activeFloorIndex) preview.append(node('line',{x1:first.portal.x,y1:first.portal.y,x2:hover.x,y2:hover.y,stroke:'#d4a0ff','stroke-width':1,'stroke-dasharray':'4 4','vector-effect':'non-scaling-stroke'}));
    preview.append(node('circle',{cx:hover.x,cy:hover.y,r:.42,fill:'none',stroke:'#d4a0ff','stroke-width':2,'stroke-dasharray':'4 4','vector-effect':'non-scaling-stroke'}));
  }
  if(chain.length) preview.append(node('polyline',{points:[...chain,...(hover?[hover]:[])].map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:'#fff','stroke-width':3,'stroke-dasharray':'6 4','vector-effect':'non-scaling-stroke'}));
  if(gesture?.box && hover) preview.append(node('rect',{x:Math.min(gesture.start.x,hover.x),y:Math.min(gesture.start.y,hover.y),width:Math.abs(hover.x-gesture.start.x),height:Math.abs(hover.y-gesture.start.y),fill:'#a2cbff','fill-opacity':.15,stroke:'#a2cbff','stroke-width':1,'vector-effect':'non-scaling-stroke'}));
}
function clearPreview() {
  preview.replaceChildren();
  previewPlacement();
}
function apply(indices,action) {
  if(!indices.length) { message('No objects found in the active layer.'); return; }
  const props=action==='replace'?settings():null;
  if(props?.open && indices.some(i=>model[layer()][i].locked)) throw new Error('Unlock the door before opening it.');
  if(layer()==='doors' && props?.type==='window') props.locked=false;
  remember();
  if(action==='erase') model[layer()]=model[layer()].filter((_,i)=>!indices.includes(i));
  else for(const i of indices) {
    const object=model[layer()][i];
    Object.assign(object,props);
    if(layer()==='props' && PROPS[object.kind].light) addObjectLight(object);
  }
  selected.clear(); render(); message(`${action==='erase'?'Erased':'Replaced'} ${indices.length} ${layer()}.`);
}
function addPoint(p,props) {
  const object={x:p.x,y:p.y,...props,...(['tokens','props'].includes(layer())?{id:crypto.randomUUID()}:{})};
  if(layer()==='props' && PROPS[props.kind].light) addObjectLight(object,object.id);
  return object;
}
function addSegment(points,props) {
  model[layer()].push({points:clone(points),...props});
  if(layer()==='doors') model.walls=cutDoorOpening(model.walls,points);
}
function placeChain() {
  if(chain.length<2) { message('Choose at least two distinct points, then press Enter.'); return; }
  const props=settings(); remember();
  for(const [a,b] of segments(chain)) {
    if(drawingWire()) model.props.push({id:crypto.randomUUID(),kind:'tripwire',size:1,x:(a.x+b.x)/2,y:(a.y+b.y)/2,
      length:Math.hypot(b.x-a.x,b.y-a.y),rotation:Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI});
    else addSegment([a,b],props);
  }
  chain=[]; hover=null; clearPreview(); render(); message('Placed segments. Click to begin another chain.');
}
function paint(p) {
  if(layer()==='portals') {
    const first=pendingNode();
    if(first?.index===floor.activeFloorIndex && Math.hypot(first.portal.x-p.x,first.portal.y-p.y)<.01) {
      message('Place the second node at a different position.'); return;
    }
    remember();
    const pairId=first?.portal.pairId || crypto.randomUUID();
    model.portals.push({id:crypto.randomUUID(),pairId,x:p.x,y:p.y});
    pendingPortal={scene:floor.sceneDocument,pairId};
    render(); return;
  }
  const props=settings();
  if(layer()==='floors' && model.floors.some(o=>Math.hypot(o.x-p.x,o.y-p.y)<.01)) return;
  if(pointLayer() && !drawingWire()) { remember(); model[layer()].push(addPoint(p,props)); render(); }
  else if(!chain.length || Math.hypot(chain.at(-1).x-p.x,chain.at(-1).y-p.y)>.00001) { chain.push(p); if(floor.buildLayer==='doors' && chain.length===2) placeChain(); else drawPreview(); }
}
function bucket(p,room=false) {
  const spacing=layer()==='floors'?1:Number($('edit-spacing').value);
  if(!Number.isFinite(spacing) || spacing<.5 || spacing>100) throw new Error('Fill spacing must be between 0.5 and 100 squares.');
  const bounds=layer()==='floors'?{
    left:Math.floor(Math.min(0,p.x,...model.floors.map(o=>o.x-.5))),
    top:Math.floor(Math.min(0,p.y,...model.floors.map(o=>o.y-.5))),
    right:Math.ceil(Math.max(model.width,p.x+1,...model.floors.map(o=>o.x+.5))),
    bottom:Math.ceil(Math.max(model.height,p.y+1,...model.floors.map(o=>o.y+.5)))
  }:undefined;
  const fillModel=room?{...model,doors:model.doors.map(door=>({...door,open:false}))}:model;
  const props=settings(), cells=bucketCells(fillModel,p,spacing,2000,bounds);
  if(room) {
    const tiles=cells.map(cell=>({cell,tile:model.floors.find(tile=>Math.hypot(tile.x-cell.x,tile.y-cell.y)<.01)}))
      .filter(({tile})=>!tile || tile.material!==props.material);
    if(!tiles.length) { message('Room already uses this floor material.'); return; }
    remember();
    for(const {cell,tile} of tiles) {
      if(tile) tile.material=props.material;
      else model.floors.push(addPoint(cell,props));
    }
    render(); message(`Painted ${tiles.length} floor tiles.`); return;
  }
  const fresh=cells.filter(c=>!model[layer()].some(o=>pointLayer()?Math.hypot(o.x-c.x,o.y-c.y)<.01:distance(c,o.points[0],o.points[1])<.01));
  if(!fresh.length) { message('This area is already filled.'); return; }
  remember();
  for(const c of fresh) {
    if(pointLayer()) model[layer()].push(addPoint(c,props));
    else addSegment([{x:Math.max(0,c.x-.5),y:c.y},{x:Math.min(model.width,c.x+.5),y:c.y}],props);
  }
  render(); message(`Filled area with ${fresh.length} ${layer()}.`);
}
host.addEventListener('pointermove',event=>{
  if(!isGM || !model || !floor.buildLayer || host.hidden) return;
  const raw=point(event);
  hover=raw && (['floors','portals','props'].includes(layer()) || contains(raw))?point(event,true):null;
  drawPreview();
});
host.addEventListener('pointerleave',()=>{ hover=null; clearPreview(); });
host.addEventListener('pointercancel',cancelGesture);
host.addEventListener('pointerdown',event=>{
  if(!isGM || !model || !floor.buildLayer || host.hidden || event.button!==0 || travelling || chestBusy || floor.equipmentBusy || floor.getAttribute('aria-busy')==='true') return;
  const raw=point(event);
  if(!raw || (!['floors','portals','props'].includes(layer()) && !contains(raw))) return;
  event.preventDefault(); host.querySelector('canvas').focus({preventScroll:true});
  attempt(()=>{
    if(floor.buildLayer==='floors' && leftShift && event.shiftKey) bucket(raw,true);
    else paint(point(event,true));
  });
  hover=point(event,true); drawPreview();
});
svg.addEventListener('pointerdown',event=>{
  if(!isGM) return;
  if(!model || (panel.hidden && !floor.buildLayer) || event.button!==0 || svg.hidden) return;
  // Floors can extend the ground beyond the imported image.
  const raw=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());
  if(!['floors','portals','props'].includes(layer()) && (tool()==='paint' || tool()==='bucket') && !contains(raw)) return;
  event.preventDefault(); svg.focus();
  const p=point(event), index=hit(p);
  if(floor.buildLayer==='floors' && leftShift && event.shiftKey) {
    attempt(()=>bucket(p,true)); return;
  }
  if(tool()==='paint' || tool()==='bucket') {
    attempt(()=>tool()==='paint'?paint(point(event,true)):bucket(p)); return;
  }
  gesture={start:p,screen:{x:event.clientX,y:event.clientY},index,shift:event.shiftKey,box:!(tool()==='select' && selected.has(index) && !event.shiftKey),before:null};
  svg.setPointerCapture(event.pointerId);
});
svg.addEventListener('pointermove',event=>{
  if(!model || (panel.hidden && !floor.buildLayer)) return;
  hover=point(event,tool()==='paint');
  if(gesture) {
    gesture.moved ||= Math.hypot(event.clientX-gesture.screen.x,event.clientY-gesture.screen.y)>4;
    if(gesture.moved && !gesture.box) {
      if(!gesture.before) gesture.before=geometry();
      let dx=hover.x-gesture.start.x, dy=hover.y-gesture.start.y;
      if($('edit-snap').checked) { dx=Math.round(dx); dy=Math.round(dy); }
      const originals=[...selected].map(i=>gesture.before[layer()][i]);
      const pts=originals.flatMap(o=>pointLayer()?[o]:o.points);
      if(!['floors','portals','props'].includes(layer())) {
        dx=Math.max(-Math.min(...pts.map(p=>p.x)),Math.min(model.width-Math.max(...pts.map(p=>p.x)),dx));
        dy=Math.max(-Math.min(...pts.map(p=>p.y)),Math.min(model.height-Math.max(...pts.map(p=>p.y)),dy));
      }
      if(layer()==='tokens' && originals.some(token=>crossesWindow(token,{x:token.x+dx,y:token.y+dy},model.doors))) {
        for(const i of selected) model.tokens[i]=clone(gesture.before.tokens[i]);
        render(false); message('Windows block token movement.'); return;
      }
      for(const i of selected) {
        const obj=clone(gesture.before[layer()][i]);
        if(pointLayer()) { obj.x+=dx; obj.y+=dy; } else obj.points=obj.points.map(p=>({x:p.x+dx,y:p.y+dy}));
        model[layer()][i]=obj;
      }
      render(false);
    }
  }
  drawPreview();
});
svg.addEventListener('pointerup',event=>{
  if(!gesture) return;
  const g=gesture; gesture=null; preview.replaceChildren();
  if(svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  if(g.before) {
    undo.push(g.before); if(undo.length>50) undo.shift(); redo=[];
    if(layer()==='tokens') for(const token of model.tokens) {
      const before=g.before.tokens.find(item=>item.id===token.id);
      if(before && (before.x!==token.x || before.y!==token.y)) fireCollision(token,before);
    }
    render(); return;
  }
  const indices=g.moved?model[layer()].flatMap((o,i)=>inBox(o,g.start,point(event),layer())?[i]:[]):g.index<0?[]:[g.index];
  if(tool()==='select') {
    if(!g.shift) selected.clear();
    for(const i of indices) { if(g.shift && selected.has(i)) selected.delete(i); else selected.add(i); }
    if(selected.size===1) {
      const obj=model[layer()][[...selected][0]];
      if(layer()==='lights') { $('edit-color').value=obj.color; $('edit-range').value=obj.range; $('edit-intensity').value=obj.intensity ?? 1; }
      else if(layer()==='props') { $('prop-kind').value=obj.kind; $('prop-size').value=obj.size; $('prop-rotation').value=obj.rotation; }
      else if(layer()==='portals') { if(!portalDestination(portalEntries(),obj)) pendingPortal={scene:floor.sceneDocument,pairId:obj.pairId}; }
      else if(layer()!=='tokens') { if(obj.material) { materialInput().value=obj.material; materialInput().dispatchEvent(new Event('change')); } if(layer()==='doors') { $('edit-door-type').value=obj.type || 'door'; $('edit-door').value=obj.open?'open':'closed'; doorTypeChanged(); } }
    }
    render(false); message(`Selected ${selected.size} ${layer()}. Drag selected objects to move, or apply settings.`);
  } else attempt(()=>apply(indices,tool()));
});
function cancelGesture() {
  if(gesture?.before) { Object.assign(model,gesture.before); render(false); }
  gesture=null; chain=[]; hover=null; clearPreview();
}
function addObjectLight(object, propId=model.props.includes(object)?object.id:null) {
  if(propId && model.lights.some(light=>light.propId===propId)) return;
  model.lights.push({x:object.x,y:object.y,color:'#ffb34d',range:4,intensity:1,opacity:1,...PROPS[object.kind]?.light,...(propId?{propId}:{})});
}
let editingLight, lightEditInput;
function editLight(light) {
  editingLight=light; lightEditInput=null;
  $('object-light-color').value=light.color;
  $('object-light-intensity').value=light.intensity ?? 1;
  $('object-light-range').value=light.range;
  openPanel($('object-light-panel'));
}
$('object-light-form').addEventListener('submit',event=>event.preventDefault());
for(const prefix of ['object-light-','edit-']) for(const property of ['color','intensity','range']) {
  const input=$(prefix+property);
  input.addEventListener('input',()=>{
    if(!isGM || !model || travelling || chestBusy || floor.equipmentBusy || floor.getAttribute('aria-busy')==='true' || !input.validity.valid) return;
    const value=property==='color'?input.value:input.valueAsNumber;
    if(property!=='color' && !Number.isFinite(value)) return;
    const lights=prefix==='object-light-'?(model.lights.includes(editingLight)?[editingLight]:[]):
      layer()==='lights'?[...selected].map(index=>model.lights[index]).filter(Boolean):[];
    if(!lights.some(light=>light[property]!==value)) return;
    if(lightEditInput!==input) remember();
    lightEditInput=input;
    for(const light of lights) light[property]=value;
    render();
  });
  for(const type of ['change','blur']) input.addEventListener(type,()=>{lightEditInput=null;});
}
let chestId, pendingChest, chestBusy=false;
let pendingTake, takeTimer, chestMessage='', chestAddMode='custom';
const chestToken=()=>model?.tokens.find(item=>item.id===floor.selectedTokenId && item.kind==='pc' && canControlPC(item));
let inventoryVersion=0;
async function drawInventory() {
  const version=++inventoryVersion, target=$('chest-inventory'); target.replaceChildren();
  const token=model?.tokens.find(item=>item.id===floor.selectedTokenId && item.kind==='pc');
  if(!token) { target.textContent='Select a PC.'; return; }
  try {
    const pc=await readPC(token);
    if(version!==inventoryVersion) return;
    for(const item of pcInventory(pc)) { const row=document.createElement('div'); row.textContent=`${item.name} (${item.qty ?? 1})`; target.append(row); }
    const coins=Object.keys(COIN_TYPES).filter(key=>Number(pc.coin_purse?.[key])>0).map(key=>`${pc.coin_purse[key]} ${key}`);
    if(coins.length) {const row=document.createElement('div'); row.textContent=`Coins: ${coins.join(' · ')}`; target.append(row);}
  } catch(error) { if(version===inventoryVersion) target.textContent=error.message; }
}
floor.addEventListener('vtt-selection-changed',()=>{if(chestId) drawChest();});
function requestChest(chest,command,itemId) {
  const token=chestToken(), tokenId=token?.id;
  if(!tokenId) { $('chest-state').textContent=$('session-status').textContent='Select a PC you control first.'; return; }
  if(pendingTake && ['take','take-all'].includes(command)) return;
  if(command==='open') pendingChest=chest.id;
  const requestId=crypto.randomUUID();
  if(['take','take-all'].includes(command)) {
    pendingTake=requestId; chestMessage='Taking…'; drawChest();
    takeTimer=setTimeout(()=>{if(pendingTake===requestId) {pendingTake=null; chestMessage='No response; check the bag before retrying.'; drawChest();}},25000);
  }
  floor.dispatchEvent(new CustomEvent('session-action',{detail:{type:'chest',chestId:chest.id,command,itemId:itemId || null,tokenId,requestId}}));
}
function openChest(id) { chestId=id; chestMessage=''; $('chest-add').hidden=true; openPanel($('chest-panel')); drawChest(); }
function drawChest() {
  const chest=model?.props.find(item=>item.id===chestId && hasCompartment(item));
  if(!chest || !chest.open || (!isGM && (chest.hidden || chest.locked))) { $('chest-panel').hidden=true; return; }
  const list=$('chest-items'); list.replaceChildren();
  $('chest-title').textContent=`${PROPS[chest.kind].name} · Compartment`;
  $('chest-manage').hidden=!isGM;
  if(!isGM) $('chest-add').hidden=true;
  $('chest-state').textContent=chestMessage || (chest.locked?'Locked':'Unlocked');
  $('chest-take-all').disabled=!!pendingTake || chestBusy || !chestToken() || !(chest.contents || []).some(item=>(item.qty ?? 1)>0);
  for(const item of chest.contents || []) {
    if((item.qty ?? 1)<=0) continue;
    const row=document.createElement('div'), button=document.createElement('button');
    button.type='button'; button.textContent=`${item.name} ×${item.qty ?? 1}`;
    button.title=`Take 1${item.weight != null ? ` · ${item.weight} lb each` : ' · Weight unknown'}`;
    button.setAttribute('aria-label',`Take one ${item.name}`);
    button.disabled=!!pendingTake || chestBusy || !chestToken();
    button.addEventListener('click',()=>requestChest(chest,'take',item.id)); row.append(button);
    if(isGM) {
      const remove=document.createElement('button'); remove.type='button'; remove.textContent='Remove'; remove.disabled=chestBusy || !!pendingTake;
      remove.setAttribute('aria-label',`Remove ${item.name} stack from compartment`);
      remove.addEventListener('click',()=>{if(chestBusy || pendingTake) return; remember(); chest.contents=chest.contents.filter(entry=>entry.id!==item.id); render();}); row.append(remove);
    }
    list.append(row);
  }
  if(!list.childElementCount) list.textContent='Empty.';
  drawInventory();
}
$('chest-take-all').addEventListener('click',()=>{const chest=model?.props.find(item=>item.id===chestId); if(chest) requestChest(chest,'take-all');});
floor.addEventListener('session-chest-result',event=>{
  if(event.detail.requestId!==pendingTake) return;
  clearTimeout(takeTimer); pendingTake=null;
  chestMessage=event.detail.error?`Transfer failed: ${event.detail.error} Check the bag before retrying.`:'Taken.'; drawChest();
});
async function addChestForm(mode) {
  if(!isGM || chestBusy || pendingTake) return;
  chestAddMode=mode; $('chest-add-title').textContent=mode==='srd'?'Add SRD Item':'Add Custom Item';
  $('chest-add').reset(); $('chest-add').hidden=false;
  $('chest-item-name').setAttribute('list',mode==='srd'?'chest-srd-items':'');
  if(mode==='srd') {
    try {
      const reference=await loadSheetReference();
      $('chest-srd-items').replaceChildren(...Object.values(reference).filter(item=>item.equipment_category).map(item=>new Option(item.name,item.name)));
    } catch(error) { chestMessage=error.message; drawChest(); }
  }
  $('chest-item-name').focus();
}
$('chest-add-srd').addEventListener('click',()=>addChestForm('srd'));
$('chest-add-custom').addEventListener('click',()=>addChestForm('custom'));
$('chest-add-cancel').addEventListener('click',()=>{$('chest-add').hidden=true;});
$('chest-add').addEventListener('submit',async event=>{
  event.preventDefault();
  const chest=model?.props.find(item=>item.id===chestId && hasCompartment(item)), name=$('chest-item-name').value.trim();
  if(!isGM || chestBusy || pendingTake || !chest || !name || !$('chest-add').reportValidity()) return;
  const props=model.props, qty=Number($('chest-item-qty').value), enteredWeight=$('chest-item-weight').value.trim(), mode=chestAddMode;
  chestBusy=true;
  try {
    const reference=mode==='srd'?await loadSheetReference():{};
    if(model?.props!==props || !props.includes(chest)) throw new Error('Map changed; reopen the compartment.');
    const source=mode==='srd'?reference[name.toLowerCase()]:{name};
    if(!source?.equipment_category && mode==='srd') throw new Error('Choose an SRD item.');
    const item=lootItem(source,qty);
    if(enteredWeight) item.weight=Number(enteredWeight);
    remember(); (chest.contents ||= []).push(item); $('chest-add').reset(); chestMessage='Item added.'; render();
  } catch(error) { chestMessage=error.message; }
  finally { chestBusy=false; drawChest(); }
});
async function transferChest(chest,token,itemId,requestId) {
  if(chestBusy) throw new Error('Another transfer is saving.');
  const props=model.props;
  chestBusy=true;
  try {
    await floor.flushSharedTabletop?.();
    floor.compartmentBusy=true;
    const reference=await loadSheetReference();
    const contents=await takeChestItems(token,chest,itemId,props,requestId,reference);
    if(model?.props!==props) throw new Error('Transfer saved; scene changed. Check the bag.');
    undo=[]; redo=[];
    chest.contents=contents; render();
  } finally { floor.compartmentBusy=false; chestBusy=false; drawChest(); }
}
async function chestAction(action) {
  if(!isGM || !model || travelling || chestBusy || floor.equipmentBusy || floor.getAttribute('aria-busy')==='true') throw new Error('Table is busy; try again.');
  const {chestId,tokenId,command,itemId,requestId}=action;
  const chest=model.props.find(item=>item.id===chestId && hasCompartment(item) && !item.hidden);
  const token=model.tokens.find(item=>item.id===tokenId && item.kind==='pc');
  if(!chest || !token || Math.hypot(chest.x-token.x,chest.y-token.y)>token.size/2+1) throw new Error('Move the selected PC next to the compartment.');
  if(command==='pick' && chest.locked) {
    chestBusy=true;
    try {
      const pc=await readPC(token);
      if(!pcInventory(pc).some(item=>Number(item.qty ?? 1)>0 && /lock\s*picks?|thiev(?:es|e)['\u2019]?\s*(?:tools|tool)/i.test(item.name))) {
        const text=`${token.name}: No lockpicks`;
        floor.dispatchEvent(new CustomEvent('session-dice',{detail:text}));
        floor.dispatchEvent(new CustomEvent('session-action',{detail:{type:'dice',text}})); return;
      }
      // shortcut: raw d20 until lockpicking bonuses and difficulty rules are defined.
      const roll=buildRoll({sides:20,count:1,modifier:0,mode:'normal'});
      const text=`${token.name}: Lockpicking = ${roll.total} [${roll.sub}] (GM resolves)`;
      floor.dispatchEvent(new CustomEvent('session-dice',{detail:text}));
      floor.dispatchEvent(new CustomEvent('session-action',{detail:{type:'dice',text}}));
      $('session-status').textContent=text;
    } catch(error) { $('session-status').textContent=`Lockpicking failed: ${error.message}`; }
    finally { chestBusy=false; }
    return;
  }
  if(chest.locked) throw new Error('Compartment is locked.');
  if(command==='open' || command==='close') {
    if(chest.open===(command==='open')) return;
    remember(); chest.open=command==='open'; fireInteraction('props',chest,token); render();
  }
  else if(chest.open && ['take','take-all'].includes(command)) {
    if(command==='take' && typeof itemId!=='string') throw new Error('Choose an item.');
    await transferChest(chest,token,command==='take-all'?null:itemId,requestId);
  } else throw new Error('Open the compartment first.');
}
let chestActions=Promise.resolve();
floor.addEventListener('vtt-chest-action',event=>{
  const action=event.detail;
  chestActions=chestActions.then(async()=>{
    let failure;
    try {await chestAction(action);} catch(error) {failure=error.message; $('session-status').textContent=failure;}
    if(['take','take-all'].includes(action.command)) floor.dispatchEvent(new CustomEvent('session-action',{detail:{
      type:'chest-result',target:action.client,requestId:action.requestId,...(failure?{error:failure}:{})
    }}));
  }).catch(error=>{$('session-status').textContent=error.message;});
});
floor.addEventListener('map-changed',()=>{
  if(pendingChest && model?.props.some(item=>item.id===pendingChest && item.open)) { const id=pendingChest; pendingChest=null; openChest(id); }
  if(chestId) drawChest();
});
floor.addEventListener('map-ready',()=>{ chestId=pendingChest=pendingTake=null; clearTimeout(takeTimer); $('chest-panel').hidden=true; $('object-light-panel').hidden=true; });
function iconMenu(x,y,change,origin,portal=false) {
  const defaults=portal?Object.entries(PORTAL_ICONS).map(([icon,symbol])=>({
    label:`${symbol} ${{portal:'Portal',stairsUp:'Stairs up',stairsDown:'Stairs down',ladder:'Ladder',doorway:'Doorway',magic:'Magic'}[icon]}`,
    action:()=>change(icon)
  })):[{label:'Default light',action:()=>change('')}];
  showMapMenu(x,y,[...defaults,...Object.entries(PROPS).map(([kind,entry])=>({
    label:entry.name,icon:propIcon(kind),action:()=>change(`prop:${kind}`)
  }))],origin);
}
function portalMenu(id,x,y,origin) {
  if(!model || travelling || chestBusy || floor.equipmentBusy || floor.getAttribute('aria-busy')==='true') return;
  cancelGesture();
  const portal=model.portals.find(item=>item.id===id);
  if(!portal) return;
  if(!isGM) { const actions=!portal.hidden && interactionMenuItems(objectRef('portals',portal)); if(actions?.length) showMapMenu(x,y,actions,origin); return; }
  const change=update=>{
    if(!model.portals.includes(portal)) return;
    remember(); update(); selected.clear(); render();
  };
  showMapMenu(x,y,[
    triggerMenuItem(objectRef('portals',portal)), resizeMenuItem('portals',portal),
    ...interactionMenuItems(objectRef('portals',portal)),
    {label:'Use',disabled:!portalDestination(portalEntries(),portal),action:()=>usePortal(portal)},
    {label:'Add light',action:()=>change(()=>addObjectLight(portal))},
    {label:portal.hidden?'Show':'Hide',action:()=>change(()=>{portal.hidden=!portal.hidden;})},
    {label:'Delete',action:()=>change(()=>{model.portals=model.portals.filter(item=>item!==portal);})},
    {label:'Change icon…',action:()=>iconMenu(x,y,icon=>change(()=>{portal.icon=icon;}),origin,true)}
  ],origin);
}
function lightMenu(index,x,y,origin) {
  if(!model || travelling || chestBusy || floor.equipmentBusy || floor.getAttribute('aria-busy')==='true') return;
  cancelGesture();
  const light=model.lights[index];
  if(!light) return;
  if(!isGM) { const actions=!light.hidden && interactionMenuItems(objectRef('lights',light)); if(actions?.length) showMapMenu(x,y,actions,origin); return; }
  const change=update=>{ if(!model.lights.includes(light)) return; remember(); update(); render(); };
  showMapMenu(x,y,[
    triggerMenuItem(objectRef('lights',light)), resizeMenuItem('lights',light),
    ...interactionMenuItems(objectRef('lights',light)),
    {label:light.off?'Turn on':'Turn off',action:()=>change(()=>{light.off=!light.off; fireInteraction('lights',light);})},
    {label:light.hidden?'Show':'Hide',action:()=>change(()=>{light.hidden=!light.hidden;})},
    {label:'Light settings...',action:()=>editLight(light)},
    {label:'Change icon…',action:()=>iconMenu(x,y,icon=>{
      if(!model.lights.includes(light)) return;
      remember(); light.icon=icon; render();
    },origin)},
    {label:'Delete',action:()=>{
      if(!model.lights.includes(light)) return;
      remember(); model.lights=model.lights.filter(item=>item!==light); selected.clear(); render();
    }}
  ],origin);
}
function doorMenu(index,x,y,origin) {
  if(!model || travelling || chestBusy || floor.equipmentBusy || floor.getAttribute('aria-busy')==='true') return;
  const door=model.doors[index];
  if(!door || door.hidden && !isGM) return;
  if(!isGM) {
    showMapMenu(x,y,[{label:door.open?'Close':'Open',disabled:!door.open && door.locked,action:()=>requestObjectInteraction(objectRef('doors',door))}],origin); return;
  }
  cancelGesture();
  const change=update=>{
    if(!model.doors.includes(door)) return;
    remember(); update(); selected.clear(); render();
  };
  showMapMenu(x,y,[
    triggerMenuItem(objectRef('doors',door)), resizeMenuItem('doors',door),
    {label:door.open?'Close':'Open',disabled:!door.open && door.locked,action:()=>requestObjectInteraction(objectRef('doors',door))},
    {label:door.locked?'Unlock':'Lock',disabled:door.type==='window',action:()=>change(()=>{door.locked=!door.locked; if(door.locked) door.open=false;})},
    {label:door.hidden?'Show':'Hide',action:()=>change(()=>{door.hidden=!door.hidden;})},
    {label:'Add light',action:()=>change(()=>addObjectLight({x:(door.points[0].x+door.points[1].x)/2,y:(door.points[0].y+door.points[1].y)/2}))},
    {label:'Delete',action:()=>change(()=>{model.doors=model.doors.filter(item=>item!==door);})}
  ],origin);
}
function floorMenu(index,x,y,origin) {
  if(!model || travelling || chestBusy || floor.equipmentBusy || floor.getAttribute('aria-busy')==='true') return;
  cancelGesture();
  const tile=model.floors[index];
  if(!tile) return;
  if(!isGM) { const actions=interactionMenuItems(objectRef('floors',tile)); if(actions.length) showMapMenu(x,y,actions,origin); return; }
  const change=update=>{
    if(!model.floors.includes(tile)) return;
    remember(); update(); selected.clear(); render();
  };
  showMapMenu(x,y,[
    triggerMenuItem(objectRef('floors',tile)), resizeMenuItem('floors',tile), {label:tile.hidden?'Show':'Hide',action:()=>change(()=>{tile.hidden=!tile.hidden;})},
    {label:'Change material...',action:()=>showMapMenu(x,y,MATERIAL_LAYERS.floors.map(material=>({
      label:material,action:()=>change(()=>{tile.material=material;})
    })),origin)},
    {label:'Delete',action:()=>change(()=>{model.floors=model.floors.filter(item=>item!==tile);})}
  ],origin);
}
function wallMenu(index,x,y,origin) {
  if(!model || travelling || chestBusy || floor.equipmentBusy || floor.getAttribute('aria-busy')==='true') return;
  const wall=model.walls[index];
  if(!wall) return;
  const actions=[...(isGM?[triggerMenuItem(objectRef('walls',wall)),resizeMenuItem('walls',wall),{label:wall.hidden?'Show':'Hide',action:()=>{remember(); wall.hidden=!wall.hidden; render();}}]:[]),...interactionMenuItems(objectRef('walls',wall))];
  if(actions.length) showMapMenu(x,y,actions,origin);
}
async function fillCompartment(prop,tier) {
  if(!isGM || chestBusy || pendingTake) return;
  const props=model.props;
  chestBusy=true;
  try {
    const reference=await loadSheetReference();
    if(model?.props!==props || !props.includes(prop)) throw new Error('Map changed; reopen the compartment.');
    const contents=generateLoot(tier,reference);
    remember(); prop.contents=[...(prop.contents || []),...contents];
    chestMessage=`Tier ${tier} loot added.`; render(); $('session-status').textContent=chestMessage;
  } catch(error) { $('session-status').textContent=error.message; }
  finally { chestBusy=false; if(chestId) drawChest(); }
}
function compartmentMenu(prop,x,y,origin) {
  const open=()=>{
    if(!model.props.includes(prop) || chestBusy) return;
    if(isGM) { if(!prop.open) {remember(); prop.open=true; fireInteraction('props',prop); render();} openChest(prop.id); }
    else if(prop.open) openChest(prop.id);
    else requestChest(prop,'open');
  };
  showMapMenu(x,y,[
    ...(isGM?[{label:prop.locked?'Unlock':'Lock',action:()=>{remember(); prop.locked=!prop.locked; if(prop.locked) prop.open=false; render();}},{label:'Contents',action:()=>showMapMenu(x,y,LOOT_TIERS.map((tier,index)=>({label:tier.label,action:()=>fillCompartment(prop,index+1)})),origin)}]:[]),
    {label:'Open',disabled:!!prop.locked,action:open}
  ],origin);
}
function propMenu(id,x,y,origin) {
  if(!model || travelling || chestBusy || floor.equipmentBusy || floor.getAttribute('aria-busy')==='true') return;
  cancelGesture();
  const prop=model.props.find(item=>item.id===id);
  if(!prop || (!isGM && prop.hidden)) return;
  if(['lever','button'].includes(prop.kind) && !hasCompartment(prop)) {
    showMapMenu(x,y,[{label:prop.open?'Toggle off':'Toggle on',action:()=>requestObjectInteraction(objectRef('props',prop))},
      ...(isGM?[triggerMenuItem(objectRef('props',prop)), resizeMenuItem('props',prop),
        {label:prop.hidden?'Show':'Hide',action:()=>{remember(); prop.hidden=!prop.hidden; render();}},
        {label:'Rotate 90°',action:()=>{remember(); prop.rotation=(prop.rotation+90)%360; render();}},
        {label:'Delete',action:()=>{remember(); model.props=model.props.filter(item=>item!==prop); render();}}]:[])],origin); return;
  }
  if(!isGM && !hasCompartment(prop)) {
    const actions=interactionMenuItems(objectRef('props',prop));
    if(actions.length) showMapMenu(x,y,actions,origin);
    return;
  }
  if(!isGM) {
    showMapMenu(x,y,[
      {label:`Inspect: ${prop.locked?'Locked':'Unlocked'}`,action:()=>{ $('session-status').textContent=prop.locked?'Chest is locked.':'Chest is unlocked.'; }},
      {label:'Pick lock',disabled:!prop.locked,action:()=>requestChest(prop,'pick')},
      {label:'Compartment',action:()=>compartmentMenu(prop,x,y,origin)},
      {label:'Close',disabled:!prop.open,action:()=>requestChest(prop,'close')}
    ],origin); return;
  }
  const change=update=>{
    if(!model.props.includes(prop)) return;
    remember(); update(); selected.clear(); render();
  };
  showMapMenu(x,y,[
    triggerMenuItem(objectRef('props',prop)), resizeMenuItem('props',prop),
    ...(!hasCompartment(prop)?interactionMenuItems(objectRef('props',prop)):[]),
    {label:'Delete',action:()=>change(()=>{model.props=model.props.filter(item=>item!==prop);})},
    {label:prop.hidden?'Show':'Hide',action:()=>change(()=>{prop.hidden=!prop.hidden;})},
    {label:'Change icon...',action:()=>showMapMenu(x,y,Object.entries(PROPS).map(([kind,entry])=>({
      label:entry.name,icon:propIcon(kind),action:()=>change(()=>{prop.icon=`prop:${kind}`;})
    })),origin)},
    ...(model.lights.some(light=>light.propId===prop.id)?[
      {label:'Remove light',action:()=>change(()=>{model.lights=model.lights.filter(light=>light.propId!==prop.id);})},
      {label:'Edit light...',action:()=>{
        const light=model.lights.find(light=>light.propId===prop.id);
        if(light) editLight(light);
      }}
    ]:[{label:'Add light',action:()=>change(()=>addObjectLight(prop))}]),
    ...(hasCompartment(prop)?[
      {label:prop.locked?'Unlock':'Lock',action:()=>change(()=>{prop.locked=!prop.locked; if(prop.locked) prop.open=false;})},
      {label:prop.open?'Close':'Open',disabled:!prop.open && prop.locked,action:()=>{requestObjectInteraction(objectRef('props',prop)); if(prop.open) openChest(prop.id);}},
      {label:'Compartment',action:()=>compartmentMenu(prop,x,y,origin)}
    ]:[]),
    ...(['ladder','stairs'].includes(prop.kind)?[{label:'Use',action:()=>{
      const portal=model.portals.find(item=>Math.hypot(item.x-prop.x,item.y-prop.y)<.5);
      if(portal) usePortal(portal);
      else $('session-status').textContent='This ladder or stairs needs a paired portal at its position.';
    }}]:[]),
    {label:'Rotate 90°',action:()=>change(()=>{prop.rotation=(prop.rotation+90)%360;})},
  ],origin);
}
onMapRightClick(svg,event=>{
  if(!model || svg.hidden) return;
  const p=point(event);
  // Tokens are drawn above portals and retain their own right-click action.
  if(model.tokens.some(token=>visibleObject(floor.tabletopMap,token) && Math.hypot(p.x-token.x,p.y-token.y)<=token.size/2)) return;
  const portal=model.portals.findLast(item=>{
    const appearance=propAppearance(item);
    return (!item.hidden || showHiddenPortals()) && (appearance?propDistance(appearance,p)===0:Math.hypot(p.x-item.x,p.y-item.y)<=.42*(item.size || 1));
  });
  if(portal) { portalMenu(portal.id,event.clientX,event.clientY,svg); return; }
  const prop=model.props.findLast(item=>(!item.hidden || showHiddenProps()) && propDistance(item,p)===0);
  if(prop) { propMenu(prop.id,event.clientX,event.clientY,svg); return; }
  const matrix=svg.getScreenCTM();
  let best=9/Math.max(.001,Math.hypot(matrix.a,matrix.b)), index=-1;
  model.doors.forEach((door,i)=>{
    if(!visibleObject(floor.tabletopMap,door)) return;
    const d=Math.min(...segments(door.points).map(([a,b])=>distance(p,a,b)));
    if(d<=best) { best=d; index=i; }
  });
  if(index>=0) { doorMenu(index,event.clientX,event.clientY,svg); return; }
  const lightIndex=model.lights.findLastIndex(item=>{
    if(item.hidden && !isGM) return false;
    const appearance=propAppearance(item);
    return appearance?propDistance(appearance,p)===0:Math.hypot(p.x-item.x,p.y-item.y)<=Math.max(.12,best);
  });
  if(lightIndex>=0) { lightMenu(lightIndex,event.clientX,event.clientY,svg); return; }
  const wallIndex=model.walls.findLastIndex(wall=>segments(wall.points).some(([a,b])=>distance(p,a,b)<=best));
  if(wallIndex>=0) { wallMenu(wallIndex,event.clientX,event.clientY,svg); return; }
  const floorIndex=model.floors.findLastIndex(tile=>Math.abs(p.x-tile.x)<=(tile.size || 1)/2 && Math.abs(p.y-tile.y)<=(tile.size || 1)/2);
  if(floorIndex>=0) floorMenu(floorIndex,event.clientX,event.clientY,svg);
});
$('floors').addEventListener('keydown',event=>{
  if(!isGM || !['Enter',' ','ContextMenu'].includes(event.key)) return;
  const target=event.target.closest('[data-floor-index]');
  if(!target) return;
  event.preventDefault(); event.stopPropagation();
  const rect=target.getBoundingClientRect();
  floorMenu(Number(target.dataset.floorIndex),rect.right,rect.top,svg);
});
floor.addEventListener('floor-menu',event=>{
  const {index,x,y}=event.detail;
  floorMenu(index,x,y,document.activeElement);
});
floor.addEventListener('wall-menu',event=>{const {index,x,y}=event.detail; wallMenu(index,x,y,document.activeElement);});
$('walls').addEventListener('keydown',event=>{
  const target=event.target.closest('[data-trigger-id]');
  if(!target || !['Enter',' ','ContextMenu'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const index=model.walls.findIndex(wall=>wall.id===target.dataset.triggerId), rect=target.getBoundingClientRect();
  wallMenu(index,rect.right,rect.top,svg);
});
$('lights').addEventListener('keydown',event=>{
  if(!isGM) return;
  const target=event.target.closest('[data-light-index]');
  if(!target || !['Enter',' ','ContextMenu'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const light=model?.lights[Number(target.dataset.lightIndex)];
  if(!light) return;
  const point=new DOMPoint(light.x,light.y).matrixTransform(svg.getScreenCTM());
  lightMenu(Number(target.dataset.lightIndex),point.x,point.y,svg);
});
floor.addEventListener('light-menu',event=>{
  const {index,x,y}=event.detail;
  lightMenu(index,x,y,document.activeElement);
});
$('portals').addEventListener('keydown',event=>{
  if(!isGM) return;
  const target=event.target.closest('[data-portal-id]');
  if(!target || !['Enter',' ','ContextMenu'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const rect=target.getBoundingClientRect();
  portalMenu(target.dataset.portalId,rect.right,rect.top,svg);
});
floor.addEventListener('portal-menu',event=>{
  const {id,x,y}=event.detail;
  portalMenu(id,x,y,document.activeElement);
});
$('doors').addEventListener('keydown',event=>{
  const target=event.target.closest('[data-door-index]');
  if(!target || !['Enter',' ','ContextMenu'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const rect=target.getBoundingClientRect();
  doorMenu(Number(target.dataset.doorIndex),rect.right,rect.top,svg);
});
floor.addEventListener('door-menu',event=>{
  const {index,x,y}=event.detail;
  doorMenu(index,x,y,document.activeElement);
});
$('props').addEventListener('keydown',event=>{
  const target=event.target.closest('[data-prop-id]');
  if(!target || !['Enter',' ','ContextMenu'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const rect=target.getBoundingClientRect();
  propMenu(target.dataset.propId,rect.right,rect.top,svg);
});
floor.addEventListener('prop-menu',event=>{
  const {id,x,y}=event.detail;
  propMenu(id,x,y,document.activeElement);
});
for(const element of [panel,$('portals-panel'),$('props-panel')]) new MutationObserver(()=>{
  closeMapMenu();
  if(model) render(false);
}).observe(element,{attributes:true,attributeFilter:['hidden']});
floor.addEventListener('map-changed',closeMapMenu);
floor.addEventListener('tabletop-item-saved',event=>{
  if(!isGM || !model) return;
  const saved=event.detail;
  undo=[]; redo=[];
  model.tokens=clone(saved.tokens || []); model.props=clone(saved.props || []);
  floor.tabletopMap.initiative=clone(saved.initiative);
  render();
});
floor.addEventListener('object-resize',event=>{
  if(!isGM || !model || floor.equipmentBusy) return;
  const {layer,id}=event.detail, object=model[layer]?.find(item=>item.id===id);
  if(!object) return;
  const current=object.points?Math.hypot(object.points.at(-1).x-object.points[0].x,object.points.at(-1).y-object.points[0].y):object.range ?? object.length ?? object.size ?? 1;
  const value=window.prompt('Size in grid squares:',String(current));
  if(value===null) return;
  try {
    const next=clone(object); resizeObject(next,Number(value.trim() || NaN)); remember();
    if(layer==='doors') model.walls=resizeDoorWalls(model.walls,object.points,next.points);
    Object.assign(object,next); render();
  }
  catch(error) { window.alert(error.message); }
});
floor.addEventListener('object-hide',event=>{
  if(!isGM || !model || floor.equipmentBusy) return;
  const object=model[event.detail.layer]?.find(item=>item.id===event.detail.id);
  if(object) { remember(); object.hidden=!object.hidden; render(); }
});
function resizeMenuItem(layer,object) {
  return {label:'Resize...',action:()=>floor.dispatchEvent(new CustomEvent('object-resize',{detail:{layer,id:object.id}}))};
}
floor.addEventListener('token-sync',event=>{
  const {npcId,name,hp,kind,hpMax,ac,speed,turnFeatures,vision,overCapacity,invisible}=event.detail;
  const props={name,hp,kind,hpMax,ac,speed,turnFeatures,vision,overCapacity:overCapacity===true,invisible:invisible===true};
  if(!model?.tokens.some(token=>token.npcId===npcId && Object.keys(props).some(key=>JSON.stringify(token[key])!==JSON.stringify(props[key])))) return;
  cancelGesture();
  for(const token of model.tokens) if(token.npcId===npcId) Object.assign(token,props);
  render();
});
floor.addEventListener('token-update',event=>{
  try {
    cancelGesture();
    const token=model?.tokens.find(token=>token.id===event.detail.id);
    if(!token) throw new Error('This token no longer exists.');
    const props=tokenProperties(event.detail.name,event.detail.size,event.detail.hp);
    props.icon=tokenIcon(event.detail.icon ?? token.icon);
    if (typeof event.detail.imageName === 'string' && event.detail.imageName.length <= 150 && !/[/\\?#]/.test(event.detail.imageName) && !event.detail.imageName.includes('..')) props.imageName=event.detail.imageName;
    remember(); Object.assign(token,props); render();
  } catch(error) { event.detail.error=error.message; }
});
floor.addEventListener('vtt-door-toggle',event=>{
  if(!isGM) return;
  if(!model || travelling || chestBusy || floor.equipmentBusy || floor.getAttribute('aria-busy')==='true') return;
  const index=typeof event.detail==='number'?event.detail:event.detail.index;
  const actor=typeof event.detail==='number'?activatingPC():model.tokens.find(token=>token.id===event.detail.tokenId);
  const door=model.doors[index];
  if(!door || door.type==='window' || (!door.open && door.locked)) return;
  cancelGesture(); remember(); door.open=!door.open; fireInteraction('doors',door,actor); render();
});
floor.addEventListener('vtt-object-interact',event=>{
  const fail=text=>{event.detail.error=text; $('session-status').textContent=text;};
  if(!isGM || !model || travelling || chestBusy || floor.equipmentBusy || floor.getAttribute('aria-busy')==='true') {fail('Table is busy; try again.'); return;}
  const {ref,tokenId,remote}=event.detail, object=triggerObject(model,ref);
  const token=model.tokens.find(token=>token.id===tokenId && token.kind==='pc');
  if(!object || remote && (!token || object.hidden)) {fail('Object is unavailable.'); return;}
  if(remote && !(ref.layer==='doors' || ref.layer==='props' && (hasCompartment(object) || ['lever','button'].includes(object.kind)) ||
      model.triggers.some(rule=>rule.event==='interact' && rule.source.layer===ref.layer && rule.source.id===ref.id))) {fail('This object has no interaction.'); return;}
  if(remote) {
    const range=ref.layer==='props'?propDistance(object,token):object.points?Math.min(...segments(object.points).map(([a,b])=>distance(token,a,b))):Math.hypot(object.x-token.x,object.y-token.y);
    if(range>token.size/2+1) { fail('Move next to the object to interact.'); return; }
  }
  if((ref.layer==='doors' || ref.layer==='props') && object.locked && !object.open) {fail('Object is locked.'); return;}
  if(ref.layer==='doors' && object.type==='window') {fail('Windows cannot be toggled.'); return;}
  cancelGesture(); remember();
  if(ref.layer==='doors' || ref.layer==='props') object.open=!object.open;
  else if(ref.layer==='lights') object.off=!object.off;
  fireInteraction(ref.layer,object,token); render();
});
floor.addEventListener('vtt-object-move',event=>{
  if(!isGM || !model || travelling || chestBusy || floor.equipmentBusy || floor.getAttribute('aria-busy')==='true') return;
  const {kind,id,index,x,y}=event.detail;
  const object=kind==='lights'?model.lights[index]:['props','portals'].includes(kind)?model[kind].find(item=>item.id===id):null;
  if(!object || !Number.isFinite(x) || !Number.isFinite(y)) return;
  cancelGesture(); remember();
  const portal=kind==='props' && ['ladder','stairs'].includes(object.kind) && model.portals.find(item=>Math.hypot(item.x-object.x,item.y-object.y)<.5);
  Object.assign(object,{x:Math.max(0,Math.min(model.width,x)),y:Math.max(0,Math.min(model.height,y))});
  if(portal) Object.assign(portal,{x:object.x,y:object.y});
  render();
});
floor.addEventListener('vtt-token-rotate',event=>{
  if(!isGM || !model || travelling || chestBusy || floor.equipmentBusy || floor.getAttribute('aria-busy')==='true') return;
  const token=model.tokens.find(item=>item.id===event.detail);
  if(!token) return;
  cancelGesture(); remember(); token.rotation=((token.rotation || 0)+90)%360; render();
});
floor.addEventListener('vtt-token-move',event=>{
  if(!isGM) return;
  if(!model || travelling || chestBusy || floor.equipmentBusy || floor.getAttribute('aria-busy')==='true') return;
  const {id,x,y}=event.detail, token=model.tokens.find(item=>item.id===id);
  if(!token || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const destination=floor.initiativeActive
    ? playerDestination(floor.tabletopMap,token,x-token.x,y-token.y,true)
    : {x:Math.max(0,Math.min(model.width,x)),y:Math.max(0,Math.min(model.height,y))};
  if(!destination) return;
  if(!floor.initiativeActive && crossesWindow(token,destination,model.doors)) return;
  if(token.x===destination.x && token.y===destination.y) return;
  cancelGesture(); remember();
  const before={x:token.x,y:token.y};
  if(floor.initiativeActive) floor.tabletopMap.initiative.turn.movementSpent+=destination.cost;
  Object.assign(token,{x:destination.x,y:destination.y}); fireCollision(token,before,destination.path || [token]); render();
});
svg.addEventListener('pointercancel',cancelGesture);
svg.addEventListener('wheel',cancelGesture,{passive:true});
svg.tabIndex=0;
svg.setAttribute('role','group');
svg.setAttribute('aria-label','Map editor. Click objects or drag to select. Middle-drag to pan; scroll to zoom. Right-click a token to edit or a light, portal, door, or prop for actions. Walls snap to grid intersections; hold Shift for grid-line midpoints. Enter finishes painting; Escape cancels.');
function stopBuild() {
  if(!floor.buildLayer) return;
  delete floor.buildLayer; cancelGesture(); floor.dispatchEvent(new Event('build-state'));
}
floor.addEventListener('build-stop',stopBuild);
floor.addEventListener('build-start',event=>{
  if(!isGM || !model || travelling || chestBusy || floor.equipmentBusy || floor.getAttribute('aria-busy')==='true') return;
  const name=event.detail;
  if(!['walls','floors','lights','doors','portals','props','tokens'].includes(name)) return;
  cancelGesture(); floor.buildLayer=name; panel.hidden=true; $('fog-tool').value='off';
  layerInput.value=name; toolInput.value='paint';
  if(name==='doors') { $('edit-door-type').value='door'; $('edit-door').value='closed'; doorTypeChanged(); }
  updateTools(); floor.dispatchEvent(new Event('build-state'));
});
for(const button of document.querySelectorAll('[data-edit-layer], #open-tools')) button.addEventListener('click',()=>{
  stopBuild();
  if(button.dataset.editLayer==='tokens') floor.dispatchEvent(new CustomEvent('build-start',{detail:'tokens'}));
});
$('fog-tool').addEventListener('change',()=>{if($('fog-tool').value!=='off') stopBuild();});
for(const input of [layerInput,toolInput]) input.addEventListener('change',()=>{cancelGesture(); updateTools();});
function doorTypeChanged() { $('edit-door').disabled=$('edit-door-type').value==='window'; }
$('edit-door-type').addEventListener('change',doorTypeChanged);
$('prop-category').replaceChildren(...Object.keys(PROP_CATEGORIES).map(name=>new Option(name,name)));
$('prop-category').addEventListener('change',()=>{
  $('prop-kind').value=PROP_CATEGORIES[$('prop-category').value][0];
  $('prop-kind').dispatchEvent(new Event('input'));
});
$('prop-kind').replaceChildren(...Object.entries(PROPS).map(([kind,entry])=>new Option(entry.name,kind)));
for(const [kind,entry] of Object.entries(PROPS)) {
  const button=document.createElement('button');
  button.type='button'; button.dataset.propKind=kind;
  button.append(propIcon(kind),document.createTextNode(entry.name));
  button.addEventListener('click',()=>{
    $('prop-kind').value=kind;
    $('prop-kind').dispatchEvent(new Event('input'));
    toolInput.value='paint'; toolInput.dispatchEvent(new Event('change'));
    button.focus();
  });
  $('prop-palette').append(button);
}
for(const input of [$('prop-kind'),$('prop-size'),$('prop-rotation')]) input.addEventListener('input',()=>{if(input.id==='prop-kind') cancelGesture(); buttons();drawPreview();});
const toolIcons={
  select:'M4 3 19 13l-7 1-3 7Z',
  erase:'m4 13 9-9a2 2 0 0 1 3 0l4 4a2 2 0 0 1 0 3l-9 9H8l-4-4a2 2 0 0 1 0-3Zm5-5 8 8M11 20h10',
  paint:'m14 5 5-3 3 3-3 5-7 7-5-5ZM7 12c-4 0-2 6-5 8 4 2 9 0 9-4',
  bucket:'m9 4 11 11-8 6L2 11Zm-4-2 9 9M3 12h13m4 4s-2 3-2 4a2 2 0 0 0 4 0c0-1-2-4-2-4Z',
  replace:'M2 2h7v7H2ZM15 15h7v7h-7ZM10 10l4 4m-4 0h4v-4'
};
for(const option of toolInput.options) {
  const button=document.createElement('button');
  button.type='button'; button.dataset.tool=option.value;
  button.title=option.textContent;
  button.setAttribute('aria-label',option.textContent);
  const icon=node('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.7,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'});
  icon.append(node('path',{d:toolIcons[option.value]}));
  button.append(icon);
  if(option.value==='bucket') button.title='Bucket: fill enclosed areas with floors, lights, doors, or tokens. Not available for walls.';
  button.addEventListener('click',()=>{ toolInput.value=option.value; toolInput.dispatchEvent(new Event('change')); });
  $('tool-buttons').append(button);
}
for(const palette of document.querySelectorAll('[data-material-layer]')) {
  const input=materialInput(palette.dataset.materialLayer), materials=MATERIAL_LAYERS[palette.dataset.materialLayer];
  const initial=input.value;
  input.replaceChildren(...materials.map(material=>new Option(material,material)));
  input.value=initial;
  for(const material of materials) {
    const color=MATERIALS[material];
    const button=document.createElement('button'), swatch=document.createElement('span');
    button.type='button'; button.dataset.material=material; button.title=material;
    button.setAttribute('aria-label',material);
    swatch.className='material-swatch'; swatch.style.setProperty('--material-color',color); swatch.setAttribute('aria-hidden','true');
    swatch.style.backgroundImage=`url("${materialURL(material)}")`;
    swatch.style.backgroundSize='64px 64px';
    button.append(swatch);
    button.addEventListener('click',()=>{ input.value=material; input.dispatchEvent(new Event('change')); button.focus(); });
    palette.append(button);
  }
  input.addEventListener('change',buttons);
}
for(const swatches of document.querySelectorAll('[data-swatch-layer]')) {
  const activate=event=>{
    if(event.target.closest('.editor-close') || swatches.querySelector('fieldset').disabled || layer()===swatches.dataset.swatchLayer) return;
    if(floor.buildLayer) {
      floor.dispatchEvent(new CustomEvent('build-start',{detail:swatches.dataset.swatchLayer}));
      return;
    }
    layerInput.value=swatches.dataset.swatchLayer;
    layerInput.dispatchEvent(new Event('change'));
  };
  for(const event of ['pointerdown','focusin','click','change']) swatches.addEventListener(event,activate);
}
$('editor-close').addEventListener('click',()=>{
  cancelGesture(); selected.clear(); if(model) render(false);
});
$('edit-apply').addEventListener('click',()=>attempt(()=>apply([...selected],'replace')));
$('edit-delete').addEventListener('click',()=>apply([...selected],'erase'));
$('portal-new-pair').addEventListener('click',()=>{
  pendingPortal=null; selected.clear(); toolInput.value='paint'; updateTools();
});
async function usePortal(source) {
  if(!isGM || !model || !model.portals.includes(source) || travelling || chestBusy || floor.equipmentBusy || floor.getAttribute('aria-busy')==='true') return;
  cancelGesture();
  const destination=portalDestination(portalEntries(),source);
  if(!destination) { message('This portal needs a second node.'); return; }
  const passengers=model.tokens.filter(token=>Math.hypot(token.x-source.x,token.y-source.y)<=.5);
  const moved=passengers.map(token=>({...clone(token),x:destination.portal.x,y:destination.portal.y}));
  // Token imports require centers inside the map, including after saving travel.
  const resolution=destination.entry.map.resolution;
  const width=destination.index===floor.activeFloorIndex?model.width:resolution?.map_size?.x;
  const height=destination.index===floor.activeFloorIndex?model.height:resolution?.map_size?.y;
  if(passengers.length && (destination.portal.x<0 || destination.portal.y<0 || destination.portal.x>width || destination.portal.y>height)) {
    message('The destination must be inside its map to receive tokens.'); return;
  }
  if(destination.index===floor.activeFloorIndex) {
    if(!moved.length) { $('session-status').textContent=`Already on ${destination.entry.name}.`; return; }
    remember();
    for(const token of moved) Object.assign(model.tokens.find(item=>item.id===token.id),token);
    render(); message(`Moved ${moved.length} tokens through the portal.`); return;
  }
  travelling=true; buttons();
  const scene=floor.sceneDocument, sourceEntry=scene.floors[floor.activeFloorIndex];
  try {
    if(!await floor.loadMap({name:destination.entry.sourceName},{entry:destination.entry,index:destination.index})) return;
    if(floor.sceneDocument!==scene) return;
    $('session-status').textContent=`Arrived at ${destination.entry.name}.`;
    if(!moved.length) return;
    const ids=new Set(passengers.map(token=>token.id));
    sourceEntry.map.geezvtt_editor.tokens=sourceEntry.map.geezvtt_editor.tokens.filter(token=>!ids.has(token.id));
    model.tokens.push(...moved.map(token=>({...token,id:crypto.randomUUID()})));
    // Floor switches reset local history; travel must not be undone on only one floor.
    undo=[]; redo=[]; selected.clear(); render(); floor.captureFloor();
    message(`Moved ${moved.length} tokens to ${destination.entry.name}.`);
  } catch(error) { message(`Portal travel failed: ${error.message}`); }
  finally { travelling=false; buttons(); }
}
$('portal-travel').addEventListener('click',()=>{
  if(layer()==='portals' && selected.size===1) usePortal(model?.portals[[...selected][0]]);
});
function history(back) {
  cancelGesture(); const from=back?undo:redo, to=back?redo:undo;
  if(!from.length) return;
  to.push(geometry()); Object.assign(model,from.pop()); selected.clear(); render(); message(back?'Undid edit.':'Redid edit.');
}
document.addEventListener('keydown',event=>{
  if(!isGM) return;
  if(!model || event.defaultPrevented || event.target.isContentEditable || /INPUT|TEXTAREA/.test(event.target.tagName)) return;
  if((event.ctrlKey||event.metaKey) && !event.altKey && ['z','y'].includes(event.key.toLowerCase())) {
    event.preventDefault(); history(event.key.toLowerCase()==='z' && !event.shiftKey); return;
  }
  if(!model || (panel.hidden && !floor.buildLayer) || (svg.hidden && !floor.buildLayer) || event.target.closest('.editor-panel') || /INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName)) return;
  if(event.key==='Escape') { cancelGesture(); selected.clear(); render(false); }
  else if(event.key==='Enter' && tool()==='paint' && (!pointLayer() || drawingWire())) { event.preventDefault(); attempt(placeChain); }
  else if(event.key==='Backspace' && chain.length) { event.preventDefault(); chain.pop(); drawPreview(); }
  else if(event.key==='Delete' && selected.size) { event.preventDefault(); apply([...selected],'erase'); }
});
floor.addEventListener('map-ready',()=>{
  stopBuild(); closeMapMenu();
  gesture=null; chain=[]; hover=null; clearPreview();
  const imported=floor.tabletopMap, raw=floor.sourceMap;
  const saved=raw.geezvtt_editor;
  imported.environment=environmentSettings(saved?.environment,imported);
  const sceneEnvironment=environmentSettings(floor.sceneDocument.environment || imported.environment,imported);
  floor.sceneDocument.environment={time:sceneEnvironment.time,weather:sceneEnvironment.weather,weatherColor:sceneEnvironment.weatherColor};
  Object.assign(imported.environment,floor.sceneDocument.environment);
  model={width:imported.width,height:imported.height,
    triggers:importedTriggers(saved?.triggers),
    portals:importedPortals(saved?.portals),
    props:importedProps(saved?.props),
    floors:(Array.isArray(saved?.floors)?saved.floors:[]).filter(o=>o && Number.isFinite(o.x) && Number.isFinite(o.y)).map(o=>({x:o.x,y:o.y,size:Number.isFinite(o.size) && o.size>=.25 && o.size<=20?o.size:1,hidden:o.hidden===true,material:Object.hasOwn(MATERIALS,o.material)?o.material:'stone'})),
    walls:imported.walls.flatMap((points,i)=>segments(points).map(pair=>({points:pair,hidden:saved?.wallHidden?.[i]===true,material:saved?.wallMaterials?.[i]}))),
    doors:imported.doors.map((d,i)=>({...d,type:portalType(d.source),hidden:d.source?.geezvtt_hidden===true,locked:portalType(d.source)==='door' && d.source?.geezvtt_locked===true,open:portalType(d.source)==='door' && d.open,material:saved?.doorMaterials?.[i]})),
    lights:imported.lights.map(l=>({...l,propId:typeof l.source?.geezvtt_prop_id==='string'?l.source.geezvtt_prop_id:null,hidden:l.source?.geezvtt_hidden===true,off:l.source?.geezvtt_off===true,icon:propAppearance({icon:l.source?.geezvtt_icon})?l.source.geezvtt_icon:''})),tokens:importedTokens(saved?.tokens,imported.width,imported.height)};
  // Each wall and door segment is individually selectable and replaceable.
  model.doors=model.doors.flatMap(d=>segments(d.points).map(points=>({...d,points})));
  for(const name of ['floors','walls','doors','lights','props','portals','tokens']) model[name].forEach((object,index)=>{
    const id=saved?.objectIds?.[name]?.[index];
    if(typeof id==='string' && id && id.length<=100) object.id=id;
  });
  undo=[]; redo=[]; selected.clear(); controls.disabled=$('toggle-3d').getAttribute('aria-pressed')==='true';
  document.querySelectorAll('.swatch-panel fieldset').forEach(fieldset=>{ fieldset.disabled=controls.disabled && !fieldset.closest('#tokens-panel'); });
  imported.initiative=initiativeState(saved?.initiative,model.tokens);
  updateTools(); render();
  $('edit-export').disabled=false;
  if(controls.disabled) message('Use Build controls to place objects in 3D.');
});
function viewState() {
  stopBuild(); closeMapMenu();
  const on=$('toggle-3d').getAttribute('aria-pressed')==='true';
  cancelGesture(); controls.disabled=!model || on;
  document.querySelectorAll('.swatch-panel fieldset').forEach(fieldset=>{ fieldset.disabled=!model || on && !fieldset.closest('#tokens-panel'); });
  if(on) message('Use Build controls to place objects in 3D.'); else if(model) updateTools();
}
new MutationObserver(viewState).observe($('toggle-3d'),{attributes:true,attributeFilter:['aria-pressed']});
export function serializeMap() {
  if(!model) throw new Error('Import a map first.');
  const raw=clone(floor.sourceMap), origin=raw.resolution?.map_origin || {x:0,y:0};
  const offset=p=>({x:p.x+(Number.isFinite(origin.x)?origin.x:0),y:p.y+(Number.isFinite(origin.y)?origin.y:0)});
  raw.line_of_sight=model.walls.map(w=>w.points.map(offset));
  raw.portals=model.doors.map(d=>({...d.source,geezvtt_type:d.type || 'door',geezvtt_hidden:!!d.hidden,geezvtt_locked:d.type!=='window' && !!d.locked,bounds:d.points.map(offset),position:offset({x:(d.points[0].x+d.points[1].x)/2,y:(d.points[0].y+d.points[1].y)/2}),closed:d.type==='window'?false:!d.open,rotation:Math.atan2(d.points[1].y-d.points[0].y,d.points[1].x-d.points[0].x)}));
  raw.lights=model.lights.map(l=>({...l.source,geezvtt_icon:l.icon || '',geezvtt_prop_id:l.propId || null,geezvtt_hidden:!!l.hidden,geezvtt_off:!!l.off,position:offset(l),range:l.range,intensity:l.intensity ?? 1,color:Math.round((l.opacity ?? 1)*255).toString(16).padStart(2,'0')+l.color.slice(1),shadows:l.source?.shadows ?? true}));
  raw.geezvtt_editor={...raw.geezvtt_editor,floors:clone(model.floors),portals:clone(model.portals),props:clone(model.props),wallMaterials:model.walls.map(w=>w.material || null),doorMaterials:model.doors.map(d=>d.material || null),tokens:clone(floor.tabletopMap.tokens || []),environment:clone(floor.tabletopMap.environment)};
  raw.geezvtt_editor.triggers=clone(model.triggers);
  raw.geezvtt_editor.wallHidden=model.walls.map(w=>w.hidden===true);
  raw.geezvtt_editor.objectIds=Object.fromEntries(['floors','walls','doors','lights','props','portals','tokens'].map(name=>[name,model[name].map(object=>object.id)]));
  raw.geezvtt_editor.initiative=initiativeState(floor.tabletopMap.initiative,model.tokens);
  return raw;
}
export function sharedMapState() {
  return { ...geometry(), environment: clone(floor.tabletopMap.environment), initiative: initiativeState(floor.tabletopMap.initiative,model.tokens) };
}
export function applySharedMap(state) {
  if(isGM || !model || !state) return;
  // Firebase omits empty arrays when reading JSON back.
  for(const key of ['floors','walls','doors','lights','tokens','portals','props']) {
    if(state[key] != null && !Array.isArray(state[key])) return;
  }
  for(const key of ['floors','walls','doors','lights','tokens','portals','props']) model[key]=clone(state[key] || []);
  model.triggers=importedTriggers(state.triggers);
  floor.tabletopMap.environment=environmentSettings(state.environment,model);
  floor.tabletopMap.initiative=initiativeState(state.initiative,model.tokens);
  render();
  floor.dispatchEvent(new Event('environment-changed'));
}
$('edit-export').addEventListener('click',()=>{
  const raw=serializeMap();
  const url=URL.createObjectURL(new Blob([JSON.stringify(raw)],{type:'application/json'})), link=document.createElement('a');
  link.href=url; link.download=floor.sourceName.replace(/\.dd2vtt$/i,'')+'-edited.dd2vtt'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  message('Exported map with edited objects and materials.');
});
// Modules may finish loading after an import.
if(floor.tabletopMap) floor.dispatchEvent(new Event('map-ready'));

window.addEventListener('token-art-ready',()=>{if(model) render();});
window.addEventListener('player-signed-in',()=>{if(model) render();});
