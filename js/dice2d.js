// Animated 2D dice: same tray interface as the old 3D version (throwGroup / clear / destroy), no WebGL or libraries.
// Each die is an SVG shape that tumbles in, shows rolling numbers, lands with a small thud, then the total appears.
const SHAPES = {
  4: '50,8 94,86 6,86',
  6: '14,14 86,14 86,86 14,86',
  8: '50,4 94,50 50,96 6,50',
  10: '50,4 92,40 50,96 8,40',
  12: '50,5 95,38 78,92 22,92 5,38',
  20: '50,4 92,27 92,73 50,96 8,73 8,27',
  100: '50,4 92,40 50,96 8,40'
};
// Light facet lines so each shape reads as a polyhedral die, not a flat badge.
const FACETS = {
  4: 'M50 8 L50 86 M50 50 L94 86 M50 50 L6 86',
  6: 'M14 14 L30 30 M86 14 L70 30 M86 86 L70 70 M14 86 L30 70 M30 30 H70 V70 H30 Z',
  8: 'M6 50 H94 M50 4 L50 96',
  10: 'M50 4 L50 96 M8 40 L92 40',
  12: 'M50 5 L50 30 M95 38 L72 46 M78 92 L64 68 M22 92 L36 68 M5 38 L28 46 M50 30 L72 46 L64 68 H36 L28 46 Z',
  20: 'M50 22 L78 70 L22 70 Z M50 4 L50 22 M92 27 L78 70 M92 73 L78 70 M50 96 L22 70 M8 73 L22 70 M8 27 L50 22 M92 27 L50 22',
  100: 'M50 4 L50 96 M8 40 L92 40'
};
export function diePoints(sides) { return SHAPES[sides] || SHAPES[6]; }
export function dieFacets(sides) { return FACETS[sides] || FACETS[6]; }

const STYLE = `.d2-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:10px;padding-bottom:12%}
.d2-group{display:flex;flex-direction:column;align-items:center;gap:6px}
.d2-row{display:flex;flex-wrap:wrap;justify-content:center;gap:12px;max-width:min(92vw,40rem)}
.d2-die{position:relative;width:64px;height:64px;filter:drop-shadow(0 6px 5px #0008);will-change:transform}
.d2-die svg{display:block;width:100%;height:100%;overflow:visible}
.d2-die .body{fill:var(--die,#8b1e2b);stroke:var(--die-edge,#e8c98a);stroke-width:5;stroke-linejoin:round}
.d2-die .shine{fill:none;stroke:#fff;stroke-opacity:.22;stroke-width:2;stroke-linejoin:round}
.d2-die .num{position:absolute;inset:0;display:grid;place-items:center;font:900 24px/1 Georgia,serif;color:#fff7e0;text-shadow:0 2px 3px #000b}
.d2-die.small .num{font-size:20px}
.d2-die.dropped{opacity:.4;filter:grayscale(.8) drop-shadow(0 4px 4px #0008)}
.d2-die.crit .body{stroke:#ffd86b;stroke-width:7}.d2-die.crit{filter:drop-shadow(0 0 10px #ffd86b) drop-shadow(0 6px 5px #0008)}
.d2-die.bad .body{fill:#3a1014;stroke:#e2574c}.d2-die.bad .num{color:#ffb4ac}
.d2-tag{text-align:center;color:#fff;text-shadow:0 2px 4px #000;white-space:nowrap;animation:d2in .25s ease-out}
.d2-tag .who{font:600 12px system-ui}.d2-tag .num{font:900 30px/1 Georgia,serif}.d2-tag .how{font:11px system-ui;color:#d2cbbf}
.d2-tag .num.ok{color:#7fd69a}.d2-tag .num.bad{color:#e2574c}.d2-tag .num.crit{color:#ffd86b}
@keyframes d2in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.d2-tag{animation:none}}`;

const rand = (a, b) => a + Math.random() * (b - a);
const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function createDiceTray2D(container) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  const layer = document.createElement('div');
  layer.className = 'd2-layer';
  container.append(style, layer);
  let destroyed = false, generation = 0, queue = Promise.resolve();
  const timers = new Set(), pending = new Set();

  function buildDie(d, color) {
    const el = document.createElement('div');
    el.className = 'd2-die' + (d.drop ? ' dropped' : '');
    if (color) el.style.setProperty('--die', color);
    el.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><polygon class="body" points="${diePoints(d.s)}"/><path class="shine" d="${dieFacets(d.s)}"/></svg><span class="num"></span>`;
    return el;
  }

  function tumble(el, d, delay) {
    const num = el.querySelector('.num'), final = String(d.v);
    return new Promise((resolve) => {
      const land = () => {
        num.textContent = final;
        if (!d.drop && d.s === 20 && d.v === 20) el.classList.add('crit');
        if (!d.drop && d.s === 20 && d.v === 1) el.classList.add('bad');
        el.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.14)' }, { transform: 'scale(1)' }], { duration: 180, easing: 'ease-out' });
        resolve();
      };
      if (reduced() || !el.animate) { land(); return; }
      const sx = rand(-220, 220), sy = rand(160, 300), turns = (Math.random() < .5 ? -1 : 1) * rand(540, 900);
      const ms = rand(850, 1150);
      const anim = el.animate([
        { transform: `translate(${sx}px,${-sy}px) rotate(${turns}deg) scale(.5)`, opacity: 0 },
        { transform: `translate(${sx * .3}px,${-sy * .02}px) rotate(${turns * .5}deg) scale(1.15)`, opacity: 1, offset: .42 },
        { transform: `translate(${sx * .12}px,${-sy * .3}px) rotate(${turns * .22}deg) scale(1)`, offset: .66 },
        { transform: `translate(${sx * .03}px,${-sy * .05}px) rotate(${turns * .06}deg) scale(1)`, offset: .84 },
        { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 }
      ], { duration: ms, delay, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'both' });
      const cycle = setInterval(() => { num.textContent = String(1 + Math.floor(Math.random() * Math.max(2, d.s === 100 ? 100 : d.s))); }, 70);
      timers.add(cycle);
      anim.addEventListener('finish', () => { clearInterval(cycle); timers.delete(cycle); land(); });
      anim.addEventListener('cancel', () => { clearInterval(cycle); timers.delete(cycle); resolve(); });
    });
  }

  function tag(g) {
    const el = document.createElement('div');
    el.className = 'd2-tag';
    for (const [name, value] of [['who', g.label], ['num', g.total], ['how', g.sub]]) {
      if (value == null || value === '') continue;
      const line = document.createElement('div');
      line.className = name + (name === 'num' && ['ok', 'bad', 'crit'].includes(g.cls) ? ` ${g.cls}` : '');
      line.textContent = String(value);
      el.appendChild(line);
    }
    return el;
  }

  async function launch(groups) {
    const jobs = [];
    for (const g of groups) {
      const wrap = document.createElement('div'), row = document.createElement('div');
      wrap.className = 'd2-group'; row.className = 'd2-row';
      wrap.appendChild(row); layer.appendChild(wrap);
      const dice = g.dice || [];
      const runs = dice.map((d, i) => {
        const el = buildDie(d, g.color);
        if (dice.length > 6) el.classList.add('small');
        row.appendChild(el);
        return tumble(el, d, i * 90);
      });
      const job = Promise.all(runs).then(() => { if (!destroyed) wrap.appendChild(tag(g)); });
      pending.add(job); jobs.push(job);
    }
    await Promise.all(jobs);
    jobs.forEach((j) => pending.delete(j));
  }

  function throwGroup(groups) {
    const token = generation;
    const task = queue.then(() => {
      if (destroyed || token !== generation) return;
      return launch(Array.isArray(groups) ? groups : []);
    });
    queue = task.catch(() => {});
    return task;
  }
  function clear() {
    generation++;
    timers.forEach(clearInterval); timers.clear();
    layer.replaceChildren();
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clear();
    style.remove(); layer.remove();
  }
  return { throwGroup, clear, destroy };
}
