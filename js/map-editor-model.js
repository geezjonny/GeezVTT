import { propCorners, propDistance, propAppearance } from './prop-model.js';

export const MATERIALS = {
  'wooden fence': '#a97848', 'iron fence': '#58636b', barricade: '#90613c', 'broken wall': '#9ca3af', wood: '#a97848', stone: '#9ca3af', cobble: '#7e8275', brick: '#b96750', metal: '#a9c8d4',
  water: '#377eaa', grass: '#648448', dirt: '#876448', 'cracked rock': '#777875', snow: '#e5edf0',
  marble: '#dedbd3', 'burnt wood': '#39302c', moss: '#526b38', blood: '#842b30', sand: '#cbb47c',
  mud: '#604c38', gravel: '#939087', ice: '#acd4df', lava: '#da5327', swamp: '#556345',
  tile: '#b69b81', carpet: '#853d50', ash: '#686260', 'dark wood': '#604331',
  'reinforced wood': '#94704c', 'rusty iron': '#865b45', bronze: '#aa8750', curtain: '#88465d',
  sandstone: '#c5a474', limestone: '#bab7a1', plaster: '#d3c6af', timber: '#815b3b',
  'mossy stone': '#73806a', cave: '#68615a', hedge: '#486239', obsidian: '#34303f'
};
export const MATERIAL_LAYERS = {
  floors: ['wood','stone','cobble','brick','metal','water','grass','dirt','cracked rock','snow','marble','burnt wood','moss','blood','sand','mud','gravel','ice','lava','swamp','tile','carpet','ash'],
  doors: ['wood','stone','cobble','brick','metal','dark wood','reinforced wood','burnt wood','rusty iron','bronze','marble','curtain'],
  walls: ['wooden fence','iron fence','barricade','broken wall','wood','stone','cobble','brick','metal','sandstone','limestone','marble','plaster','timber','mossy stone','cave','hedge','ice','obsidian','burnt wood']
};
export const clone = value => JSON.parse(JSON.stringify(value));
export function floorBrushCells(from,to) {
  const steps=Math.ceil(Math.max(Math.abs(to.x-from.x),Math.abs(to.y-from.y)));
  if(steps>2000) throw new Error('Paint a shorter floor stroke.');
  return Array.from({length:steps+1},(_,index)=>{
    const t=steps?index/steps:0;
    return {x:Math.floor(from.x+(to.x-from.x)*t)+.5,y:Math.floor(from.y+(to.y-from.y)*t)+.5};
  });
}
export function paintFloorTiles(tiles,cells,material) {
  let changed=false;
  for(const cell of cells) {
    const tile=tiles.find(tile=>Math.hypot(tile.x-cell.x,tile.y-cell.y)<.01);
    if(tile?.material===material) continue;
    if(tile) tile.material=material;
    else tiles.push({...cell,material});
    changed=true;
  }
  return changed;
}
export function eraseStrokeIndices(objects,from,to,layer,tolerance=0) {
  return objects.flatMap((object,index)=>{
    if(layer==='floors') {
      const half=(object.size || 1)/2;
      const inside=p=>Math.abs(p.x-object.x)<=half && Math.abs(p.y-object.y)<=half;
      const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>({x:object.x+x*half,y:object.y+y*half}));
      return inside(from) || inside(to) || corners.some((a,i)=>crosses(from,to,a,corners[(i+1)%4]))?[index]:[];
    }
    return segments(object.points).some(([a,b])=>crosses(from,to,a,b) ||
      Math.min(distance(from,a,b),distance(to,a,b),distance(a,from,to),distance(b,from,to))<=tolerance)?[index]:[];
  });
}
export function portalType(portal) {
  return ['door','window'].includes(portal?.geezvtt_type) ? portal.geezvtt_type : portal?.closed === false ? 'window' : 'door';
}
export function adjoiningWallIndex(door,walls) {
  const a=door.points[0], b=door.points.at(-1), dx=b.x-a.x, dy=b.y-a.y, epsilon=1e-6;
  return walls.findIndex(wall=>segments(wall.points || wall).some(([c,d])=>
    Math.abs((d.x-c.x)*dy-(d.y-c.y)*dx)<=epsilon*Math.max(1,Math.hypot(dx,dy)) &&
    [a,b].some(p=>Math.hypot(p.x-c.x,p.y-c.y)<epsilon || Math.hypot(p.x-d.x,p.y-d.y)<epsilon)));
}
export function windowFrameParts(length) {
  const edge=Math.min(.12,length*.2);
  return [
    {x:length/2,y:.3,width:length,height:.6},
    {x:length/2,y:1.8,width:length,height:.4},
    {x:edge/2,y:1.1,width:edge,height:1},
    {x:length-edge/2,y:1.1,width:edge,height:1}
  ];
}
export function segments(points) { return points.slice(1).map((b, i) => [points[i], b]); }
export function cutDoorOpening(walls, [a,b]) {
  const epsilon=1e-7;
  return walls.flatMap(wall=>{
    const [c,d]=wall.points, dx=d.x-c.x, dy=d.y-c.y, length=Math.hypot(dx,dy);
    if(length<epsilon) return [wall];
    // Only cut walls along the doorway; crossing walls at corners stay intact.
    if([a,b].some(p=>Math.abs((p.x-c.x)*dy-(p.y-c.y)*dx)>epsilon*length)) return [wall];
    const project=p=>((p.x-c.x)*dx+(p.y-c.y)*dy)/(length*length);
    const start=Math.max(0,Math.min(project(a),project(b))), end=Math.min(1,Math.max(project(a),project(b)));
    if((end-start)*length<epsilon) return [wall];
    const at=t=>({x:c.x+dx*t,y:c.y+dy*t});
    const pieces=[];
    if(start*length>epsilon) pieces.push({...wall,points:[c,at(start)]});
    if((1-end)*length>epsilon) pieces.push({...wall,points:[at(end),d]});
    return pieces;
  });
}
export function distance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx + (p.y-a.y)*dy) / (dx*dx+dy*dy || 1)));
  return Math.hypot(p.x-a.x-t*dx, p.y-a.y-t*dy);
}
export function crosses(a, b, c, d) {
  const cross = (p, q, r) => (q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
  const on = (p,q,r) => r.x >= Math.min(p.x,q.x)-1e-9 && r.x <= Math.max(p.x,q.x)+1e-9 && r.y >= Math.min(p.y,q.y)-1e-9 && r.y <= Math.max(p.y,q.y)+1e-9;
  const x=cross(a,b,c), y=cross(a,b,d), z=cross(c,d,a), w=cross(c,d,b);
  return ((x>0 && y<0 || x<0 && y>0) && (z>0 && w<0 || z<0 && w>0)) ||
    Math.abs(x)<1e-9 && on(a,b,c) || Math.abs(y)<1e-9 && on(a,b,d) || Math.abs(z)<1e-9 && on(c,d,a) || Math.abs(w)<1e-9 && on(c,d,b);
}
export function inBox(object, a, b, layer) {
  const appearance=['lights','portals'].includes(layer) && propAppearance(object);
  if(appearance) return inBox(appearance,a,b,'props');
  const left=Math.min(a.x,b.x), right=Math.max(a.x,b.x), top=Math.min(a.y,b.y), bottom=Math.max(a.y,b.y);
  const inside = p => p.x>=left && p.x<=right && p.y>=top && p.y<=bottom;
  if (layer==='lights' || layer==='portals') return inside(object);
  if (layer==='floors') return object.x+.5>=left && object.x-.5<=right && object.y+.5>=top && object.y-.5<=bottom;
  if (layer==='tokens') return Math.hypot(object.x-Math.max(left,Math.min(right,object.x)),object.y-Math.max(top,Math.min(bottom,object.y)))<=object.size/2;
  const corners=[{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}];
  if (layer==='props') {
    const footprint=propCorners(object);
    return footprint.some(inside) || corners.some(p=>propDistance(object,p)===0) ||
      footprint.some((p,i)=>corners.some((c,j)=>crosses(p,footprint[(i+1)%4],c,corners[(j+1)%4])));
  }
  return object.points.some(inside) || segments(object.points).some(([p,q]) => corners.some((c,i)=>crosses(p,q,c,corners[(i+1)%4])));
}
// Flood cell centers, with walls, windows, and closed doors as barriers.
// Refuse oversized fills atomically, including maps without enclosing walls.
export function bucketCells(model, seed, spacing, limit=2000, bounds={left:0,top:0,right:model.width,bottom:model.height}) {
  const cols=Math.ceil((bounds.right-bounds.left)/spacing), rows=Math.ceil((bounds.bottom-bounds.top)/spacing);
  const center=(x,y)=>({x:bounds.left+(x+.5)*spacing,y:bounds.top+(y+.5)*spacing});
  const barriers=[...model.walls, ...model.doors.filter(d=>d.type==='window' || !d.open)].flatMap(o=>segments(o.points));
  const start=[Math.floor((seed.x-bounds.left)/spacing),Math.floor((seed.y-bounds.top)/spacing)];
  const queue=[start], seen=new Set([start.join(',')]), result=[];
  for(let i=0;i<queue.length;i++) {
    const [x,y]=queue[i], p=center(x,y);
    if(x<0 || y<0 || x>=cols || y>=rows || p.x>=bounds.right || p.y>=bounds.bottom) continue;
    result.push(p);
    if(result.length>limit) throw new Error(`Fill exceeds ${limit} objects. Increase spacing or enclose a smaller area.`);
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx=x+dx, ny=y+dy, key=`${nx},${ny}`;
      if(seen.has(key) || nx<0 || ny<0 || nx>=cols || ny>=rows) continue;
      const q=center(nx,ny);
      if(barriers.some(([a,b])=>crosses(p,q,a,b))) continue;
      seen.add(key); queue.push([nx,ny]);
    }
  }
  return result;
}
