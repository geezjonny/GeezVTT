import { MATERIALS, clone, segments, distance, inBox, bucketCells } from './map-editor-model.js';

const $ = id => document.getElementById(id);
const floor=$('floor'), svg=$('map-view'), preview=$('edit-preview');
const controls=$('editor-controls'), layerInput=$('edit-layer'), toolInput=$('edit-tool');
const panel=$('editor-panel');
let model, selected=new Set(), undo=[], redo=[], chain=[], hover, gesture;
const layer=()=>layerInput.value, tool=()=>toolInput.value;
const message=text=>{ $('editor-help').textContent=text; };
const node=(tag,attrs={})=>{
  const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [key,value] of Object.entries(attrs)) el.setAttribute(key,value);
  return el;
};
const geometry=()=>clone({walls:model.walls,doors:model.doors,lights:model.lights});
function remember() { undo.push(geometry()); if(undo.length>50) undo.shift(); redo=[]; }
function buttons() {
  $('edit-undo').disabled=!undo.length; $('edit-redo').disabled=!redo.length;
  $('edit-apply').disabled=$('edit-delete').disabled=!selected.size;
  document.querySelectorAll('[data-tool]').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.tool===tool()));
    button.disabled=toolInput.querySelector(`[value="${button.dataset.tool}"]`).disabled;
  });
  document.querySelectorAll('[data-material]').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.material===$('edit-material').value));
  });
}
function settings() {
  if(layer()==='lights') {
    const range=Number($('edit-range').value), intensity=Number($('edit-intensity').value);
    if(!Number.isFinite(range) || range<.25 || range>100 || !Number.isFinite(intensity) || intensity<0 || intensity>10) throw new Error('Use a light range of 0.25–100 and intensity of 0–10.');
    return {color:$('edit-color').value, range, intensity, opacity:1};
  }
  return {material:$('edit-material').value, ...(layer()==='doors'?{open:$('edit-door').value==='open'}:{})};
}
function attempt(fn) { try { fn(); } catch(error) { message(error.message); } }
function render(notify=true) {
  for(const name of ['walls','doors','lights']) {
    const group=$(name); group.replaceChildren();
    model[name].forEach((obj,index)=>{
      let el;
      if(name==='lights') {
        el=node('g');
        el.append(node('circle',{cx:obj.x,cy:obj.y,r:obj.range,fill:obj.color,stroke:obj.color,opacity:obj.opacity,class:'light-range'}));
        el.append(node('circle',{cx:obj.x,cy:obj.y,r:.12,fill:obj.color,class:'light-source'}));
      } else {
        el=node('polyline',{points:obj.points.map(p=>`${p.x},${p.y}`).join(' '),class:`map-line${name==='doors'?` door${obj.open?' open':''}`:''}`});
        if(obj.material) el.style.stroke=MATERIALS[obj.material] || MATERIALS.stone;
      }
      const title=node('title'); title.textContent=name==='lights'?`Light · range ${obj.range} · intensity ${obj.intensity ?? 1}`:`${name==='walls'?'Wall':'Door'} · ${obj.material || 'imported'}${name==='doors'?obj.open?' · open':' · closed':''}`;
      el.append(title);
      if(name===layer() && selected.has(index)) {
        if(name==='lights') el.querySelector('.light-source').classList.add('edit-selected');
        else el.classList.add('edit-selected');
      }
      group.append(el);
    });
  }
  // Retain the current renderer contract, with material metadata alongside walls.
  floor.tabletopMap={...floor.tabletopMap,walls:model.walls.map(w=>w.points),wallMaterials:model.walls.map(w=>w.material),doors:model.doors,lights:model.lights};
  buttons();
  if(notify) floor.dispatchEvent(new Event('map-changed'));
}
function updateTools() {
  chain=[]; hover=null; gesture=null; preview.replaceChildren(); selected.clear();
  const light=layer()==='lights', door=layer()==='doors';
  $('editor-title').textContent=layerInput.selectedOptions[0].textContent;
  $('materials-title').textContent=door?'Doors:':'Walls:';
  toolInput.querySelector('[value="bucket"]').disabled=layer()==='walls';
  if(layer()==='walls' && tool()==='bucket') toolInput.value='paint';
  $('material-label').hidden=light;
  for(const id of ['color','range','intensity']) $(`${id}-label`).hidden=!light;
  $('door-label').hidden=!door; $('spacing-label').hidden=tool()!=='bucket';
  const help={select:'Click an object or drag a box to select. Shift adds/removes objects. Drag a selected object to move the selection. Apply settings or Delete selection.',erase:'Click a segment/source or drag a box to erase a collection.',replace:'Choose settings, then click a segment/source or drag a box to replace a collection.',paint:light?'Click to place a light with the chosen color, range, and intensity.':'Click points to draw a connected chain. Enter places it; Escape cancels; Backspace removes the last point.',bucket:'Click inside an area to fill it at the chosen spacing. Walls and closed doors bound the fill. Lights use cell centers; doors fill as horizontal segments.'};
  message(help[tool()]+' Changes are local; use File > Save Map to keep them.');
  if(model) render(false);
}
function hit(p) {
  const matrix=svg.getScreenCTM(), tolerance=9/Math.max(.001,Math.hypot(matrix.a,matrix.b));
  let index=-1, best=tolerance;
  model[layer()].forEach((obj,i)=>{
    const d=layer()==='lights'?Math.hypot(p.x-obj.x,p.y-obj.y):Math.min(...segments(obj.points).map(([a,b])=>distance(p,a,b)));
    if(d<=best) { best=d; index=i; }
  });
  return index;
}
function point(event,snap=false) {
  const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());
  const clamp=(v,max)=>Math.max(0,Math.min(max,v));
  return {x:clamp(snap && $('edit-snap').checked?Math.round(p.x):p.x,model.width),y:clamp(snap && $('edit-snap').checked?Math.round(p.y):p.y,model.height)};
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
function addLight(p,props) { return {x:p.x,y:p.y,...props}; }
function placeChain() {
  if(chain.length<2) { message('Choose at least two distinct points, then press Enter.'); return; }
  const props=settings(); remember();
  for(const pair of segments(chain)) model[layer()].push({points:clone(pair),...props});
  chain=[]; hover=null; preview.replaceChildren(); render(); message('Placed segments. Click to begin another chain.');
}
function paint(p) {
  const props=settings();
  if(layer()==='lights') { remember(); model.lights.push(addLight(p,props)); render(); }
  else if(!chain.length || Math.hypot(chain.at(-1).x-p.x,chain.at(-1).y-p.y)>.00001) { chain.push(p); drawPreview(); }
}
function bucket(p) {
  const spacing=Number($('edit-spacing').value);
  if(!Number.isFinite(spacing) || spacing<.5 || spacing>100) throw new Error('Fill spacing must be between 0.5 and 100 squares.');
  const props=settings(), cells=bucketCells(model,p,spacing);
  const fresh=cells.filter(c=>!model[layer()].some(o=>layer()==='lights'?Math.hypot(o.x-c.x,o.y-c.y)<.01:distance(c,o.points[0],o.points[1])<.01));
  if(!fresh.length) { message('This area is already filled.'); return; }
  remember();
  for(const c of fresh) model[layer()].push(layer()==='lights'?addLight(c,props):{points:[{x:Math.max(0,c.x-.5),y:c.y},{x:Math.min(model.width,c.x+.5),y:c.y}],...props});
  render(); message(`Filled area with ${fresh.length} ${layer()}.`);
}
svg.addEventListener('pointerdown',event=>{
  if(!model || panel.hidden || event.button!==0 || svg.hidden) return;
  // Reject clicks on the SVG's letterboxing rather than clamping them onto the map.
  const raw=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());
  if(!contains(raw)) return;
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
      const pts=originals.flatMap(o=>layer()==='lights'?[o]:o.points);
      dx=Math.max(-Math.min(...pts.map(p=>p.x)),Math.min(model.width-Math.max(...pts.map(p=>p.x)),dx));
      dy=Math.max(-Math.min(...pts.map(p=>p.y)),Math.min(model.height-Math.max(...pts.map(p=>p.y)),dy));
      for(const i of selected) {
        const obj=clone(gesture.before[layer()][i]);
        if(layer()==='lights') { obj.x+=dx; obj.y+=dy; } else obj.points=obj.points.map(p=>({x:p.x+dx,y:p.y+dy}));
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
      else { if(obj.material) $('edit-material').value=obj.material; if(layer()==='doors') $('edit-door').value=obj.open?'open':'closed'; }
    }
    render(false); message(`Selected ${selected.size} ${layer()}. Drag selected objects to move, or apply settings.`);
  } else attempt(()=>apply(indices,tool()));
});
function cancelGesture() {
  if(gesture?.before) { Object.assign(model,gesture.before); render(false); }
  gesture=null; chain=[]; hover=null; preview.replaceChildren();
}
svg.addEventListener('pointercancel',cancelGesture);
svg.addEventListener('wheel',cancelGesture,{passive:true});
svg.tabIndex=0;
svg.setAttribute('role','group');
svg.setAttribute('aria-label','Map editor. Click objects or drag to select. Enter finishes painting; Escape cancels.');
for(const input of [layerInput,toolInput]) input.addEventListener('change',()=>{cancelGesture(); updateTools();});
for(const option of toolInput.options) {
  const button=document.createElement('button');
  button.type='button'; button.dataset.tool=option.value; button.textContent=option.textContent;
  if(option.value==='bucket') button.title='Fill enclosed areas with lights or doors. Not available for walls.';
  button.addEventListener('click',()=>{ toolInput.value=option.value; toolInput.dispatchEvent(new Event('change')); });
  $('tool-buttons').append(button);
}
for(const [material,color] of Object.entries(MATERIALS)) {
  const button=document.createElement('button'), swatch=document.createElement('span');
  button.type='button'; button.dataset.material=material;
  swatch.className='material-swatch'; swatch.style.setProperty('--material-color',color); swatch.setAttribute('aria-hidden','true');
  button.append(swatch,document.createTextNode(material));
  button.addEventListener('click',()=>{ $('edit-material').value=material; buttons(); });
  $('material-swatches').append(button);
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
$('edit-undo').addEventListener('click',()=>history(true));
$('edit-redo').addEventListener('click',()=>history(false));
document.addEventListener('keydown',event=>{
  if(!model || panel.hidden || svg.hidden || event.target.closest('#editor-titlebar') || /INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName)) return;
  if(event.key==='Escape') { cancelGesture(); selected.clear(); render(false); }
  else if(event.key==='Enter' && tool()==='paint' && layer()!=='lights') { event.preventDefault(); attempt(placeChain); }
  else if(event.key==='Backspace' && chain.length) { event.preventDefault(); chain.pop(); drawPreview(); }
  else if(event.key==='Delete' && selected.size) { event.preventDefault(); apply([...selected],'erase'); }
  else if((event.ctrlKey||event.metaKey) && ['z','y'].includes(event.key.toLowerCase())) { event.preventDefault(); history(event.key.toLowerCase()==='z' && !event.shiftKey); }
});
floor.addEventListener('map-ready',()=>{
  gesture=null; chain=[]; hover=null; preview.replaceChildren();
  const imported=floor.tabletopMap, raw=floor.sourceMap;
  const saved=raw.geezvtt_editor;
  model={width:imported.width,height:imported.height,
    walls:imported.walls.flatMap((points,i)=>segments(points).map(pair=>({points:pair,material:saved?.wallMaterials?.[i]}))),
    doors:imported.doors.map((d,i)=>({...d,material:saved?.doorMaterials?.[i]})),
    lights:imported.lights.map(l=>({...l}))};
  // Each wall and door segment is individually selectable and replaceable.
  model.doors=model.doors.flatMap(d=>segments(d.points).map(points=>({...d,points})));
  undo=[]; redo=[]; selected.clear(); controls.disabled=$('toggle-3d').getAttribute('aria-pressed')==='true'; updateTools(); render();
  $('edit-export').disabled=false;
  if(controls.disabled) message('Switch to 2D view to edit. Your changes are visible in 3D.');
});
function viewState() {
  const on=$('toggle-3d').getAttribute('aria-pressed')==='true';
  cancelGesture(); controls.disabled=!model || on;
  if(on) message('Switch to 2D view to edit. Your changes are visible in 3D.'); else if(model) updateTools();
}
new MutationObserver(viewState).observe($('toggle-3d'),{attributes:true,attributeFilter:['aria-pressed']});
$('edit-export').addEventListener('click',()=>{
  const raw=clone(floor.sourceMap), origin=raw.resolution?.map_origin || {x:0,y:0};
  const offset=p=>({x:p.x+(Number.isFinite(origin.x)?origin.x:0),y:p.y+(Number.isFinite(origin.y)?origin.y:0)});
  raw.line_of_sight=model.walls.map(w=>w.points.map(offset));
  raw.portals=model.doors.map(d=>({...d.source,bounds:d.points.map(offset),position:offset({x:(d.points[0].x+d.points[1].x)/2,y:(d.points[0].y+d.points[1].y)/2}),closed:!d.open,rotation:Math.atan2(d.points[1].y-d.points[0].y,d.points[1].x-d.points[0].x)}));
  raw.lights=model.lights.map(l=>({...l.source,position:offset(l),range:l.range,intensity:l.intensity ?? 1,color:Math.round((l.opacity ?? 1)*255).toString(16).padStart(2,'0')+l.color.slice(1),shadows:l.source?.shadows ?? true}));
  raw.geezvtt_editor={wallMaterials:model.walls.map(w=>w.material || null),doorMaterials:model.doors.map(d=>d.material || null)};
  const url=URL.createObjectURL(new Blob([JSON.stringify(raw)],{type:'application/json'})), link=document.createElement('a');
  link.href=url; link.download=floor.sourceName.replace(/\.dd2vtt$/i,'')+'-edited.dd2vtt'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  message('Exported map with edited objects and materials.');
});
// Modules may finish loading after an import.
if(floor.tabletopMap) floor.dispatchEvent(new Event('map-ready'));
