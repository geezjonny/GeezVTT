import { importedItems } from './prop-model.js';

export function takeCompartmentItems(pc, chest, itemId, keys) {
  const contents = chest.contents || [];
  if (!Array.isArray(contents) || importedItems(contents).length !== contents.length) throw new Error('Invalid compartment inventory.');
  const items = contents.filter(item => (itemId == null || item.id === itemId) && (item.qty ?? 1) > 0);
  if (!items.length) throw new Error('No items available.');
  if (items.some(item => !/^[a-zA-Z0-9-]{1,100}$/.test(keys[item.id] || '') || Object.hasOwn(pc.inventory || {}, keys[item.id]))) throw new Error('Inventory key conflict; reopen the compartment.');
  const balances = { ...pc.coin_purse };
  for (const item of items.filter(item => item.coin)) {
    const balance = Number(balances[item.coin] ?? 0), qty = itemId == null ? item.qty ?? 1 : 1;
    if (!Number.isSafeInteger(balance) || balance < 0 || !Number.isSafeInteger(balance + qty)) throw new Error('Invalid coin balance.');
    balances[item.coin] = balance + qty;
  }
  pc.inventory = { ...pc.inventory };
  for (const item of items) {
    const qty = itemId == null ? item.qty ?? 1 : 1;
    const { id, ...entry } = item;
    if (item.coin) pc.coin_purse = { ...pc.coin_purse, [item.coin]: Number(pc.coin_purse?.[item.coin] ?? 0) + qty };
    else pc.inventory[keys[id]] = { ...entry, qty };
    item.qty = (item.qty ?? 1) - qty;
  }
  chest.contents = contents.filter(item => (item.qty ?? 1) > 0);
}
