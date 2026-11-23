import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tokenIcon } from './token-model.js';

// One kit per map build; the map renderer disposes the shared meshes and materials.
export function createTokenMiniKit() {
  const templates = new Map();
  return icon => {
    icon = tokenIcon(icon);
    if (!templates.has(icon)) templates.set(icon, buildMini(icon));
    return templates.get(icon).clone(true);
  };
}

function buildMini(icon) {
  const pc = icon;
  icon = { lark: 'bard', liora: 'ranger', ashara: 'cleric', rurik: 'bard', seris: 'fighter' }[pc] || icon;
  const shapes = {
    sphere: new THREE.SphereGeometry(1, 12, 8),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 12),
    cone: new THREE.CylinderGeometry(.65, 1, 1, 12),
    point: new THREE.ConeGeometry(1, 1, 12),
    box: new THREE.BoxGeometry(1, 1, 1),
    ring: new THREE.TorusGeometry(1, .12, 6, 16)
  };
  const colors = {
    base: '#293747', cloth: '#673c85', cape: '#a33051', leather: '#493026',
    skin: '#e3ac7e', hair: '#633c28', gold: '#d6ad54', wood: '#a45d30',
    face: '#efd29a', dark: '#211b23', feather: '#69c9bb', glass: '#d4f1f3'
  };
  const robes = { generic: '#60758c', fighter: '#7e8995', hunter: '#6b7540', druid: '#527846', wizard: '#385bb0', sorcerer: '#a63854', monk: '#d39547', rogue: '#424354', barbarian: '#956b4b', cleric: '#d4cbb1', paladin: '#bcc6d0', ranger: '#3f6850', warlock: '#563768', artificer: '#997347' };
  colors.cloth = robes[icon] || colors.cloth;
  if (pc === 'lark') Object.assign(colors, { cloth: '#74243c', cape: '#74243c', hair: '#663c28' });
  if (pc === 'liora') Object.assign(colors, { cape: '#315c38', leather: '#315c38', hair: '#633c28' });
  if (pc === 'ashara') Object.assign(colors, { hair: '#ff641b', feather: '#ffc340', skin: '#d58a5a', cloth: '#eee2c7', cape: '#a14926' });
  if (pc === 'rurik') Object.assign(colors, { hair: '#b83e23', feather: '#fff0cc', face: '#d99828' });
  if (pc === 'seris') Object.assign(colors, { hair: '#873cba', face: '#17131e', cape: '#403247' });
  const height = pc === 'lark' ? .72 : pc === 'rurik' ? .78 : 1;
  const width = pc === 'rurik' ? 1.2 : pc === 'lark' ? .9 : 1;
  const bodyMatrix = new THREE.Matrix4().compose(new THREE.Vector3(0, .085 * (1 - height), 0),
    new THREE.Quaternion(), new THREE.Vector3(width, height, width));
  const parts = Object.fromEntries(Object.keys(colors).map(role => [role, []]));
  function part(shape, role, x, y, z, sx, sy, sz, tilt = 0) {
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt),
      new THREE.Vector3(sx, sy, sz));
    const geometry = shapes[shape].clone().applyMatrix4(matrix);
    if (y > .085) geometry.applyMatrix4(bodyMatrix);
    parts[role].push(geometry);
  }
  function rod(role, a, b, radius) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    const matrix = new THREE.Matrix4().compose(start.add(end).multiplyScalar(.5),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()),
      new THREE.Vector3(radius, direction.length(), radius));
    parts[role].push(shapes.cylinder.clone().applyMatrix4(matrix).applyMatrix4(bodyMatrix));
  }

  part('cylinder', 'base', 0, .04, 0, .37, .08, .37);
  part('cylinder', 'gold', 0, .078, 0, .37, .014, .37);
  // A planted stance, tall boots, flared tunic, and a cape behind the shoulders.
  for (const side of [-1, 1]) {
    part('sphere', 'leather', side * .12, .135, .055, .085, .055, .14);
    rod('leather', [side * .12, .16, 0], [side * .105, .36, -.015], .068);
    rod('cloth', [side * .105, .34, -.015], [side * .075, .56, 0], .07);
    part('cylinder', 'gold', side * .105, .34, -.015, .072, .025, .072);
  }
  if (!['generic', 'monk', 'barbarian'].includes(icon)) part('cone', 'cape', 0, .64, -.12, .24, .53, .085);
  part('cone', 'cloth', 0, .55, 0, .2, .22, .13);
  part('cone', 'cloth', 0, .74, 0, .19, .29, .13, Math.PI);
  part('cylinder', 'leather', 0, .62, 0, .177, .055, .138);
  part('box', 'gold', 0, .62, .145, .065, .05, .025);
  part('sphere', 'gold', -.1, .86, .105, .025, .025, .02);
  part('cylinder', 'skin', 0, .93, 0, .055, .09, .055);
  part('sphere', pc === 'rurik' ? 'skin' : 'hair', 0, 1.035, -.015, .126, .145, .115);
  part('sphere', 'skin', 0, 1.025, .035, .105, .12, .095);
  part('sphere', 'skin', 0, 1.025, .128, .025, .032, .027);
  for (const side of [-1, 1]) {
    part('sphere', 'dark', side * .04, 1.055, .12, .012, .014, .009);
    if (pc !== 'rurik') part('sphere', 'hair', side * .1, .99, -.01, .04, .1, .065);
  }
  if (['lark', 'liora', 'ashara', 'seris'].includes(pc)) {
    for (const side of [-1, 1]) part('sphere', 'hair', side * .1, .93, -.065, .055, .18, .07);
  }
  if (pc === 'liora' || pc === 'lark') {
    for (const side of [-1, 1]) part('point', 'skin', side * .12, 1.035, .015, .035, .12, .035, -side * .9);
  }
  if (pc === 'lark') {
    part('sphere', 'cloth', -.025, 1.15, -.015, .19, .065, .15, -.2);
    part('cylinder', 'cloth', 0, 1.12, 0, .125, .035, .11);
    part('sphere', 'gold', .12, 1.15, .07, .025, .025, .015);
    rod('leather', [.26, .59, .13], [.26, .74, .13], .018);
    part('ring', 'gold', .26, .74, .13, .055, .055, .035);
    rod('face', [.26, .75, .13], [.26, 1.3, .13], .008);
    part('sphere', 'wood', -.12, .65, -.23, .11, .15, .055);
    rod('wood', [-.12, .72, -.23], [-.2, 1.03, -.23], .025);
  }
  if (pc === 'rurik') {
    part('cone', 'hair', 0, .86, .115, .13, .27, .085);
    for (const side of [-1, 1]) part('sphere', 'hair', side * .05, .99, .132, .065, .027, .035, side * .2);
    part('ring', 'gold', -.04, 1.055, .135, .033, .033, .016);
    rod('gold', [-.07, 1.04, .13], [-.12, .8, .13], .004);
    part('cylinder', 'glass', .26, .77, .17, .08, .22, .08);
    part('cylinder', 'face', .26, .76, .17, .065, .18, .065);
    part('cylinder', 'feather', .26, .875, .17, .077, .025, .077);
    part('ring', 'glass', .35, .77, .17, .055, .065, .035);
    part('sphere', 'wood', -.08, .66, -.24, .14, .18, .07);
    rod('wood', [-.08, .78, -.24], [-.2, 1.08, -.24], .028);
    rod('gold', [-.08, .66, -.315], [-.2, 1.08, -.315], .004);
  }
  if (pc === 'ashara') {
    for (const [x, y, z, size] of [[-.09, 1.22, -.03, .24], [0, 1.28, -.04, .34], [.09, 1.21, -.02, .23]]) {
      part('point', 'hair', x, y, z, .065, size, .065, -x * 2);
      part('point', 'feather', x, y - .035, z + .035, .03, size * .65, .03, -x * 2);
    }
    part('box', 'cape', -.07, .65, .14, .065, .4, .025);
    part('box', 'cape', .07, .65, .14, .065, .4, .025);
    part('box', 'gold', 0, .79, .155, .025, .1, .015);
    part('box', 'gold', 0, .81, .155, .07, .025, .015);
  }
  if (icon === 'bard' && pc !== 'lark' && pc !== 'rurik') {
  part('cylinder', 'cloth', 0, 1.14, 0, .23, .035, .18, -.12);
  part('cone', 'cloth', -.025, 1.205, -.01, .14, .15, .115, .2);
  part('cylinder', 'gold', -.018, 1.16, -.01, .143, .028, .12, .2);
  rod('gold', [.11, 1.17, 0], [.21, 1.43, 0], .009);
  part('sphere', 'feather', .18, 1.335, 0, .042, .13, .018, -.38);

  // The lute and arms share a diagonal playing pose, facing +Z.
  part('sphere', 'wood', -.045, .69, .19, .15, .18, .085, -.35);
  part('sphere', 'face', -.045, .69, .255, .13, .16, .018, -.35);
  part('sphere', 'dark', -.02, .745, .274, .036, .036, .006);
  rod('wood', [0, .79, .22], [.245, 1.02, .22], .032);
  rod('dark', [0, .79, .254], [.245, 1.02, .254], .019);
  part('box', 'wood', .255, 1.035, .225, .07, .095, .045, -.8);
  part('box', 'leather', -.08, .635, .277, .085, .025, .015, -.35);
  for (const offset of [-.012, 0, .012]) {
    rod('gold', [-.08 + offset, .64, .287], [.25 + offset, 1.035, .278], .002);
    part('sphere', 'gold', .25 + offset * 4, 1.045 - offset * 3, .225, .014, .014, .035);
  }
  }
  const staff = ['druid', 'wizard', 'sorcerer', 'warlock', 'cleric'].includes(icon);
  const archer = ['hunter', 'ranger'].includes(icon);
  if (staff) {
    part('cone', 'cloth', 0, .48, 0, .22, .67, .16);
    rod('wood', [.27, .12, .12], [.27, 1.26, .12], .022);
    if (icon === 'cleric') {
      rod('gold', [.27, 1.08, .12], [.27, 1.36, .12], .025);
      rod('gold', [.17, 1.27, .12], [.37, 1.27, .12], .025);
    } else {
      part('sphere', icon === 'druid' ? 'feather' : icon === 'warlock' ? 'cape' : 'gold', .27, 1.29, .12, .065, .085, .065);
    }
    if (icon === 'wizard') {
      part('cylinder', 'cloth', 0, 1.13, 0, .2, .025, .17);
      part('point', 'cloth', -.015, 1.29, 0, .145, .35, .13, .12);
    }
    if (icon === 'druid') for (const side of [-1, 1]) {
      rod('wood', [side * .08, 1.13, 0], [side * .16, 1.3, 0], .018);
      rod('wood', [side * .16, 1.3, 0], [side * .23, 1.35, 0], .013);
      rod('wood', [side * .16, 1.3, 0], [side * .13, 1.39, 0], .013);
    }
  }
  if (archer) {
    const curve = [[.25, .33, .13], [.36, .48, .13], [.39, .72, .13], [.36, .96, .13], [.25, 1.11, .13]];
    for (let i = 1; i < curve.length; i++) rod('wood', curve[i - 1], curve[i], .018);
    rod('face', curve[0], curve[4], .004);
    rod('leather', [-.13, .56, -.17], [-.13, 1.06, -.17], .055);
    for (const x of [-.16, -.12, -.08]) rod('wood', [x, .8, -.17], [x, 1.18, -.17], .006);
  }
  if (['fighter', 'paladin', 'barbarian', 'rogue'].includes(icon)) {
    const dagger = icon === 'rogue', axe = icon === 'barbarian';
    rod('leather', [.26, .56, .13], [.26, .73, .13], .022);
    part('box', 'gold', .26, .75, .13, .15, .025, .045);
    part('point', 'face', .26, dagger ? .86 : 1.01, .13, .045, dagger ? .22 : .5, .015);
    if (axe) part('sphere', 'face', .31, 1.14, .13, .14, .1, .025);
    if (!dagger && !axe) {
      part('sphere', 'cloth', -.25, .69, .14, .15, .2, .045);
      part('sphere', 'gold', -.25, .69, .185, .035, .035, .015);
      if (pc !== 'seris') part('sphere', 'cloth', 0, 1.12, 0, .135, .09, .12);
      if (icon === 'paladin') {
        part('box', 'gold', -.25, .69, .19, .025, .24, .012);
        part('box', 'gold', -.25, .73, .19, .15, .025, .012);
      }
    }
    if (dagger) part('sphere', 'cloth', 0, 1.08, -.04, .15, .16, .12);
  }
  if (icon === 'monk') {
    part('cylinder', 'cape', 0, .63, 0, .18, .055, .14);
    rod('wood', [-.29, .14, .13], [-.29, 1.23, .13], .022);
    for (const side of [-1, 1]) part('cylinder', 'face', side * .25, .68, .12, .047, .11, .047);
  }
  if (icon === 'artificer') {
    part('box', 'leather', 0, .69, -.2, .25, .28, .16);
    for (const side of [-1, 1]) {
      part('sphere', 'gold', side * .055, 1.07, .124, .045, .045, .018);
      part('sphere', 'feather', side * .055, 1.07, .142, .03, .03, .01);
    }
    rod('wood', [.26, .57, .13], [.26, .99, .13], .023);
    part('box', 'gold', .26, 1, .13, .18, .095, .09);
  }
  for (const [shoulder, elbow, hand] of icon === 'bard' && pc !== 'lark' && pc !== 'rurik' ? [
    [[-.17, .85, 0], [-.25, .71, .1], [-.07, .71, .29]],
    [[.17, .85, 0], [.28, .77, .11], [.19, .95, .26]]
  ] : [
    [[-.17, .85, 0], [-.25, .74, .04], [-.26, .66, .13]],
    [[.17, .85, 0], [.25, .74, .04], [.26, .67, .13]]
  ]) {
    part('sphere', 'cloth', ...shoulder, .09, .1, .09);
    rod('cloth', shoulder, elbow, .065);
    rod('skin', elbow, hand, .04);
    part('sphere', 'skin', ...hand, .045, .045, .035);
  }

  const template = new THREE.Group();
  for (const [role, geometries] of Object.entries(parts)) {
    if (!geometries.length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(geometries), new THREE.MeshStandardMaterial({
      color: colors[role], roughness: role === 'gold' ? .4 : role === 'glass' ? .1 : .85, metalness: role === 'gold' ? .65 : 0,
      transparent: role === 'glass', opacity: role === 'glass' ? .35 : 1,
      emissive: pc === 'ashara' && ['hair', 'feather'].includes(role) ? colors[role] : '#000000',
      emissiveIntensity: .5
    }));
    mesh.castShadow = mesh.receiveShadow = true;
    template.add(mesh);
    geometries.forEach(geometry => geometry.dispose());
  }
  Object.values(shapes).forEach(geometry => geometry.dispose());
  return template;
}
