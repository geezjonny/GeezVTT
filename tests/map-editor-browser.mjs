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
  await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/index.html`});
  await wait(`document.querySelector('#map-view')?.tabIndex===0`);
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
  const mouse=async(type,p)=>send('Input.dispatchMouseEvent',{type,...p,button:type==='mouseMoved'?'none':'left',clickCount:1,buttons:type==='mousePressed'?1:0});
  const click=async(x,y)=>{const p=await point(x,y);await mouse('mousePressed',p);await mouse('mouseReleased',p);};
  const drag=async(x,y,xx,yy)=>{await mouse('mousePressed',await point(x,y));await mouse('mouseMoved',await point(xx,yy));await mouse('mouseReleased',await point(xx,yy));};
  const key=async key=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key});await send('Input.dispatchKeyEvent',{type:'keyUp',key});};

  for(const name of ['camp','chapel_dungeon','prison_00','forestroad']) {
    await importFile(name);
    assert.equal(await evaluate(`document.getElementById('editor-controls').disabled`),false);
  }
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
  await clickButton('edit-undo');assert.equal(await count('walls'),2);
  await clickButton('edit-redo');assert.equal(await count('walls'),1);
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
  await change('edit-layer','doors');await change('edit-tool','paint');await change('edit-material','wood');await click(2,2);await click(3,2);await key('Enter');
  assert.equal(await count('doors'),1);
  await change('edit-tool','replace');await change('edit-door','open');await click(2.5,2);
  assert.equal(await evaluate(`document.getElementById('floor').tabletopMap.doors[0].open`),true);
  // Capture the download and re-import it, without touching a user's download directory.
  await evaluate(`window.originalURL=URL.createObjectURL;URL.createObjectURL=b=>{window.exportBlob=b;return window.originalURL(b)};HTMLAnchorElement.prototype.click=function(){};document.getElementById('edit-export').click()`);
  const exported=await evaluate(`window.exportBlob.text().then(JSON.parse)`);
  assert.equal(exported.line_of_sight.length,4);assert.equal(exported.portals[0].closed,false);
  assert.equal(exported.geezvtt_editor.doorMaterials[0],'wood');
  await evaluate(`(async()=>{const data=new DataTransfer();data.items.add(new File([await window.exportBlob.text()],'roundtrip.dd2vtt'));const input=document.getElementById('map-file');input.files=data.files;input.dispatchEvent(new Event('change'));})()`);
  await wait(`document.querySelector('#status').textContent.startsWith('roundtrip.dd2vtt ·')`);
  assert.equal(await count('lights'),16);assert.equal(await count('walls'),4);
  assert.equal(await evaluate(`document.getElementById('floor').tabletopMap.doors[0].material`),'wood');
  // Nonzero origins, invalid optional entries, and unknown exporter metadata.
  await evaluate(`(async()=>{
    const raw=JSON.parse(await window.exportBlob.text());raw.resolution={...raw.resolution,map_origin:{x:10,y:20},map_size:{x:4,y:4}};
    raw.line_of_sight=[[{x:10,y:20},{x:14,y:20}]];
    raw.portals=[{bounds:[{x:11,y:21},{x:12,y:21}],closed:true,custom:'keep-door'}];
    raw.lights=[{position:null,range:4},{position:{x:12,y:22},range:2,intensity:.7,color:'80abcdef',shadows:false,custom:'keep-light'}];
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
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: all map imports, chain creation/cancel, box selection, group movement, material replacement, segment/area erase, undo/redo, enclosed fills, doors, export/re-import.');
} finally {
  socket?.close();browser.kill();server.close();
  await delay(500);
  if(!resolve(profile).startsWith(resolve(join(tmpdir(),'geezvtt-editor-')))) throw new Error('Unexpected browser profile path');
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
}
