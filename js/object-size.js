import { cutDoorOpening, distance } from './map-editor-model.js';

export function resizeObject(object, size) {
  const max = object.points || object.kind === 'tripwire' ? 10000 : 'range' in object ? 100 : 20;
  if (!Number.isFinite(size) || size < .25 || size > max) throw new Error(`Size must be 0.25–${max} squares.`);
  if ('hp' in object && (size < .5 || !Number.isInteger(size * 2))) throw new Error('Token size must use half-square steps, from 0.5 to 20.');
  if (Array.isArray(object.points)) {
    const a = object.points[0], b = object.points.at(-1), length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!length) throw new Error('Cannot resize a zero-length segment.');
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    object.points = object.points.map(p => ({ x: center.x + (p.x - center.x) * size / length, y: center.y + (p.y - center.y) * size / length }));
  } else if ('range' in object) object.range = size;
  else if (object.kind === 'tripwire') object.length = size;
  else object.size = size;
}

export function resizeDoorWalls(walls, before, after) {
  const fillers = [];
  if (Math.hypot(after[1].x-after[0].x,after[1].y-after[0].y) < Math.hypot(before[1].x-before[0].x,before[1].y-before[0].y)) {
    for (let side=0;side<2;side++) {
      const wall = walls.find(wall => wall.points.some(point => Math.hypot(point.x-before[side].x,point.y-before[side].y)<1e-6) &&
        distance(before[1-side],wall.points[0],wall.points.at(-1)) > 1e-6 &&
        Math.abs((wall.points.at(-1).x-wall.points[0].x)*(before[1].y-before[0].y)-(wall.points.at(-1).y-wall.points[0].y)*(before[1].x-before[0].x))<1e-6);
      if (wall) fillers.push({id:crypto.randomUUID(),material:wall.material,points:[before[side],after[side]]});
    }
  }
  return cutDoorOpening([...walls,...fillers],after);
}
