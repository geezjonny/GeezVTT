const menus = [...document.querySelectorAll('.menu')];
const floor = document.querySelector('#floor');
const editor = document.querySelector('#editor-panel');
const panels = [...document.querySelectorAll('.editor-panel')];

function closeMenus() {
  menus.forEach(menu => { menu.open = false; });
}

menus.forEach(menu => {
  menu.addEventListener('pointerenter', event => {
    if(event.pointerType !== 'mouse' || !menus.some(other => other.open)) return;
    menus.forEach(other => { if (other !== menu) other.open = false; });
    menu.open = true;
  });
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
    const swatches = document.querySelector(`#${button.dataset.editLayer}-panel`);
    openPanel(editor);
    openPanel(swatches);
    input.value = button.dataset.editLayer;
    input.dispatchEvent(new Event('change'));
    swatches.querySelector('button[data-material], input').focus();
  });
});
document.querySelector('#open-tools').addEventListener('click', () => {
  openPanel(editor);
  document.querySelector('#tool-buttons button').focus();
});
function editState() {
  const disabled = !floor.tabletopMap || document.querySelector('#toggle-3d').getAttribute('aria-pressed') === 'true';
  document.querySelectorAll('[data-edit-layer]').forEach(button => { button.disabled = disabled; });
  document.querySelector('#open-tools').disabled = disabled;
  if (disabled) panels.filter(panel => panel !== document.querySelector('#dice-panel')).forEach(panel => { panel.hidden = true; });
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
  openPanel(document.querySelector('#dice-panel'));
  document.querySelector('#dice-sides').focus();
});

function positionPanel(panel, left, top) {
  panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, left)) + 'px';
  panel.style.top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, top)) + 'px';
}
function raisePanel(panel) {
  panels.forEach(other => { other.style.zIndex = other === panel ? '4' : '3'; });
}
function openPanel(panel) {
  panel.hidden = false;
  positionPanel(panel, panel.offsetLeft, panel.offsetTop);
  raisePanel(panel);
}
for (const panel of panels) {
  const titlebar = panel.querySelector('.editor-titlebar');
  let drag;

  panel.addEventListener('pointerdown', () => raisePanel(panel));
  panel.addEventListener('focusin', () => raisePanel(panel));
  panel.querySelector('.editor-close').addEventListener('click', () => {
    panel.hidden = true;
    document.querySelector(panel.id === 'dice-panel' ? '#open-dice' : '#open-tools').closest('.menu').querySelector('summary').focus();
  });
  titlebar.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    event.preventDefault();
    titlebar.focus();
    drag = { x: event.clientX - panel.offsetLeft, y: event.clientY - panel.offsetTop };
    titlebar.setPointerCapture(event.pointerId);
  });
  titlebar.addEventListener('pointermove', event => {
    if (drag) positionPanel(panel, event.clientX - drag.x, event.clientY - drag.y);
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
    positionPanel(panel, panel.offsetLeft + delta[0], panel.offsetTop + delta[1]);
  });
}
window.addEventListener('resize', () => {
  panels.forEach(panel => {
    if (!panel.hidden) positionPanel(panel, panel.offsetLeft, panel.offsetTop);
  });
});
