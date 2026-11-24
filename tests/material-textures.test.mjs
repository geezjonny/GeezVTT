import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATERIALS, MATERIAL_LAYERS } from '../js/map-editor-model.js';
import { materialCanvas } from '../js/material-textures.js';

test('every layer material generates and caches its own texture, with unknown names falling back to stone',()=>{
  const previous=globalThis.document;
  globalThis.document={createElement:()=>{
    const fills=[];
    const ctx=new Proxy({fills,fillRect(){fills.push(this.fillStyle);}}, {
      get(target,key){return key in target?target[key]:()=>{};}
    });
    return {getContext:()=>ctx};
  }};
  try {
    for(const names of Object.values(MATERIAL_LAYERS)) {
      assert.equal(new Set(names).size,names.length);
      for(const name of names) {
        assert.ok(Object.hasOwn(MATERIALS,name));
        const canvas=materialCanvas(name);
        assert.equal(canvas.width,128);
        assert.equal(canvas.height,128);
        assert.equal(canvas.getContext('2d').fills[0],MATERIALS[name]);
        assert.equal(materialCanvas(name),canvas);
      }
    }
    assert.equal(materialCanvas('unknown material'),materialCanvas('stone'));
  } finally {
    if(previous===undefined) delete globalThis.document;
    else globalThis.document=previous;
  }
});
