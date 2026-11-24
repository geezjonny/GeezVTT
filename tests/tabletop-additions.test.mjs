import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumableDefinition, consumableCost, applyConsumableEffect, throwItem } from '../js/consumables.js';
import { carryingLoad } from '../js/inventory-weight.js';
import { characterStats } from '../js/equipment-modifiers.js';
import { sheetRolls } from '../js/sheet-rolls.js';
import { characterVision, visionAt } from '../js/vision-model.js';
import { fogRectangles } from '../js/environment-model.js';
import { resizeObject, resizeDoorWalls } from '../js/object-size.js';
import { importedTokens } from '../js/token-model.js';
import { tokenImage } from '../js/token-art.js';

test('images use character names, support overrides, and survive scene imports', () => {
  assert.equal(tokenImage({name:'Adult Black Dragon'}), 'token/adult_black_dragon.png');
  assert.equal(tokenImage({name:'Goblin',imageName:'aboleth'}), 'token/aboleth.png');
  assert.equal(tokenImage({imageName:'../secret'}), '');
  const [token] = importedTokens([{id:'t',name:'Goblin',imageName:'aboleth',hidden:true,size:1,hp:3,x:2,y:2}],10,10);
  assert.equal(token.imageName,'aboleth'); assert.equal(token.hidden,true);
});
test('resizing handles centered segments, floor/prop footprints, light ranges and tripwires', () => {
  const door={points:[{x:1,y:2},{x:3,y:2}]}; resizeObject(door,4);
  assert.deepEqual(door.points,[{x:0,y:2},{x:4,y:2}]);
  for(const object of [{kind:'chest',size:1},{kind:'pressurePlate',size:1},{x:1,y:2}]) { resizeObject(object,2); assert.equal(object.size,2); }
  const light={range:5}; resizeObject(light,10); assert.equal(light.range,10);
  const wire={kind:'tripwire',length:3,size:1}; resizeObject(wire,5); assert.equal(wire.length,5);
  for(const size of [NaN,Infinity,0,-1,21]) assert.throws(()=>resizeObject({},size));
});
test('door resizing adjusts adjoining wall openings without creating walls around freestanding doors', () => {
  const walls=[{points:[{x:0,y:1},{x:2,y:1}],material:'stone'},{points:[{x:4,y:1},{x:6,y:1}],material:'stone'}];
  const before=[{x:2,y:1},{x:4,y:1}], expanded=[{x:1,y:1},{x:5,y:1}], shrunk=[{x:2.5,y:1},{x:3.5,y:1}];
  const widened=resizeDoorWalls(walls,before,expanded);
  assert.equal(widened[0].points[1].x,1); assert.equal(widened[1].points[0].x,5);
  const narrowed=resizeDoorWalls(walls,before,shrunk);
  assert.equal(narrowed.length,4);
  assert.equal(resizeDoorWalls([],before,shrunk).length,0);
});
test('individual darkvision reads Firebase senses, obeys walls and closed doors, and does not borrow another PC vision', () => {
  const map={width:20,height:20,walls:[],doors:[],lights:[],environment:{time:'night',fog:{covered:true,cells:[]}}};
  const viewer={x:1.5,y:1.5,size:1,vision:characterVision({senses:{darkvision:60}})};
  assert.equal(visionAt(map,{x:10.5,y:1.5},[viewer]),true);
  assert.equal(visionAt(map,{x:14.5,y:1.5},[viewer]),false);
  assert.equal(visionAt(map,{x:4.5,y:1.5},[{...viewer,vision:characterVision({senses:{darkvision:0}})}]),false);
  assert.equal(visionAt(map,{x:4.5,y:1.5},[]),false);
  map.doors=[{points:[{x:3,y:0},{x:3,y:5}],open:false,type:'door'}];
  assert.equal(visionAt(map,{x:4.5,y:1.5},[viewer]),false);
  map.doors[0].open=true;
  assert.equal(visionAt(map,{x:4.5,y:1.5},[viewer]),true);
  map.walls=[[{x:3,y:0},{x:3,y:5}]];
  assert.equal(visionAt(map,{x:4.5,y:1.5},[viewer]),false);
  map.walls=[];
  assert.equal(fogRectangles(map,[viewer]).some(r=>r.x<=4.5 && r.x+r.width>4.5 && r.y<=1.5 && r.y+r.height>1.5),false);
});
test('door surfaces remain visible while closed doors and intervening walls block sight beyond them', () => {
  const door={points:[{x:3,y:1},{x:3,y:2}],open:false,type:'door'};
  const map={walls:[],doors:[door],lights:[],environment:{time:'day'}};
  const viewer={x:1,y:1.5,size:1,vision:characterVision({})};
  for(const point of [...door.points,{x:3,y:1.5}]) assert.equal(visionAt(map,point,[viewer]),true);
  assert.equal(visionAt(map,{x:4,y:1.5},[viewer]),false);
  door.open=true;
  assert.equal(visionAt(map,{x:4,y:1.5},[viewer]),true);
  map.walls=[[{x:2,y:0},{x:2,y:3}]];
  for(const point of door.points) assert.equal(visionAt(map,point,[viewer]),false);
  map.walls=[]; door.open=false; map.environment.time='night';
  assert.equal(visionAt(map,door.points[0],[viewer]),false);
  map.lights=[{x:1,y:1.5,range:5}];
  assert.equal(visionAt(map,door.points[0],[viewer]),true);
  assert.equal(visionAt(map,{x:4,y:1.5},[viewer]),false);
});

test('variant encumbrance respects exact thresholds, current strength, size, powerful build and physical disadvantage', () => {
  const pc={stats:{str:10,dex:10},combat:{speed:30},inventory:{load:{name:'Load',weight:50}}};
  assert.equal(characterStats(pc).speed,30);
  pc.inventory.load.weight=51; assert.equal(characterStats(pc).speed,20);
  pc.inventory.load.weight=101; assert.equal(characterStats(pc).speed,10);
  assert.equal(sheetRolls(pc)['Ability Checks'].find(r=>r.key==='ability:str').disadvantage,true);
  assert.equal(sheetRolls(pc)['Ability Checks'].find(r=>r.key==='ability:wis').disadvantage,false);
  pc.inventory.load.weight=151; assert.equal(characterStats(pc).speed,0);
  assert.equal(carryingLoad({...pc,size:'large'},10).capacity,300);
  assert.equal(carryingLoad({...pc,abilities:{build:{label:'Powerful Build'}}},10).capacity,300);
});
test('consumables default to 2024 bonus actions, retain 2014 actions and atomically mutate HP/quantity', () => {
  const source={inventory:{p:{name:'Potion of Healing',qty:2}}}, target={combat:{hp_current:5,hp_max:10,temp_hp:3}};
  const definition=consumableDefinition(source.inventory.p);
  assert.equal(consumableCost({},definition),'bonus');
  assert.equal(consumableCost({rules_edition:'2014'},definition),'action');
  assert.equal(consumableCost({},consumableDefinition({name:'Potion of Speed'})),'bonus');
  applyConsumableEffect(source,target,{key:'p',effectKey:'dose'},{},{roll:{total:8,label:'2d4+2'}});
  assert.equal(target.combat.hp_current,10); assert.equal(target.combat.temp_hp,3); assert.equal(source.inventory.p.qty,1);
  source.inventory.p={name:'Acid dose',qty:1,consumable:{kind:'damage',dice:'5'}};
  applyConsumableEffect(source,target,{key:'p',effectKey:'damage'},{},{roll:{total:5,label:'5'}});
  assert.equal(target.combat.temp_hp,0); assert.equal(target.combat.hp_current,8); assert.equal(source.inventory.p.qty,0);
  assert.throws(()=>applyConsumableEffect(source,target,{key:'p',effectKey:'again'}),/No items/);
});
test('automatic potion effects spend items, modify totals and cannot reactivate for free', () => {
  const pc={inventory:{p:{name:'Potion of Hill Giant Strength',qty:1}},stats:{str:10},combat:{speed:30}};
  applyConsumableEffect(pc,pc,{key:'p',effectKey:'strength'});
  assert.equal(characterStats(pc).stats.str,21); assert.equal(pc.inventory.p.qty,0);
  assert.equal(pc.effects.strength.spentConsumable,true);
  assert.equal(pc.activeEffects['effects:strength'].remainingMinutes,60);
});
test('throwing checks weight, strength, range and obstruction, and preserves a recoverable item', () => {
  const pc={stats:{str:10},inventory:{a:{name:'Stone',qty:2,weight:1,desc:'Marked stone'}}};
  const action={key:'a',x:4,y:1,effectKey:'item',dropId:'drop'}, source={x:1,y:1},map={width:30,height:30,walls:[],doors:[]};
  const drop=throwItem(pc,action,source,map);
  assert.equal(pc.inventory.a.qty,1); assert.equal(drop.contents[0].desc,'Marked stone'); assert.equal(drop.contents[0].qty,1);
  assert.throws(()=>throwItem(pc,{...action,x:20},source,map),/beyond/);
  pc.inventory.a.weight=151; assert.throws(()=>throwItem(pc,action,source,map),/strong/);
  pc.inventory.a.weight=1; map.walls=[[{x:2,y:0},{x:2,y:3}]];
  assert.throws(()=>throwItem(pc,action,source,map),/blocks/);
  assert.equal(pc.inventory.a.qty,1);
});

test('tabletop item transactions retry conflicts without rerolling and preserve a receipt for duplicate requests', async () => {
  const previous = { document:globalThis.document,window:globalThis.window,location:globalThis.location,fetch:globalThis.fetch,sessionStorage:globalThis.sessionStorage };
  const floor = Object.assign(new EventTarget(), {sceneDocument:{},activeFloorIndex:0,flushSharedTabletop:async()=>{}});
  globalThis.document={documentElement:{dataset:{}},getElementById:()=>floor};
  globalThis.window={GEEZ_FIREBASE_CONFIG:{databaseURL:'https://example.test'}};
  globalThis.location={search:'?gm=jonny'};
  globalThis.sessionStorage={getItem:()=>null};
  let world={entities:{pc:{kind:'pc',data:{inventory:{p:{name:'Potion of Healing',qty:2}},combat:{hp_current:1,hp_max:30}}}},vtt:{live:{sceneId:'scene',initiative:true,map:{tokens:[{id:'t',kind:'pc',npcId:'v2:pc',x:1,y:1,size:1,hp:1}],props:[],initiative:{currentId:'t',turn:{id:'turn',tokenId:'t',bonus:false,action:false}}}}}};
  const attempts=[];
  globalThis.fetch=async (url,options={})=>{
    if(options.method==='PUT') {
      attempts.push(JSON.parse(options.body));
      if(attempts.length===1) return new Response(null,{status:412});
      world=JSON.parse(options.body); return new Response('null',{status:200});
    }
    return new Response(JSON.stringify(world),{headers:{ETag:'version'}});
  };
  try {
    const {resolveItemUse}=await import('../js/item-use.js');
    const action={command:'consume',requestId:'request',key:'p',to:'pc',sceneId:'scene',turnId:'turn'};
    await resolveItemUse({id:'t',npcId:'v2:pc'},action,{});
    assert.equal(attempts.length,2);
    assert.equal(attempts[0].entities.pc.data.combat.hp_current,attempts[1].entities.pc.data.combat.hp_current);
    assert.equal(world.entities.pc.data.inventory.p.qty,1);
    assert.equal(world.vtt.live.map.initiative.turn.bonus,true);
    assert.equal(world.vtt.live.map.tokens[0].hp,world.entities.pc.data.combat.hp_current);
    await resolveItemUse({id:'t',npcId:'v2:pc'},action,{});
    assert.equal(attempts.length,2);
    await assert.rejects(resolveItemUse({id:'t',npcId:'v2:pc'},{...action,requestId:'other',turnId:'stale'},{}),/turn/);
  } finally { Object.assign(globalThis,previous); }
});
