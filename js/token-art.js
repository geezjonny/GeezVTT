let filenames = [];
export const imageName = value => String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
export function tokenImage(token) {
  const name = imageName(token.imageName || token.name);
  if (!name || /[/\\?#]/.test(name) || name.includes('..')) return '';
  const file = filenames.find(file => imageName(file) === name || imageName(file.replace(/\.[^.]+$/, '')) === name) || (/\.(png|webp|jpe?g|gif|avif|svg)$/i.test(name) ? name : `${name}.png`);
  return `token/${encodeURIComponent(file)}`;
}
let catalog;
export function tokenImages() {
  return catalog ||= fetch('token/index.json', { cache: 'no-cache' }).then(async response => {
    if (!response.ok) throw new Error(`Token images unavailable (${response.status}).`);
    const names = await response.json();
    if (!Array.isArray(names) || names.some(name => typeof name !== 'string' || /[/\\?#]/.test(name) || name.includes('..') || !/\.(png|webp|jpe?g|gif|avif|svg)$/i.test(name))) throw new Error('Invalid token image catalog.');
    filenames = names;
    globalThis.window?.dispatchEvent(new Event('token-art-ready'));
    return names;
  }).catch(error => { catalog = null; throw error; });
}
