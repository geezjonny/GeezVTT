import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segments, cutDoorOpening, distance, crosses, inBox, bucketCells, floorBrushCells, paintFloorTiles } from '../js/map-editor-model.js';

test('floor brush clicks paint one cell and fast drags fill intermediate cells',()=>{
  assert.deepEqual(floorBrushCells({x:.5,y:.5},{x:.5,y:.5}),[{x:.5,y:.5}]);
  assert.deepEqual(floorBrushCells({x:-1.5,y:.5},{x:2.5,y:.5}),[
    {x:-1.5,y:.5},{x:-.5,y:.5},{x:.5,y:.5},{x:1.5,y:.5},{x:2.5,y:.5}
  ]);
  assert.deepEqual(floorBrushCells({x:2.5,y:2.5},{x:.5,y:.5}),[{x:2.5,y:2.5},{x:1.5,y:1.5},{x:.5,y:.5}]);
  assert.throws(()=>floorBrushCells({x:0,y:0},{x:2001,y:0}),/shorter/);
});

test('floor painting changes existing materials without duplicating tiles or losing metadata',()=>{
  const tile={id:'floor-1',x:.5,y:.5,material:'stone',size:1,hidden:true};
  const tiles=[tile], cells=floorBrushCells({x:.5,y:.5},{x:1.5,y:.5});
  assert.equal(paintFloorTiles(tiles,cells,'grass'),true);
  assert.equal(tiles.length,2);
  assert.equal(tiles[0],tile);
  assert.deepEqual(tile,{id:'floor-1',x:.5,y:.5,material:'grass',size:1,hidden:true});
  assert.equal(paintFloorTiles(tiles,cells,'grass'),false);
  assert.equal(tiles.length,2);
});

test('door openings split overlapping walls while preserving material and unrelated walls',()=>{
  const wall={points:[{x:0,y:0},{x:4,y:0}],material:'brick'};
  const corner={points:[{x:2,y:0},{x:2,y:2}],material:'stone'};
  const offset={points:[{x:0,y:.1},{x:4,y:.1}]};
  const walls=[wall,corner,offset];
  assert.deepEqual(cutDoorOpening(walls,[{x:3,y:0},{x:1,y:0}]),[
    {...wall,points:[{x:0,y:0},{x:1,y:0}]},
    {...wall,points:[{x:3,y:0},{x:4,y:0}]},corner,offset
  ]);
  assert.equal(wall.points[1].x,4);
  assert.deepEqual(cutDoorOpening([wall],[{x:-1,y:0},{x:5,y:0}]),[]);
  assert.deepEqual(cutDoorOpening([wall],[{x:4,y:0},{x:5,y:0}]),[wall]);
  assert.deepEqual(cutDoorOpening([wall],[{x:2,y:0},{x:2,y:0}]),[wall]);
});

test('door openings handle diagonal and reversed walls without removing the remaining span',()=>{
  const wall={points:[{x:4,y:4},{x:0,y:0}],material:'wood'};
  const pieces=cutDoorOpening([wall],[{x:1,y:1},{x:3,y:3}]);
  assert.equal(pieces.length,2);
  assert.ok(Math.hypot(pieces[0].points[1].x-3,pieces[0].points[1].y-3)<1e-7);
  assert.ok(Math.hypot(pieces[1].points[0].x-1,pieces[1].points[0].y-1)<1e-7);
  assert.ok(pieces.every(piece=>piece.material==='wood'));
});

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

test('token box selection includes overlapping circular edges and rejects nearby corners',()=>{
  const token={x:2,y:2,size:2};
  assert.ok(inBox(token,{x:2.9,y:1.9},{x:4,y:2.1},'tokens'));
  assert.ok(inBox(token,{x:4,y:2.1},{x:2.9,y:1.9},'tokens'));
  assert.ok(!inBox(token,{x:2.9,y:2.9},{x:4,y:4},'tokens'));
});
test('bucket bounds partial cells and refuses excessive fills atomically',()=>{
  assert.equal(bucketCells({width:2.2,height:2.2,walls:[],doors:[]},{x:0,y:0},1).length,4);
  assert.throws(()=>bucketCells({width:100,height:100,walls:[],doors:[]},{x:0,y:0},1),/exceeds 2000/);
});

test('floors select by tile edges outside the imported map',()=>{
  const tile={x:-1.5,y:4.5};
  assert.ok(inBox(tile,{x:-2.1,y:4},{x:-1.9,y:5},'floors'));
  assert.ok(!inBox(tile,{x:0,y:0},{x:1,y:1},'floors'));
});

test('floor bucket accepts negative bounds while preserving wall barriers and fill limits',()=>{
  const model={width:2,height:2,walls:[{points:[{x:0,y:-2},{x:0,y:2}]}],doors:[]};
  const bounds={left:-2,top:-2,right:2,bottom:2};
  const cells=bucketCells(model,{x:-.5,y:-.5},1,2000,bounds);
  assert.equal(cells.length,8);
  assert.ok(cells.every(p=>p.x<0));
  assert.throws(()=>bucketCells(model,{x:-.5,y:-.5},1,7,bounds),/exceeds 7/);
});
