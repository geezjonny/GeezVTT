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
const profile=await mkdtemp(join(tmpdir(),'geezvtt-effects-'));
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
  const fixture = { kind: 'pc', name: 'Lark', campaign: 'daddies', data: {
    name: 'Lark', level: 5, stats: { str: 10, con: 12, dex: 14, int: 12, wis: 12, cha: 18 },
    combat: { ac: 14, speed: 35, hp_current: 25, hp_max: 33, initiative_bonus: 2 },
    equipped: { armor: 'Leather Armor' }, inventory: { leather: { name: 'Leather Armor', qty: 1, category: 'Armor' } }
  } };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*://geezsheets-default-rtdb.firebaseio.com/*', '*://cdn.jsdelivr.net/*'] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.GEEZ_FIREBASE_CONFIG = { databaseURL: 'https://effects.test' };
    sessionStorage.setItem('geezvtt.player', JSON.stringify({ campaign: 'daddies', character: 'Lark', pcId: 'pc1' }));
    let entity = JSON.parse(localStorage.getItem('effects-browser-fixture') || 'null') || ${JSON.stringify(fixture)};
    const streams = new Set();
    function streamValue(url) { return url.includes('/vtt') ? {} : url.includes('/entities/pc1.json') ? entity : { pc1: entity }; }
    window.EventSource = class {
      constructor(url) { this.url = url; this.listeners = {}; streams.add(this); }
      addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); if (type === 'put') setTimeout(() => callback({ type: 'put', data: JSON.stringify({ path: '/', data: streamValue(this.url) }) }), 0); }
      close() { streams.delete(this); }
    };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (input, options = {}) => {
      const url = String(input);
      if (!url.startsWith('https://effects.test/')) return realFetch(input, options);
      if (options.method === 'PUT' && url.includes('/entities/pc1.json')) {
        entity = JSON.parse(options.body); localStorage.setItem('effects-browser-fixture', JSON.stringify(entity));
        for (const stream of streams) if (stream.url.includes('/entities')) for (const callback of stream.listeners.put || []) setTimeout(() => callback({ type: 'put', data: JSON.stringify({ path: '/', data: streamValue(stream.url) }) }), 0);
      }
      const value = url.includes('/entities/pc1.json') ? entity : url.includes('/entities.json') ? { pc1: entity } : {};
      return new Response(JSON.stringify(value), { status: 200, headers: { ETag: 'fixture-version', 'Content-Type': 'application/json' } });
    };
  ` });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await send('Page.navigate', { url: `${origin}/sheet.html?pc=pc1&gm=jonny&section=Effects` });
  await wait(`!!document.querySelector('[data-effect-form]')`);
  await evaluate(`document.querySelector('[data-effect-preset]').click(); document.querySelector('[data-effect-form]').requestSubmit()`);
  await wait(`document.querySelector('#sheet-content').textContent.includes('2/2 uses')`);
  await evaluate(`document.querySelector('[data-effect-action="activate"]').click()`);
  await wait(`document.querySelector('#sheet-content').textContent.includes('1/2 uses')`);
  await evaluate(`[...document.querySelector('#sheet-sections').children].find(button => button.textContent === 'Stats').click()`);
  const totals = selector => evaluate(`(() => {
    const root = document.querySelector(${JSON.stringify(selector)});
    return Object.fromEntries([...root.querySelectorAll('.sheet-row')].filter(row => row.querySelector('strong')).map(row => [row.querySelector('span').textContent, row.querySelector('strong').textContent]));
  })()`);
  const standalone = await totals('#sheet-content');
  for (const [key, value] of Object.entries({ 'STR': '12', 'DEX': '7', 'CON': '14', 'INT': '12', 'WIS': '12', 'CHA': '18', 'AC total': '16', 'SPD (ft)': '17', 'Maximum HP total': '38' })) assert.equal(standalone[key], value, `sheet.html ${key}`);
  await send('Page.navigate', { url: `${origin}/index.html?gm=jonny` });
  await wait(`typeof document.querySelector('#floor')?.loadMap === 'function' && document.querySelector('#map-view')?.tabIndex === 0`);
  await evaluate(`(async () => {
    const floor = document.querySelector('#floor');
    const raw = await (await fetch('/battlemap/camp.dd2vtt')).json();
    raw.geezvtt_editor = { ...(raw.geezvtt_editor || {}), tokens: [{ id: 'lark-token', npcId: 'v2:pc1', kind: 'pc', name: 'Lark', x: 2.5, y: 2.5, size: 1, hp: 25 }] };
    if (!await floor.loadMap(new File([JSON.stringify(raw)], 'effects.dd2vtt'))) throw new Error('Fixture map did not load');
  })()`);
  await wait(`document.querySelector('#floor').tabletopMap?.tokens[0]?.speed === 17`);
  await evaluate(`document.querySelector('#tokens [data-token-id]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }))`);
  await wait(`[...document.querySelectorAll('#map-object-menu button')].some(button => button.textContent === 'Stats')`);
  await evaluate(`[...document.querySelectorAll('#map-object-menu button')].find(button => button.textContent === 'Stats').click()`);
  await wait(`!document.querySelector('#sheet-stats-panel').hidden && document.querySelector('#sheet-stats-content').textContent.includes('Bark Arm')`);
  const popup = await totals('#sheet-stats-content');
  for (const key of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA', 'AC total', 'SPD (ft)', 'Maximum HP total']) assert.equal(popup[key], standalone[key], `right-click Stats ${key}`);
  assert.deepEqual(await evaluate(`(() => { const token = document.querySelector('#floor').tabletopMap.tokens[0]; return [token.ac, token.speed, token.hpMax]; })()`), [16, 17, 38]);
  await evaluate(`document.querySelector('#floor').dispatchEvent(new CustomEvent('token-sheet', { detail: { id: 'lark-token', section: 'Effects' } }))`);
  await wait(`!!document.querySelector('#sheet-effects-content [data-effect-time]')`);
  await evaluate(`const timeForm = document.querySelector('#sheet-effects-content [data-effect-time]'); timeForm.elements.namedItem('minutes').value = '60'; timeForm.requestSubmit()`);
  await wait(`document.querySelector('#floor').tabletopMap.tokens[0].speed === 35`);
  assert.equal((await totals('#sheet-stats-content'))['DEX'], '14');
  assert.equal((await totals('#sheet-stats-content'))['Maximum HP total'], '33');
  await evaluate(`document.querySelector('#sheet-effects-content [data-effect-preset]').click(); document.querySelector('#sheet-effects-content [data-effect-form] [name="label"]').value = '<img src=x onerror=alert(1)>'; document.querySelector('#sheet-effects-content [data-effect-form]').requestSubmit()`);
  await wait(`document.querySelector('#sheet-effects-content').textContent.includes('<img src=x onerror=alert(1)>')`);
  assert.equal(await evaluate(`!!document.querySelector('#sheet-effects-content article img')`), false);
  await send('Page.navigate', { url: `${origin}/sheet.html?pc=pc1&section=Effects` });
  await wait(`!!document.querySelector('[data-effect-form]')`);
  assert.equal(await evaluate(`!!document.querySelector('[data-effect-time]')`), false, 'game-time controls belong to the GM');
  assert.equal(await evaluate(`!!document.querySelector('[data-effect-preset]')`), true, 'the signed-in character can build effects');
  assert.deepEqual(errors, []);
  console.log('Effects browser checks passed: build/save/activate on sheet.html; matching final scores, AC, speed and HP in actual right-click Stats; token sync; game-time expiration; escaped effect names. Firebase was mocked; no live data changed.');
} finally {
  socket?.close(); browser.kill(); server.close();
  await delay(500);
  if (!resolve(profile).startsWith(resolve(join(tmpdir(), 'geezvtt-effects-')))) throw new Error('Unexpected browser profile path');
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
