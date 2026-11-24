import { cleanMapEdit, cleanTrigger } from './walk-model.js';
import { MATERIALS } from './map-editor-model.js';

export function readPuzzle(raw) {
  if (raw?.format !== 'geezpuzzle' || raw.version !== 1 || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 120 || !Number.isFinite(raw.w) || !Number.isFinite(raw.h)) throw new Error('Not a supported .geezpuzzle file.');
  const map = cleanMapEdit(raw, raw.w, raw.h);
  if (!map || [...map.wallMaterials, ...map.doorMaterials, ...map.floors.map(t => t.material)].some(m => !Object.hasOwn(MATERIALS, m))) throw new Error('Invalid puzzle geometry or materials.');
  if (!Array.isArray(raw.triggers) || raw.triggers.length > 5000 || !Array.isArray(raw.open)) throw new Error('Invalid puzzle triggers or door states.');
  const ids = new Set();
  const triggers = raw.triggers.map(t => {
    if (!t || !/^[A-Za-z0-9_-]{1,80}$/.test(t.id) || ids.has(t.id) || !Array.isArray(t.doors) || t.doors.length > 20 || t.doors.some(i => !Number.isInteger(i) || i < 0 || i >= map.doors.length)) throw new Error('Invalid puzzle trigger links.');
    const clean = cleanTrigger(t.id, t, map);
    if (!clean) throw new Error('Invalid puzzle trigger.');
    if (t.chains != null && (!Array.isArray(t.chains) || t.chains.length > 100 || t.chains.some(id => !map.chains.some(c => c.id === id)))) throw new Error('Invalid puzzle chain links.');
    ids.add(t.id); return clean;
  });
  if (raw.open.some(i => !Number.isInteger(i) || i < 0 || i >= map.doors.length)) throw new Error('Invalid puzzle door states.');
  return { name: raw.name.trim(), state: { ...map, triggers, open: [...new Set(raw.open)] } };
}

let puzzleFolder = null;
async function writeFile(handle, contents) {
  const writable = await handle.createWritable();
  try { await writable.write(contents); await writable.close(); }
  catch (error) {
    try { await writable.abort(); } catch { /* The stream may already be closed. */ }
    throw error;
  }
}
export async function savePuzzle(raw) {
  const puzzle = readPuzzle(raw);
  const filename = (puzzle.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '') || 'Puzzle') + '.geezpuzzle';
  const contents = JSON.stringify({ format: 'geezpuzzle', version: 1, name: puzzle.name, ...puzzle.state });
  if (window.showDirectoryPicker) {
    if (!puzzleFolder) {
      const folder = await window.showDirectoryPicker({ id: 'geezpuzzle', mode: 'readwrite' });
      puzzleFolder = folder.name === 'minigame' ? folder : await folder.getDirectoryHandle('minigame', { create: true });
    }
    let entries = [];
    try {
      const index = await puzzleFolder.getFileHandle('index.json');
      entries = JSON.parse(await (await index.getFile()).text());
    } catch (error) { if (error.name !== 'NotFoundError') throw error; }
    if (!Array.isArray(entries) || entries.some(e => typeof e?.file !== 'string')) throw new Error('Invalid minigame/index.json; it was left unchanged.');
    await writeFile(await puzzleFolder.getFileHandle(filename, { create: true }), contents);
    const entry = entries.find(e => e.file === filename);
    if (entry) entry.name = puzzle.name;
    else entries.push({ file: filename, name: puzzle.name });
    try { await writeFile(await puzzleFolder.getFileHandle('index.json', { create: true }), JSON.stringify(entries, null, 4) + '\n'); }
    catch (error) { return `Saved minigame/${filename}; index update failed: ${error.message}`; }
    return `Saved minigame/${filename}`;
  }
  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({ id: 'geezpuzzle', suggestedName: filename, types: [{ description: 'GeezVTT puzzle', accept: { 'application/json': ['.geezpuzzle'] } }] });
    await writeFile(handle, contents);
    return `Saved ${handle.name}`;
  }
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return `Downloaded ${filename}`;
}
