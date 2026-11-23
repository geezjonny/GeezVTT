import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onMapRightClick } from '../js/map-right-click.js';

test('right-click waits for release, ignores orbit drags, and suppresses the browser menu', () => {
  const target = new EventTarget();
  let clicks = 0;
  const remove = onMapRightClick(target, () => clicks++);
  const send = (type, x = 10, button = 2) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: 1, clientX: x, clientY: 10, button });
    target.dispatchEvent(event);
    return event;
  };
  send('pointerdown');
  assert.ok(send('contextmenu').defaultPrevented);
  assert.equal(clicks, 0, 'Windows may emit contextmenu before the drag');
  send('pointerup');
  send('contextmenu');
  assert.equal(clicks, 1, 'a release-time contextmenu must not edit twice');
  send('pointerdown'); send('pointermove', 30); send('pointermove', 10); send('pointerup');
  assert.equal(clicks, 1, 'orbiting away and back is still a drag');
  send('pointerdown'); send('pointercancel'); send('pointerup');
  assert.equal(clicks, 1);
  send('pointerdown', 10, 1); send('pointerup', 10, 1);
  assert.equal(clicks, 1, 'middle-drag panning does not edit');
  send('contextmenu', 10, 0);
  assert.equal(clicks, 2, 'keyboard context menus remain available');
  remove(); send('pointerdown'); send('pointerup');
  assert.equal(clicks, 2);
});
