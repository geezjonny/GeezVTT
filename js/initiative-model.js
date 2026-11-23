export function initiativeState(value, tokens) {
  const ids = new Set();
  const entries = (Array.isArray(value?.entries) ? value.entries : []).filter(entry => {
    if (!entry || !tokens.some(token => token.id === entry.id) || ids.has(entry.id) || !Number.isSafeInteger(entry.score)) return false;
    ids.add(entry.id);
    return true;
  }).map(({ id, score }) => ({ id, score })).sort((a, b) => b.score - a.score);
  return { entries, currentId: entries.some(entry => entry.id === value?.currentId) ? value.currentId : null };
}

export function initiativeOrder(state) {
  const index = Math.max(0, state.entries.findIndex(entry => entry.id === state.currentId));
  return [...state.entries.slice(index), ...state.entries.slice(0, index)];
}
