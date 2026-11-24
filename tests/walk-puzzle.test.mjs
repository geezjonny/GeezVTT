import test from 'node:test';
import assert from 'node:assert/strict';
import { readPuzzle, savePuzzle } from '../js/walk-puzzle.js';
import { cleanMapEdit, world } from '../js/walk-model.js';
import { importedProps } from '../js/prop-model.js';
import { importedTokens } from '../js/token-model.js';

const puzzle = () => ({
  format: 'geezpuzzle', version: 1, name: 'Prison puzzle', w: 20, h: 12,
  walls: [[0, 0, 4, 0]], wallMaterials: ['brick'],
  doors: [[4, 0, 5, 0]], doorMaterials: ['wood'],
  floors: [{ x: 0.5, y: 0.5, material: 'grass' }],
  props: [], tokens: [],
  triggers: [{ id: 'lever1', kind: 'lever', x: 15, y: 8, doors: [0], on: true }], open: [0]
});

test('puzzles round-trip their own dimensions, materials, links and door state', () => {
  const raw = puzzle(), before = JSON.stringify(world);
  const loaded = readPuzzle(JSON.parse(JSON.stringify(raw)));
  assert.deepEqual({ format: 'geezpuzzle', version: 1, name: loaded.name, ...loaded.state }, raw);
  assert.equal(JSON.stringify(world), before, 'reading a file does not mutate the active map');
  assert.equal(cleanMapEdit({ version: 1, ...loaded.state }, 5, 5).w, 20, 'shared imports retain dimensions larger than the base map');
});

test('invalid imports fail before replacing the map', () => {
  for (const patch of [
    { format: 'geezvtt' }, { version: 2 }, { w: -1 }, { h: Infinity },
    { wallMaterials: ['unknown'] }, { open: [99] }, { triggers: null },
    { triggers: [{ ...puzzle().triggers[0], id: 'bad/key' }] },
    { triggers: [{ ...puzzle().triggers[0], doors: [99] }] },
    { triggers: [puzzle().triggers[0], puzzle().triggers[0]] }
  ]) assert.throws(() => readPuzzle({ ...puzzle(), ...patch }));
});

test('puzzles preserve placed props, tokens, art and linked prop triggers', () => {
  const raw = puzzle();
  raw.props = importedProps([{ id: 'lever1', kind: 'lever', size: 1, rotation: 90, x: 15, y: 8 }]);
  raw.tokens = importedTokens([{ id: 'guard1', name: 'Guard', size: 2, hp: 12, imageName: 'guard.png', x: 3, y: 4, rotation: 45 }], raw.w, raw.h);
  const loaded = readPuzzle(JSON.parse(JSON.stringify(raw)));
  assert.deepEqual(loaded.state.props, raw.props);
  assert.deepEqual(loaded.state.tokens, raw.tokens);
  assert.equal(loaded.state.props[0].id, loaded.state.triggers[0].id);
  assert.deepEqual(loaded.state.triggers[0].doors, [0]);
  assert.throws(() => readPuzzle({ ...raw, tokens: [{ ...raw.tokens[0], size: -1 }] }));
  assert.throws(() => readPuzzle({ ...raw, props: [raw.props[0], raw.props[0]] }));
});

test('export writes a portable puzzle under minigame and preserves existing library entries', async () => {
  const previous = globalThis.window;
  const files = new Map([['index.json', JSON.stringify([{ file: 'existing.geezpuzzle', name: 'Existing' }])]]);
  const folder = {
    name: 'minigame',
    async getFileHandle(name, options) {
      if (!files.has(name) && !options?.create) throw new DOMException('Missing', 'NotFoundError');
      return {
        async getFile() { return { text: async () => files.get(name) }; },
        async createWritable() {
          let pending;
          return { write: async value => { pending = value; }, close: async () => { files.set(name, pending); }, abort: async () => {} };
        }
      };
    }
  };
  globalThis.window = { showDirectoryPicker: async () => ({ name: 'GeezVTT', getDirectoryHandle: async (name, options) => {
    assert.equal(name, 'minigame'); assert.equal(options.create, true); return folder;
  } }) };
  try {
    assert.equal(await savePuzzle(puzzle()), 'Saved minigame/Prison puzzle.geezpuzzle');
    assert.deepEqual(readPuzzle(JSON.parse(files.get('Prison puzzle.geezpuzzle'))), readPuzzle(puzzle()));
    assert.deepEqual(JSON.parse(files.get('index.json')), [
      { file: 'existing.geezpuzzle', name: 'Existing' },
      { file: 'Prison puzzle.geezpuzzle', name: 'Prison puzzle' }
    ]);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
