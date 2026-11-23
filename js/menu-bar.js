const menus = [...document.querySelectorAll('.menu')];
const floor = document.querySelector('#floor');
const editor = document.querySelector('#editor-panel');
const titlebar = document.querySelector('#editor-titlebar');

function closeMenus() {
  menus.forEach(menu => { menu.open = false; });
}

menus.forEach(menu => {
  menu.querySelector('summary').addEventListener('click', () => {
    menus.forEach(other => { if (other !== menu) other.open = false; });
  });
  menu.addEventListener('click', event => {
    if (event.target.closest('button, label')) closeMenus();
  });
});
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.menu')) closeMenus();
});
document.addEventListener('focusin', event => {
  if (!event.target.closest('.menu')) closeMenus();
});
document.addEventListener('keydown', event => {
  const menu = event.target.closest('.menu');
  if (event.key === 'Escape' && menu?.open) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeMenus();
    menu.querySelector('summary').focus();
  }
}, true);

document.querySelector('#import-map').addEventListener('click', () => {
  document.querySelector('#map-file').click();
});
document.querySelectorAll('[data-edit-layer]').forEach(button => {
  button.addEventListener('click', () => {
    const input = document.querySelector('#edit-layer');
    editor.hidden = false;
    input.value = button.dataset.editLayer;
    input.dispatchEvent(new Event('change'));
    positionEditor(editor.offsetLeft, editor.offsetTop);
    document.querySelector('#tool-buttons button').focus();
  });
});
function editState() {
  const disabled = !floor.tabletopMap || document.querySelector('#toggle-3d').getAttribute('aria-pressed') === 'true';
  document.querySelectorAll('[data-edit-layer]').forEach(button => { button.disabled = disabled; });
  if (disabled) editor.hidden = true;
}
floor.addEventListener('map-ready', editState);
new MutationObserver(editState).observe(document.querySelector('#toggle-3d'), {
  attributes: true, attributeFilter: ['aria-pressed']
});
editState();
document.querySelector('#toggle-grid').addEventListener('change', event => {
  document.querySelector('#grid').toggleAttribute('hidden', !event.target.checked);
});
document.querySelector('#open-dice').addEventListener('click', () => {
  document.querySelector('#dice-panel').open = true;
  document.querySelector('#dice-sides').focus();
});

document.querySelector('#editor-close').addEventListener('click', () => {
  editor.hidden = true;
  document.querySelector('[data-edit-layer="' + document.querySelector('#edit-layer').value + '"]')
    .closest('.menu').querySelector('summary').focus();
});

function positionEditor(left, top) {
  editor.style.left = Math.max(0, Math.min(window.innerWidth - editor.offsetWidth, left)) + 'px';
  editor.style.top = Math.max(0, Math.min(window.innerHeight - editor.offsetHeight, top)) + 'px';
}
let drag;
titlebar.addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target.closest('button')) return;
  event.preventDefault();
  titlebar.focus();
  drag = { x: event.clientX - editor.offsetLeft, y: event.clientY - editor.offsetTop };
  titlebar.setPointerCapture(event.pointerId);
});
titlebar.addEventListener('pointermove', event => {
  if (drag) positionEditor(event.clientX - drag.x, event.clientY - drag.y);
});
titlebar.addEventListener('pointerup', event => {
  drag = null;
  if (titlebar.hasPointerCapture(event.pointerId)) titlebar.releasePointerCapture(event.pointerId);
});
titlebar.addEventListener('lostpointercapture', () => { drag = null; });
titlebar.addEventListener('pointercancel', () => { drag = null; });
titlebar.addEventListener('keydown', event => {
  if (event.target !== titlebar) return;
  const delta = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[event.key];
  if (!delta) return;
  event.preventDefault();
  positionEditor(editor.offsetLeft + delta[0], editor.offsetTop + delta[1]);
});
window.addEventListener('resize', () => {
  if (!editor.hidden) positionEditor(editor.offsetLeft, editor.offsetTop);
});
