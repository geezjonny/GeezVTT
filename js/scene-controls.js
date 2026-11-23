import { openPanel } from './menu-bar.js';
import { showMapMenu } from './map-object-menu.js';

const $ = id => document.getElementById(id);
$('open-scene-controls').addEventListener('click', () => openPanel($('scene-panel')));
function choices(button, battlemap, scene) {
  button.addEventListener('click', () => {
    const rect = button.getBoundingClientRect();
    showMapMenu(rect.left, rect.bottom, [
      { label: 'Battlemap', action: () => $(battlemap).click() },
      { label: 'Scene', action: () => $(scene).click() }
    ], button, rect);
  });
}
choices($('scene-load'), 'load-battlemap', 'load-scene');
choices($('scene-import'), 'import-map', 'open-scene');
for (const button of $('scene-controls').querySelectorAll('[data-scene-action]')) {
  const target = $(button.dataset.sceneAction);
  button.addEventListener('click', () => target.click());
  const sync = () => { button.disabled = target.disabled; };
  new MutationObserver(sync).observe(target, { attributes: true, attributeFilter: ['disabled'] });
  sync();
}
