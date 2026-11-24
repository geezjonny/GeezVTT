import { MATERIALS } from './map-editor-model.js';

const canvases=new Map(), urls=new Map();
export function materialCanvas(name) {
  if(!Object.hasOwn(MATERIALS,name)) name='stone';
  if(canvases.has(name)) return canvases.get(name);
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=128;
  const ctx=canvas.getContext('2d');
  let seed=Object.keys(MATERIALS).indexOf(name)+1;
  const random=()=>{ seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
  ctx.fillStyle=MATERIALS[name]; ctx.fillRect(0,0,128,128);
  const line=(points,color,width=1)=>{
    ctx.beginPath(); ctx.moveTo(...points[0]);
    for(const point of points.slice(1)) ctx.lineTo(...point);
    ctx.strokeStyle=color; ctx.lineWidth=width; ctx.stroke();
  };
  if(['wooden fence','barricade','wood','dark wood','burnt wood','reinforced wood','timber'].includes(name)) {
    for(let plank=0;plank<4;plank++) {
      const x=plank*32;
      ctx.fillStyle=`rgba(${plank%2?255:20},${plank%2?220:12},${plank%2?160:5},.08)`;
      ctx.fillRect(x,0,32,128);
      line([[x,0],[x,128]],'#49311e',2);
      for(let i=0;i<16;i++) {
        const grain=x+3+random()*26, bend=random()*4;
        line([[grain,0],[grain+bend,32],[grain-bend,80],[grain,128]],`rgba(55,28,10,${.1+random()*.18})`);
      }
      ctx.strokeStyle='#674022'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.ellipse(x+16,28+plank*21,3,9,0,0,Math.PI*2); ctx.stroke();
    }
    if(name==='reinforced wood') for(const y of [22,100]) {
      ctx.fillStyle='#51565b'; ctx.fillRect(0,y,128,9);
      ctx.fillStyle='#b4b5ad';
      for(const x of [8,40,88,120]) { ctx.beginPath(); ctx.arc(x,y+4,2,0,Math.PI*2); ctx.fill(); }
    }
  } else if(['broken wall','brick','stone','cobble','sandstone','limestone','mossy stone','tile'].includes(name)) {
    const rows=name==='brick'?4:name==='stone'?2:4, h=128/rows;
    const w=name==='brick'?64:name==='stone'?64:32;
    ctx.fillStyle=name==='brick'?'#b5a18a':'#484b48'; ctx.fillRect(0,0,128,128);
    for(let row=0;row<rows;row++) for(let col=-1;col<Math.ceil(128/w)+1;col++) {
      const x=col*w+(row%2)*w/2, y=row*h, inset=name==='cobble'?2.5:1.5;
      ctx.fillStyle=MATERIALS[name];
      ctx.beginPath(); ctx.roundRect(x+inset,y+inset,w-inset*2,h-inset*2,name==='cobble'?8:2); ctx.fill();
      ctx.fillStyle=`rgba(${random()>.5?'255,255,240':'0,0,0'},${random()*.15})`;
      ctx.fill();
      line([[x+inset+3,y+h-inset-2],[x+inset+3,y+inset+2],[x+w-inset-3,y+inset+2]],'#ffffff25');
      if(name==='stone') line([[x+18,y+10],[x+24,y+24],[x+20,y+30],[x+29,y+41]],'#333b4648');
    }
    if(name==='mossy stone') for(let i=0;i<45;i++) {
      ctx.fillStyle='#45633388'; ctx.beginPath(); ctx.arc(random()*128,random()*128,2+random()*7,0,Math.PI*2); ctx.fill();
    }
  } else if(['iron fence','metal','rusty iron','bronze'].includes(name)) {
    for(let y=0;y<128;y++) {
      ctx.fillStyle=`rgba(${y%3?'255,255,255':'10,25,35'},${random()*.1})`; ctx.fillRect(0,y,128,1);
    }
    ctx.strokeStyle='#435862'; ctx.lineWidth=2; ctx.strokeRect(1,1,126,126);
    for(const x of [7,121]) for(const y of [7,121]) {
      ctx.fillStyle='#42525b'; ctx.beginPath(); ctx.arc(x,y,2.5,0,Math.PI*2); ctx.fill();
      line([[x-1,y-1],[x+1,y-1]],'#e3f2f7');
    }
    if(name==='rusty iron') for(let i=0;i<60;i++) {
      ctx.fillStyle='#ab4e2580'; ctx.beginPath(); ctx.arc(random()*128,random()*128,1+random()*5,0,Math.PI*2); ctx.fill();
    }
  } else if(['water','swamp','blood'].includes(name)) {
    for(let i=0;i<16;i++) {
      const x=random()*128,y=random()*128;
      ctx.beginPath(); ctx.ellipse(x,y,6+random()*15,1+random()*2,0,0,Math.PI);
      ctx.strokeStyle='#ffffff35'; ctx.lineWidth=1.5; ctx.stroke();
    }
    if(name==='swamp') for(let i=0;i<30;i++) {
      const x=random()*128,y=random()*128;
      line([[x,y],[x+3,y-9],[x+5,y]],'#88904e88',2);
    }
  } else if(['grass','moss','hedge'].includes(name)) {
    for(let i=0;i<180;i++) {
      const x=random()*128,y=random()*128;
      line([[x-2,y+3],[x,y-3-random()*5],[x+2,y+2]],random()>.5?'#bdd07c66':'#233d2466',name==='grass'?1:3);
    }
  } else if(['cracked rock','cave','ice','lava','obsidian','marble'].includes(name)) {
    for(let i=0;i<10;i++) {
      const x=random()*128,y=random()*128;
      const points=[[x,y],[x+12,y+8],[x+8,y+23],[x+24,y+34],[x+20,y+54]];
      if(name==='lava') line(points,'#ffce56',5);
      line(points,name==='lava'?'#ffe58a':name==='ice'?'#edfaff99':name==='marble'?'#7b788866':'#201e2388',name==='marble'?1:2);
    }
  } else if(name==='curtain' || name==='carpet') {
    for(let x=0;x<128;x+=name==='curtain'?16:4) {
      line([[x,0],[x,128]],'#210b2333',name==='curtain'?5:1);
    }
    if(name==='carpet') for(let y=0;y<128;y+=4) line([[0,y],[128,y]],'#efcba329');
  } else if(['dirt','sand','mud','gravel','snow','ash','plaster'].includes(name)) {
    for(let i=0;i<140;i++) {
      ctx.fillStyle=random()>.5?'#ffffff25':'#201a1633';
      ctx.beginPath(); ctx.ellipse(random()*128,random()*128,name==='gravel'?2+random()*4:1+random()*2,1+random()*2,random()*Math.PI,0,Math.PI*2); ctx.fill();
    }
  }
  for(let i=0;i<1800;i++) {
    ctx.fillStyle=`rgba(${random()>.5?'255,255,255':'0,0,0'},${random()*.08})`;
    ctx.fillRect(Math.floor(random()*128),Math.floor(random()*128),1,1);
  }
  canvases.set(name,canvas);
  return canvas;
}

export function materialURL(name) {
  if(!urls.has(name)) urls.set(name,materialCanvas(name).toDataURL('image/png'));
  return urls.get(name);
}

export function installMaterialPatterns(svg) {
  const defs=svg.querySelector('defs');
  for(const name of Object.keys(MATERIALS)) {
    const pattern=document.createElementNS(svg.namespaceURI,'pattern');
    pattern.id=`material-${name}`;
    pattern.setAttribute('patternUnits','userSpaceOnUse');
    pattern.setAttribute('width','1'); pattern.setAttribute('height','1');
    const image=document.createElementNS(svg.namespaceURI,'image');
    image.setAttribute('href',materialURL(name)); image.setAttribute('width','1'); image.setAttribute('height','1');
    pattern.append(image); defs.append(pattern);
  }
}
