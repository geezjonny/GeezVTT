export function livePatch(before, after) {
  const patch = {};
  if (before.initiative !== after.initiative) patch.initiative = after.initiative;
  if (before.freeRoam !== after.freeRoam) patch.freeRoam = after.freeRoam === true;
  for (const key of new Set([...Object.keys(before.map), ...Object.keys(after.map)])) {
    if (JSON.stringify(before.map[key]) !== JSON.stringify(after.map[key])) patch[`map/${key}`] = after.map[key] ?? null;
  }
  return patch;
}
