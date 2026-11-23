import { MATERIALS, clone, segments, distance, inBox, bucketCells, portalType } from './map-editor-model.js';
import { importedTokens, tokenProperties, crossesWindow } from './token-model.js';
import { environmentSettings } from './environment-model.js';

const $ = id => document.getElementById(id);
const floor=$('floor'), svg=$('map-view'), preview=$('edit-preview');
const controls=$('editor-controls'), layerInput=$('edit-layer'), toolInput=$('edit-tool');
const panel=$('editor-panel');
let model, selected=new Set(), undo=[], redo=[], chain=[], hover, gesture;
const layer=()=>layerInput.value, tool=()=>toolInput.value;
const pointLayer=()=>['lights','tokens','floors'].includes(layer());
const materialInput=(name=layer())=>$(name==='floors'?'edit-floor-material':name==='doors'?'edit-door-material':'edit-material');
const message=text=>{ $('editor-help').textContent=text; };
const node=(tag,attrs={})=>{
  const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [key,value] of Object.entries(attrs)) el.setAttribute(key,value);
  return el;
};
const geometry=()=>clone({floors:model.floors,walls:model.walls,doors:model.doors,lights:model.lights,tokens:model.tokens});
function remember() { undo.push(geometry()); if(undo.length>50) undo.shift(); redo=[]; }
function buttons() {
  $('edit-apply').disabled=$('edit-delete').disabled=!selected.size;
  document.querySelectorAll('[data-tool]').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.tool===tool()));
    button.disabled=toolInput.querySelector(`[value="${button.dataset.tool}"]`).disabled;
  });
  document.querySelectorAll('[data-material]').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.material===materialInput(button.closest('[data-material-layer]').dataset.materialLayer).value));
  });
}
function settings() {
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
  for(const name of ['floors','walls','doors','lights','tokens']) {
    const group=$(name); group.replaceChildren();
    model[name].forEach((obj,index)=>{
      let el;
      if(name==='tokens') {
        el=node('g',{transform:`translate(${obj.x} ${obj.y})`,class:'map-token',tabindex:0,role:'button','aria-label':`${obj.name}, HP ${obj.hp}, size ${obj.size} squares. Enter to edit.`});
        el.dataset.tokenId=obj.id;
        el.append(node('circle',{r:obj.size/2,fill:'#344f70',stroke:'#a2cbff','stroke-width':2,'vector-effect':'non-scaling-stroke'}));
        const text=node('text',{'text-anchor':'middle','dominant-baseline':'central','font-size':obj.size*.3,fill:'#fff','pointer-events':'none'});
        text.textContent=obj.name.split(/\s+/).slice(0,2).map(word=>Array.from(word)[0]).join('');
        el.append(text);
      } else if(name==='floors') {
        el=node('rect',{x:obj.x-.5,y:obj.y-.5,width:1,height:1,fill:MATERIALS[obj.material] || MATERIALS.stone,'stroke-width':2,'vector-effect':'non-scaling-stroke'});
      } else if(name==='lights') {
        el=node('g');
        el.append(node('circle',{cx:obj.x,cy:obj.y,r:obj.range,fill:obj.color,stroke:obj.color,opacity:obj.opacity,class:'light-range'}));
        el.append(node('circle',{cx:obj.x,cy:obj.y,r:.12,fill:obj.color,class:'light-source'}));
      } else {
        el=node('polyline',{points:obj.points.map(p=>`${p.x},${p.y}`).join(' '),class:`map-line${name==='doors'?` door${obj.type==='window'?' window':obj.open?' open':''}`:''}`});
        if(obj.material && obj.type!=='window') el.style.stroke=MATERIALS[obj.material] || MATERIALS.stone;
      }
      const title=node('title'); title.textContent=name==='tokens'?`${obj.name} · HP ${obj.hp} · ${obj.size} squares`:name==='lights'?`Light · range ${obj.range} · intensity ${obj.intensity ?? 1}`:`${name==='floors'?'Floor':name==='walls'?'Wall':obj.type==='window'?'Window':'Door'} · ${obj.material || 'imported'}${name==='doors' && obj.type!=='window'?obj.open?' · open':' · closed':''}`;
      el.append(title);
      if(name===layer() && selected.has(index)) {
        if(name==='lights' || name==='tokens') el.querySelector(name==='lights'?'.light-source':'circle').classList.add('edit-selected');
        else el.classList.add('edit-selected');
      }
      group.append(el);
    });
  }
  // Retain the current renderer contract, with material metadata alongside walls.
  floor.tabletopMap={...floor.tabletopMap,floors:model.floors,walls:model.walls.map(w=>w.points),wallMaterials:model.walls.map(w=>w.material),doors:model.doors,lights:model.lights,tokens:model.tokens};
  buttons();
  if(notify) floor.dispatchEvent(new Event('map-changed'));
}
function updateTools() {
  chain=[]; hover=null; gesture=null; preview.replaceChildren(); selected.clear();
  $('editor-title').textContent=`Tools — ${layerInput.selectedOptions[0].textContent}`;
  document.querySelectorAll('[data-swatch-layer]').forEach(panel=>{
    panel.dataset.active=String(panel.dataset.swatchLayer===layer());
  });
  toolInput.querySelector('[value="bucket"]').disabled=layer()==='walls';
  if(layer()==='walls' && tool()==='bucket') toolInput.value='paint';
  $('spacing-label').hidden=tool()!=='bucket' || layer()==='floors';
  message('');
  if(model) render(false);
}
function hit(p) {
  const matrix=svg.getScreenCTM(), tolerance=9/Math.max(.001,Math.hypot(matrix.a,matrix.b));
  let index=-1, best=tolerance;
  model[layer()].forEach((obj,i)=>{
    const d=layer()==='floors'?Math.hypot(Math.max(0,Math.abs(p.x-obj.x)-.5),Math.max(0,Math.abs(p.y-obj.y)-.5)):pointLayer()?Math.hypot(p.x-obj.x,p.y-obj.y)-(layer()==='tokens'?obj.size/2:0):Math.min(...segments(obj.points).map(([a,b])=>distance(p,a,b)));
    if(d<=best) { best=d; index=i; }
  });
  return index;
}
function point(event,snap=false) {
  const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());
  if(!snap) return {x:p.x,y:p.y};
  if(layer()==='floors') return $('edit-snap').checked?{x:Math.floor(p.x)+.5,y:Math.floor(p.y)+.5}:{x:p.x,y:p.y};
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
  if(chain.length) preview.append(node('polyline',{points:[...chain,...(hover?[hover]:[])].map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:'#fff','stroke-width':3,'stroke-dasharray':'6 4','vector-effect':'non-scaling-stroke'}));
  if(gesture?.box && hover) preview.append(node('rect',{x:Math.min(gesture.start.x,hover.x),y:Math.min(gesture.start.y,hover.y),width:Math.abs(hover.x-gesture.start.x),height:Math.abs(hover.y-gesture.start.y),fill:'#a2cbff','fill-opacity':.15,stroke:'#a2cbff','stroke-width':1,'vector-effect':'non-scaling-stroke'}));
}
function apply(indices,action) {
  if(!indices.length) { message('No objects found in the active layer.'); return; }
  const props=action==='replace'?settings():null;
  remember();
  if(action==='erase') model[layer()]=model[layer()].filter((_,i)=>!indices.includes(i));
  else for(const i of indices) Object.assign(model[layer()][i],props);
  selected.clear(); render(); message(`${action==='erase'?'Erased':'Replaced'} ${indices.length} ${layer()}.`);
}
function addPoint(p,props) { return {x:p.x,y:p.y,...props,...(layer()==='tokens'?{id:crypto.randomUUID()}:{})}; }
function placeChain() {
  if(chain.length<2) { message('Choose at least two distinct points, then press Enter.'); return; }
  const props=settings(); remember();
  for(const pair of segments(chain)) model[layer()].push({points:clone(pair),...props});
  chain=[]; hover=null; preview.replaceChildren(); render(); message('Placed segments. Click to begin another chain.');
}
function paint(p) {
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
  if(!model || panel.hidden || event.button!==0 || svg.hidden) return;
  // Floors can extend the ground beyond the imported image.
  const raw=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());
  if(layer()!=='floors' && (tool()==='paint' || tool()==='bucket') && !contains(raw)) return;
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
      if(layer()!=='floors') {
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
      else if(layer()!=='tokens') { if(obj.material) { materialInput().value=obj.material; materialInput().dispatchEvent(new Event('change')); } if(layer()==='doors') { $('edit-door-type').value=obj.type || 'door'; $('edit-door').value=obj.open?'open':'closed'; doorTypeChanged(); } }
    }
    render(false); message(`Selected ${selected.size} ${layer()}. Drag selected objects to move, or apply settings.`);
  } else attempt(()=>apply(indices,tool()));
});
function cancelGesture() {
  if(gesture?.before) { Object.assign(model,gesture.before); render(false); }
  gesture=null; chain=[]; hover=null; preview.replaceChildren();
}
floor.addEventListener('token-update',event=>{
  try {
    cancelGesture();
    const token=model?.tokens.find(token=>token.id===event.detail.id);
    if(!token) throw new Error('This token no longer exists.');
    const props=tokenProperties(event.detail.name,event.detail.size,event.detail.hp);
    remember(); Object.assign(token,props); render();
  } catch(error) { event.detail.error=error.message; }
});
svg.addEventListener('pointercancel',cancelGesture);
svg.addEventListener('wheel',cancelGesture,{passive:true});
svg.tabIndex=0;
svg.setAttribute('role','group');
svg.setAttribute('aria-label','Map editor. Click objects or drag to select. Middle-drag to pan; scroll to zoom. Right-click a token to edit. Walls snap to grid intersections; hold Shift for grid-line midpoints. Enter finishes painting; Escape cancels.');
for(const input of [layerInput,toolInput]) input.addEventListener('change',()=>{cancelGesture(); updateTools();});
function doorTypeChanged() { $('edit-door').disabled=$('edit-door-type').value==='window'; }
$('edit-door-type').addEventListener('change',doorTypeChanged);
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
function history(back) {
  cancelGesture(); const from=back?undo:redo, to=back?redo:undo;
  if(!from.length) return;
  to.push(geometry()); Object.assign(model,from.pop()); selected.clear(); render(); message(back?'Undid edit.':'Redid edit.');
}
document.addEventListener('keydown',event=>{
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
  gesture=null; chain=[]; hover=null; preview.replaceChildren();
  const imported=floor.tabletopMap, raw=floor.sourceMap;
  const saved=raw.geezvtt_editor;
  imported.environment=environmentSettings(saved?.environment,imported);
  const sceneEnvironment=environmentSettings(floor.sceneDocument.environment || imported.environment,imported);
  floor.sceneDocument.environment={time:sceneEnvironment.time,weather:sceneEnvironment.weather};
  Object.assign(imported.environment,floor.sceneDocument.environment);
  model={width:imported.width,height:imported.height,
    floors:(Array.isArray(saved?.floors)?saved.floors:[]).filter(o=>o && Number.isFinite(o.x) && Number.isFinite(o.y)).map(o=>({x:o.x,y:o.y,material:Object.hasOwn(MATERIALS,o.material)?o.material:'stone'})),
    walls:imported.walls.flatMap((points,i)=>segments(points).map(pair=>({points:pair,material:saved?.wallMaterials?.[i]}))),
    doors:imported.doors.map((d,i)=>({...d,type:portalType(d.source),open:portalType(d.source)==='door' && d.open,material:saved?.doorMaterials?.[i]})),
    lights:imported.lights.map(l=>({...l})),tokens:importedTokens(saved?.tokens,imported.width,imported.height)};
  // Each wall and door segment is individually selectable and replaceable.
  model.doors=model.doors.flatMap(d=>segments(d.points).map(points=>({...d,points})));
  undo=[]; redo=[]; selected.clear(); controls.disabled=$('toggle-3d').getAttribute('aria-pressed')==='true';
  document.querySelectorAll('.swatch-panel fieldset').forEach(fieldset=>{ fieldset.disabled=controls.disabled; });
  updateTools(); render();
  $('edit-export').disabled=false;
  if(controls.disabled) message('Switch to 2D view to edit. Your changes are visible in 3D.');
});
function viewState() {
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
  raw.portals=model.doors.map(d=>({...d.source,geezvtt_type:d.type || 'door',bounds:d.points.map(offset),position:offset({x:(d.points[0].x+d.points[1].x)/2,y:(d.points[0].y+d.points[1].y)/2}),closed:d.type==='window'?false:!d.open,rotation:Math.atan2(d.points[1].y-d.points[0].y,d.points[1].x-d.points[0].x)}));
  raw.lights=model.lights.map(l=>({...l.source,position:offset(l),range:l.range,intensity:l.intensity ?? 1,color:Math.round((l.opacity ?? 1)*255).toString(16).padStart(2,'0')+l.color.slice(1),shadows:l.source?.shadows ?? true}));
  raw.geezvtt_editor={...raw.geezvtt_editor,floors:clone(model.floors),wallMaterials:model.walls.map(w=>w.material || null),doorMaterials:model.doors.map(d=>d.material || null),tokens:clone(floor.tabletopMap.tokens || []),environment:clone(floor.tabletopMap.environment)};
  return raw;
}
$('edit-export').addEventListener('click',()=>{
  const raw=serializeMap();
  const url=URL.createObjectURL(new Blob([JSON.stringify(raw)],{type:'application/json'})), link=document.createElement('a');
  link.href=url; link.download=floor.sourceName.replace(/\.dd2vtt$/i,'')+'-edited.dd2vtt'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  message('Exported map with edited objects and materials.');
});
// Modules may finish loading after an import.
if(floor.tabletopMap) floor.dispatchEvent(new Event('map-ready'));
