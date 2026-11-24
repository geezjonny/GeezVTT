import { PROPS, propDimensions } from './prop-model.js';

const node = (tag, attrs) => {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
};
export function propIcon(kind, color = PROPS[kind].color) {
  const prop = PROPS[kind];
  const svg = node('svg', { viewBox: '0 0 24 24', width: 24, height: 24, 'aria-hidden': true, focusable: false });
  svg.append(node('path', { d: prop.path, fill: 'none', stroke: color, 'stroke-width': 1.6,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  return svg;
}
export function propMarker(prop) {
  const { width, depth } = propDimensions(prop);
  const group = node('g', { transform: `translate(${prop.x} ${prop.y}) rotate(${prop.rotation}) scale(${prop.size})` });
  group.append(node('rect', { x: -width/2, y: -depth/2, width, height: depth, rx: .04,
    fill: '#15191f', 'fill-opacity': .65, stroke: '#ffffff30', 'stroke-width': .025 }));
  const kind=prop.icon?.startsWith('prop:') && Object.hasOwn(PROPS,prop.icon.slice(5))?prop.icon.slice(5):prop.kind;
  const icon = propIcon(kind, ['torch','brazier'].includes(kind) ? prop.lightColor : ['lever','button','pressurePlate'].includes(kind) && prop.open ? '#7ee09a' : undefined);
  for (const [key, value] of Object.entries({ x: -width/2, y: -depth/2, width, height: depth, preserveAspectRatio: 'none' })) icon.setAttribute(key, value);
  group.append(icon);
  return group;
}
