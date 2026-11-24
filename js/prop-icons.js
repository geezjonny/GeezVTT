import { PROPS, propDimensions } from './prop-model.js';
import { PROP_COLOR_PARTS, PROP_COLORS, objectColors } from './object-appearance.js';

const node = (tag, attrs) => {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
};
export function propIcon(kind, color = PROPS[kind].color, colors = {}) {
  const prop = PROPS[kind];
  color=colors[PROP_COLOR_PARTS[kind]?.[0]] || color;
  const svg = node('svg', { viewBox: '0 0 24 24', width: 24, height: 24, 'aria-hidden': true, focusable: false });
  const tree=['tree','pine'].includes(kind), crystal=kind==='crystalObelisk';
  const path=tree?prop.path.split(' M12')[0]:crystal?prop.path.split('M3 20')[0]:prop.path;
  svg.append(node('path', { d: path, fill: tree || crystal?color:'none','fill-opacity':.2, stroke: color, 'stroke-width': 1.6,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  if(tree || crystal) svg.append(node('path',{d:tree?'M12 13v10':'M3 20v3h18v-3',fill:'none',stroke:tree?colors.wood || PROP_COLORS.wood:colors.stone || PROP_COLORS.stone,'stroke-width':1.8}));
  return svg;
}
export function propMarker(prop) {
  const { width, depth } = propDimensions(prop);
  const group = node('g', { transform: `translate(${prop.x} ${prop.y}) rotate(${prop.rotation}) scale(${prop.size})` });
  group.append(node('rect', { x: -width/2, y: -depth/2, width, height: depth, rx: .04,
    fill: '#15191f', 'fill-opacity': .65, stroke: '#ffffff30', 'stroke-width': .025 }));
  const kind=prop.icon?.startsWith('prop:') && Object.hasOwn(PROPS,prop.icon.slice(5))?prop.icon.slice(5):prop.kind;
  const icon = propIcon(kind, PROPS[kind].light ? prop.lightColor : ['lever','button','pressurePlate'].includes(kind) && prop.open ? '#7ee09a' : undefined, objectColors(prop.colors));
  for (const [key, value] of Object.entries({ x: -width/2, y: -depth/2, width, height: depth, preserveAspectRatio: 'none' })) icon.setAttribute(key, value);
  group.append(icon);
  return group;
}
