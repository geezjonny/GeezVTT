export const isGM = new URLSearchParams(location.search).get('gm') === 'jonny';
document.documentElement.dataset.role = isGM ? 'gm' : 'player';
