import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importedProps, propCorners, propDistance, propProperties } from '../js/prop-model.js';
import { triggerRule, importedTriggers, collisionSources, activateTriggers, applyTrapDamage } from '../js/trigger-model.js';

const ref = (layer,id) => ({layer,id});
const source = ref('props','plate'), target = ref('doors','door');
const rule = (patch={}) => ({id:'connection',source,target,event:'collision',effect:'state',state:'toggle',...patch});
function scene() {
  return {width:20,height:20,props:[{id:'plate',kind:'pressurePlate',x:2.5,y:2.5,size:1,rotation:0}],
    tokens:[{id:'pc:one',name:'Hero',kind:'pc',x:1.5,y:2.5,size:1,hp:20}],
    doors:[{id:'door',points:[{x:5,y:1},{x:5,y:3}],open:false,locked:false}],lights:[],portals:[],floors:[],walls:[],triggers:[rule()]};
}

test('trap props retain their type, state and wire length; plates stay one cell',()=>{
  const props=importedProps(['tripwire','pressurePlate','lever','button'].map((kind,i)=>({id:`p${i}`,kind,x:2,y:2,size:2,rotation:90,open:true,length:8})));
  assert.equal(props.length,4);
  assert.equal(props[0].length,8);
  assert.equal(props[1].size,1);
  assert.ok(props.every(prop=>prop.open));
  assert.equal(importedProps([{...props[0],length:-1}]).length,0);
  assert.equal(propProperties('pressurePlate',4).size,1);
  assert.equal(propDistance(props[0],{x:2,y:9}),0);
  assert.ok(propCorners(props[0]).some(point=>Math.abs(point.y-10)<1e-8));
});

test('connections survive JSON round trips, reject malformed effects and deduplicate IDs',()=>{
  const valid=rule({effect:'damage',damageTarget:'target',target:ref('tokens','pc:one'),damage:'2d6+3'});
  assert.deepEqual(importedTriggers(JSON.parse(JSON.stringify([valid,valid,{...valid,id:'bad',damage:'999d6'}]))),[triggerRule(valid)]);
  assert.throws(()=>triggerRule(rule({effect:'move',x:NaN,y:2,target:ref('tokens','pc:one')})));
  assert.throws(()=>triggerRule(rule({effect:'damage',damageTarget:'target',damage:'2d6'})));
  assert.throws(()=>triggerRule(rule({source:ref('__proto__','x')})));
  assert.throws(()=>triggerRule(rule({target:ref('lights','light'),state:'lock'})));
});

test('collision fires on entry or crossing, not standing or exiting; NPCs do not activate it',()=>{
  const map=scene(), token=map.tokens[0];
  assert.deepEqual(collisionSources(map,token,{x:1.5,y:2.5},[{x:2.5,y:2.5}]),[source]);
  assert.deepEqual(collisionSources(map,token,{x:1.5,y:2.5},[{x:3.5,y:2.5}]),[source]);
  assert.deepEqual(collisionSources(map,token,{x:2.5,y:2.5},[{x:2.7,y:2.5}]),[]);
  assert.deepEqual(collisionSources(map,token,{x:2.5,y:2.5},[{x:3.5,y:2.5}]),[]);
  assert.deepEqual(collisionSources(map,{...token,kind:'npc'},{x:1.5,y:2.5},[{x:3.5,y:2.5}]),[]);
});

test('collision follows the actual cell path instead of cutting across a distant plate',()=>{
  const map=scene(), token=map.tokens[0];
  assert.deepEqual(collisionSources(map,token,{x:.5,y:2.5},[{x:.5,y:.5},{x:4.5,y:.5},{x:4.5,y:2.5}]),[]);
  map.props[0]={id:'plate',kind:'tripwire',x:2.5,y:2.5,size:1,rotation:45,length:6};
  assert.deepEqual(collisionSources(map,token,{x:1.5,y:2.5},[{x:3.5,y:2.5}]),[source]);
});

test('state connections honor locks, explicit states, lights, and missing targets',()=>{
  const map=scene(), token=map.tokens[0], door=map.doors[0];
  activateTriggers(map,'collision',[source,source],token);
  assert.equal(door.open,true);
  map.triggers=[rule({state:'lock'})]; activateTriggers(map,'collision',[source],token);
  assert.equal(door.open,false); assert.equal(door.locked,true);
  map.triggers=[rule({state:'open'})]; activateTriggers(map,'collision',[source],token);
  assert.equal(door.open,false);
  map.triggers=[rule({state:'unlock'})]; activateTriggers(map,'collision',[source],token);
  assert.equal(door.locked,false);
  map.lights=[{id:'lamp',off:true}]; map.triggers=[rule({target:ref('lights','lamp'),state:'open'})];
  activateTriggers(map,'collision',[source],token); assert.equal(map.lights[0].off,false);
  map.triggers=[rule({target:ref('doors','missing')})];
  assert.deepEqual(activateTriggers(map,'collision',[source],token),[]);
});

test('self damage uses the activating PC; specific damage uses the connected token',()=>{
  const map=scene(), token=map.tokens[0];
  map.tokens.push({id:'enemy',kind:'npc',x:9,y:9,size:1,hp:10});
  map.triggers=[rule({effect:'damage',damageTarget:'self',damage:'2d6+3'}),
    rule({id:'other',effect:'damage',damageTarget:'target',target:ref('tokens','enemy'),damage:'5'})];
  const hits=activateTriggers(map,'collision',[source],token);
  assert.deepEqual(hits,[{token,formula:'2d6+3'},{token:map.tokens[1],formula:'5'}]);
  assert.deepEqual(activateTriggers(map,'interact',[source],token),[]);
});

test('trigger moves chain through plates once per connection, and cannot recurse forever',()=>{
  const map=scene(), token=map.tokens[0];
  map.props.push({id:'second',kind:'pressurePlate',x:6.5,y:2.5,size:1,rotation:0});
  map.triggers=[rule({effect:'move',target:ref('tokens',token.id),x:6.5,y:2.5}),
    rule({id:'back',source:ref('props','second'),effect:'move',target:ref('tokens',token.id),x:2.5,y:2.5})];
  activateTriggers(map,'collision',[source],token);
  assert.equal(token.x,2.5); assert.equal(token.y,2.5);
  map.triggers=[rule({effect:'move',target:ref('tokens',token.id),x:-1,y:2.5})];
  activateTriggers(map,'collision',[source],token);
  assert.equal(token.x,2.5);
});

test('trap damage spends temporary HP first and floors current HP at zero',()=>{
  const pc={combat:{hp_current:20,temp_hp:5,ac:14}};
  applyTrapDamage(pc,8); assert.deepEqual(pc.combat,{hp_current:17,temp_hp:0,ac:14});
  applyTrapDamage(pc,100); assert.equal(pc.combat.hp_current,0);
  assert.throws(()=>applyTrapDamage(pc,-1));
});

test('moving a different PC onto a plate makes that PC the self damage target',()=>{
  const map=scene(), actor=map.tokens[0], moved={id:'second-pc',kind:'pc',x:8.5,y:2.5,size:1,hp:20};
  map.tokens.push(moved);
  map.props.push({id:'lever',kind:'lever',x:9,y:2,size:1,rotation:0});
  map.triggers=[rule({id:'move',source:ref('props','lever'),event:'interact',effect:'move',target:ref('tokens',moved.id),x:2.5,y:2.5}),
    rule({effect:'damage',damageTarget:'self',damage:'4'})];
  assert.deepEqual(activateTriggers(map,'interact',[ref('props','lever')],actor),[{token:moved,formula:'4'}]);
});
