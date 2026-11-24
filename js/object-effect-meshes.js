import * as THREE from 'three';

export function createObjectEffectKit() {
  const animated=[], materials=new Map();
  let particleTexture, sphere, cone;
  const material=(name,color,opacity)=>{
    if(!materials.has(name)) materials.set(name,new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,blending:THREE.AdditiveBlending}));
    return materials.get(name);
  };
  function mesh(bounds,effects) {
    const group=new THREE.Group(), {x,y,width,depth,height}=bounds;
    group.position.set(x,0,y);
    if(effects.includes('glow')) {
      sphere ||= new THREE.SphereGeometry(1,12,8);
      const halo=new THREE.Mesh(sphere,material('glow','#ffdc69',.16));
      halo.position.y=height*.5; halo.scale.set(width*.7,Math.max(.15,height*.65),depth*.7);
      group.add(halo); animated.push({kind:'glow',object:halo,phase:0});
    }
    if(effects.includes('fairy')) {
      if(!particleTexture) {
        const canvas=document.createElement('canvas'); canvas.width=canvas.height=32;
        const context=canvas.getContext('2d'), gradient=context.createRadialGradient(16,16,0,16,16,16);
        gradient.addColorStop(0,'#ffffff'); gradient.addColorStop(.3,'#ffffffcc'); gradient.addColorStop(1,'#ffffff00');
        context.fillStyle=gradient; context.fillRect(0,0,32,32); particleTexture=new THREE.CanvasTexture(canvas);
      }
      if(!materials.has('fairy')) materials.set('fairy',new THREE.PointsMaterial({color:'#c8ffae',size:.16,map:particleTexture,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending}));
      const positions=new Float32Array(16*3);
      const geometry=new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
      const particles=new THREE.Points(geometry,materials.get('fairy'));
      particles.frustumCulled=false; group.add(particles); animated.push({kind:'fairy',object:particles,bounds});
    }
    if(effects.includes('ablaze')) {
      cone ||= new THREE.ConeGeometry(1,1,7);
      const radius=Math.max(.12,Math.min(.5,Math.max(width,depth)*.14));
      for(let i=0;i<7;i++) {
        const flame=new THREE.Mesh(cone,material(i%2?'core':'fire',i%2?'#ffe486':'#ff7327',.8));
        flame.position.set(Math.sin(i*2.4)*width*.35,height*.4+radius,Math.cos(i*2.4)*depth*.35);
        flame.scale.set(radius,radius*4,radius); group.add(flame);
        animated.push({kind:'fire',object:flame,radius,phase:i*1.7});
      }
    }
    group.traverse(object=>{object.raycast=()=>{};});
    return group;
  }
  function animate(time) {
    for(const effect of animated) {
      const {object}=effect;
      if(effect.kind==='fairy') {
        const {width,depth,height}=effect.bounds, positions=object.geometry.attributes.position;
        for(let i=0;i<positions.count;i++) {
          const angle=i*2.4+time*.5;
          positions.setXYZ(i,Math.sin(angle)*width*.65,((i/positions.count+time*.14)%1)*Math.max(.4,height+ .4),Math.cos(angle)*depth*.65);
        }
        positions.needsUpdate=true;
      } else if(effect.kind==='fire') {
        object.scale.y=effect.radius*(3.5+Math.sin(time*8+effect.phase)*.8);
      } else object.material.opacity=(.13+Math.sin(time*2)*.035)*(object.userData.effectOpacityScale || 1);
    }
    return animated.length>0;
  }
  return {mesh,animate};
}
