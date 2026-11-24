import { propAppearance, propDimensions } from './prop-model.js';
export { OBJECT_EFFECTS, visualEffects } from './object-appearance.js';

export function objectEffectBounds(object,layer) {
  const size=object.size || 1, appearance=propAppearance(object);
  if(object.points) {
    const xs=object.points.map(point=>point.x), ys=object.points.map(point=>point.y);
    return {x:(Math.min(...xs)+Math.max(...xs))/2,y:(Math.min(...ys)+Math.max(...ys))/2,width:Math.max(.2,Math.max(...xs)-Math.min(...xs)),depth:Math.max(.2,Math.max(...ys)-Math.min(...ys)),height:2};
  }
  if(layer==='props' || appearance) {
    const prop=appearance || object, dimensions=propDimensions(prop);
    const height=['tree','pine'].includes(prop.kind)?2.8:prop.kind==='crystalObelisk'?2.4:prop.kind==='ladder'?1.8:1;
    return {x:object.x,y:object.y,width:dimensions.width*size,depth:dimensions.depth*size,height:height*size};
  }
  return {x:object.x,y:object.y,width:size,depth:size,height:layer==='floors'?.15:layer==='tokens'?size*1.2:.8*size};
}

export function svgObjectEffects(bounds,effects) {
  const node=(tag,attrs)=>{
    const element=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [key,value] of Object.entries(attrs)) element.setAttribute(key,value);
    return element;
  };
  const group=node('g',{'pointer-events':'none','aria-hidden':'true'}), {x,y,width,depth}=bounds;
  const radius=Math.max(.3,Math.min(3,Math.max(width,depth)));
  if(effects.includes('glow')) for(const scale of [1,1.2,1.4]) group.append(node('ellipse',{
    cx:x,cy:y,rx:width*.55*scale,ry:depth*.55*scale,fill:'#ffdc69','fill-opacity':.06,stroke:'#ffe795','stroke-opacity':.4/scale,'stroke-width':.04*radius,class:'object-glow'
  }));
  if(effects.includes('fairy')) for(let i=0;i<10;i++) {
    const particle=node('circle',{cx:x+Math.sin(i*2.4)*width*.6,cy:y+Math.cos(i*2.4)*depth*.6,r:.045*radius,fill:['#b8ff9a','#83e6ff','#ffc3fa'][i%3],class:'object-fairy'});
    particle.style.animationDelay=`${-i*.31}s`; group.append(particle);
  }
  if(effects.includes('ablaze')) for(let i=0;i<5;i++) {
    const cx=x+(i-2)*width*.18, cy=y+Math.sin(i*2)*depth*.2, r=radius*.13;
    const flame=node('path',{d:`M${cx-r} ${cy+r}Q${cx-r*2} ${cy-r} ${cx} ${cy-r*3}Q${cx+r*.2} ${cy-r} ${cx+r} ${cy-r*2}Q${cx+r*3} ${cy+r*2} ${cx-r} ${cy+r}Z`,fill:i%2?'#ffe486':'#ff872e','fill-opacity':.85,class:'object-flame'});
    flame.style.animationDelay=`${-i*.17}s`; group.append(flame);
  }
  return group;
}
