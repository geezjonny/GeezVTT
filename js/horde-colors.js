// Everyone's look and magic use their own colour: Liora green, Lark pink, Ashara orange, Seris purple, Rurik cyan.
// Characters not listed (guests, new PCs) fall back to the colour of their role.
import { normalizeName } from './horde-model.js';

const PEOPLE = {
  liora: { body: '#4f9a58', dark: '#2f6a39', hair: '#6b4b2a', label: '#9be59a', magic: '#5fe07a' },
  lark: { body: '#c0507a', dark: '#7a2f4d', hair: '#2a1a2e', label: '#ff9fc0', magic: '#ff6fa8' },
  ashara: { body: '#d9822b', dark: '#8f4f14', hair: '#5a3a1a', label: '#ffc07a', magic: '#ff9a2e' },
  seris: { body: '#8a52c8', dark: '#55308a', hair: '#9aa5b5', label: '#d2a8ff', magic: '#b36bff' },
  rurik: { body: '#3f9eb0', dark: '#256270', hair: '#e8e8f0', label: '#9fe8f5', magic: '#4fe0ff' },
  kairon: { body: '#c4504a', dark: '#7e2a26', hair: '#3a2a22', label: '#ff9d96', magic: '#ff6a5f' } // red, so he is never mistaken for anyone else
};
const ROLES = {
  tank: { body: '#8a52c8', dark: '#55308a', hair: '#9aa5b5', label: '#d2a8ff', magic: '#b36bff' },
  striker: PEOPLE.liora, cutter: PEOPLE.lark, simon: PEOPLE.ashara, pitch: PEOPLE.rurik,
  healer: { body: '#e6e0cc', dark: '#a9a28a', hair: '#e5c46a', label: '#fff3b0', magic: '#fff3b0' },
  support: { body: '#8c5bc0', dark: '#593a80', hair: '#3c2a52', label: '#d9b3ff', magic: '#d9b3ff' }
};
export const personColors = (name, role) => PEOPLE[normalizeName(name)] || ROLES[role] || ROLES.striker;

const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
// Blend `hex` toward `other` (t = 0 is hex, 1 is other); both are #rrggbb.
export function mix(hex, other, t) {
  const a = channels(hex), b = channels(other);
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
export const rgba = (hex, alpha) => `rgba(${channels(hex).join(',')},${alpha})`;
