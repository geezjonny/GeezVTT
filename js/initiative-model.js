import { equippedName } from './inventory-model.js';

export function initiativeState(value, tokens) {
  const ids = new Set();
  const entries = (Array.isArray(value?.entries) ? value.entries : []).filter(entry => {
    if (!entry || !tokens.some(token => token.id === entry.id) || ids.has(entry.id) || !Number.isSafeInteger(entry.score)) return false;
    ids.add(entry.id);
    return true;
  }).map(({ id, score }) => ({ id, score })).sort((a, b) => b.score - a.score);
  const currentId = entries.some(entry => entry.id === value?.currentId) ? value.currentId : null;
  const state = { entries, currentId };
  if (Array.isArray(value?.completedIds)) state.completedIds = [...new Set(value.completedIds.filter(id => tokens.some(token => token.id === id)))];
  const turn = value?.turn;
  if (currentId && turn?.tokenId === currentId && typeof turn.id === 'string' &&
      Number.isFinite(turn.movementSpent) && turn.movementSpent >= 0) {
    state.turn = { id: turn.id, tokenId: currentId, movementSpent: turn.movementSpent,
      action: turn.action === true, bonus: turn.bonus === true, item: turn.item === true,
      firstTurn: turn.firstTurn === true, attacking: turn.attacking === true,
      attacksUsed: Number.isSafeInteger(turn.attacksUsed) && turn.attacksUsed >= 0 ? turn.attacksUsed : 0 };
  }
  return state;
}

export function initiativeOrder(state) {
  const index = Math.max(0, state.entries.findIndex(entry => entry.id === state.currentId));
  return [...state.entries.slice(index), ...state.entries.slice(0, index)];
}

export function startTurn(state, tokenId) {
  if (state.turn) state.completedIds = [...new Set([...(state.completedIds || []), state.turn.tokenId])];
  state.currentId = tokenId;
  state.turn = { id: crypto.randomUUID(), tokenId, movementSpent: 0, action: false, bonus: false, item: false,
    firstTurn: !state.completedIds?.includes(tokenId), attacking: false, attacksUsed: 0 };
}

export function remainingMovement(map, token) {
  const turn = map?.initiative?.turn;
  return token && !token.overCapacity && turn && turn.tokenId === token.id
    ? Math.max(0, (token.speed ?? 0) + (turn.firstTurn && token.turnFeatures?.dreadAmbusher ? token.turnFeatures.firstTurnSpeedBonus ?? 10 : 0) - turn.movementSpent) : 0;
}

export function takeTurnAction(map, tokenId, turnId, command) {
  const state = map.initiative;
  if (!state?.turn || state.currentId !== tokenId || state.turn.id !== turnId) return false;
  const token = map.tokens.find(token => token.id === tokenId);
  if (command === 'attack') {
    if (!token || state.turn.action && !state.turn.attacking || state.turn.attacksUsed >= attacksPerTurn(map, token)) return false;
    state.turn.action = true; state.turn.attacking = true; state.turn.attacksUsed++;
  } else if (command === 'hunters-mark') {
    if (!token?.turnFeatures?.huntersMark || state.turn.bonus) return false;
    state.turn.bonus = true;
  } else if (command === 'end') {
    const order = initiativeOrder(state);
    startTurn(state, (order[1] || order[0]).id);
  } else if (['action', 'bonus', 'item'].includes(command) && !state.turn[command]) state.turn[command] = true;
  else return false;
  return true;
}

// shortcut: Extra Attack grants two attacks here; extend for higher-level Fighter and other attack-count features when needed.
export function attacksPerTurn(map, token) {
  return (token?.turnFeatures?.extraAttack ? 2 : 1) + (map?.initiative?.turn?.firstTurn && token?.turnFeatures?.dreadAmbusher ? 1 : 0);
}

// shortcut: ordinary 2014 equipment interactions; add feat-specific exceptions when those features are supported.
export function equipmentTurnCost(map, tokenId, pc, action) {
  const turn = map.initiative?.turn;
  if (!turn || map.initiative.currentId !== tokenId || turn.tokenId !== tokenId) throw new Error('Wait for your turn to change equipment.');
  const current = equippedName(pc, action.slot);
  const next = action.key ? pc.inventory?.[action.key]?.name : '';
  if (current === next && (action.slot !== 'card' || !pc.equipped?.card_key || pc.equipped.card_key === action.key)) return { item: false, action: false };
  if (action.slot === 'armor') throw new Error('Donning or doffing armor takes longer than one turn.');
  const interactions = Number(!!current) + Number(!!next);
  if (action.slot === 'shield') {
    if (turn.action || interactions > 1) throw new Error('Donning or doffing a shield requires an available action.');
    return { item: false, action: true };
  }
  const free = !turn.item && interactions > 0;
  const remaining = interactions - Number(free);
  if (remaining > 1 || remaining && turn.action) throw new Error('Not enough object interactions or actions to change equipment.');
  return { item: free, action: remaining > 0 };
}
