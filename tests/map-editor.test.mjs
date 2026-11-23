import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segments, distance, crosses, inBox, bucketCells } from '../js/map-editor-model.js';

test('segment picking and crossing handle endpoints, degenerate and collinear edges',()=>{
  const a={x:0,y:0}, b={x:4,y:0};
  assert.equal(segments([a,b,{x:4,y:4}]).length,2);
  assert.equal(distance({x:2,y:3},a,b),3);
  assert.equal(distance({x:0,y:3},a,a),3);
  assert.ok(crosses(a,b,{x:2,y:-1},{x:2,y:1}));
  assert.ok(crosses(a,b,b,{x:8,y:0}));
  assert.ok(!crosses(a,b,{x:5,y:0},{x:8,y:0}));
});
test('area selection catches crossing segments and uses light sources, not their range',()=>{
  const a={x:1,y:1},b={x:3,y:3};
  assert.ok(inBox({points:[{x:0,y:2},{x:4,y:2}]},a,b,'walls'));
  assert.ok(!inBox({points:[{x:0,y:0},{x:4,y:0}]},a,b,'doors'));
  assert.ok(inBox({x:2,y:2},b,a,'lights'));
  assert.ok(!inBox({x:0,y:0,range:100},a,b,'lights'));
});
test('bucket respects walls and closed doors, and crosses open doors',()=>{
  const barrier={points:[{x:2,y:0},{x:2,y:4}]};
  const model={width:4,height:4,walls:[barrier],doors:[]};
  assert.equal(bucketCells(model,{x:.5,y:.5},1).length,8);
  model.walls=[];model.doors=[{...barrier,open:false}];
  assert.equal(bucketCells(model,{x:.5,y:.5},1).length,8);
  model.doors[0].open=true;
  assert.equal(bucketCells(model,{x:.5,y:.5},1).length,16);
});
test('bucket bounds partial cells and refuses excessive fills atomically',()=>{
  assert.equal(bucketCells({width:2.2,height:2.2,walls:[],doors:[]},{x:0,y:0},1).length,4);
  assert.throws(()=>bucketCells({width:100,height:100,walls:[],doors:[]},{x:0,y:0},1),/exceeds 2000/);
});
