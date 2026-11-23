// Open token properties on release, after distinguishing a click from an orbit drag.
export function onMapRightClick(element, callback) {
  let press;
  const down = event => {
    if (event.button === 2) press = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  };
  const move = event => {
    if (press?.id === event.pointerId) press.moved ||= Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4;
  };
  const up = event => {
    if (!press || event.pointerId !== press.id || event.button !== 2) return;
    move(event);
    const click = !press.moved;
    press = null;
    if (click) callback(event);
  };
  const cancel = () => { press = null; };
  const menu = event => {
    event.preventDefault();
    if (event.button !== 2) callback(event);
  };
  const listeners = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: cancel, lostpointercapture: cancel, contextmenu: menu };
  for (const [type, listener] of Object.entries(listeners)) element.addEventListener(type, listener, true);
  return () => {
    cancel();
    for (const [type, listener] of Object.entries(listeners)) element.removeEventListener(type, listener, true);
  };
}
