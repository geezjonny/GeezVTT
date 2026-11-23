import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importedPortals, portalDestination } from '../js/portal-model.js';
import { inBox } from '../js/map-editor-model.js';

test('portal import preserves pair identities and rejects invalid or duplicate endpoints', () => {
  const portal={id:'a',pairId:'pair',x:-2.5,y:3.5};
  assert.deepEqual(importedPortals([portal,portal,null,{...portal,id:'b',x:NaN},{...portal,id:'c',pairId:null}]),[portal]);
  assert.deepEqual(importedPortals(null),[]);
  assert.deepEqual(importedPortals(JSON.parse(JSON.stringify([portal]))),[portal]);
});

test('paired endpoints resolve across floors without depending on floor order or names', () => {
  const a={id:'a',pairId:'pair',x:.5,y:.5}, b={id:'b',pairId:'pair',x:4.5,y:8.5};
  const first={portal:a,index:0}, second={portal:b,index:2};
  assert.equal(portalDestination([first,second],a),second);
  assert.equal(portalDestination([second,first],b),first);
  assert.equal(portalDestination([first],a),undefined);
  assert.equal(portalDestination([first,second,{portal:{...b,id:'c'}}],a),undefined);
  assert.equal(portalDestination([first,{portal:{...a}}],a),undefined);
});

test('portal nodes support shared box selection outside the imported map', () => {
  assert.equal(inBox({x:-2.5,y:3.5},{x:-3,y:3},{x:-2,y:4},'portals'),true);
  assert.equal(inBox({x:-2.5,y:3.5},{x:0,y:0},{x:2,y:2},'portals'),false);
});
