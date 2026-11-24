import { openPanel } from './menu-bar.js';
import { isGM, playerIdentity } from './session-role.js';
import { watchTabletop } from './tabletop-stream.js';
import { SCENE_AUDIO_CHANNELS, sceneAudio } from './scene-audio-model.js';

const $ = id => document.getElementById(id), floor = $('floor');
const base = `${window.GEEZ_FIREBASE_CONFIG.databaseURL.replace(/\/$/, '')}/v2/worlds/gaia/vtt`;
async function write(path, value, method = 'PUT', etag) {
  const response = await fetch(`${base}/${path}.json`, { method,
    headers: { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) },
    body: JSON.stringify(value), signal: AbortSignal.timeout(15000) });
  if (response.status === 412) throw new Error('Changed in another session; reopen before saving.');
  if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
}
const key = value => encodeURIComponent(value);
for (const name of ['journal', 'handouts', 'soundboard']) $(`vtt-${name}`).addEventListener('click', () => {
  if (name === 'handouts' && !isGM) return;
  openPanel($(`${name}-panel`));
  if (name === 'journal') loadJournal();
  if (name === 'handouts') recipients();
});
let journalId, journalVersion, journalDirty = false, journalLoading = false;
function players() {
  const previous = $('journal-player').value;
  const pcs = [...new Map((floor.tabletopMap?.tokens || []).filter(token => token.kind === 'pc' && token.npcId?.startsWith('v2:')).map(token => [token.npcId.slice(3), token])).values()];
  $('journal-player').replaceChildren(...pcs.map(token => new Option(token.name, token.npcId.slice(3))));
  if (pcs.some(token => token.npcId === `v2:${previous}`)) $('journal-player').value = previous;
}
async function loadJournal() {
  if(journalLoading) { if(isGM && journalId) $('journal-player').value=journalId; return; }
  if (journalDirty && !window.confirm('Discard unsaved journal changes?')) { if(isGM && journalId) $('journal-player').value=journalId; return; }
  const id = isGM ? $('journal-player').value : playerIdentity?.pcId;
  if (!id) { $('journal-status').textContent = 'Select a player character.'; return; }
  journalLoading = true; journalId = id; journalVersion = null;
  $('journal-text').disabled = true; $('journal-status').textContent = 'Loading…';
  try {
    const response = await fetch(`${base}/journals/${key(id)}.json`, { headers: { 'X-Firebase-ETag': 'true' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Firebase returned ${response.status}`);
    const value = await response.json();
    if (journalId !== id) return;
    journalVersion = response.headers.get('ETag');
    $('journal-text').value = typeof value?.text === 'string' ? value.text : '';
    journalDirty = false; $('journal-status').textContent = '';
  } catch (error) { $('journal-status').textContent = error.message; }
  finally { journalLoading = false; $('journal-text').disabled = !journalVersion; }
}
$('journal-player').addEventListener('change', loadJournal);
$('journal-text').addEventListener('input', () => { journalDirty = true; $('journal-status').textContent = 'Unsaved'; });
$('journal-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (journalLoading || !journalVersion || !journalId || !isGM && journalId !== playerIdentity?.pcId) return;
  journalLoading = true; $('journal-text').disabled=true;
  const text = $('journal-text').value;
  try {
    await write(`journals/${key(journalId)}`, { text, updated: Date.now() }, 'PUT', journalVersion);
    journalDirty = false; journalLoading=false; await loadJournal(); $('journal-status').textContent = 'Saved.';
  } catch (error) { $('journal-status').textContent = `${error.message} Notes remain in this window.`; }
  finally { journalLoading = false; $('journal-text').disabled=false; }
});
window.addEventListener('beforeunload', event => { if (journalDirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('player-signed-in', () => { if (!$('journal-panel').hidden) loadJournal(); });
floor.addEventListener('map-ready', players);
floor.addEventListener('map-changed', players);
players();

function recipients() {
  const list = $('handout-recipients'); list.replaceChildren();
  const legend = document.createElement('legend'); legend.textContent = 'Tokens'; list.append(legend);
  for (const token of floor.tabletopMap?.tokens || []) {
    if (!token.npcId?.startsWith('v2:') || token.kind !== 'pc') continue;
    const label = document.createElement('label'), input = document.createElement('input');
    input.type = 'checkbox'; input.value = token.npcId.slice(3); input.checked = token.id === floor.selectedTokenId;
    label.append(input, document.createTextNode(token.name)); list.append(label);
  }
}
function fileData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('File could not be read.')); reader.readAsDataURL(file);
  });
}
function showHandout(value) {
  if (typeof value?.name !== 'string' || typeof value.body !== 'string' || value.body.length > 1500000) return;
  $('handout-title').textContent = value.name;
  const node = document.createElement(value.type === 'image' ? 'img' : 'pre');
  if (value.type === 'image') {
    if (!/^data:image\/(png|jpeg|webp|gif);base64,/.test(value.body)) return;
    node.src = value.body; node.alt = value.name; node.style.maxWidth = '100%';
  } else { node.textContent = value.body; node.style.whiteSpace = 'pre-wrap'; node.style.overflowWrap = 'anywhere'; }
  $('handout-content').replaceChildren(node); openPanel($('handout-panel'));
}
$('handouts-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!isGM) return;
  const button = event.submitter; button.disabled = true;
  try {
    const ids = [...$('handout-recipients').querySelectorAll('input:checked')].map(input => input.value);
    if (!ids.length) throw new Error('Select recipient tokens.');
    const file = $('handout-file').files[0];
    if (!file || file.size > 1024 * 1024) throw new Error('Choose an image/text file up to 1 MB.');
    const image = /^image\/(png|jpeg|webp|gif)$/.test(file.type);
    if (!image && !/\.txt$/i.test(file.name) && file.type !== 'text/plain') throw new Error('Choose PNG, JPEG, WebP, GIF, or TXT.');
    const value = { id: crypto.randomUUID(), name: file.name.slice(0, 200), type: image ? 'image' : 'text', body: image ? await fileData(file) : await file.text() };
    await write('handouts', Object.fromEntries(ids.map(id => [id, value])), 'PATCH');
    $('handouts-status').textContent = 'Sent.'; showHandout(value);
  } catch (error) { $('handouts-status').textContent = error.message; }
  finally { button.disabled = false; }
});
let seenHandout, handouts;
function receiveHandouts(values) {
  handouts=values;
  if (isGM) return;
  const value = values?.[playerIdentity?.pcId];
  if (value?.id && value.id !== seenHandout) { seenHandout = value.id; showHandout(value); }
}
const stopHandouts = watchTabletop('handouts', receiveHandouts, message => { $('handouts-status').textContent = message; });
window.addEventListener('player-signed-in',()=>receiveHandouts(handouts));
window.addEventListener('pagehide', stopHandouts, { once: true });

const channels = new Map();
let audioState = {}, audioEnabled = false;
const audioForms=new Map();
let audioDocument, audioFormState, audioWrites=Promise.resolve();
const channelVolume=state=>Number($('sound-volume').value)*(Number.isFinite(state?.volume)?Math.max(0,Math.min(1,state.volume)):1);
try { $('sound-volume').value = localStorage.getItem('geezvtt-volume') ?? '.7'; } catch { /* Local storage may be disabled. */ }
function validAudio(url) {
  if(typeof url!=='string' || !url.trim() || url.length>2048) return false;
  try { const value = new URL(url, location.href); return ['https:', 'http:'].includes(value.protocol); } catch { return false; }
}
async function syncChannel(name, state) {
  if (!state || state.stopped) { const old = channels.get(name); old?.element.pause(); channels.delete(name); return; }
  if (!audioEnabled || typeof state.url !== 'string' || !validAudio(state.url) || !Number.isFinite(state.started)) return;
  let channel = channels.get(name);
  if (channel?.id !== state.id) {
    channel?.element.pause();
    const element = new Audio(state.url); element.loop = name !== 'sfx';
    channel = { id: state.id, element }; channels.set(name, channel);
    element.addEventListener('error', () => { $('soundboard-status').textContent = `Cannot load ${name}.`; });
    element.addEventListener('loadedmetadata', () => seek(element, state));
  }
  channel.element.volume=channelVolume(state);
  seek(channel.element, state);
  if (!channel.element.loop && Number.isFinite(channel.element.duration) && (Date.now()-state.started)/1000 >= channel.element.duration) return;
  try { await channel.element.play(); $('soundboard-status').textContent = 'Playing'; }
  catch { $('soundboard-status').textContent = 'Click Enable audio.'; }
}
function seek(element, state) {
  if (!(element.duration > 0) || !Number.isFinite(element.duration)) return;
  const seconds = Math.max(0, (Date.now() - state.started) / 1000);
  const target = element.loop ? seconds % element.duration : Math.min(seconds, element.duration);
  if (Math.abs(element.currentTime - target) > .5) element.currentTime = target;
}
function syncAudio() { for (const name of ['ambience', 'sfx', 'music']) syncChannel(name, audioState[name]); }
$('sound-enable').addEventListener('click', () => {
  audioEnabled = true;
  // Unlock playback during the gesture before async metadata arrives.
  for (const channel of channels.values()) channel.element.play().catch(() => {});
  syncAudio();
});
$('sound-volume').addEventListener('input', () => {
  for (const [name,channel] of channels) channel.element.volume = channelVolume(audioState[name]);
  try { localStorage.setItem('geezvtt-volume', $('sound-volume').value); } catch { /* Local storage may be disabled. */ }
});
const stopAudio = watchTabletop('audio', value => { audioState = value || {}; syncAudio(); }, message => { $('soundboard-status').textContent = message; });
const syncTimer = setInterval(() => { if (audioEnabled) for (const [name, channel] of channels) if (audioState[name]) seek(channel.element, audioState[name]); }, 5000);
window.addEventListener('pagehide', () => { stopAudio(); clearInterval(syncTimer); for (const channel of channels.values()) channel.element.pause(); }, { once: true });
function publishAudio(path,value,document=floor.sceneDocument,method='PUT') {
  const task=audioWrites.then(async()=>{
    if(document!==floor.sceneDocument) return;
    await write(path,value,method);
    if(document!==floor.sceneDocument) return;
    if(path==='audio') audioState=value;
    else audioState={...audioState,[path.slice(6)]:method==='PATCH'?{...audioState[path.slice(6)],...value}:value};
    syncAudio();
  });
  audioWrites=task.catch(error=>{$('soundboard-status').textContent=error.message;});
  return task;
}
function rememberAudio(name,settings) {
  if(!SCENE_AUDIO_CHANNELS.includes(name) || !floor.sceneDocument) return;
  floor.sceneDocument.audio=sceneAudio({...floor.sceneDocument.audio,[name]:settings});
  floor.dispatchEvent(new Event('scene-audio-changed'));
}
function audioFormValues() {
  const settings=sceneAudio(floor.sceneDocument?.audio);
  const signature=JSON.stringify(settings);
  if(audioFormState===signature) return;
  audioFormState=signature;
  for(const [name,form] of audioForms) if(settings[name]) {
    form.elements.url.value=settings[name].url;
    form.elements.volume.value=settings[name].volume;
  }
}
function loadSceneAudio() {
  const document=floor.sceneDocument;
  if(!document || audioDocument===document) return;
  audioDocument=document;
  audioFormState=null;
  document.audio=sceneAudio(document.audio);
  audioFormValues();
  if(!isGM) return;
  const restored={sfx:{stopped:true}};
  for(const name of SCENE_AUDIO_CHANNELS) {
    const settings=document.audio[name];
    restored[name]={...settings,id:crypto.randomUUID(),started:Date.now()};
  }
  audioState=restored; syncAudio();
  publishAudio('audio',restored,document).catch(()=>{});
}
if (isGM) for (const name of ['ambience', 'sfx', 'music']) {
  const form = document.createElement('form');
  form.innerHTML = `<label>${name[0].toUpperCase() + name.slice(1)}<input name="url" list="${name}-tracks" placeholder="Audio URL" required></label><datalist id="${name}-tracks"></datalist><button type="submit">Play</button><button type="button">Stop</button>`;
  if(SCENE_AUDIO_CHANNELS.includes(name)) {
    const label=document.createElement('label'), input=document.createElement('input');
    label.textContent='Track volume'; input.type='range'; input.name='volume'; input.min='0'; input.max='1'; input.step='.05'; input.value='1';
    label.append(input); form.insertBefore(label,form.querySelector('button')); audioForms.set(name,form);
    form.elements.url.addEventListener('change',()=>{
      if(!floor.sceneDocument) return;
      const old=sceneAudio(floor.sceneDocument.audio)[name];
      if(!form.elements.url.value.trim()) {
        const settings={...old,url:'',stopped:true};
        rememberAudio(name,settings); publishAudio(`audio/${name}`,settings).catch(()=>{}); return;
      }
      if(!validAudio(form.elements.url.value)) { $('soundboard-status').textContent='Choose an audio URL.'; return; }
      const url=new URL(form.elements.url.value,location.href).href;
      rememberAudio(name,{...old,url,stopped:old.url!==url || old.stopped});
    });
    input.addEventListener('change',()=>{
      if(!floor.sceneDocument) return;
      const volume=Number(input.value), settings={...sceneAudio(floor.sceneDocument.audio)[name],volume};
      rememberAudio(name,settings);
      publishAudio(`audio/${name}`,{volume},floor.sceneDocument,'PATCH').catch(()=>{});
    });
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if(SCENE_AUDIO_CHANNELS.includes(name) && !floor.sceneDocument) { $('soundboard-status').textContent='Load a scene first.'; return; }
    if (!validAudio(form.elements.url.value)) { $('soundboard-status').textContent = 'Choose an audio URL.'; return; }
    audioEnabled = true;
    const url=new URL(form.elements.url.value,location.href).href, volume=form.elements.volume?Number(form.elements.volume.value):1;
    rememberAudio(name,{url,volume,stopped:false});
    try { await publishAudio(`audio/${name}`, { id: crypto.randomUUID(), url, volume, stopped:false, started: Date.now() }); }
    catch (error) { $('soundboard-status').textContent = error.message; }
  });
  form.querySelector('[type="button"]').addEventListener('click', async () => {
    if(SCENE_AUDIO_CHANNELS.includes(name) && !floor.sceneDocument) return;
    const settings={...sceneAudio(floor.sceneDocument?.audio)[name],stopped:true};
    rememberAudio(name,settings);
    try { await publishAudio(`audio/${name}`, settings); } catch (error) { $('soundboard-status').textContent = error.message; }
  });
  $('soundboard-tracks').append(form);
  fetch(`${name}/index.json`, { cache: 'no-cache' }).then(async response => {
    if (!response.ok) throw new Error(`${name} catalog unavailable.`);
    const entries = await response.json();
    if (!Array.isArray(entries)) throw new Error(`Invalid ${name} catalog.`);
    const options = entries.filter(entry => typeof entry?.file === 'string' && !/[/\\?#]/.test(entry.file) && /\.(mp3|ogg|wav|m4a|aac|flac)$/i.test(entry.file)).map(entry => new Option(entry.name || entry.file, `${name}/${encodeURIComponent(entry.file)}`));
    $(`${name}-tracks`).replaceChildren(...options);
  }).catch(error => { $('soundboard-status').textContent = error.message; });
}
floor.addEventListener('map-ready',loadSceneAudio);
floor.addEventListener('map-changed',audioFormValues);
if(floor.tabletopMap) loadSceneAudio();
