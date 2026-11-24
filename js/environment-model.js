import { visionTest } from './vision-model.js';
import { crosses, segments } from './map-editor-model.js';

export const TIMES = {
  original: { color: '#ffe6c4', ambient: .8, sun: 2.5, tint: 'transparent' },
  day: { color: '#fff4df', ambient: .8, sun: 2.5, tint: 'transparent' },
  dawn: { color: '#ffb980', ambient: .35, sun: 1.2, tint: '#d77d4933' },
  dusk: { color: '#ff9966', ambient: .2, sun: .7, tint: '#532d7355' },
  night: { color: '#91b8ff', ambient: .12, sun: .2, tint: '#07132b99' }
};
export const WEATHER_COLORS = { clear: '#b9d6ed', rain: '#b9d6ed', snow: '#ffffff', fog: '#cbd2d6', ash: '#969087' };
// Bound fog geometry on large maps; ordinary maps use one-square cells.
export const fogSize = map => Math.max(1, Math.ceil(Math.max(map.width, map.height) / 128));
export function fogBounds(map) {
  return (map.floors || []).reduce((bounds,tile)=>{
    const half=(Number.isFinite(tile?.size) && tile.size>=.25 && tile.size<=20?tile.size:1)/2;
    if(Number.isFinite(tile?.x) && Number.isFinite(tile?.y)) {
      bounds.left=Math.min(bounds.left,tile.x-half); bounds.right=Math.max(bounds.right,tile.x+half);
      bounds.top=Math.min(bounds.top,tile.y-half); bounds.bottom=Math.max(bounds.bottom,tile.y+half);
    }
    return bounds;
  },{left:0,top:0,right:map.width,bottom:map.height});
}
export function environmentSettings(raw, map) {
  const size = fogSize(map), bounds = fogBounds(map);
  return {
    time: Object.hasOwn(TIMES, raw?.time) ? raw.time : 'original',
    weather: Object.hasOwn(WEATHER_COLORS, raw?.weather) ? raw.weather : 'clear',
    weatherColor: typeof raw?.weatherColor === 'string' && /^#[0-9a-f]{6}$/i.test(raw.weatherColor) ? raw.weatherColor : WEATHER_COLORS[raw?.weather] || WEATHER_COLORS.clear,
    fog: { covered: raw?.fog?.covered === true, cells: [...new Set((Array.isArray(raw?.fog?.cells) ? raw.fog.cells : []).filter(key => {
      if (typeof key !== 'string' || !/^-?\d+,-?\d+$/.test(key)) return false;
      const [x, y] = key.split(',').map(Number);
      return Number.isSafeInteger(x) && Number.isSafeInteger(y) && x >= Math.floor(bounds.left/size) && y >= Math.floor(bounds.top/size) && x < Math.ceil(bounds.right/size) && y < Math.ceil(bounds.bottom/size) && key === `${x},${y}`;
    }))] }
  };
}
export function fogRectangles(map, viewers = null) {
  const visible = viewers === null ? null : visionTest(map, viewers);
  const fog = map.environment.fog, cells = new Set(fog.cells), size = fogSize(map), bounds = fogBounds(map), rectangles = [];
  const lights = (map.lights || []).filter(light => Number.isFinite(light.x) && Number.isFinite(light.y) &&
    !light.hidden && !light.off && Number.isFinite(light.range) && light.range > 0 && (light.intensity ?? 1) > 0 && (light.opacity ?? 1) > 0);
  const barriers = [...(map.walls || []).map(wall=>wall.points || wall), ...(map.doors || []).filter(door => door.type !== 'window' && !door.open).map(door => door.points)].flatMap(segments);
  const centerAt = (x,y) => ({x:(Math.max(bounds.left,x*size)+Math.min(bounds.right,(x+1)*size))/2,y:(Math.max(bounds.top,y*size)+Math.min(bounds.bottom,(y+1)*size))/2});
  const lit = center => {
    return lights.some(light => Math.hypot(center.x - light.x, center.y - light.y) <= light.range &&
      !barriers.some(([a, b]) => crosses(light, center, a, b)));
  };
  // Visit painted ground, without allocating cells for empty gaps between distant floors.
  const rows=new Map();
  const regions=[{x:0,y:0,width:map.width,height:map.height},...(map.floors || []).filter(tile=>Number.isFinite(tile?.x) && Number.isFinite(tile?.y)).map(tile=>{
    const size=Number.isFinite(tile.size) && tile.size>=.25 && tile.size<=20?tile.size:1;
    return {x:tile.x-size/2,y:tile.y-size/2,width:size,height:size};
  })];
  for(const region of regions) for(let y=Math.floor(region.y/size);y<Math.ceil((region.y+region.height)/size);y++) {
    if(!rows.has(y)) rows.set(y,new Set());
    for(let x=Math.floor(region.x/size);x<Math.ceil((region.x+region.width)/size);x++) rows.get(y).add(x);
  }
  for (const [y,row] of [...rows].sort(([a],[b])=>a-b)) {
    let start = null;
    let end;
    const flush = () => {
      if(start===null) return;
      const left=Math.max(bounds.left,start*size), top=Math.max(bounds.top,y*size);
      rectangles.push({x:left,y:top,width:Math.min(end*size,bounds.right)-left,height:Math.min((y+1)*size,bounds.bottom)-top});
      start=null;
    };
    for (const x of [...row].sort((a,b)=>a-b)) {
      const center=centerAt(x,y);
      const hidden=visible ? !visible(center) : fog.covered !== cells.has(`${x},${y}`) && !lit(center);
      if(!hidden || start!==null && x!==end) flush();
      if(hidden) { if(start===null) start=x; end=x+1; }
    }
    flush();
  }
  return rectangles;
}
