import { isGM, canControlPC } from './session-role.js';
import { visionTest } from './vision-model.js';
export const viewersFor = map => isGM ? null : (map.tokens || []).filter(token => !token.hidden && token.kind === 'pc' && canControlPC(token));
export function visibleObject(map, object) {
  return visibilityFor(map)(object);
}
export function visibilityFor(map) {
  if (isGM) return () => true;
  const viewers=viewersFor(map), visible = visionTest(map, viewers);
  return object => !object.hidden && (!object.invisible || canControlPC(object) || viewers.some(viewer=>Math.hypot(viewer.x-object.x,viewer.y-object.y)*5 <= Math.max(viewer.vision?.blindsight || 0,viewer.vision?.truesight || 0))) && (object.points || [object]).some(visible);
}
