// Dependency-free interaction checks using a local Chromium browser's DevTools protocol.
// Windows: node tests/map-editor-browser.mjs
// Elsewhere: BROWSER_PATH=/path/to/chromium node tests/map-editor-browser.mjs
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../',import.meta.url));
const profile=await mkdtemp(join(tmpdir(),'geezvtt-editor-'));
const server=createServer(async(req,res)=>{
  try {
    const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://local').pathname));
    if(path!==resolve(root) && !path.startsWith(root.endsWith(sep)?root:root+sep)) throw new Error('Invalid path');
    const target=path===resolve(root)?join(path,'index.html'):path;
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.dd2vtt':'application/json'})[extname(target)] || 'application/octet-stream');
    res.end(await readFile(target));
  } catch { res.statusCode=404;res.end(); }
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=spawn(process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[
  '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'
],{windowsHide:true,stdio:'ignore'});
let socket;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try {
  let port;
  for(let i=0;i<100;i++) {
    try { port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break; } catch { await delay(100); }
  }
  if(!port) throw new Error('Browser DevTools did not start');
  const pages=await (await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(5000)})).json();
  socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{const timer=setTimeout(()=>j(new Error('DevTools connection timed out')),5000);socket.onopen=()=>{clearTimeout(timer);r();};socket.onerror=j;});
  let next=0;const pending=new Map(), errors=[];
  socket.onmessage=event=>{
    const data=JSON.parse(event.data);
    if(data.method==='Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.text+': '+data.params.exceptionDetails.exception?.description);
    if(!data.id) return;
    const entry=pending.get(data.id); pending.delete(data.id);
    if(data.error) entry.reject(new Error(JSON.stringify(data.error))); else entry.resolve(data.result);
  };
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>reject(new Error('DevTools timed out: '+method)),15000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{
    const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(50);}throw new Error('Timed out: '+expression);};
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Network.enable');
  await send('Network.setBlockedURLs',{urls:['*://geezsheets-default-rtdb.firebaseio.com/*']});
  await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/index.html?gm=jonny`});
  await wait(`document.querySelector('#map-view')?.tabIndex===0`);
  await evaluate(`window.confirm=()=>true`);
  assert.equal(await evaluate(`(()=>{
    for(const panel of document.querySelectorAll('.editor-panel')) {
      const hidden=panel.hidden, button=panel.querySelector('.editor-close');
      panel.hidden=false;
      if(!['scene-panel','vtt-panel','build-panel','initiative-panel'].includes(panel.id)) {
        button.click();
        if(!panel.hidden || button.hasAttribute('aria-expanded') || !button.getAttribute('aria-label').startsWith('Close ')) return false;
        panel.hidden=hidden;
        continue;
      }
      const body=document.getElementById(button.getAttribute('aria-controls'));
      button.click();
      if(panel.hidden || !body.hidden || button.getAttribute('aria-expanded')!=='false' || !button.getAttribute('aria-label').startsWith('Restore ')) return false;
      button.click();
      if(panel.hidden || body.hidden || button.getAttribute('aria-expanded')!=='true' || !button.getAttribute('aria-label').startsWith('Minimize ')) return false;
      panel.hidden=hidden;
    }
    return true;
  })()`),true,'the four permanent controls minimize and restore; other floating windows close');
  await evaluate(`document.querySelectorAll('.menu > summary')[0].click(); document.querySelectorAll('.menu')[1].dispatchEvent(new PointerEvent('pointerenter',{pointerType:'mouse'}))`);
  assert.equal(await evaluate(`document.querySelectorAll('.menu[open]').length`),1);
  assert.equal(await evaluate(`document.querySelectorAll('.menu')[1].open`),true,'hover switches the open menu');
  await evaluate(`document.querySelectorAll('.menu')[2].open=true`);
  assert.equal(await evaluate(`document.querySelectorAll('.menu[open]').length`),1,'top bar menus are mutually exclusive');
  await evaluate(`document.querySelectorAll('.menu').forEach(menu=>menu.open=false)`);
  const importFile=async name=>{
    const {root:doc}=await send('DOM.getDocument');
    const {nodeId}=await send('DOM.querySelector',{nodeId:doc.nodeId,selector:'#map-file'});
    await send('DOM.setFileInputFiles',{nodeId,files:[join(root,'battlemap',name+'.dd2vtt')]});
    await wait(`document.querySelector('#status').textContent.startsWith('${name}.dd2vtt ·')`);
  };
  const change=async(id,value)=>evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change'));})()`);
  const clickButton=id=>evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  const count=type=>evaluate(`document.getElementById('floor').tabletopMap.${type}.length`);
  const point=async(x,y)=>evaluate(`(()=>{const p=new DOMPoint(${x},${y}).matrixTransform(document.getElementById('map-view').getScreenCTM());return {x:p.x,y:p.y};})()`);
  const mouse=async(type,p,modifiers=0)=>send('Input.dispatchMouseEvent',{type,...p,modifiers,button:type==='mouseMoved'?'none':'left',clickCount:1,buttons:type==='mousePressed'?1:0});
  const click=async(x,y)=>{const p=await point(x,y);await mouse('mousePressed',p);await mouse('mouseReleased',p);};
  const drag=async(x,y,xx,yy)=>{await mouse('mousePressed',await point(x,y));await mouse('mouseMoved',await point(xx,yy));await mouse('mouseReleased',await point(xx,yy));};
  const key=async key=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key});await send('Input.dispatchKeyEvent',{type:'keyUp',key});};

  await clickButton('load-battlemap');
  await wait(`document.querySelectorAll('#library-list button').length > 0`);
  assert.equal(await evaluate(`document.querySelector('#library-panel').hidden`),false);
  await evaluate(`[...document.querySelectorAll('#library-list button')].find(button=>button.textContent==='camp').click()`);
  await wait(`document.querySelector('#library-panel').hidden && document.querySelector('#floor').sourceName==='camp.dd2vtt'`);
  await clickButton('load-scene');
  await wait(`document.querySelectorAll('#library-list button').length > 0`);
  assert.equal(await evaluate(`document.querySelector('#library-panel').dataset.kind`),'scene');
  await evaluate(`document.querySelector('#library-panel .editor-close').click()`);

  for(const name of ['camp','chapel_dungeon','prison_00','forestroad']) {
    await importFile(name);
    assert.equal(await evaluate(`document.getElementById('editor-controls').disabled`),false);
  }
  // Swatches stay open together, retain separate settings, and share one tool selection.
  await evaluate(`window.originalFetch=window.fetch;window.fetch=(url,...args)=>String(url).includes('.firebaseio.com/')?Promise.resolve(new Response(JSON.stringify(String(url).includes('characters/npcs')?{guard:{name:'Guard',size:'Large',combat:{hp_max:9}}}:{}),{status:200})):window.originalFetch(url,...args)`);
  await evaluate(`document.querySelectorAll('[data-edit-layer]').forEach(button=>button.click())`);
  assert.equal(await evaluate(`document.querySelectorAll('.swatch-panel:not([hidden])').length`),4);
  const recentMaterials=layer=>evaluate(`[...document.querySelectorAll('[data-material-layer="${layer}"] button:not([hidden])')].map(button=>button.dataset.material)`);
  assert.deepEqual(await recentMaterials('walls'),['stone','wood','cobble','brick']);
  await evaluate(`(()=>{const select=document.querySelector('[data-material-layer="walls"] .material-more');select.value='metal';select.dispatchEvent(new Event('change'));})()`);
  assert.deepEqual(await recentMaterials('walls'),['metal','stone','wood','cobble'],'dropdown choice becomes the most recent swatch');
  assert.equal(await evaluate(`document.getElementById('edit-material').value`),'metal');
  assert.deepEqual(await evaluate(`[...document.querySelector('[data-material-layer="walls"] .material-more').options].map(option=>option.value)`),['','brick'],'older choices move to the dropdown');
  assert.deepEqual(await recentMaterials('doors'),['stone','wood','cobble','brick'],'wall recents do not change door recents');
  await evaluate(`(()=>{const select=document.querySelector('[data-material-layer="walls"] .material-more');select.value='brick';select.dispatchEvent(new Event('change'));})()`);
  assert.deepEqual(await recentMaterials('walls'),['brick','metal','stone','wood']);
  await evaluate(`document.querySelector('[data-material-layer="walls"] [data-material="wood"]').click()`);
  assert.deepEqual(await recentMaterials('walls'),['wood','brick','metal','stone'],'using a swatch promotes it without duplicates');
  await change('edit-tool','replace');
  await evaluate(`document.querySelector('[data-material-layer="walls"] [data-material="brick"]').click()`);
  assert.equal(await evaluate(`document.getElementById('edit-layer').value`),'walls');
  await evaluate(`document.querySelector('[data-material-layer="doors"] [data-material="wood"]').click()`);
  assert.equal(await evaluate(`document.getElementById('edit-layer').value`),'doors');
  assert.equal(await evaluate(`document.getElementById('edit-material').value`),'brick');
  assert.equal(await evaluate(`document.getElementById('edit-door-material').value`),'wood');
  await change('edit-color','#ff0000');
  assert.equal(await evaluate(`document.getElementById('edit-layer').value`),'lights');
  assert.equal(await evaluate(`document.getElementById('edit-tool').value`),'replace');
  assert.equal(await evaluate(`document.getElementById('editor-title').textContent`),'Tools — Lights');
  assert.equal(await evaluate(`document.querySelectorAll('.swatch-panel:not([hidden])').length`),4);
  await evaluate(`document.querySelectorAll('.swatch-panel .editor-close').forEach(button=>button.click())`);
  assert.equal(await evaluate(`document.getElementById('editor-panel').hidden`),false);
  await change('edit-layer','walls');
  await change('edit-tool','paint');
  await evaluate(`document.getElementById('edit-snap').checked=false`);
  for(const [x,y,shiftKey,expected] of [
    [2.4,2.2,false,{x:2,y:2}],
    [3.45,2.1,true,{x:3.5,y:2}],
    [4.1,3.45,true,{x:4,y:3.5}],
    [5.5,4.5,true,{x:5.5,y:5}],
    [6.1,5.1,true,{x:6,y:5}]
  ]) {
    const screen=await point(x,y);
    await evaluate(`(()=>{const svg=document.getElementById('map-view');const event={clientX:${screen.x},clientY:${screen.y},shiftKey:${shiftKey},bubbles:true};svg.dispatchEvent(new PointerEvent('pointermove',event));svg.dispatchEvent(new PointerEvent('pointerdown',{...event,button:0}));})()`);
    assert.equal(await evaluate(`document.querySelector('#edit-preview polyline').getAttribute('points').split(' ').at(-1)`),`${expected.x},${expected.y}`,'wall preview snaps to intersections or grid-line midpoints');
  }
  await key('Enter');
  assert.deepEqual(await evaluate(`document.getElementById('floor').tabletopMap.walls`),[
    [{x:2,y:2},{x:3.5,y:2}],
    [{x:3.5,y:2},{x:4,y:3.5}],
    [{x:4,y:3.5},{x:5.5,y:5}],
    [{x:5.5,y:5},{x:6,y:5}]
  ],'wall placement matches the snapped preview even with the checkbox off');
  await evaluate(`document.getElementById('map-view').dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));document.getElementById('edit-snap').checked=true`);
  await change('edit-tool','paint');await click(2,2);await click(5,2);await click(5,5);
  assert.equal(await count('walls'),0,'preview must not commit before Enter');
  await key('Enter');assert.equal(await count('walls'),2);
  await click(8,8);await click(9,8);await key('Escape');assert.equal(await count('walls'),2);
  await change('edit-tool','select');await drag(1,1,6,6);
  assert.equal(await evaluate(`document.querySelectorAll('.edit-selected').length`),2);
  await drag(3,2,4,3);
  assert.deepEqual(await evaluate(`document.getElementById('floor').tabletopMap.walls[0][0]`),{x:3,y:3});
  await change('edit-material','brick');await clickButton('edit-apply');
  assert.deepEqual(await evaluate(`document.getElementById('floor').tabletopMap.wallMaterials`),['brick','brick']);
  await change('edit-tool','replace');await change('edit-material','metal');await click(4,3);
  assert.equal(await evaluate(`document.getElementById('floor').tabletopMap.wallMaterials[0]`),'metal');
  await change('edit-tool','erase');await click(4,3);assert.equal(await count('walls'),1);
  await clickButton('editor-close');
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}))`);
  assert.equal(await count('walls'),2,'Ctrl+Z works with Tools closed');
  await clickButton('open-tools');
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'y',ctrlKey:true,bubbles:true,cancelable:true}))`);
  assert.equal(await count('walls'),1,'Ctrl+Y works with a tool button focused');
  await drag(1,1,8,8);assert.equal(await count('walls'),0);
  assert.equal(await evaluate(`document.querySelector('#edit-tool option[value="bucket"]').disabled`),true);
  await change('edit-layer','lights');await change('edit-tool','paint');await click(3,3);assert.equal(await count('lights'),1);
  await change('edit-tool','replace');await change('edit-color','#ff0000');await change('edit-range','6');await click(3,3);
  assert.equal(await evaluate(`document.getElementById('floor').tabletopMap.lights[0].range`),6);
  await change('edit-layer','walls');await change('edit-tool','paint');
  for(const [x,y] of [[2,2],[10,2],[10,10],[2,10],[2,2]]) await click(x,y);
  await key('Enter');assert.equal(await count('walls'),4);
  await change('edit-layer','lights');await change('edit-tool','bucket');await change('edit-spacing','2');await click(4,4);
  assert.equal(await count('lights'),16,'enclosed fill has 16 cells including the existing light');
  await click(4,4);assert.equal(await count('lights'),16,'repeated fills skip occupied centers');
  await change('edit-layer','doors');await change('edit-tool','paint');await change('edit-door-material','wood');await click(2,2);await click(3,2);await key('Enter');
  assert.equal(await count('doors'),1);
  await change('edit-tool','replace');await change('edit-door','open');await click(2.5,2);
  assert.equal(await evaluate(`document.getElementById('floor').tabletopMap.doors[0].open`),true);
  // Tokens share tools, selection, movement, history, bucket barriers, and map export.
  await wait(`document.querySelector('#token-source option[value="legacy:guard"]')!==null`);
  assert.equal(await evaluate(`document.querySelector('#token-pc-source option[value="legacy:guard"]') === null`),true,'NPCs stay out of the PC dropdown');
  await change('edit-layer','tokens');await change('edit-tool','paint');
  await click(12,12);await click(14,12);assert.equal(await count('tokens'),2);
  await change('edit-tool','select');await drag(11,11,15,13);
  assert.equal(await evaluate(`document.querySelectorAll('#tokens .edit-selected').length`),2);
  await drag(12.5,12.5,13.5,13.5);
  assert.equal(await evaluate(`document.getElementById('floor').tabletopMap.tokens[0].x`),13.5);
  await change('token-source','legacy:guard');await change('edit-tool','replace');await click(13.5,13.5);
  assert.equal(await evaluate(`document.getElementById('token-pc-source').value`),'','selecting an NPC clears the PC selection');
  assert.equal(await evaluate(`document.getElementById('floor').tabletopMap.tokens[0].name`),'Guard');
  assert.equal(await evaluate(`document.getElementById('floor').tabletopMap.tokens[0].size`),2);
  await wait(`document.querySelector('#token-art-source option[value="aboleth.png"]')!==null`);
  await change('token-art-source','aboleth.png');
  assert.deepEqual(await evaluate(`(()=>{const t=document.getElementById('floor').tokenTemplate;return [t.name,t.imageName,t.npcId,document.getElementById('token-source').value,document.getElementById('token-pc-source').value]})()`),
    ['aboleth','aboleth.png',null,'',''],'folder images create independent tokens and clear character selections');
  await change('token-source','legacy:guard');
  assert.equal(await evaluate(`document.getElementById('token-art-source').value`),'','selecting an NPC clears the folder image');
  for(const tool of ['select','erase','paint','bucket','replace']) {
    await change('edit-tool',tool);
    const position=await point(13.5,13.5);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...position,button:'right',buttons:2,clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...position,button:'right',buttons:0,clickCount:1});
    assert.equal(await evaluate(`document.getElementById('token-properties-panel').hidden`),false,`right-click edits tokens with ${tool} active`);
    assert.equal(await count('tokens'),2,'right-click does not apply the active tool');
    await evaluate(`document.querySelector('#token-properties-panel .editor-close').click()`);
  }
  await evaluate(`(()=>{const svg=document.getElementById('map-view'),p=new DOMPoint(13.5,13.5).matrixTransform(svg.getScreenCTM());svg.dispatchEvent(new MouseEvent('contextmenu',{clientX:p.x,clientY:p.y,bubbles:true,cancelable:true}));})()`);
  assert.equal(await evaluate(`document.getElementById('token-name').value`),'Guard','right-click resolves the token when the event targets the shared map');
  await evaluate(`document.getElementById('token-name').value='Captain';document.getElementById('token-size').value='1.5';document.getElementById('token-hp').value='4';document.getElementById('token-form').requestSubmit()`);
  assert.equal(await evaluate(`document.getElementById('floor').tabletopMap.tokens[0].hp`),4);
  const historyKey=key=>evaluate(`document.getElementById('map-view').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},ctrlKey:true,bubbles:true,cancelable:true}))`);
  await historyKey('z');assert.equal(await evaluate(`document.getElementById('floor').tabletopMap.tokens[0].hp`),9);
  await historyKey('y');assert.equal(await evaluate(`document.getElementById('floor').tabletopMap.tokens[0].hp`),4);
  await evaluate(`document.querySelector('#token-properties-panel .editor-close').click()`);
  await change('edit-tool','erase');await drag(11,11,18,16);assert.equal(await count('tokens'),0);
  await historyKey('z');assert.equal(await count('tokens'),2);
  await change('edit-tool','bucket');await change('edit-spacing','2');await click(4,4);
  assert.equal(await count('tokens'),18);
  await click(4,4);assert.equal(await count('tokens'),18,'token bucket skips occupied centers');
  // Capture the download and re-import it, without touching a user's download directory.
  await evaluate(`window.originalURL=URL.createObjectURL;URL.createObjectURL=b=>{window.exportBlob=b;return window.originalURL(b)};HTMLAnchorElement.prototype.click=function(){};document.getElementById('edit-export').click()`);
  const exported=await evaluate(`window.exportBlob.text().then(JSON.parse)`);
  assert.equal(exported.line_of_sight.length,4);assert.equal(exported.portals[0].closed,false);
  assert.equal(exported.geezvtt_editor.doorMaterials[0],'wood');
  assert.equal(exported.geezvtt_editor.tokens.length,18);
  assert.equal(exported.geezvtt_editor.tokens[0].name,'Captain');
  await evaluate(`(async()=>{const data=new DataTransfer();data.items.add(new File([await window.exportBlob.text()],'roundtrip.dd2vtt'));const input=document.getElementById('map-file');input.files=data.files;input.dispatchEvent(new Event('change'));})()`);
  await wait(`document.querySelector('#status').textContent.startsWith('roundtrip.dd2vtt ·')`);
  assert.equal(await count('lights'),16);assert.equal(await count('walls'),4);
  assert.equal(await count('tokens'),18);
  assert.equal(await evaluate(`document.getElementById('floor').tabletopMap.doors[0].material`),'wood');
  // Portable scenes retain the same prep data and reject unsupported versions without replacing it.
  await evaluate(`window.originalSavePicker=window.showSaveFilePicker;window.showSaveFilePicker=undefined;window.mapExportBlob=window.exportBlob;document.getElementById('scene-name').value='Prepared ambush';document.getElementById('save-scene').click()`);
  const scene=await evaluate(`window.exportBlob.text().then(JSON.parse)`);
  assert.equal(scene.format,'geezvtt');assert.equal(scene.version,2);
  assert.equal(scene.name,'Prepared ambush');
  for(const field of ['image','resolution','line_of_sight','portals','lights']) assert.deepEqual(scene.floors[0].map[field],exported[field]);
  assert.deepEqual(scene.floors[0].map.geezvtt_editor.floors,exported.geezvtt_editor.floors);
  assert.deepEqual(scene.floors[0].map.geezvtt_editor.tokens.map(({id,...token})=>token),exported.geezvtt_editor.tokens.map(({id,...token})=>token));
  await evaluate(`window.sceneText=window.exportBlob.text();window.openScene=async text=>{const data=new DataTransfer();data.items.add(new File([text],'ambush.geezvtt'));const input=document.getElementById('scene-file');input.files=data.files;input.dispatchEvent(new Event('change'));};window.openScene(await window.sceneText)`);
  await wait(`document.querySelector('#status').textContent.startsWith('ambush.geezvtt ·')`);
  assert.equal(await evaluate(`document.getElementById('scene-name').value`),'Prepared ambush');
  assert.equal(await count('tokens'),18);assert.equal(await count('walls'),4);assert.equal(await count('lights'),16);
  assert.equal(await evaluate(`document.getElementById('floor').tabletopMap.doors[0].material`),'wood');
  await evaluate(`const invalid=JSON.parse(await window.sceneText);invalid.version=99;window.openScene(JSON.stringify(invalid))`);
  await wait(`document.querySelector('#status').textContent.includes('unsupported version')`);
  assert.equal(await count('tokens'),18);
  await evaluate(`document.getElementById('scene-name').dispatchEvent(new Event('input'));window.confirm=()=>false;window.openScene(await window.sceneText)`);
  assert.equal(await evaluate(`document.getElementById('scene-state').textContent`),'Unsaved scene');
  await evaluate(`window.confirm=()=>true;window.exportBlob=window.mapExportBlob`);
  // Mock file handles so Save, Save As, cancellation, and failures never touch disk.
  await evaluate(`window.pickerCalls=0;window.sceneWrites=[];window.fileHandle={name:'ambush.geezvtt',createWritable:async()=>({write:async blob=>window.sceneWrites.push(await blob.text()),close:async()=>{},abort:async()=>{}})};window.showSaveFilePicker=async()=>{window.pickerCalls++;return window.fileHandle};document.getElementById('save-scene').click()`);
  await wait(`!document.getElementById('save-scene').disabled`);
  assert.equal(await evaluate(`window.pickerCalls`),1);
  assert.equal(await evaluate(`JSON.parse(window.sceneWrites[0]).name`),'Prepared ambush');
  await clickButton('save-scene');
  await wait(`!document.getElementById('save-scene').disabled`);
  assert.equal(await evaluate(`window.pickerCalls`),1,'Save reuses the chosen file');
  await clickButton('save-scene-as');
  await wait(`!document.getElementById('save-scene').disabled`);
  assert.equal(await evaluate(`window.pickerCalls`),2,'Save As opens a picker');
  await evaluate(`document.getElementById('scene-name').dispatchEvent(new Event('input'));window.showSaveFilePicker=async()=>{throw new DOMException('Cancelled','AbortError')};document.getElementById('save-scene-as').click()`);
  await wait(`!document.getElementById('save-scene').disabled`);
  assert.equal(await evaluate(`document.getElementById('scene-state').textContent`),'Unsaved scene');
  await evaluate(`window.fileHandle.createWritable=async()=>{throw new Error('Permission denied')};document.getElementById('save-scene').click()`);
  await wait(`document.getElementById('scene-state').textContent.includes('Permission denied')`);
  assert.equal(await evaluate(`document.getElementById('floor').sceneFileHandle===window.fileHandle`),true,'failed Save As retains the previous handle');
  await evaluate(`window.showSaveFilePicker=window.originalSavePicker`);
  // Nonzero origins, invalid optional entries, and unknown exporter metadata.
  await evaluate(`(async()=>{
    const raw=JSON.parse(await window.exportBlob.text());raw.resolution={...raw.resolution,map_origin:{x:10,y:20},map_size:{x:4,y:4}};
    raw.line_of_sight=[[{x:10,y:20},{x:14,y:20}]];
    raw.portals=[{bounds:[{x:11,y:21},{x:12,y:21}],closed:true,custom:'keep-door'}];
    raw.lights=[{position:null,range:4},{position:{x:12,y:22},range:2,intensity:.7,color:'80abcdef',shadows:false,custom:'keep-light'},
      {position:{x:9,y:22},range:2,color:'ffffffff'},{position:{x:15,y:22},range:2,color:'ffffffff'}];
    const data=new DataTransfer();data.items.add(new File([JSON.stringify(raw)],'origin.dd2vtt'));const input=document.getElementById('map-file');input.files=data.files;input.dispatchEvent(new Event('change'));
  })()`);
  await wait(`document.querySelector('#status').textContent.startsWith('origin.dd2vtt ·')`);
  assert.deepEqual(await evaluate(`document.getElementById('floor').tabletopMap.walls[0][0]`),{x:0,y:0});
  assert.equal(await evaluate(`document.getElementById('floor').tabletopMap.lights[0].intensity`),.7);
  await clickButton('edit-export');
  const originExport=await evaluate(`window.exportBlob.text().then(JSON.parse)`);
  assert.deepEqual(originExport.lights[0].position,{x:12,y:22});
  assert.equal(originExport.lights[0].color,'80abcdef');
  assert.equal(originExport.lights[0].shadows,false);
  assert.equal(originExport.lights[0].custom,'keep-light');
  assert.equal(originExport.portals[0].custom,'keep-door');
  // Dungeondraft lights outside either map edge remain editable after panning/zooming out.
  await evaluate(`document.getElementById('map-view').setAttribute('viewBox','-4 -4 12 12')`);
  await change('edit-layer','lights');await change('edit-tool','erase');
  await click(-1,2);assert.equal(await count('lights'),2,'erase reaches a negative-coordinate light');
  await historyKey('z');assert.equal(await count('lights'),3);
  await change('edit-tool','select');await drag(4.5,1.5,5.5,2.5);
  assert.equal(await evaluate(`document.querySelectorAll('#lights .edit-selected').length`),1,'box selection reaches beyond the map edge');
  await clickButton('edit-delete');assert.equal(await count('lights'),2);
  await historyKey('z');assert.equal(await count('lights'),3);
  await change('edit-tool','erase');await drag(4.5,1.5,5.5,2.5);
  assert.equal(await count('lights'),2,'box erase reaches beyond the map edge');
  await change('edit-tool','paint');await click(-2,1);assert.equal(await count('lights'),2,'painting outside the map remains blocked');
  await change('edit-tool','bucket');await click(-2,1);assert.equal(await count('lights'),2,'bucket fills outside the map remain blocked');
  await clickButton('edit-export');
  assert.deepEqual(await evaluate(`window.exportBlob.text().then(JSON.parse).then(raw=>raw.lights.map(light=>light.position))`),[{x:12,y:22},{x:9,y:22}],'export retains undeleted lights and omits the erased outside light');
  await evaluate(`document.getElementById('map-view').setAttribute('viewBox','0 0 4 4')`);
  // Middle-button drags pan the 2D view without painting or changing zoom.
  const panStart=await evaluate(`(()=>{const svg=document.getElementById('map-view'),r=svg.getBoundingClientRect();return {x:r.right-120,y:r.bottom-120,viewBox:svg.getAttribute('viewBox'),width:svg.viewBox.baseVal.width,height:svg.viewBox.baseVal.height};})()`);
  const beforePan=await point(1,1), beforePanWalls=await count('walls');
  await change('edit-tool','paint');
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:panStart.x,y:panStart.y,button:'middle',buttons:4,clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:panStart.x+60,y:panStart.y+40,button:'none',buttons:4});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:panStart.x+60,y:panStart.y+40,button:'middle',buttons:0,clickCount:1});
  const afterPan=await point(1,1);
  assert.ok(Math.abs(afterPan.x-beforePan.x-60)<.001 && Math.abs(afterPan.y-beforePan.y-40)<.001,'middle drag moves the map with the pointer');
  assert.deepEqual(await evaluate(`(()=>{const b=document.getElementById('map-view').viewBox.baseVal;return {width:b.width,height:b.height};})()`),{width:panStart.width,height:panStart.height},'panning preserves zoom');
  assert.equal(await count('walls'),beforePanWalls,'middle drag does not paint');
  await mouse('mouseMoved',{x:panStart.x+80,y:panStart.y+60});
  assert.deepEqual(await point(1,1),afterPan,'releasing the middle button ends panning');
  await evaluate(`document.getElementById('map-view').setAttribute('viewBox',${JSON.stringify(panStart.viewBox)})`);
  // Every floating window shares a width and snaps only to nearby visible windows.
  const panelSize=await evaluate(`(()=>{
    const panels=[...document.querySelectorAll('.editor-panel')];panels.forEach(p=>p.hidden=false);
    const widths=panels.map(p=>p.getBoundingClientRect().width);
    panels.forEach(p=>p.hidden=!['editor-panel','walls-panel'].includes(p.id));
    const editor=document.getElementById('editor-panel'), walls=document.getElementById('walls-panel');
    editor.style.left='400px';editor.style.top='300px';walls.style.left='800px';walls.style.top='100px';
    return {widths,width:walls.offsetWidth,height:walls.offsetHeight};
  })()`);
  assert.equal(new Set(panelSize.widths).size,1,'all floating windows have the same width');
  const moveWindow=async(left,top,shift=false)=>{
    const start=await evaluate(`(()=>{const r=document.getElementById('walls-panel').getBoundingClientRect();return {x:r.left+10,y:r.top+10};})()`);
    await mouse('mousePressed',start,shift?8:0);
    await mouse('mouseMoved',{x:left+10,y:top+10},shift?8:0);
    await mouse('mouseReleased',{x:left+10,y:top+10},shift?8:0);
    return evaluate(`(()=>{const p=document.getElementById('walls-panel');return {left:p.offsetLeft,top:p.offsetTop};})()`);
  };
  assert.deepEqual(await moveWindow(400-panelSize.width+7,305),{left:400-panelSize.width,top:300},'windows snap side by side and align their tops');
  assert.deepEqual(await moveWindow(440-panelSize.width,340),{left:440-panelSize.width,top:340});
  assert.deepEqual(await evaluate(`(()=>{const p=document.getElementById('editor-panel');return {left:p.offsetLeft,top:p.offsetTop};})()`),{left:440,top:340},'dragging a snapped window moves its neighbor');
  assert.deepEqual(await moveWindow(440-panelSize.width-5,340,true),{left:440-panelSize.width-5,top:340},'Shift-drag disables snapping even within the snap distance');
  await moveWindow(800,100,true);
  assert.deepEqual(await evaluate(`(()=>{const p=document.getElementById('editor-panel');return {left:p.offsetLeft,top:p.offsetTop};})()`),{left:440,top:340},'Shift-drag leaves the neighbor in place');
  await evaluate(`(()=>{const editor=document.getElementById('editor-panel');editor.style.left='400px';editor.style.top='300px';})()`);
  assert.deepEqual(await moveWindow(405,300-panelSize.height+7),{left:400,top:300-panelSize.height},'windows stack and align their sides');
  assert.deepEqual(await moveWindow(400-panelSize.width-30,300,true),{left:400-panelSize.width-30,top:300},'Shift-drag detaches a stacked window');
  await evaluate(`document.getElementById('editor-panel').hidden=true`);
  assert.deepEqual(await moveWindow(400-panelSize.width+7,305),{left:400-panelSize.width+7,top:305},'hidden windows do not attract other windows');
  await evaluate(`(()=>{
    const editor=document.getElementById('editor-panel'),walls=document.getElementById('walls-panel'),doors=document.getElementById('doors-panel');
    editor.hidden=doors.hidden=false;
    editor.style.left='400px';editor.style.top='300px';
    walls.style.left=(400-walls.offsetWidth)+'px';walls.style.top='300px';
    doors.style.left=(400+editor.offsetWidth)+'px';doors.style.top='300px';
  })()`);
  assert.deepEqual(await moveWindow(430-panelSize.width,330),{left:430-panelSize.width,top:330});
  assert.deepEqual(await evaluate(`['editor-panel','doors-panel'].map(id=>{const p=document.getElementById(id);return {left:p.offsetLeft,top:p.offsetTop};})`),[
    {left:430,top:330},{left:430+panelSize.width,top:330}
  ],'snapped connections carry through a chain of three windows');
  await moveWindow(-50,330);
  assert.deepEqual(await evaluate(`['walls-panel','editor-panel','doors-panel'].map(id=>document.getElementById(id).offsetLeft)`),[0,panelSize.width,2*panelSize.width],'viewport limits preserve group spacing');
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: all map imports, chain creation/cancel, box selection, group movement, material replacement, segment/area erase, undo/redo, enclosed fills, doors, export/re-import.');
} finally {
  socket?.close();browser.kill();server.close();
  await delay(500);
  if(!resolve(profile).startsWith(resolve(join(tmpdir(),'geezvtt-editor-')))) throw new Error('Unexpected browser profile path');
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
}
