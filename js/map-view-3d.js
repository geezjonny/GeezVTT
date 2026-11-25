import { tokenImage } from './token-art.js';
import { viewersFor, visibleObject, visibilityFor } from './player-vision.js';
// Adapted from view3d.js: grid coordinates map directly to world (x, z).
// One grid cell = one world unit = 5 ft; walls and doors are two units high.
import * as THREE from 'three';
import { graphicsSettings, onGraphicsChange } from './graphics-settings.js';
import { isGM, canControlPC } from './session-role.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { onMapRightClick } from './map-right-click.js';
import { PORTAL_ICONS } from './portal-model.js';
import { createPropKit } from './prop-meshes.js';
import { createObjectEffectKit } from './object-effect-meshes.js';
import { visualEffects, objectEffectBounds } from './object-effects.js';
import { objectColors, objectLightColor } from './object-appearance.js';
import { propCorners, propAppearance, propDistance } from './prop-model.js';
import { TIMES, environmentSettings, fogRectangles } from './environment-model.js';
import { MATERIALS, adjoiningWallIndex, windowFrameParts } from './map-editor-model.js';
import { materialCanvas } from './material-textures.js';
import { pcTokenStatus } from './token-model.js';
import { createTokenMiniKit } from './token-meshes.js';

export function createMapView3D(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', '3D tabletop. Middle-drag to pan; scroll to zoom; right-drag to orbit. Right-click a token to edit or a light, portal, door, or prop for actions.');
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#15191f');
  const ambient = new THREE.HemisphereLight(0xe6f0ff, 0x655b50, 0.8);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffe6c4, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.normalBias = 0.02;
  sun.shadow.bias = -0.0001;
  scene.add(sun, sun.target);
  // Local quality setting: pixel ratio and shadow cost. Point-light shadows are ranked in setMap.
  function applyGraphics(live) {
    const g = graphicsSettings();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, g.pixelRatio));
    const shadowsChanged = renderer.shadowMap.enabled !== g.shadows;
    renderer.shadowMap.enabled = g.shadows;
    sun.castShadow = g.shadows;
    if (sun.shadow.mapSize.x !== g.sunShadowSize) { sun.shadow.mapSize.set(g.sunShadowSize, g.sunShadowSize); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    for (const light of groups.lights?.children || []) {
      if (!light.isPointLight) continue;
      light.castShadow = light.userData.shadowRank >= 0 && light.userData.shadowRank < g.pointShadows;
      if (light.shadow.mapSize.x !== g.pointShadowSize) { light.shadow.mapSize.set(g.pointShadowSize, g.pointShadowSize); light.shadow.map?.dispose(); light.shadow.map = null; }
    }
    if (shadowsChanged) scene.traverse(object => { if (object.material) [].concat(object.material).forEach(material => { material.needsUpdate = true; }); });
    renderer.shadowMap.needsUpdate = true;
    if (live) resize();
  }
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 2000);
  const orbitLabel = renderer.domElement.getAttribute('aria-label');
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  controls.screenSpacePanning = false;
  const groups = { floors: new THREE.Group(), walls: new THREE.Group(), doors: new THREE.Group(), lights: new THREE.Group(), lightMarkers: new THREE.Group(), grid: new THREE.Group(), tokens: new THREE.Group(), portals: new THREE.Group(), props: new THREE.Group() };
  const root = new THREE.Group();
  Object.values(groups).forEach(group => root.add(group));
  scene.add(root);
  applyGraphics(false);
  const stopGraphics = onGraphicsChange(() => applyGraphics(true));
  const placement = new THREE.Group();
  const placementMaterial = new THREE.LineBasicMaterial({ color: '#d4a0ff', transparent: true, opacity: .85, depthTest: false, depthWrite: false });
  scene.add(placement);
  const fogGroup = new THREE.Group();
  scene.add(fogGroup);
  const fogMaterial = new THREE.MeshBasicMaterial({ color: '#080b10', transparent: isGM, opacity: isGM ? .55 : 1 });
  let model, active = false, raf = 0, dirty = true, pendingFit = false;
  let bounds;
  let effectKit;
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  let firstPerson = false, savedCamera, look, yaw = 0, pitch = 0, lastFrame = 0;
  const keys = new Set();
  const movementKeys = { KeyW: [0,-1], KeyS: [0,1], KeyA: [-1,0], KeyD: [1,0],
    ArrowUp: [0,-1], ArrowDown: [0,1], ArrowLeft: [-1,0], ArrowRight: [1,0] };
  function character() {
    const tokens = model?.tokens || [];
    const selected = host.closest('#floor').selectedTokenId;
    return tokens.find(token => token.id === selected && (isGM || canControlPC(token))) ||
      (!isGM && tokens.find(token => token.kind === 'pc' && canControlPC(token)));
  }
  function firstPersonStart() {
    const token = character();
    camera.position.set(token?.x ?? controls.target.x, 1.15, token?.y ?? controls.target.z);
    yaw = THREE.MathUtils.degToRad(token?.rotation || 0);
    pitch = 0;
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
  }
  function setFirstPerson(on) {
    if (firstPerson === on) return;
    firstPerson = on;
    keys.clear(); look = null;
    controls.enabled = !on;
    if (on) {
      savedCamera = { position: camera.position.clone(), target: controls.target.clone() };
      firstPersonStart();
    } else if (savedCamera) {
      camera.position.copy(savedCamera.position);
      controls.target.copy(savedCamera.target);
      controls.update();
    }
    groups.tokens.children.forEach(mesh => { mesh.visible = true; });
    camera.fov = on ? 75 : 45;
    camera.updateProjectionMatrix();
    renderer.domElement.setAttribute('aria-label', on
      ? 'First person. Right-drag to look; WASD or arrow keys to move.' : orbitLabel);
    host.setAttribute('aria-label', on ? 'First person map' : '3D map');
    if (on) renderer.domElement.focus({ preventScroll: true });
    invalidate();
  }
  const input = {
    pointerdown(event) {
      if (!firstPerson || !active || event.button !== 2) return;
      renderer.domElement.focus({ preventScroll: true });
      look = { id: event.pointerId, x: event.clientX, y: event.clientY };
      renderer.domElement.setPointerCapture(event.pointerId);
    },
    pointermove(event) {
      if (!look || look.id !== event.pointerId) return;
      yaw -= (event.clientX - look.x) * .005;
      pitch = THREE.MathUtils.clamp(pitch - (event.clientY - look.y) * .004, -1.4, 1.4);
      look.x = event.clientX; look.y = event.clientY;
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      invalidate();
    },
    pointerup() { look = null; },
    pointercancel() { look = null; },
    lostpointercapture() { look = null; },
    keydown(event) {
      if (!active || !firstPerson || !isGM || !movementKeys[event.code] || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      keys.add(event.code);
    },
    keyup(event) { keys.delete(event.code); },
    blur() { keys.clear(); look = null; }
  };
  for (const [type, listener] of Object.entries(input)) renderer.domElement.addEventListener(type, listener);
  window.addEventListener('blur', input.blur);
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line.threshold = .03;
  const removeRightClick = onMapRightClick(renderer.domElement, event => {
    if (!active) return;
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    const hit = raycaster.intersectObjects([...groups.tokens.children, ...groups.portals.children, ...groups.lightMarkers.children, ...groups.props.children, ...groups.doors.children, ...groups.walls.children, ...groups.floors.children, ...(isGM ? [] : fogGroup.children)],true).sort((a,b)=>Math.abs(a.distance-b.distance)<1e-6?b.object.renderOrder-a.object.renderOrder:a.distance-b.distance)[0];
    if (hit?.object.userData.tokenId) host.closest('#floor').dispatchEvent(new CustomEvent('token-menu', {
      detail: { id: hit.object.userData.tokenId, x: event.clientX, y: event.clientY }
    }));
    else if (hit?.object.userData.portalId) host.closest('#floor').dispatchEvent(new CustomEvent('portal-menu', {
      detail: { id: hit.object.userData.portalId, x: event.clientX, y: event.clientY }
    }));
    else if (hit?.object.userData.doorIndex !== undefined) host.closest('#floor').dispatchEvent(new CustomEvent('door-menu', {
      detail: { index: hit.object.userData.doorIndex, x: event.clientX, y: event.clientY }
    }));
    else if (hit?.object.userData.propId) host.closest('#floor').dispatchEvent(new CustomEvent('prop-menu', {
      detail: { id: hit.object.userData.propId, x: event.clientX, y: event.clientY }
    }));
    else if (hit?.object.userData.floorIndex !== undefined) host.closest('#floor').dispatchEvent(new CustomEvent('floor-menu', {
      detail: { index: hit.object.userData.floorIndex, x: event.clientX, y: event.clientY }
    }));
    else if (hit?.object.userData.lightIndex !== undefined) host.closest('#floor').dispatchEvent(new CustomEvent('light-menu', {
      detail: { index: hit.object.userData.lightIndex, x: event.clientX, y: event.clientY }
    }));
    else if (hit?.object.userData.wallIndex !== undefined) host.closest('#floor').dispatchEvent(new CustomEvent('wall-menu', {
      detail: { index: hit.object.userData.wallIndex, x: event.clientX, y: event.clientY }
    }));
  });
  const invalidate = () => { dirty = true; };
  function previewPlacement(lines = []) {
    placement.children.forEach(line => line.geometry.dispose());
    placement.clear();
    for (const points of lines) {
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(p.x, .05, p.y)));
      const line = new THREE.Line(geometry, placementMaterial);
      line.renderOrder = 10;
      placement.add(line);
    }
    invalidate();
  }
  function aim(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
  }
  function tabletopPoint(event) {
    aim(event);
    const point = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    return point && { x: point.x, y: point.z };
  }
  function screenPoint(point) {
    const p = new THREE.Vector3(point.x, .05, point.y).project(camera);
    if (p.z < -1 || p.z > 1) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
  }
  function tabletopHit(event) {
    aim(event);
    return raycaster.intersectObjects([...groups.tokens.children, ...groups.portals.children, ...groups.lightMarkers.children, ...groups.doors.children, ...groups.walls.children, ...groups.props.children, ...groups.floors.children, ...(isGM ? [] : fogGroup.children)], true).sort((a,b)=>Math.abs(a.distance-b.distance)<1e-6?b.object.renderOrder-a.object.renderOrder:a.distance-b.distance)[0]?.object.userData;
  }
  function previewToken(id, point) {
    const mesh = groups.tokens.children.find(item => item.userData.tokenId === id);
    if (mesh) { mesh.position.set(point.x, .03, point.y); invalidate(); }
  }
  function previewObject(kind,id,index,point) {
    const key=kind==='lights'?'lightIndex':kind==='portals'?'portalId':'propId';
    const value=kind==='lights'?index:id;
    const group=groups[kind==='lights'?'lightMarkers':kind];
    const mesh=group.children.find(root=>{ let match=false; root.traverse(child=>{if(child.userData[key]===value) match=true;}); return match; });
    const object=kind==='lights'?model.lights[index]:model[kind].find(item=>item.id===id);
    if(!mesh || !object) return;
    mesh.userData.dragOrigin ||= mesh.position.clone();
    mesh.position.x=mesh.userData.dragOrigin.x+point.x-object.x;
    mesh.position.z=mesh.userData.dragOrigin.z+point.y-object.y;
    invalidate();
  }
  controls.addEventListener('change', invalidate);

  function disposeContents() {
    const geometries = new Set(), materials = new Set(), textures = new Set();
    root.traverse(object => {
      object.shadow?.dispose();
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) {
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
          if (material.map) textures.add(material.map);
        }
      }
    });
    geometries.forEach(item => item.dispose());
    materials.forEach(item => item.dispose());
    textures.forEach(item => item.dispose());
    root.clear();
    Object.values(groups).forEach(group => { group.clear(); root.add(group); });
  }
  function resize() {
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    invalidate();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  function fit() {
    if (!model) return;
    resize();
    if (firstPerson) { firstPersonStart(); invalidate(); return; }
    // Fit a bounding sphere in both the vertical and horizontal field of view.
    const radius = Math.hypot(bounds.right-bounds.left, bounds.bottom-bounds.top, 2) / 2;
    const fov = Math.min(THREE.MathUtils.degToRad(camera.fov), 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
    const distance = radius / Math.sin(fov / 2) * 1.12;
    const target = new THREE.Vector3((bounds.left+bounds.right)/2, 0.5, (bounds.top+bounds.bottom)/2);
    controls.target.copy(target);
    camera.position.copy(target).add(new THREE.Vector3(0, 0.9, 0.8).normalize().multiplyScalar(distance));
    controls.minDistance = 0.5;
    controls.maxDistance = Math.max(distance * 4, 20);
    camera.far = Math.max(2000, distance * 8);
    camera.updateProjectionMatrix();
    controls.update();
    invalidate();
  }
  function slabs(points, material, parent, open = false, doorIndex, wallStyle) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const dx = b.x - a.x, dz = b.y - a.y, length = Math.hypot(dx, dz);
      if (length < 0.00001) continue;
      if(['wooden fence','iron fence','barricade','broken wall'].includes(wallStyle)) {
        const group=new THREE.Group();
        const piece=(x,y,z,w,h,d,angle=0)=>{
          const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);
          mesh.position.set(x,y,z); mesh.rotation.z=angle;
          mesh.castShadow=mesh.receiveShadow=true; group.add(mesh);
        };
        const count=Math.max(1,Math.min(256,Math.ceil(length/(wallStyle==='iron fence'?.22:.6))));
        if(wallStyle==='broken wall') {
          for(let n=0;n<count;n++) {
            const h=.4+(n%3)*.28;
            piece((n+.5)*length/count,h/2,0,length/count,h,.22);
            piece((n+.5)*length/count,.08,.19,length/count*.7,.16,.2,.15*(n%2?1:-1));
          }
        } else {
          for(let n=0;n<=count;n++) piece(n*length/count,.5,0,.07,1,.1);
          for(const y of [.32,.78]) piece(length/2,y,0,length,.09,.08);
          if(wallStyle==='barricade') for(let n=0;n<count;n++) {
            const x=(n+.5)*length/count;
            piece(x,.5,.07,.08,1.2,.1,.6);
            piece(x,.5,-.07,.08,1.2,.1,-.6);
          }
        }
        group.position.set(a.x,0,a.y); group.rotation.y=-Math.atan2(dz,dx);
        parent.add(group);
        continue;
      }
      const thickness = doorIndex !== undefined ? 0.24 : 0.12;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, 2, thickness), material);
      if (doorIndex !== undefined) mesh.userData.doorIndex = doorIndex;
      if (doorIndex !== undefined) {
        const iron = new THREE.MeshStandardMaterial({ color: '#45413a', metalness: .75, roughness: .7 });
        const size = Math.min(1, length / .4);
        const parts = [
          { geometry: new THREE.CylinderGeometry(.075, .075, .02, 12), y: .015, z: .01, rotation: Math.PI / 2 },
          { geometry: new THREE.SphereGeometry(.025, 8, 6), y: .015, z: .035, rotation: 0 },
          { geometry: new THREE.TorusGeometry(.075, .014, 6, 16), y: -.06, z: .045, rotation: 0 }
        ];
        for (const side of [-1, 1]) for (const part of parts) {
          const handle = new THREE.Mesh(part.geometry, iron);
          handle.scale.setScalar(size);
          handle.rotation.x = part.rotation;
          handle.position.set(length / 2 - .15 * size, part.y * size, side * (thickness / 2 + part.z * size));
          handle.castShadow = handle.receiveShadow = true;
          handle.userData.doorIndex = doorIndex;
          mesh.add(handle);
        }
      }
      // Keep texture density constant on every face, regardless of segment length.
      const positions=mesh.geometry.attributes.position, normals=mesh.geometry.attributes.normal, uv=mesh.geometry.attributes.uv;
      for(let vertex=0;vertex<positions.count;vertex++) {
        const x=positions.getX(vertex)+length/2, y=positions.getY(vertex)+1, z=positions.getZ(vertex)+thickness/2;
        uv.setXY(vertex,Math.abs(normals.getX(vertex))>.5?z:x,Math.abs(normals.getY(vertex))>.5?z:y);
      }
      mesh.castShadow = mesh.receiveShadow = !material.transparent;
      mesh.position.set((a.x + b.x) / 2, 1, (a.y + b.y) / 2);
      mesh.rotation.y = -Math.atan2(dz, dx);
      if (open) {
        // Swing the door 90 degrees around its first endpoint, leaving the opening clear.
        mesh.position.set(a.x - dz / 2, 1, a.y + dx / 2);
        mesh.rotation.y -= Math.PI / 2;
      }
      parent.add(mesh);
    }
  }
  function setMap(next, refit = true) {
    disposeContents();
    model = next;
    const canSee=visibilityFor(model);
    bounds = (model.floors || []).reduce((box, tile) => ({
      left: Math.min(box.left, tile.x-.5), top: Math.min(box.top, tile.y-.5),
      right: Math.max(box.right, tile.x+.5), bottom: Math.max(box.bottom, tile.y+.5)
    }), { left: 0, top: 0, right: model.width, bottom: model.height });
    for(const prop of model.props || []) if(!prop.hidden) for(const point of propCorners(prop)) {
      bounds.left=Math.min(bounds.left,point.x); bounds.right=Math.max(bounds.right,point.x);
      bounds.top=Math.min(bounds.top,point.y); bounds.bottom=Math.max(bounds.bottom,point.y);
    }
    for(const object of [...(model.portals || []).filter(portal=>!portal.hidden),...model.lights]) {
      const appearance=propAppearance(object);
      if(appearance) for(const point of propCorners(appearance)) {
        bounds.left=Math.min(bounds.left,point.x); bounds.right=Math.max(bounds.right,point.x);
        bounds.top=Math.min(bounds.top,point.y); bounds.bottom=Math.max(bounds.bottom,point.y);
      }
    }
    const texture = new THREE.Texture(model.image);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    texture.needsUpdate = true;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(model.width, model.height),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    ground.receiveShadow = true;
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(model.width / 2, -0.005, model.height / 2);
    root.add(ground);
    const gridMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      // Keep the grid above the image's negative depth offset and painted floors.
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: { size: { value: new THREE.Vector2(bounds.right-bounds.left, bounds.bottom-bounds.top) }, origin: { value: new THREE.Vector2(bounds.left, bounds.top) } },
      vertexShader: `varying vec2 gridUv;
        void main() { gridUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec2 size; uniform vec2 origin; varying vec2 gridUv;
        void main() {
          vec2 cell = origin + vec2(gridUv.x, 1.0 - gridUv.y) * size;
          vec2 line = abs(fract(cell - 0.5) - 0.5) / max(fwidth(cell), vec2(0.0001));
          float alpha = 1.0 - min(min(line.x, line.y), 1.0);
          gl_FragColor = vec4(0.86, 0.9, 0.95, alpha * 0.55);
        }`
    });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(bounds.right-bounds.left, bounds.bottom-bounds.top), gridMaterial);
    grid.rotation.x = -Math.PI / 2;
    grid.position.set((bounds.left+bounds.right)/2, .01, (bounds.top+bounds.bottom)/2);
    grid.renderOrder = 1;
    groups.grid.add(grid);
    const palette = MATERIALS;
    const materials = new Map();
    const material = (name, fallback, tint) => {
      name=Object.hasOwn(palette,name)?name:fallback;
      const key=`${name}:${tint || ''}`;
      if (!materials.has(key)) {
        const metallic=['metal','rusty iron','bronze'].includes(name);
        const texture=new THREE.CanvasTexture(materialCanvas(name));
        texture.colorSpace=THREE.SRGBColorSpace;
        texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
        texture.anisotropy=renderer.capabilities.getMaxAnisotropy();
        materials.set(key,new THREE.MeshStandardMaterial({color:tint || '#ffffff',map:texture,bumpMap:texture,bumpScale:metallic?.008:.035,
          roughness:metallic?.4:name==='wood'?.8:.95,metalness:metallic?.65:0}));
      }
      return materials.get(key);
    };
    (model.floors || []).forEach((tile,index)=>{
      if(!canSee(tile)) return;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(tile.size || 1, tile.size || 1), material(tile.material, 'stone', objectColors(tile.colors).base));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(tile.x, -0.001, tile.y);
      mesh.receiveShadow = true;
      mesh.userData.floorIndex=index;
      groups.floors.add(mesh);
    });
    model.walls.forEach((points, i) => {
      if(!isGM && model.wallHidden?.[i]) return;
      const start = groups.walls.children.length;
      slabs(points, material(model.wallMaterials?.[i], 'stone', objectColors(model.wallColors?.[i]).base), groups.walls, false, undefined, model.wallMaterials?.[i]);
      for (const mesh of groups.walls.children.slice(start)) mesh.traverse(child => { child.userData.wallIndex = i; });
    });
    model.doors.forEach((door,index) => {
      if(!canSee(door)) return;
      if(door.type==='window') {
        const wall=adjoiningWallIndex(door,model.walls), frame=material(model.wallMaterials?.[wall] || door.material,'stone',objectColors(door.colors).base || objectColors(model.wallColors?.[wall]).base);
        const a=door.points[0], b=door.points.at(-1), length=Math.hypot(b.x-a.x,b.y-a.y);
        if(length<.00001) return;
        const group=new THREE.Group(); group.userData.doorIndex=index;
        group.position.set(a.x,0,a.y); group.rotation.y=-Math.atan2(b.y-a.y,b.x-a.x);
        for(const part of windowFrameParts(length)) {
          const mesh=new THREE.Mesh(new THREE.BoxGeometry(part.width,part.height,.12),frame);
          const positions=mesh.geometry.attributes.position, normals=mesh.geometry.attributes.normal, uv=mesh.geometry.attributes.uv;
          for(let vertex=0;vertex<positions.count;vertex++) {
            const x=positions.getX(vertex)+part.x, y=positions.getY(vertex)+part.y, z=positions.getZ(vertex)+.06;
            uv.setXY(vertex,Math.abs(normals.getX(vertex))>.5?z:x,Math.abs(normals.getY(vertex))>.5?z:y);
          }
          mesh.position.set(part.x,part.y,0); mesh.castShadow=mesh.receiveShadow=true; group.add(mesh);
        }
        if(door.pane!=='open') {
          const pane=new THREE.Mesh(new THREE.BoxGeometry(length-Math.min(.12,length*.2)*2,1,.025),new THREE.MeshStandardMaterial({color:'#8bd9f2',transparent:true,opacity:.25,roughness:.15,depthWrite:false}));
          pane.position.set(length/2,1.1,0); group.add(pane);
        }
        group.traverse(child=>{child.userData.doorIndex=index;}); groups.doors.add(group);
      } else slabs(door.points,material(door.material,'wood',objectColors(door.colors).base),groups.doors,door.open,index);
    });
    const propMesh=createPropKit();
    const appearanceMesh=(appearance,key,value)=>{
      const mesh=propMesh(appearance);
      mesh.traverse(object=>{delete object.userData.propId; object.userData[key]=value;});
      return mesh;
    };
    for (const prop of model.props || []) if(canSee(prop)) groups.props.add(propMesh({
      ...prop,...(prop.kind==='pressurePlate'?{open:model.tokens.some(token=>token.kind==='pc' && propDistance(prop,token)===0)}:{}),kind:propAppearance(prop)?.kind || prop.kind,lightColor:objectLightColor(model.lights.find(light=>light.propId===prop.id))
    }));
    model.lights.forEach((light,index)=>{
      if(light.propId || !canSee(light)) return;
      const appearance=propAppearance(light);
      if(appearance) groups.lightMarkers.add(appearanceMesh({...appearance,colors:light.colors,lightColor:objectLightColor(light)},'lightIndex',index));
      else {
        const marker=new THREE.Mesh(new THREE.SphereGeometry(.12,8,6),new THREE.MeshBasicMaterial({color:objectLightColor(light)}));
        marker.position.set(light.x,.12,light.y); marker.userData.lightIndex=index;
        groups.lightMarkers.add(marker);
      }
    });
    for (const portal of model.portals || []) {
      if (!canSee(portal)) continue;
      const appearance=propAppearance(portal);
      if(appearance) {
        groups.portals.add(appearanceMesh({...appearance,colors:portal.colors},'portalId',portal.id));
        continue;
      }
      const canvas=document.createElement('canvas');
      canvas.width=canvas.height=128;
      const context=canvas.getContext('2d');
      context.fillStyle=objectColors(portal.colors).base || '#502e73';
      context.beginPath(); context.arc(64,64,59,0,Math.PI*2); context.fill();
      context.strokeStyle='#d4a0ff'; context.lineWidth=6; context.stroke();
      context.fillStyle='#fff'; context.font='48px system-ui'; context.textAlign='center'; context.textBaseline='middle';
      context.fillText(PORTAL_ICONS[portal.icon] || PORTAL_ICONS.portal,64,64);
      const texture=new THREE.CanvasTexture(canvas);
      texture.colorSpace=THREE.SRGBColorSpace;
      const ring=new THREE.Mesh(new THREE.PlaneGeometry(.86*(portal.size || 1),.86*(portal.size || 1)),new THREE.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.1,side:THREE.DoubleSide}));
      ring.rotation.x=-Math.PI/2; ring.position.set(portal.x,.015,portal.y);
      ring.userData.portalId=portal.id;
      groups.portals.add(ring);
    }
    const tokenMini = model.tokens?.length ? createTokenMiniKit() : null;
    for (const token of model.tokens || []) {
      if (!canSee(token)) continue;
      const status = pcTokenStatus(token);
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = status ? 384 : 256;
      const context = canvas.getContext('2d');
      context.fillStyle = objectColors(token.colors).base || '#344f70';
      context.beginPath(); context.arc(128, 128, 124, 0, Math.PI * 2); context.fill();
      context.strokeStyle = '#a2cbff'; context.lineWidth = 8; context.stroke();
      context.fillStyle = '#fff'; context.font = 'bold 22px system-ui'; context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText(token.name.split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join(''), 128, 237);
      if (status) {
        context.fillStyle = '#17212b'; context.fillRect(13, 272, 230, 23);
        context.fillStyle = status.color; context.fillRect(13, 272, 230 * status.fraction, 23);
        context.font = '600 36px system-ui'; context.lineWidth = 6; context.strokeStyle = '#17212b';
        context.strokeText(status.label, 128, 330, 250);
        context.fillStyle = '#fff'; context.fillText(status.label, 128, 330, 250);
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const image = new Image();
      image.onload = () => {
        if (!groups.tokens.children.includes(group)) return;
        context.save(); context.beginPath(); context.arc(128,128,120,0,Math.PI*2); context.clip();
        const crop=Math.min(image.width,image.height);
        context.drawImage(image,(image.width-crop)/2,(image.height-crop)/2,crop,crop,8,8,240,240); context.restore(); texture.needsUpdate=true; invalidate();
      };
      image.src = tokenImage(token);
      const geometry = new THREE.PlaneGeometry(token.size, token.size * (status ? 1.5 : 1));
      if (status) geometry.translate(0, -token.size * .25, 0);
      const mesh = new THREE.Mesh(geometry,
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: .1 }));
      mesh.rotation.x = -Math.PI / 2;
      const miniature = tokenMini(token.icon,objectColors(token.colors).base);
      miniature.rotation.y = -(token.rotation || 0) * Math.PI / 180;
      miniature.scale.setScalar(token.size);
      const group = new THREE.Group();
      group.position.set(token.x, .03, token.y);
      group.add(mesh, miniature);
      group.traverse(object => { object.userData.tokenId = token.id; });
      groups.tokens.add(group);
    }
    effectKit=createObjectEffectKit();
    for(const name of ['floors','walls','doors','props','portals','tokens','lightMarkers']) {
      const attached=new Set(), layer=name==='lightMarkers'?'lights':name;
      groups[name].children.forEach((object,index)=>{
        const data=object.userData;
        const source=layer==='walls'?{points:model.walls[data.wallIndex],hidden:model.wallHidden?.[data.wallIndex],visualEffects:model.wallEffects?.[data.wallIndex],colors:model.wallColors?.[data.wallIndex]}:
          data.doorIndex!==undefined?model.doors[data.doorIndex]:
          data.floorIndex!==undefined?model.floors[data.floorIndex]:
          data.lightIndex!==undefined?model.lights[data.lightIndex]:
          model[layer]?.find(item=>item.id===(data.tokenId || data.portalId || data.propId));
        const effects=visualEffects(source?.visualEffects), key=layer==='walls'?data.wallIndex:source;
        if(effects.length && !attached.has(key)) {
          attached.add(key);
          const effect=effectKit.mesh(objectEffectBounds(source,layer),effects);
          if(layer==='props') effect.rotation.y=-(source.rotation || 0)*Math.PI/180;
          object.attach(effect);
        }
        object.traverse(child=>{
          child.renderOrder=index+1;
          if(isGM && source?.hidden && child.material) {
            child.material=child.material.clone(); child.material.transparent=true;
            child.material.opacity*=.3; child.material.depthWrite=false; child.castShadow=false; child.userData.effectOpacityScale=.3;
          }
        });
      });
    }
    effectKit.animate(0);
    // Dispose materials for degenerate segments which produced no mesh.
    const used = new Set(), usedTextures = new Set();
    root.traverse(object => { if (object.material) { used.add(object.material); if(object.material.map) usedTextures.add(object.material.map); } });
    materials.forEach(value => { if (!used.has(value)) { if(!usedTextures.has(value.map)) value.map?.dispose(); value.dispose(); } });
    const strength = light => light.off ? 0 : Math.max(0, Number.isFinite(light.intensity) ? light.intensity : 1) *
      THREE.MathUtils.clamp(Number.isFinite(light.opacity) ? light.opacity : 1, 0, 1);
    const lights = model.lights.filter(light => (isGM || !light.hidden) && strength(light) > 0 && Number.isFinite(light.range) && light.range > 0);
    // shortcut: only the eight strongest eligible lights cast shadows; use tiled lighting for larger scenes.
    const shadowOrder = lights.filter(light => light.source?.shadows !== false)
      .sort((a, b) => strength(b) - strength(a)).slice(0, 8);
    const quality = graphicsSettings();
    lights.forEach(light => {
      const height = Math.min(1.3, light.range / 2);
      const distance = Math.hypot(light.range, height);
      const source = new THREE.PointLight(objectLightColor(light), strength(light) * 16, distance, 2);
      source.position.set(light.x, height, light.y);
      const rank = shadowOrder.indexOf(light);
      source.userData.shadowRank = rank;
      source.castShadow = rank >= 0 && rank < quality.pointShadows;
      source.shadow.mapSize.set(quality.pointShadowSize, quality.pointShadowSize);
      source.shadow.camera.near = Math.min(0.05, height / 4);
      source.shadow.camera.far = distance;
      source.shadow.bias = -0.0002;
      source.shadow.normalBias = 0.015;
      groups.lights.add(source);
    });
    const radius = Math.hypot(bounds.right-bounds.left, bounds.bottom-bounds.top, 2) / 2;
    sun.target.position.set((bounds.left+bounds.right)/2, 0, (bounds.top+bounds.bottom)/2);
    sun.position.copy(sun.target.position).add(new THREE.Vector3(-1, 2, 1).normalize().multiplyScalar(radius * 2));
    Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 0.1, far: radius * 4 });
    sun.shadow.camera.updateProjectionMatrix();
    setEnvironment(model.environment);
    renderer.shadowMap.needsUpdate = true;
    invalidate();
    if (refit) pendingFit = true;
    if (active && pendingFit) { fit(); pendingFit = false; }
  }
  function loop() {
    if (!active) return;
    const now = performance.now(), delta = Math.min((now - lastFrame) / 1000, .05);
    lastFrame = now;
    if (firstPerson) {
      const token = !isGM && character();
      if (token) {
        camera.position.set(token.x, 1.15, token.y);
        invalidate();
      }
      groups.tokens.children.forEach(mesh => { mesh.visible = mesh.userData.tokenId !== token?.id; });
      if (isGM && keys.size) {
        const direction = new THREE.Vector3();
        for (const key of keys) { const [x, z] = movementKeys[key]; direction.x += x; direction.z += z; }
        // shortcut: the GM camera flies through walls; player movement keeps server collision checks.
        direction.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        camera.position.addScaledVector(direction, delta * 3);
        invalidate();
      }
    } else controls.update();
    if(!reducedMotion.matches && !document.hidden && effectKit?.animate(now/1000)) invalidate();
    if (dirty) { dirty = false; renderer.render(scene, camera); }
    raf = requestAnimationFrame(loop);
  }
  function setEnvironment(next) {
    if (!model) return;
    model.environment = environmentSettings(next, model);
    const time = TIMES[model.environment.time];
    const localLighting = model.environment.time === 'original' && groups.lights.children.length > 0;
    ambient.intensity = localLighting ? .03 : time.ambient;
    sun.intensity = localLighting ? 0 : time.sun;
    sun.color.set(time.color);
    ambient.color.set(model.environment.time === 'night' ? '#91b8ff' : '#e6f0ff');
    fogGroup.children.forEach(mesh => mesh.geometry.dispose());
    fogGroup.clear();
    // Cover wall height too, so orbiting cannot expose geometry beneath the fog.
    for (const rect of fogRectangles(model, viewersFor(model))) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(rect.width, 2.2, rect.height), fogMaterial);
      mesh.position.set(rect.x + rect.width / 2, 1.05, rect.y + rect.height / 2);
      fogGroup.add(mesh);
    }
    renderer.shadowMap.needsUpdate = true;
    invalidate();
  }
  function setActive(on) {
    active = on;
    keys.clear(); look = null;
    lastFrame = performance.now();
    cancelAnimationFrame(raf);
    if (on) {
      resize();
      if (pendingFit) { fit(); pendingFit = false; }
      loop();
    }
  }
  function setLayers(visible) {
    Object.entries(groups).forEach(([name, group]) => { group.visible = visible[name] !== false; });
    renderer.shadowMap.needsUpdate = true;
    invalidate();
  }
  function destroy() {
    stopGraphics();
    setActive(false);
    previewPlacement();
    placementMaterial.dispose();
    removeRightClick();
    observer.disconnect();
    controls.dispose();
    for (const [type, listener] of Object.entries(input)) renderer.domElement.removeEventListener(type, listener);
    window.removeEventListener('blur', input.blur);
    disposeContents();
    fogGroup.children.forEach(mesh => mesh.geometry.dispose());
    fogGroup.clear();
    fogMaterial.dispose();
    sun.shadow.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }
  return { setMap, setEnvironment, setLayers, setActive, setFirstPerson, firstPersonYaw: () => yaw, fit, destroy, tabletopPoint, screenPoint, tabletopHit, previewToken, previewObject, previewPlacement };
}
