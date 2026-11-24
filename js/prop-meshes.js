import * as THREE from 'three';
import { PROP_COLORS, objectColors } from './object-appearance.js';

// One kit per map build; the renderer owns disposal of the shared resources.
export function createPropKit() {
  const materials = new Map(), geometries = new Map();
  const colors = PROP_COLORS;
  function material(role, lightColor, overrides={}) {
    const fire = role === 'flame' || role === 'core';
    const value=overrides[role] || (fire && lightColor ? lightColor : colors[role]);
    const color = new THREE.Color(value);
    if (role === 'core' && lightColor && !overrides[role]) color.lerp(new THREE.Color('#ffffff'), .4);
    const key=`${role}:${color.getHexString()}`;
    if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({
      color, roughness: role === 'metal' ? .55 : .9, metalness: role === 'metal' ? .65 : 0,
      ...(fire ? { emissive: color, emissiveIntensity: 1.5 } : {}),
      ...(role==='crystal'?{roughness:.15,metalness:.1,transparent:true,opacity:.8,emissive:color,emissiveIntensity:.3}:{})
    }));
    return materials.get(key);
  }
  function geometry(shape) {
    if (!geometries.has(shape)) geometries.set(shape, shape === 'box' ? new THREE.BoxGeometry(1,1,1) :
      shape === 'sphere' ? new THREE.SphereGeometry(1,8,6) : shape === 'cone' ? new THREE.ConeGeometry(1,1,7) :
      shape === 'crystal' ? new THREE.CylinderGeometry(1,1,1,6) : shape === 'crystalTip' ? new THREE.ConeGeometry(1,1,6) :
      new THREE.CylinderGeometry(1,1,1,10));
    return geometries.get(shape);
  }
  return function propMesh(prop) {
    const group = new THREE.Group();
    const overrides=objectColors(prop.colors);
    const part = (shape, role, x,y,z, sx,sy,sz) => {
      const mesh = new THREE.Mesh(geometry(shape), material(role, prop.lightColor, overrides));
      mesh.position.set(x,y,z); mesh.scale.set(sx,sy,sz);
      mesh.castShadow = !['flame','core'].includes(role); mesh.receiveShadow = mesh.castShadow;
      group.add(mesh);
      return mesh;
    };
    const box = (role,x,y,z,w,h,d) => part('box',role,x,y,z,w,h,d);
    const rod = (role,a,b,radius=.035) => {
      const start=new THREE.Vector3(...a), end=new THREE.Vector3(...b), direction=end.clone().sub(start);
      const mesh=part('cylinder',role,...start.clone().add(end).multiplyScalar(.5).toArray(),radius,direction.length(),radius);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
      return mesh;
    };
    const legs = (width,depth,height,role='wood') => {
      for(const x of [-width/2,width/2]) for(const z of [-depth/2,depth/2]) box(role,x,height/2,z,.09,height,.09);
    };
    const fire = (y,radius) => {
      part('cone','flame',0,y,0,radius,radius*3,radius);
      const tip=part('cone','core',-.03,y-.04,.01,radius*.5,radius*1.8,radius*.5);
      tip.rotation.z=-.16;
    };
    switch(prop.kind) {
      case 'crystalObelisk':
        box('stone',0,.12,0,.85,.24,.85);
        box('stone',0,.29,0,.64,.1,.64);
        part('crystal','crystal',0,1.1,0,.3,1.65,.3);
        part('crystalTip','crystal',0,2.125,0,.3,.4,.3);
        break;
      case 'tree':
      case 'pine':
        rod('wood',[0,0,0],[0,1.8,0],.16);
        if(prop.kind==='pine') {
          for(const y of [1,1.6,2.2]) part('cone','leaves',0,y,0,.8-(y-1)*.3,1.3,.8-(y-1)*.3);
        } else {
          part('sphere','leaves',0,2,0,1,.85,1);
          part('sphere','leaves',-.45,1.7,.2,.55,.6,.6);
        }
        break;
      case 'bush':
        for(const x of [-.24,0,.24]) part('sphere','leaves',x,.3,0,.26,.35,.43);
        break;
      case 'stump':
        part('cylinder','wood',0,.22,0,.32,.44,.32);
        part('cylinder','trim',0,.445,0,.3,.015,.3);
        for(const x of [-.28,.28]) box('wood',x,.07,0,.24,.14,.23);
        break;
      case 'log':
        rod('wood',[-.85,.25,0],[.85,.25,0],.25);
        rod('trim',[-.86,.25,0],[-.85,.25,0],.21);
        rod('trim',[.85,.25,0],[.86,.25,0],.21);
        break;
      case 'rock':
      case 'boulder': {
        const size=prop.kind==='boulder'?1:.44;
        const rock=part('sphere','stone',0,size*.4,0,size*.8,size*.55,size*.65);
        rock.rotation.y=.4; rock.rotation.z=.12;
        break;
      }
      case 'rubble':
        for(let i=0;i<9;i++) {
          const angle=i*2.4, radius=i*.065;
          const stone=box('stone',Math.cos(angle)*radius,.12+(i%3)*.05,Math.sin(angle)*radius,.25,.22,.3);
          stone.rotation.set(i*.23,i*.7,i*.13);
        }
        break;
      case 'barrel':
        part('cylinder','wood',0,.4,0,.35,.8,.35);
        for(const y of [.13,.65]) part('cylinder','metal',0,y,0,.365,.065,.365);
        part('cylinder','trim',0,.81,0,.33,.025,.33);
        break;
      case 'sack':
        part('sphere','cloth',0,.28,0,.34,.32,.31);
        part('cone','cloth',0,.62,0,.13,.16,.13).rotation.z=Math.PI;
        part('cylinder','wood',0,.55,0,.09,.035,.09);
        break;
      case 'cart':
        box('wood',0,.45,0,1,.12,1.3);
        for(const x of [-.48,.48]) box('trim',x,.7,0,.08,.5,1.3);
        for(const z of [-.62,.62]) box('wood',0,.7,z,1,.5,.08);
        for(const x of [-.62,.62]) {
          rod('metal',[x-.04,.3,0],[x+.04,.3,0],.29);
          rod('trim',[x-.05,.3,0],[x+.05,.3,0],.12);
        }
        for(const x of [-.35,.35]) rod('wood',[x,.4,.5],[x,.35,1.3],.04);
        break;
      case 'tent':
        for(const side of [-1,1]) {
          const roof=box('cloth',side*.47,.6,0,1.52,.04,1.9);
          roof.rotation.z=-side*Math.atan2(1.2,.94);
        }
        rod('wood',[0,0,-.9],[0,1.2,-.9],.04);
        rod('wood',[0,0,.9],[0,1.2,.9],.04);
        rod('wood',[0,1.2,-1],[0,1.2,1],.04);
        break;
      case 'campfire':
        rod('wood',[-.4,.12,-.3],[.4,.12,.3],.1);
        rod('wood',[-.4,.12,.3],[.4,.12,-.3],.1);
        fire(.44,.24);
        break;
      case 'candle':
        part('cylinder','wax',0,.18,0,.1,.36,.1);
        fire(.43,.055);
        break;
      case 'fairyLights':
        for(const x of [-.95,.95]) rod('wood',[x,0,0],[x,1.4,0],.025);
        for(let i=0;i<8;i++) {
          const x=-.9+i*1.8/7, y=1.1+.3*(x/.9)**2;
          if(i) { const px=-.9+(i-1)*1.8/7; rod('metal',[px,1.1+.3*(px/.9)**2,0],[x,y,0],.01); }
          part('sphere','core',x,y-.04,0,.045,.065,.045);
        }
        break;
      case 'fireflies':
        for(let i=0;i<9;i++) part('sphere','core',Math.sin(i*2.4)*.55,.2+(i%4)*.2,Math.cos(i*2.4)*.55,.025,.025,.025);
        break;
      case 'signpost':
        rod('wood',[0,0,0],[0,1.4,0],.055);
        box('trim',0,1.15,0,.95,.32,.1);
        break;
      case 'gravestone':
        box('stone',0,.35,0,.65,.7,.18);
        part('sphere','stone',0,.7,0,.325,.25,.09);
        box('coal',0,.53,.095,.24,.035,.012);
        box('coal',0,.51,.095,.035,.27,.012);
        break;
      case 'tripwire': {
        const half = (prop.length ?? 1) / 2;
        for (const x of [-half, half]) {
          box('metal',x,.14,0,.07,.28,.09);
          box('stone',x,.025,0,.15,.05,.16);
        }
        rod('metal',[-half,.13,0],[half,.13,0],.012);
        break;
      }
      case 'pressurePlate':
        box('stone',0,.035,0,1,.07,1);
        box('metal',0,prop.open ? .065 : .095,0,.88,.06,.88);
        for (const x of [-.36,.36]) for (const z of [-.36,.36]) part('sphere','trim',x,.13,z,.025,.012,.025);
        break;
      case 'lever': {
        box('stone',0,.07,0,.6,.14,.6);
        box('metal',0,.19,0,.22,.24,.2);
        const end = [prop.open ? .2 : -.2,.68,0];
        rod('metal',[0,.24,0],end,.04);
        part('sphere','trim',...end,.09,.09,.09);
        break;
      }
      case 'button':
        box('stone',0,.06,0,.5,.12,.5);
        part('cylinder',prop.open ? 'trim' : 'wood',0,prop.open ? .13 : .19,0,.17,.12,.17);
        break;
      case 'crate':
        box('wood',0,.42,0,.86,.84,.86);
        for(const z of [-.44,.44]) {
          for(const x of [-.35,.35]) box('trim',x,.42,z,.1,.84,.045);
          for(const y of [.08,.76]) box('trim',0,y,z,.86,.1,.045);
          const brace=box('trim',0,.42,z,.085,.95,.045); brace.rotation.z=-Math.PI/4;
        }
        for(const x of [-.3,0,.3]) box('trim',x,.85,0,.025,.02,.85);
        break;
      case 'stairs':
        for(let i=0;i<6;i++) {
          const height=(i+1)*.22, z=.84-i/3;
          box('stone',0,height/2,z,1,height,1/3);
          box('trim',0,height+.012,z+.12,1.02,.025,.055);
        }
        break;
      case 'ladder':
        for(const x of [-.26,.26]) rod('wood',[x,.04,.35],[x,1.8,-.35],.045);
        for(let i=0;i<8;i++) {
          const t=(i+.5)/8;
          rod('trim',[-.26,.04+1.76*t,.35-.7*t],[.26,.04+1.76*t,.35-.7*t],.035);
        }
        break;
      case 'chest': {
        box('wood',0,.23,0,.96,.46,.61);
        if(!geometries.has('lid')) {
          const arch=new THREE.Shape();
          arch.moveTo(-.31,0); arch.absarc(0,0,.31,Math.PI,0,true); arch.lineTo(-.31,0);
          const lidGeometry=new THREE.ExtrudeGeometry(arch,{depth:.96,bevelEnabled:false,curveSegments:8});
          lidGeometry.translate(0,0,-.48);
          geometries.set('lid',lidGeometry);
        }
        const lid=new THREE.Mesh(geometries.get('lid'),material('trim',undefined,overrides));
        lid.rotation.y=Math.PI/2; lid.position.y=.46; lid.castShadow=lid.receiveShadow=true; group.add(lid);
        for(const x of [-.34,.34]) {
          box('metal',x,.24,.318,.055,.48,.025);
          box('metal',x,.24,-.318,.055,.48,.025);
          box('metal',x,.47,0,.055,.04,.63);
        }
        box('metal',0,.37,.335,.14,.18,.04);
        box('trim',0,.37,.36,.025,.055,.015);
        break;
      }
      case 'bones':
        for(const [a,b] of [[[-.34,.07,-.28],[.3,.07,.24]],[[-.3,.1,.28],[.34,.1,-.25]]]) {
          rod('bone',a,b,.045);
          for(const p of [a,b]) for(const offset of [-.03,.03]) part('sphere','bone',p[0]+offset,p[1],p[2],.07,.055,.06);
        }
        part('sphere','bone',0,.13,-.25,.14,.12,.16);
        for(const x of [-.055,.055]) part('sphere','coal',x,.17,-.39,.035,.035,.018);
        box('bone',0,.07,-.37,.15,.06,.1);
        break;
      case 'torch':
        part('cylinder','metal',0,.04,0,.16,.08,.16);
        rod('wood',[0,.08,0],[0,1.05,0],.045);
        part('cylinder','metal',0,1.02,0,.1,.18,.1);
        fire(1.24,.15);
        break;
      case 'brazier':
        legs(.48,.48,.42,'metal');
        part('cylinder','metal',0,.43,0,.38,.17,.38);
        part('cylinder','coal',0,.525,0,.32,.025,.32);
        for(let i=0;i<8;i++) {
          const angle=i*Math.PI/4, x=Math.cos(angle)*.34,z=Math.sin(angle)*.34;
          rod('metal',[x,.45,z],[x, .75,z],.025);
        }
        fire(.76,.23);
        break;
      case 'table':
        legs(1.3,.64,.72);
        for(let i=0;i<5;i++) box(i%2?'trim':'wood',0,.77,(i-2)*.176,1.6,.1,.17);
        box('wood',0,.58,0,1.35,.12,.1);
        break;
      case 'chair':
        legs(.46,.46,.42);
        box('wood',0,.46,0,.63,.09,.62);
        for(const x of [-.24,.24]) box('wood',x,.73,-.27,.07,.58,.07);
        for(const y of [.74,.96]) box('trim',0,y,-.27,.55,.09,.07);
        break;
      case 'cobweb': {
        const points=[], center=new THREE.Vector3(0,.035,0);
        for(let i=0;i<8;i++) {
          const angle=i*Math.PI/4;
          points.push(center.clone(),new THREE.Vector3(Math.cos(angle)*.59,.035,Math.sin(angle)*.59));
          for(const radius of [.2,.38,.56]) {
            const next=angle+Math.PI/4;
            points.push(new THREE.Vector3(Math.cos(angle)*radius,.035,Math.sin(angle)*radius),
              new THREE.Vector3(Math.cos(next)*radius,.035,Math.sin(next)*radius));
          }
        }
        const webKey=`web:${overrides.web || colors.web}`;
        if(!materials.has(webKey)) materials.set(webKey,new THREE.LineBasicMaterial({color:overrides.web || colors.web,transparent:true,opacity:.75}));
        group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),materials.get(webKey)));
        break;
      }
    }
    group.position.set(prop.x,.006,prop.y);
    // SVG's clockwise rotation maps to a negative rotation about world Y.
    group.rotation.y=-prop.rotation*Math.PI/180;
    group.scale.setScalar(prop.size);
    group.traverse(object=>{object.userData.propId=prop.id;});
    return group;
  };
}
