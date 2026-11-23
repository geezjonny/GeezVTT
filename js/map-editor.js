import { MATERIALS, clone, segments, distance, inBox, bucketCells, portalType } from './map-editor-model.js';
import { isGM } from './session-role.js';
import { importedTokens, tokenProperties, crossesWindow, pcTokenStatus } from './token-model.js';
import { environmentSettings } from './environment-model.js';
import { importedPortals, portalDestination, PORTAL_ICONS } from './portal-model.js';
import { onMapRightClick } from './map-right-click.js';
import { showMapMenu, closeMapMenu } from './map-object-menu.js';
import { installMaterialPatterns, materialURL } from './material-textures.js';
import { PROPS, importedProps, propProperties, propDistance, propAppearance } from './prop-model.js';
import { propIcon, propMarker } from './prop-icons.js';

const $ = id => document.getElementById(id);
const floor=$('floor'), svg=$('map-view'), preview=$('edit-preview');
const controls=$('editor-controls'), layerInput=$('edit-layer'), toolInput=$('edit-tool');
const panel=$('editor-panel');
const showHiddenPortals=()=>!panel.hidden && !$('portals-panel').hidden && layer()==='portals';
const showHiddenProps=()=>!panel.hidden && !$('props-panel').hidden && layer()==='props';
installMaterialPatterns(svg);
let model, selected=new Set(), undo=[], redo=[], chain=[], hover, gesture;
let pendingPortal, travelling=false;
const layer=()=>layerInput.value, tool=()=>toolInput.value;
const pointLayer=()=>['lights','tokens','floors','portals','props'].includes(layer());
const materialInput=(name=layer())=>$(name==='floors'?'edit-floor-material':name==='doors'?'edit-door-material':'edit-material');
const message=text=>{ $('editor-help').textContent=text; };
const node=(tag,attrs={})=>{
  const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [key,value] of Object.entries(attrs)) el.setAttribute(key,value);
  return el;
};
const geometry=()=>clone({floors:model.floors,walls:model.walls,doors:model.doors,lights:model.lights,tokens:model.tokens,portals:model.portals,props:model.props});
function portalEntries() {
  return (floor.sceneDocument?.floors || []).flatMap((entry,index)=>
    (index===floor.activeFloorIndex?model.portals:importedPortals(entry.map.geezvtt_editor?.portals)).map(portal=>({portal,index,entry})));
}
function pendingNode() {
  const matches=pendingPortal?.scene===floor.sceneDocument?portalEntries().filter(({portal})=>portal.pairId===pendingPortal.pairId):[];
  return matches.length===1?matches[0]:null;
}
function remember() { undo.push(geometry()); if(undo.length>50) undo.shift(); redo=[]; }
function buttons() {
  $('edit-apply').disabled=$('edit-delete').disabled=!selected.size;
  if(layer()==='portals') $('edit-apply').disabled=true;
  const portal=layer()==='portals' && selected.size===1?model?.portals[[...selected][0]]:null;
  const destination=portal && portalDestination(portalEntries(),portal);
  $('portal-travel').disabled=travelling || !destination;
  const pending=model && pendingNode();
  $('portal-status').textContent=pending?`Unpaired portal: ${pending.entry.name}`:portal?
    destination?`Linked to ${destination.entry.name}`:'Unpaired portal':'';
  document.querySelectorAll('[data-prop-kind]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.propKind===$('prop-kind').value)));
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
  for(const name of ['floors','walls','doors','lights','props','portals','tokens']) {
    const group=$(name); group.replaceChildren();
    model[name].forEach((obj,index)=>{
      let el;
      if(name==='props') {
        if(obj.hidden && !showHiddenProps()) return;
        el=propMarker(obj);
        el.setAttribute('opacity',obj.hidden?.3:1);
        el.setAttribute('tabindex','0'); el.setAttribute('role','button');
        el.setAttribute('aria-label',`${obj.hidden?'Hidden ':''}${PROPS[obj.kind].name}. Right-click for actions.`);
        el.dataset.propId=obj.id;
      } else if(name==='portals') {
        if(obj.hidden && !showHiddenPortals()) return;
        const destination=portalDestination(portalEntries(),obj);
        el=node('g',{transform:`translate(${obj.x} ${obj.y})`,opacity:obj.hidden?.3:1,tabindex:0,role:'button','aria-label':`${obj.hidden?'Hidden portal':'Portal'}. Right-click for actions.`});
        el.dataset.portalId=obj.id;
        el.append(node('circle',{r:.42,fill:'#502e73','fill-opacity':.75,stroke:destination?'#d4a0ff':'#ffce73','stroke-width':3,'stroke-dasharray':destination?'none':'4 3','vector-effect':'non-scaling-stroke'}));
        const text=node('text',{'text-anchor':'middle','dominant-baseline':'central','font-size':.3,fill:'#fff','pointer-events':'none'});
        const appearance=propAppearance(obj);
        if(appearance) el.append(propMarker({...appearance,x:0,y:0}));
        else { text.textContent=PORTAL_ICONS[obj.icon] || PORTAL_ICONS.portal; el.append(text); }
      } else if(name==='tokens') {
        el=node('g',{transform:`translate(${obj.x} ${obj.y})`,class:'map-token',tabindex:0,role:'button','aria-label':`${obj.name}, HP ${obj.hp}, size ${obj.size} squares. Enter to ${isGM?'edit':'select'}.`});
        el.dataset.tokenId=obj.id;
        el.append(node('circle',{r:obj.size/2,fill:'#344f70',stroke:'#a2cbff','stroke-width':2,'vector-effect':'non-scaling-stroke'}));
        const text=node('text',{'text-anchor':'middle','dominant-baseline':'central','font-size':obj.size*.3,fill:'#fff','pointer-events':'none'});
        text.textContent=obj.name.split(/\s+/).slice(0,2).map(word=>Array.from(word)[0]).join('');
        el.append(text);
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
        el=node('rect',{x:obj.x-.5,y:obj.y-.5,width:1,height:1,fill:`url(#material-${Object.hasOwn(MATERIALS,obj.material)?obj.material:'stone'})`,'stroke-width':2,'vector-effect':'non-scaling-stroke'});
      } else if(name==='lights') {
        el=node('g',{tabindex:0,role:'button','aria-label':'Light. Right-click for actions.'});
        el.dataset.lightIndex=index;
        el.append(node('circle',{cx:obj.x,cy:obj.y,r:obj.range,fill:obj.color,stroke:obj.color,opacity:obj.opacity,class:'light-range'}));
        const appearance=propAppearance(obj);
        const marker=appearance?propMarker(appearance):node('circle',{cx:obj.x,cy:obj.y,r:.12,fill:obj.color});
        marker.classList.add('light-source'); el.append(marker);
      } else {
        el=node('polyline',{points:obj.points.map(p=>`${p.x},${p.y}`).join(' '),class:`map-line${name==='doors'?` door${obj.type==='window'?' window':obj.open?' open':''}`:''}`});
        if(name==='doors' && obj.type!=='window') {
          el.dataset.doorIndex=index;
          el.setAttribute('tabindex','0');
          el.setAttribute('role','button');
          el.setAttribute('aria-label',`Door, ${obj.open?'open':'closed'}, ${obj.locked?'locked':'unlocked'}. Right-click for actions.`);
        }
        if(obj.type!=='window') el.style.stroke=`url(#material-${Object.hasOwn(MATERIALS,obj.material)?obj.material:name==='doors'?'wood':'stone'})`;
      }
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
  floor.tabletopMap={...floor.tabletopMap,floors:model.floors,walls:model.walls.map(w=>w.points),wallMaterials:model.walls.map(w=>w.material),doors:model.doors,lights:model.lights,tokens:model.tokens,portals:model.portals,props:model.props};
  buttons();
  if(notify) floor.dispatchEvent(new Event('map-changed'));
}
function updateTools() {
  chain=[]; hover=null; gesture=null; preview.replaceChildren(); selected.clear();
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
  const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());
  if(!snap) return {x:p.x,y:p.y};
  if(['floors','portals','props'].includes(layer())) return $('edit-snap').checked?{x:Math.floor(p.x)+.5,y:Math.floor(p.y)+.5}:{x:p.x,y:p.y};
  const clamp=(v,max)=>Math.max(0,Math.min(max,v));
  if(snap && layer()==='walls') {
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
  preview.replaceChildren();
  if(layer()==='props' && tool()==='paint' && hover) {
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
function apply(indices,action) {
  if(!indices.length) { message('No objects found in the active layer.'); return; }
  const props=action==='replace'?settings():null;
  if(props?.open && indices.some(i=>model[layer()][i].locked)) throw new Error('Unlock the door before opening it.');
  if(layer()==='doors' && props?.type==='window') props.locked=false;
  remember();
  if(action==='erase') model[layer()]=model[layer()].filter((_,i)=>!indices.includes(i));
  else for(const i of indices) Object.assign(model[layer()][i],props);
  selected.clear(); render(); message(`${action==='erase'?'Erased':'Replaced'} ${indices.length} ${layer()}.`);
}
function addPoint(p,props) { return {x:p.x,y:p.y,...props,...(['tokens','props'].includes(layer())?{id:crypto.randomUUID()}:{})}; }
function placeChain() {
  if(chain.length<2) { message('Choose at least two distinct points, then press Enter.'); return; }
  const props=settings(); remember();
  for(const pair of segments(chain)) model[layer()].push({points:clone(pair),...props});
  chain=[]; hover=null; preview.replaceChildren(); render(); message('Placed segments. Click to begin another chain.');
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
  if(pointLayer()) { remember(); model[layer()].push(addPoint(p,props)); render(); }
  else if(!chain.length || Math.hypot(chain.at(-1).x-p.x,chain.at(-1).y-p.y)>.00001) { chain.push(p); drawPreview(); }
}
function bucket(p) {
  const spacing=layer()==='floors'?1:Number($('edit-spacing').value);
  if(!Number.isFinite(spacing) || spacing<.5 || spacing>100) throw new Error('Fill spacing must be between 0.5 and 100 squares.');
  const bounds=layer()==='floors'?{
    left:Math.floor(Math.min(0,p.x,...model.floors.map(o=>o.x-.5))),
    top:Math.floor(Math.min(0,p.y,...model.floors.map(o=>o.y-.5))),
    right:Math.ceil(Math.max(model.width,p.x+1,...model.floors.map(o=>o.x+.5))),
    bottom:Math.ceil(Math.max(model.height,p.y+1,...model.floors.map(o=>o.y+.5)))
  }:undefined;
  const props=settings(), cells=bucketCells(model,p,spacing,2000,bounds);
  const fresh=cells.filter(c=>!model[layer()].some(o=>pointLayer()?Math.hypot(o.x-c.x,o.y-c.y)<.01:distance(c,o.points[0],o.points[1])<.01));
  if(!fresh.length) { message('This area is already filled.'); return; }
  remember();
  for(const c of fresh) model[layer()].push(pointLayer()?addPoint(c,props):{points:[{x:Math.max(0,c.x-.5),y:c.y},{x:Math.min(model.width,c.x+.5),y:c.y}],...props});
  render(); message(`Filled area with ${fresh.length} ${layer()}.`);
}
svg.addEventListener('pointerdown',event=>{
  if(!isGM) return;
  if(!model || panel.hidden || event.button!==0 || svg.hidden) return;
  // Floors can extend the ground beyond the imported image.
  const raw=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());
  if(!['floors','portals','props'].includes(layer()) && (tool()==='paint' || tool()==='bucket') && !contains(raw)) return;
  event.preventDefault(); svg.focus();
  const p=point(event), index=hit(p);
  if(tool()==='paint' || tool()==='bucket') {
    attempt(()=>tool()==='paint'?paint(point(event,true)):bucket(p)); return;
  }
  gesture={start:p,screen:{x:event.clientX,y:event.clientY},index,shift:event.shiftKey,box:!(tool()==='select' && selected.has(index) && !event.shiftKey),before:null};
  svg.setPointerCapture(event.pointerId);
});
svg.addEventListener('pointermove',event=>{
  if(!model || panel.hidden) return;
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
  if(g.before) { undo.push(g.before); if(undo.length>50) undo.shift(); redo=[]; render(); return; }
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
  gesture=null; chain=[]; hover=null; preview.replaceChildren();
}
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
  if(!model || travelling || floor.getAttribute('aria-busy')==='true') return;
  cancelGesture();
  const portal=model.portals.find(item=>item.id===id);
  if(!portal) return;
  const change=update=>{
    if(!model.portals.includes(portal)) return;
    remember(); update(); selected.clear(); render();
  };
  showMapMenu(x,y,[
    {label:portal.hidden?'Show':'Hide',action:()=>change(()=>{portal.hidden=!portal.hidden;})},
    {label:'Delete',action:()=>change(()=>{model.portals=model.portals.filter(item=>item!==portal);})},
    {label:'Change icon…',action:()=>iconMenu(x,y,icon=>change(()=>{portal.icon=icon;}),origin,true)}
  ],origin);
}
function lightMenu(index,x,y,origin) {
  if(!model || travelling || floor.getAttribute('aria-busy')==='true') return;
  cancelGesture();
  const light=model.lights[index];
  if(!light) return;
  showMapMenu(x,y,[
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
  if(!model || travelling || floor.getAttribute('aria-busy')==='true') return;
  const door=model.doors[index];
  if(!door || door.type==='window') return;
  cancelGesture();
  const change=update=>{
    if(!model.doors.includes(door)) return;
    remember(); update(); selected.clear(); render();
  };
  showMapMenu(x,y,[
    {label:door.open?'Close':'Open',disabled:!door.open && door.locked,action:()=>change(()=>{door.open=!door.open;})},
    {label:door.locked?'Unlock':'Lock',action:()=>change(()=>{door.locked=!door.locked; if(door.locked) door.open=false;})},
    {label:'Delete',action:()=>change(()=>{model.doors=model.doors.filter(item=>item!==door);})}
  ],origin);
}
function propMenu(id,x,y,origin) {
  if(!model || travelling || floor.getAttribute('aria-busy')==='true') return;
  cancelGesture();
  const prop=model.props.find(item=>item.id===id);
  if(!prop) return;
  const change=update=>{
    if(!model.props.includes(prop)) return;
    remember(); update(); selected.clear(); render();
  };
  showMapMenu(x,y,[
    {label:prop.hidden?'Show':'Hide',action:()=>change(()=>{prop.hidden=!prop.hidden;})},
    {label:'Rotate 90°',action:()=>change(()=>{prop.rotation=(prop.rotation+90)%360;})},
    {label:'Change object…',action:()=>showMapMenu(x,y,Object.entries(PROPS).map(([kind,entry])=>({
      label:entry.name,action:()=>change(()=>{prop.kind=kind;})
    })),origin)},
    {label:'Delete',action:()=>change(()=>{model.props=model.props.filter(item=>item!==prop);})}
  ],origin);
}
onMapRightClick(svg,event=>{
  if(!model || svg.hidden) return;
  const p=point(event);
  // Tokens are drawn above portals and retain their own right-click action.
  if(model.tokens.some(token=>Math.hypot(p.x-token.x,p.y-token.y)<=token.size/2)) return;
  const portal=model.portals.findLast(item=>{
    const appearance=propAppearance(item);
    return (!item.hidden || showHiddenPortals()) && (appearance?propDistance(appearance,p)===0:Math.hypot(p.x-item.x,p.y-item.y)<=.42);
  });
  if(portal) { portalMenu(portal.id,event.clientX,event.clientY,svg); return; }
  const prop=model.props.findLast(item=>(!item.hidden || showHiddenProps()) && propDistance(item,p)===0);
  if(prop) { propMenu(prop.id,event.clientX,event.clientY,svg); return; }
  const matrix=svg.getScreenCTM();
  let best=9/Math.max(.001,Math.hypot(matrix.a,matrix.b)), index=-1;
  model.doors.forEach((door,i)=>{
    if(door.type==='window') return;
    const d=Math.min(...segments(door.points).map(([a,b])=>distance(p,a,b)));
    if(d<=best) { best=d; index=i; }
  });
  if(index>=0) { doorMenu(index,event.clientX,event.clientY,svg); return; }
  const lightIndex=model.lights.findLastIndex(item=>{
    const appearance=propAppearance(item);
    return appearance?propDistance(appearance,p)===0:Math.hypot(p.x-item.x,p.y-item.y)<=Math.max(.12,best);
  });
  if(lightIndex>=0) lightMenu(lightIndex,event.clientX,event.clientY,svg);
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
  if(!isGM) return;
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
  if(!isGM) return;
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
floor.addEventListener('token-sync',event=>{
  const {npcId,name,size,hp,kind,hpMax,ac}=event.detail;
  const props={name,size,hp,kind,hpMax,ac};
  if(!model?.tokens.some(token=>token.npcId===npcId && Object.keys(props).some(key=>token[key]!==props[key]))) return;
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
    remember(); Object.assign(token,props); render();
  } catch(error) { event.detail.error=error.message; }
});
floor.addEventListener('vtt-door-toggle',event=>{
  if(!isGM) return;
  if(!model || travelling || floor.getAttribute('aria-busy')==='true') return;
  const door=model.doors[event.detail];
  if(!door || door.type==='window' || (!door.open && door.locked)) return;
  cancelGesture(); remember(); door.open=!door.open; render();
});
floor.addEventListener('vtt-token-move',event=>{
  if(!isGM) return;
  if(!model || travelling || floor.getAttribute('aria-busy')==='true') return;
  const {id,x,y}=event.detail, token=model.tokens.find(item=>item.id===id);
  if(!token || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const destination={x:Math.max(0,Math.min(model.width,x)),y:Math.max(0,Math.min(model.height,y))};
  if(crossesWindow(token,destination,model.doors)) return;
  if(token.x===destination.x && token.y===destination.y) return;
  cancelGesture(); remember(); Object.assign(token,destination); render();
});
svg.addEventListener('pointercancel',cancelGesture);
svg.addEventListener('wheel',cancelGesture,{passive:true});
svg.tabIndex=0;
svg.setAttribute('role','group');
svg.setAttribute('aria-label','Map editor. Click objects or drag to select. Middle-drag to pan; scroll to zoom. Right-click a token to edit or a light, portal, door, or prop for actions. Walls snap to grid intersections; hold Shift for grid-line midpoints. Enter finishes painting; Escape cancels.');
for(const input of [layerInput,toolInput]) input.addEventListener('change',()=>{cancelGesture(); updateTools();});
function doorTypeChanged() { $('edit-door').disabled=$('edit-door-type').value==='window'; }
$('edit-door-type').addEventListener('change',doorTypeChanged);
$('prop-kind').replaceChildren(...Object.entries(PROPS).map(([kind,entry])=>new Option(entry.name,kind)));
for(const [kind,entry] of Object.entries(PROPS)) {
  const button=document.createElement('button');
  button.type='button'; button.dataset.propKind=kind;
  button.append(propIcon(kind),document.createTextNode(entry.name));
  button.addEventListener('click',()=>{
    $('prop-kind').value=kind;
    toolInput.value='paint'; toolInput.dispatchEvent(new Event('change'));
    button.focus();
  });
  $('prop-palette').append(button);
}
for(const input of [$('prop-kind'),$('prop-size'),$('prop-rotation')]) input.addEventListener('input',()=>{buttons();drawPreview();});
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
  const input=materialInput(palette.dataset.materialLayer), swatches=new Map();
  let recent=[input.value,...Object.keys(MATERIALS).filter(material=>material!==input.value)].slice(0,4);
  const more=document.createElement('select');
  more.className='material-more';
  more.setAttribute('aria-label',`More ${palette.dataset.materialLayer} materials`);
  const initial=input.value;
  input.replaceChildren(...Object.keys(MATERIALS).map(material=>new Option(material,material)));
  input.value=initial;
  function updatePalette() {
    recent=[input.value,...recent.filter(material=>material!==input.value)].slice(0,4);
    for(const [material,button] of swatches) button.hidden=!recent.includes(material);
    for(const material of recent) palette.append(swatches.get(material));
    more.replaceChildren(new Option('More…',''),...Object.keys(MATERIALS).filter(material=>!recent.includes(material)).map(material=>new Option(material,material)));
    more.disabled=recent.length===Object.keys(MATERIALS).length;
    palette.append(more);
  }
  for(const [material,color] of Object.entries(MATERIALS)) {
    const button=document.createElement('button'), swatch=document.createElement('span');
    button.type='button'; button.dataset.material=material; button.title=material;
    button.setAttribute('aria-label',material);
    swatch.className='material-swatch'; swatch.style.setProperty('--material-color',color); swatch.setAttribute('aria-hidden','true');
    swatch.style.backgroundImage=`url("${materialURL(material)}")`;
    swatch.style.backgroundSize='64px 64px';
    button.append(swatch);
    button.addEventListener('click',()=>{ input.value=material; input.dispatchEvent(new Event('change')); button.focus(); });
    swatches.set(material,button);
    palette.append(button);
  }
  input.addEventListener('change',()=>{ updatePalette(); buttons(); });
  more.addEventListener('change',()=>{
    if(!more.value) return;
    input.value=more.value; input.dispatchEvent(new Event('change')); swatches.get(input.value).focus();
  });
  updatePalette();
}
for(const swatches of document.querySelectorAll('[data-swatch-layer]')) {
  const activate=event=>{
    if(event.target.closest('.editor-close') || swatches.querySelector('fieldset').disabled || layer()===swatches.dataset.swatchLayer) return;
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
$('portal-travel').addEventListener('click',async()=>{
  if(travelling || floor.getAttribute('aria-busy')==='true' || layer()!=='portals' || selected.size!==1) return;
  cancelGesture();
  const source=model.portals[[...selected][0]], destination=source && portalDestination(portalEntries(),source);
  if(!destination) { message('This portal needs a second node.'); return; }
  const passengers=model.tokens.filter(token=>Math.hypot(token.x-source.x,token.y-source.y)<=.5);
  if(!passengers.length) { message('Move a token center onto this portal first.'); return; }
  const moved=passengers.map(token=>({...clone(token),x:destination.portal.x,y:destination.portal.y}));
  // Token imports require centers inside the map, including after saving travel.
  const resolution=destination.entry.map.resolution;
  const width=destination.index===floor.activeFloorIndex?model.width:resolution?.map_size?.x;
  const height=destination.index===floor.activeFloorIndex?model.height:resolution?.map_size?.y;
  if(destination.portal.x<0 || destination.portal.y<0 || destination.portal.x>width || destination.portal.y>height) {
    message('The destination must be inside its map to receive tokens.'); return;
  }
  if(destination.index===floor.activeFloorIndex) {
    remember();
    for(const token of moved) Object.assign(model.tokens.find(item=>item.id===token.id),token);
    render(); message(`Moved ${moved.length} tokens through the portal.`); return;
  }
  travelling=true; buttons();
  const scene=floor.sceneDocument, sourceEntry=scene.floors[floor.activeFloorIndex];
  try {
    if(!await floor.loadMap({name:destination.entry.sourceName},{entry:destination.entry,index:destination.index})) return;
    if(floor.sceneDocument!==scene) return;
    const ids=new Set(passengers.map(token=>token.id));
    sourceEntry.map.geezvtt_editor.tokens=sourceEntry.map.geezvtt_editor.tokens.filter(token=>!ids.has(token.id));
    model.tokens.push(...moved.map(token=>({...token,id:crypto.randomUUID()})));
    // Floor switches reset local history; travel must not be undone on only one floor.
    undo=[]; redo=[]; selected.clear(); render(); floor.captureFloor();
    message(`Moved ${moved.length} tokens to ${destination.entry.name}.`);
  } catch(error) { message(`Portal travel failed: ${error.message}`); }
  finally { travelling=false; buttons(); }
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
  if(!model || panel.hidden || svg.hidden || event.target.closest('.editor-panel') || /INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName)) return;
  if(event.key==='Escape') { cancelGesture(); selected.clear(); render(false); }
  else if(event.key==='Enter' && tool()==='paint' && !pointLayer()) { event.preventDefault(); attempt(placeChain); }
  else if(event.key==='Backspace' && chain.length) { event.preventDefault(); chain.pop(); drawPreview(); }
  else if(event.key==='Delete' && selected.size) { event.preventDefault(); apply([...selected],'erase'); }
});
floor.addEventListener('map-ready',()=>{
  closeMapMenu();
  gesture=null; chain=[]; hover=null; preview.replaceChildren();
  const imported=floor.tabletopMap, raw=floor.sourceMap;
  const saved=raw.geezvtt_editor;
  imported.environment=environmentSettings(saved?.environment,imported);
  const sceneEnvironment=environmentSettings(floor.sceneDocument.environment || imported.environment,imported);
  floor.sceneDocument.environment={time:sceneEnvironment.time,weather:sceneEnvironment.weather};
  Object.assign(imported.environment,floor.sceneDocument.environment);
  model={width:imported.width,height:imported.height,
    portals:importedPortals(saved?.portals),
    props:importedProps(saved?.props),
    floors:(Array.isArray(saved?.floors)?saved.floors:[]).filter(o=>o && Number.isFinite(o.x) && Number.isFinite(o.y)).map(o=>({x:o.x,y:o.y,material:Object.hasOwn(MATERIALS,o.material)?o.material:'stone'})),
    walls:imported.walls.flatMap((points,i)=>segments(points).map(pair=>({points:pair,material:saved?.wallMaterials?.[i]}))),
    doors:imported.doors.map((d,i)=>({...d,type:portalType(d.source),locked:portalType(d.source)==='door' && d.source?.geezvtt_locked===true,open:portalType(d.source)==='door' && d.source?.geezvtt_locked!==true && d.open,material:saved?.doorMaterials?.[i]})),
    lights:imported.lights.map(l=>({...l,icon:propAppearance({icon:l.source?.geezvtt_icon})?l.source.geezvtt_icon:''})),tokens:importedTokens(saved?.tokens,imported.width,imported.height)};
  // Each wall and door segment is individually selectable and replaceable.
  model.doors=model.doors.flatMap(d=>segments(d.points).map(points=>({...d,points})));
  undo=[]; redo=[]; selected.clear(); controls.disabled=$('toggle-3d').getAttribute('aria-pressed')==='true';
  document.querySelectorAll('.swatch-panel fieldset').forEach(fieldset=>{ fieldset.disabled=controls.disabled; });
  updateTools(); render();
  $('edit-export').disabled=false;
  if(controls.disabled) message('Switch to 2D view to edit. Your changes are visible in 3D.');
});
function viewState() {
  closeMapMenu();
  const on=$('toggle-3d').getAttribute('aria-pressed')==='true';
  cancelGesture(); controls.disabled=!model || on;
  document.querySelectorAll('.swatch-panel fieldset').forEach(fieldset=>{ fieldset.disabled=controls.disabled; });
  if(on) message('Switch to 2D view to edit. Your changes are visible in 3D.'); else if(model) updateTools();
}
new MutationObserver(viewState).observe($('toggle-3d'),{attributes:true,attributeFilter:['aria-pressed']});
export function serializeMap() {
  if(!model) throw new Error('Import a map first.');
  const raw=clone(floor.sourceMap), origin=raw.resolution?.map_origin || {x:0,y:0};
  const offset=p=>({x:p.x+(Number.isFinite(origin.x)?origin.x:0),y:p.y+(Number.isFinite(origin.y)?origin.y:0)});
  raw.line_of_sight=model.walls.map(w=>w.points.map(offset));
  raw.portals=model.doors.map(d=>({...d.source,geezvtt_type:d.type || 'door',geezvtt_locked:d.type!=='window' && !!d.locked,bounds:d.points.map(offset),position:offset({x:(d.points[0].x+d.points[1].x)/2,y:(d.points[0].y+d.points[1].y)/2}),closed:d.type==='window'?false:!d.open,rotation:Math.atan2(d.points[1].y-d.points[0].y,d.points[1].x-d.points[0].x)}));
  raw.lights=model.lights.map(l=>({...l.source,geezvtt_icon:l.icon || '',position:offset(l),range:l.range,intensity:l.intensity ?? 1,color:Math.round((l.opacity ?? 1)*255).toString(16).padStart(2,'0')+l.color.slice(1),shadows:l.source?.shadows ?? true}));
  raw.geezvtt_editor={...raw.geezvtt_editor,floors:clone(model.floors),portals:clone(model.portals),props:clone(model.props),wallMaterials:model.walls.map(w=>w.material || null),doorMaterials:model.doors.map(d=>d.material || null),tokens:clone(floor.tabletopMap.tokens || []),environment:clone(floor.tabletopMap.environment)};
  return raw;
}
export function sharedMapState() {
  return { ...geometry(), environment: clone(floor.tabletopMap.environment) };
}
export function applySharedMap(state) {
  if(isGM || !model || !state) return;
  // Firebase omits empty arrays when reading JSON back.
  for(const key of ['floors','walls','doors','lights','tokens','portals','props']) {
    if(state[key] != null && !Array.isArray(state[key])) return;
  }
  for(const key of ['floors','walls','doors','lights','tokens','portals','props']) model[key]=clone(state[key] || []);
  floor.tabletopMap.environment=environmentSettings(state.environment,model);
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
