import { isGM } from './session-role.js';

document.querySelectorAll('summary[data-gm-only]').forEach(summary => summary.closest('.menu').setAttribute('data-gm-only', ''));
document.querySelectorAll('.editor-panel').forEach(panel => {
  if (!['vtt-panel', 'dice-panel', 'chest-panel', 'initiative-panel', 'sheet-stats-panel', 'sheet-weapons-panel', 'sheet-inventory-panel', 'sheet-feats-panel', 'sheet-spells-panel'].includes(panel.id)) panel.setAttribute('data-gm-only', '');
});
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
const library = document.querySelector('#library-panel');
const libraryList = document.querySelector('#library-list');
const libraryStatus = document.querySelector('#library-status');
let libraryVersion = 0;
document.querySelector('#library-local').addEventListener('click', () => {
  if (library.dataset.kind === 'scene') document.querySelector('#open-scene').click();
  else document.querySelector('#map-file').click();
});
document.querySelectorAll('[data-library]').forEach(button => {
  button.addEventListener('click', async () => {
    const kind = button.dataset.library;
    const version = ++libraryVersion;
    library.dataset.kind = kind;
    document.querySelector('#library-title').textContent = kind === 'scene' ? 'Load Scene' : 'Load Battlemap';
    libraryList.replaceChildren();
    libraryList.setAttribute('aria-busy', 'false');
    libraryStatus.textContent = 'Loading…';
    openPanel(library);
    document.querySelector('#library-local').focus();
    try {
      const response = await fetch(`${kind}/index.json`, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`Library unavailable (${response.status}).`);
      const entries = await response.json();
      const extension = kind === 'scene' ? '.geezvtt' : '.dd2vtt';
      if (!Array.isArray(entries) || entries.some(entry => !entry || typeof entry.file !== 'string' ||
          /[/\\?#]/.test(entry.file) || !entry.file.toLowerCase().endsWith(extension))) {
        throw new Error('Invalid library index.');
      }
      if (version !== libraryVersion) return;
      libraryStatus.textContent = entries.length ? '' : 'No files available.';
      for (const entry of entries) {
        const item = document.createElement('button');
        item.type = 'button';
        item.textContent = typeof entry.name === 'string' ? entry.name : entry.file;
        item.addEventListener('click', async () => {
          if (floor.getAttribute('aria-busy') === 'true' || libraryList.getAttribute('aria-busy') === 'true') return;
          libraryList.setAttribute('aria-busy', 'true');
          libraryStatus.textContent = `Loading ${item.textContent}…`;
          try {
            const response = await fetch(`${kind}/${encodeURIComponent(entry.file)}`);
            if (!response.ok) throw new Error(`File unavailable (${response.status}).`);
            const file = new File([await response.blob()], entry.file);
            if (version !== libraryVersion) return;
            const loaded = await floor.loadMap(file);
            if (version !== libraryVersion) return;
            if (loaded) library.hidden = true;
            else libraryStatus.textContent = document.querySelector('#status').classList.contains('error')
              ? document.querySelector('#status').textContent : 'Load cancelled.';
          } catch (error) {
            if (version === libraryVersion) libraryStatus.textContent = error.message;
          } finally {
            if (version === libraryVersion) libraryList.setAttribute('aria-busy', 'false');
          }
        });
        libraryList.append(item);
      }
    } catch (error) {
      if (version === libraryVersion) libraryStatus.textContent = error.message;
    }
  });
});
document.querySelectorAll('[data-edit-layer]').forEach(button => {
  button.addEventListener('click', () => {
    const input = document.querySelector('#edit-layer');
    const swatches = document.querySelector(`#${button.dataset.editLayer}-panel`);
    if (button.dataset.editLayer === 'tokens') {
      editor.hidden = true;
      openPanel(swatches);
      swatches.querySelector('select').focus();
      return;
    }
    openPanel(editor);
    openPanel(swatches);
    input.value = button.dataset.editLayer;
    input.dispatchEvent(new Event('change'));
    if (['portals', 'props'].includes(input.value)) {
      document.querySelector('#edit-tool').value = 'paint';
      document.querySelector('#edit-tool').dispatchEvent(new Event('change'));
    }
    swatches.querySelector('button[data-material]:not([hidden]), input, select:not([hidden]), button:not(.editor-close)').focus();
  });
});
document.querySelector('#open-tools').addEventListener('click', () => {
  openPanel(editor);
  document.querySelector('#tool-buttons button').focus();
});
function editState() {
  const disabled = !floor.tabletopMap || document.querySelector('#toggle-3d').getAttribute('aria-pressed') === 'true';
  document.querySelectorAll('[data-edit-layer]').forEach(button => { button.disabled = button.dataset.editLayer === 'tokens' ? !floor.tabletopMap : disabled; });
  document.querySelector('#open-tools').disabled = disabled;
    if (disabled) panels.filter(panel => !['dice-panel', 'token-properties-panel', 'environment-panel', 'vtt-panel', 'library-panel', 'object-light-panel', 'chest-panel', 'build-panel', 'initiative-panel', 'scene-panel', 'sheet-stats-panel', 'sheet-weapons-panel', 'sheet-inventory-panel', 'sheet-feats-panel', 'sheet-spells-panel'].includes(panel.id)).forEach(panel => { panel.hidden = true; });
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
  document.querySelector('[data-dice-sides="20"]').focus();
});

function connectedPanels(panel) {
  const group = [panel];
  for (const member of group) {
    const a = member.getBoundingClientRect();
    for (const other of panels) {
      if (other.hidden || group.includes(other)) continue;
      const b = other.getBoundingClientRect();
      const vertical = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      const horizontal = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1;
      if (vertical && (Math.abs(a.right - b.left) <= 1 || Math.abs(a.left - b.right) <= 1) ||
          horizontal && (Math.abs(a.bottom - b.top) <= 1 || Math.abs(a.top - b.bottom) <= 1)) group.push(other);
    }
  }
  return group;
}
function positionPanel(panel, left, top, snap = false, group = [panel]) {
  const members = group.map(member => ({ panel: member, x: member.offsetLeft - panel.offsetLeft,
    y: member.offsetTop - panel.offsetTop, width: member.offsetWidth, height: member.offsetHeight }));
  const minLeft = -Math.min(...members.map(m => m.x)), minTop = -Math.min(...members.map(m => m.y));
  const maxLeft = Math.max(minLeft, window.innerWidth - Math.max(...members.map(m => m.x + m.width)));
  const maxTop = Math.max(minTop, window.innerHeight - Math.max(...members.map(m => m.y + m.height)));
  left = Math.max(minLeft, Math.min(maxLeft, left));
  top = Math.max(minTop, Math.min(maxTop, top));
  if (snap) {
    let snappedLeft = left, snappedTop = top, bestX = 13, bestY = 13;
    for (const member of members) for (const other of panels) {
      if (group.includes(other) || other.hidden) continue;
      const rect = other.getBoundingClientRect();
      if (top + member.y <= rect.bottom + 12 && top + member.y + member.height >= rect.top - 12) {
        for (const edge of [rect.left - member.width, rect.right, rect.left, rect.right - member.width]) {
          const x = edge - member.x;
          const distance = Math.abs(x - left);
          if (x >= minLeft && x <= maxLeft && distance <= 12 && distance < bestX) {
            snappedLeft = x; bestX = distance;
          }
        }
      }
      if (left + member.x <= rect.right + 12 && left + member.x + member.width >= rect.left - 12) {
        for (const edge of [rect.top - member.height, rect.bottom, rect.top, rect.bottom - member.height]) {
          const y = edge - member.y;
          const distance = Math.abs(y - top);
          if (y >= minTop && y <= maxTop && distance <= 12 && distance < bestY) {
            snappedTop = y; bestY = distance;
          }
        }
      }
    }
    left = snappedLeft; top = snappedTop;
  }
  for (const member of members) {
    member.panel.style.left = left + member.x + 'px';
    member.panel.style.top = top + member.y + 'px';
  }
}
function raisePanel(panel) {
  panels.forEach(other => { other.style.zIndex = other === panel ? '4' : '3'; });
}
function anchorPanel(panel) {
  const left = panel.offsetLeft, top = panel.offsetTop;
  panel.style.left = left + 'px';
  panel.style.top = top + 'px';
  panel.style.right = panel.style.bottom = 'auto';
}
function setPanelMinimized(panel, minimized) {
  const button = panel.querySelector('.editor-close[aria-expanded]');
  if (!button) return;
  document.getElementById(button.getAttribute('aria-controls')).hidden = minimized;
  button.setAttribute('aria-expanded', String(!minimized));
  button.setAttribute('aria-label', button.getAttribute('aria-label').replace(/^(Minimize|Restore)/, minimized ? 'Restore' : 'Minimize'));
  button.textContent = minimized ? '+' : '\u2212';
}
export function openPanel(panel) {
  if (!isGM && panel.hasAttribute('data-gm-only')) return;
  panel.hidden = false;
  setPanelMinimized(panel, false);
  positionPanel(panel, panel.offsetLeft, panel.offsetTop);
  raisePanel(panel);
}
for (const panel of panels) {
  const titlebar = panel.querySelector('.editor-titlebar');
  titlebar.setAttribute('aria-label', titlebar.getAttribute('aria-label') + ' Snapped windows move together. Hold Shift to move only this window.');
  titlebar.title = 'Drag snapped windows together. Shift-drag to detach. Resize from the bottom-right corner or use Alt + arrow keys.';
  titlebar.setAttribute('aria-label', titlebar.getAttribute('aria-label') + ' Alt + arrow keys resize this window.');
  let drag;

  panel.addEventListener('pointerdown', () => { anchorPanel(panel); raisePanel(panel); });
  panel.addEventListener('focusin', () => raisePanel(panel));
  panel.querySelector('.editor-close').addEventListener('click', event => {
    if (!event.currentTarget.hasAttribute('aria-expanded')) {
      panel.hidden = true;
      document.querySelector('#vtt-collapse').focus();
      return;
    }
    setPanelMinimized(panel, event.currentTarget.getAttribute('aria-expanded') === 'true');
    positionPanel(panel, panel.offsetLeft, panel.offsetTop);
  });
  titlebar.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    event.preventDefault();
    panel.style.top = panel.offsetTop + 'px';
    panel.style.bottom = 'auto';
    titlebar.focus();
    drag = { x: event.clientX - panel.offsetLeft, y: event.clientY - panel.offsetTop,
      group: event.shiftKey ? [panel] : connectedPanels(panel), split: event.shiftKey };
    titlebar.setPointerCapture(event.pointerId);
  });
  titlebar.addEventListener('pointermove', event => {
    if (!drag) return;
    if (event.shiftKey) { drag.group = [panel]; drag.split = true; }
    positionPanel(panel, event.clientX - drag.x, event.clientY - drag.y, !drag.split, drag.group);
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
    if (event.altKey) {
      anchorPanel(panel);
      panel.style.width = Math.max(0, panel.offsetWidth + delta[0]) + 'px';
      panel.style.height = Math.max(0, panel.offsetHeight + delta[1]) + 'px';
      positionPanel(panel, panel.offsetLeft, panel.offsetTop);
      return;
    }
    positionPanel(panel, panel.offsetLeft + delta[0], panel.offsetTop + delta[1], false, event.shiftKey ? [panel] : connectedPanels(panel));
  });
}
window.addEventListener('resize', () => {
  const moved = new Set();
  panels.forEach(panel => {
    if (panel.hidden || moved.has(panel)) return;
    const group = connectedPanels(panel);
    positionPanel(panel, panel.offsetLeft, panel.offsetTop, false, group);
    group.forEach(member => moved.add(member));
  });
});

const layoutKey = `geezvtt-window-layout-${isGM ? 'gm' : 'player'}`;
try {
  const layout = JSON.parse(localStorage.getItem(layoutKey) || '{}');
  for (const panel of panels) {
    const saved = layout?.[panel.id];
    if (!saved || typeof saved !== 'object') continue;
    for (const key of ['left', 'top', 'width', 'height']) {
      if (Number.isFinite(saved[key]) && (key === 'left' || key === 'top' || saved[key] > 0)) {
        panel.style[key] = saved[key] + 'px';
      }
    }
    if (Number.isFinite(saved.left)) panel.style.right = 'auto';
    if (Number.isFinite(saved.top)) panel.style.bottom = 'auto';
    const collapse = panel.querySelector('.editor-close[aria-expanded]');
    if (collapse && typeof saved.collapsed === 'boolean') {
      setPanelMinimized(panel, saved.collapsed);
    }
    if (!panel.hidden) positionPanel(panel, panel.offsetLeft, panel.offsetTop);
  }
} catch (error) { console.warn('Could not restore window layout.', error); }

let layoutTimer;
function saveLayout() {
  clearTimeout(layoutTimer);
  const layout = {};
  for (const panel of panels) {
    const saved = {};
    for (const key of ['left', 'top', 'width', 'height']) {
      const value = parseFloat(panel.style[key]);
      if (Number.isFinite(value)) saved[key] = value;
    }
    const collapse = panel.querySelector('.editor-close[aria-expanded]');
    if (collapse) saved.collapsed = collapse.getAttribute('aria-expanded') === 'false';
    layout[panel.id] = saved;
  }
  try { localStorage.setItem(layoutKey, JSON.stringify(layout)); }
  catch (error) { console.warn('Could not save window layout.', error); }
}
const layoutObserver = new MutationObserver(() => {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(saveLayout, 150);
});
for (const panel of panels) {
  layoutObserver.observe(panel, { attributes: true, attributeFilter: ['style'] });
  const collapse = panel.querySelector('.editor-close[aria-expanded]');
  if (collapse) layoutObserver.observe(collapse, { attributes: true, attributeFilter: ['aria-expanded'] });
}
window.addEventListener('pagehide', saveLayout);
