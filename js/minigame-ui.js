// Floating windows and icon buttons for the minigame, styled after index.html's editor panels:
// drag by the titlebar, minimise with the dash, resize from the corner, click to bring forward, and remember position.
const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
export const ICONS = {
  walls: svg('M2 4h20v16H2ZM2 12h20M8 4v8m8 0v8'),
  floors: svg('m12 3 10 9-10 9L2 12Zm-5 4 10 10M7 17 17 7'),
  doors: svg('M4 21V3h16v18M7 21V5h10v16M13 13h1'),
  lights: svg('M9 18h6m-5 3h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3Z'),
  levers: svg('M5 20h14M8 20v-3h8v3M12 17 17 5m0 0-2-1m2 1 1 2'),
  tokens: svg('M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0Z'),
  select: svg('m5 3 14 8-6 2-3 6Z'),
  erase: svg('m7 21-4-4 11-11 7 7-8 8Zm2-2 8-8M9 21h12'),
  paint: svg('M4 20c4 0 5-2 5-4l9-9-3-3-9 9c-2 0-2 3-2 7ZM14 6l4 4'),
  connect: svg('M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'),
  bucket: svg('m5 11 7-8 7 8-6 8Zm-2 10h18M19 14c1.5 2 2 3 2 4a2 2 0 0 1-4 0c0-1 .5-2 2-4Z'),
  grid: svg('M3 3h18v18H3ZM3 9h18M3 15h18M9 3v18M15 3v18'),
  snap: svg('M5 3v8a7 7 0 0 0 14 0V3h-4v8a3 3 0 0 1-6 0V3ZM5 7h4m6 0h4'),
  fit: svg('M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'),
  undo: svg('M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3'),
  redo: svg('m15 14 5-5-5-5m5 5H10a6 6 0 0 0 0 12h3'),
  save: svg('M3 3h15l3 3v15H3ZM7 3v6h10V3M7 21v-8h10v8M10 15h4'),
  import: svg('M12 3v12m-5-5 5 5 5-5M3 15v6h18v-6'),
  blank: svg('M3 3h18v18H3ZM12 7v10M7 12h10')
};

export const iconButton = (icon, label, onclick) => {
  const b = Object.assign(document.createElement('button'), { type: 'button', title: label, innerHTML: ICONS[icon] });
  b.setAttribute('aria-label', label); if (onclick) b.onclick = onclick; return b;
};

let top = 10;
const store = key => { try { return JSON.parse(localStorage.getItem('mg-win-' + key)); } catch { return null; } };
const save = (key, v) => { try { localStorage.setItem('mg-win-' + key, JSON.stringify(v)); } catch { /* storage may be blocked */ } };

// opts: { id, title, left, top, width, collapsible, onClose } -> { el, body, show, hide }
export function makeWindow({ id, title, left = 16, top: y = 80, width, onClose }) {
  const el = Object.assign(document.createElement('section'), { className: 'win', hidden: true });
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', title);
  const bar = Object.assign(document.createElement('div'), { className: 'win-title' });
  const h = Object.assign(document.createElement('h2'), { textContent: title });
  const min = Object.assign(document.createElement('button'), { type: 'button', textContent: '−', title: 'Minimize', ariaLabel: `Minimize ${title}` });
  min.setAttribute('aria-expanded', 'true');
  bar.append(h, min);
  if (onClose) { const x = Object.assign(document.createElement('button'), { type: 'button', textContent: '×', title: 'Close', ariaLabel: `Close ${title}` }); x.onclick = onClose; bar.append(x); }
  const body = Object.assign(document.createElement('div'), { className: 'win-body' });
  el.append(bar, body);
  const pos = store(id); // clamp a remembered position back on screen
  el.style.left = Math.max(0, Math.min(pos?.x ?? left, innerWidth - 60)) + 'px';
  el.style.top = Math.max(0, Math.min(pos?.y ?? y, innerHeight - 40)) + 'px';
  if (width) el.style.width = width + 'px';
  el.style.zIndex = ++top;
  document.body.append(el);

  el.addEventListener('pointerdown', () => { el.style.zIndex = ++top; }, true);
  min.onclick = () => { const open = min.getAttribute('aria-expanded') !== 'true'; min.setAttribute('aria-expanded', open); min.textContent = open ? '−' : '+'; body.hidden = !open; el.classList.toggle('collapsed', !open); };
  let drag;
  bar.onpointerdown = e => { if (e.target.closest('button')) return; drag = [e.clientX - el.offsetLeft, e.clientY - el.offsetTop]; bar.setPointerCapture(e.pointerId); };
  bar.onpointermove = e => {
    if (!drag) return;
    el.style.left = Math.max(0, Math.min(e.clientX - drag[0], innerWidth - 60)) + 'px';
    el.style.top = Math.max(0, Math.min(e.clientY - drag[1], innerHeight - 30)) + 'px';
  };
  bar.onpointerup = () => { if (drag) save(id, { x: el.offsetLeft, y: el.offsetTop }); drag = null; };
  bar.tabIndex = 0; // arrow keys move the window too, as in index.html
  bar.onkeydown = e => {
    const d = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[e.key];
    if (!d || e.target !== bar) return;
    e.preventDefault(); el.style.left = el.offsetLeft + d[0] + 'px'; el.style.top = el.offsetTop + d[1] + 'px'; save(id, { x: el.offsetLeft, y: el.offsetTop });
  };
  return { el, body, show: () => { el.hidden = false; el.style.zIndex = ++top; }, hide: () => { el.hidden = true; } };
}
