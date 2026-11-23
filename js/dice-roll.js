// Roll results are independent of the optional 3D presentation.
export function randomDie(sides) {
  const limit = Math.floor(0x100000000 / sides) * sides;
  const value = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(value); } while (value[0] >= limit);
  return value[0] % sides + 1;
}

export function buildRoll({ sides, count, modifier, mode }, random = randomDie) {
  if (![4, 6, 8, 10, 12, 20, 100].includes(sides) ||
      !Number.isInteger(count) || count < 1 || count > (sides === 100 ? 6 : 12) ||
      !Number.isInteger(modifier) || Math.abs(modifier) > 999 ||
      !['normal', 'advantage', 'disadvantage'].includes(mode) ||
      (mode !== 'normal' && (sides !== 20 || count !== 1))) {
    throw new Error('Choose up to 12 dice (6 for d100). Advantage and disadvantage use one d20.');
  }
  const dice = Array.from({ length: mode === 'normal' ? count : 2 }, () => ({ s: sides, v: random(sides) }));
  if (mode !== 'normal') {
    const keepFirst = mode === 'advantage' ? dice[0].v >= dice[1].v : dice[0].v <= dice[1].v;
    dice[keepFirst ? 1 : 0].drop = true;
  }
  const kept = dice.filter(d => !d.drop);
  const total = kept.reduce((sum, d) => sum + d.v, modifier);
  const suffix = modifier ? ` ${modifier > 0 ? '+' : '-'} ${Math.abs(modifier)}` : '';
  const label = `${count}d${sides}${suffix}${mode === 'normal' ? '' : ` (${mode})`}`;
  const sub = dice.map(d => `${d.v}${d.drop ? ' dropped' : ''}`).join(', ');
  const natural = sides === 20 && count === 1 ? kept[0].v : null;
  return { dice, total, label, sub, cls: natural === 20 ? 'crit' : natural === 1 ? 'bad' : '', color: '#8b1e2b' };
}
