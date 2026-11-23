// These paired endpoints also provide the connection model for stairs.
export function importedPortals(value) {
  if (!Array.isArray(value)) return [];
  const ids = new Set();
  return value.flatMap(portal => {
    if (!portal || typeof portal.id !== 'string' || !portal.id || ids.has(portal.id) ||
        typeof portal.pairId !== 'string' || !portal.pairId ||
        !Number.isFinite(portal.x) || !Number.isFinite(portal.y)) return [];
    ids.add(portal.id);
    return [{ id: portal.id, pairId: portal.pairId, x: portal.x, y: portal.y }];
  });
}

export function portalDestination(entries, source) {
  const matches = entries.filter(({ portal }) => portal.pairId === source.pairId);
  return matches.length === 2 && matches.filter(({ portal }) => portal.id === source.id).length === 1
    ? matches.find(({ portal }) => portal.id !== source.id) : undefined;
}
