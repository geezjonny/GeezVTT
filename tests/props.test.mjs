import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROPS, importedProps, propProperties, propDistance } from '../js/prop-model.js';
import { inBox } from '../js/map-editor-model.js';

test('props survive saving with identity, visibility, size, and rotation', () => {
  const props=Object.keys(PROPS).map((kind,i)=>({id:String(i),kind,x:-2,y:3,size:1.5,rotation:90,hidden:true}));
  assert.deepEqual(importedProps(JSON.parse(JSON.stringify(props))),props);
  assert.equal(importedProps([...props,props[0],{...props[0],id:'bad',kind:'unknown'},null]).length,10);
  assert.deepEqual(importedProps(null),[]);
  assert.throws(()=>propProperties('crate',Infinity));
  assert.throws(()=>propProperties('crate',0));
  assert.equal(propProperties('stairs',1,-90).rotation,270);
});

test('rotated prop footprints drive picking and box selection', () => {
  const prop={kind:'stairs',x:0,y:0,size:2,rotation:90};
  assert.equal(propDistance(prop,{x:1.8,y:0}),0);
  assert.ok(propDistance(prop,{x:0,y:1.8})>.7);
  assert.equal(inBox(prop,{x:1.7,y:-.1},{x:1.9,y:.1},'props'),true);
  assert.equal(inBox(prop,{x:-.1,y:1.7},{x:.1,y:1.9},'props'),false);
  assert.equal(inBox(prop,{x:-.1,y:-.1},{x:.1,y:.1},'props'),true);
});
