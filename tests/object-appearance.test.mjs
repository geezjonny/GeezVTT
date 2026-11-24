import { test } from 'node:test';
import assert from 'node:assert/strict';
import { objectColors, visualEffects, PROP_COLOR_PARTS } from '../js/object-appearance.js';
import { objectEffectBounds } from '../js/object-effects.js';
import { PROPS, PROP_CATEGORIES, importedProps } from '../js/prop-model.js';
import { importedTokens } from '../js/token-model.js';
import { importedPortals } from '../js/portal-model.js';

test('part colors accept only known parts and six-digit hex colors',()=>{
  assert.deepEqual(objectColors({leaves:'#ff8800',wood:'#808080',base:'red',stone:'#123',unknown:'#ffffff'}),{leaves:'#ff8800',wood:'#808080'});
  assert.deepEqual(objectColors(null),{});
  assert.deepEqual(objectColors(['#ffffff']),{});
  assert.deepEqual(PROP_COLOR_PARTS.tree,['leaves','wood']);
  assert.deepEqual(visualEffects(['glow','glow','ablaze','unknown','fairy']),['glow','ablaze','fairy']);
});

test('object colors and effects survive token, prop and portal round trips',()=>{
  const style={colors:{leaves:'#ff8800',wood:'#808080'},visualEffects:['glow','fairy']};
  const prop={id:'tree',kind:'tree',x:-1,y:2,size:2,rotation:90,...style};
  const token={id:'token',name:'NPC',x:1,y:1,size:1,hp:10,...style};
  const portal={id:'portal',pairId:'pair',x:1,y:2,...style};
  for(const object of [importedProps([prop])[0],importedTokens([token],10,10)[0],importedPortals([portal])[0]]) {
    assert.deepEqual(object.colors,style.colors);
    assert.deepEqual(object.visualEffects,style.visualEffects);
  }
});

test('crystal obelisks are categorized, recolorable and sized for effects',()=>{
  assert.ok(PROP_CATEGORIES['Decor & Landmarks'].includes('crystalObelisk'));
  assert.deepEqual(PROP_COLOR_PARTS.crystalObelisk,['crystal','stone']);
  assert.deepEqual(Object.values(PROP_CATEGORIES).flat().sort(),Object.keys(PROPS).sort());
  assert.deepEqual(objectEffectBounds({kind:'crystalObelisk',x:3,y:4,size:2},'props'),{x:3,y:4,width:2,depth:2,height:4.8});
  assert.deepEqual(objectEffectBounds({points:[{x:1,y:2},{x:4,y:2}]},'walls'),{x:2.5,y:2,width:3,depth:.2,height:2});
});
