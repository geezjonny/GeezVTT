// Adapted from view3d.js: grid coordinates map directly to world (x, z).
// One grid cell = one world unit = 5 ft; walls and doors are two units high.
import * as THREE from 'three';
import { isGM } from './session-role.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { onMapRightClick } from './map-right-click.js';
import { PORTAL_ICONS } from './portal-model.js';
import { createPropKit } from './prop-meshes.js';
import { propCorners, propAppearance } from './prop-model.js';
import { TIMES, environmentSettings, fogRectangles } from './environment-model.js';
import { MATERIALS } from './map-editor-model.js';
import { materialCanvas } from './material-textures.js';
import { pcTokenStatus } from './token-model.js';

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
  const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  controls.screenSpacePanning = false;
  const groups = { floors: new THREE.Group(), walls: new THREE.Group(), doors: new THREE.Group(), lights: new THREE.Group(), lightMarkers: new THREE.Group(), grid: new THREE.Group(), tokens: new THREE.Group(), portals: new THREE.Group(), props: new THREE.Group() };
  const root = new THREE.Group();
  Object.values(groups).forEach(group => root.add(group));
  scene.add(root);
  const fogGroup = new THREE.Group();
  scene.add(fogGroup);
  const fogMaterial = new THREE.MeshBasicMaterial({ color: '#080b10', transparent: isGM, opacity: isGM ? .55 : 1 });
  let model, active = false, raf = 0, dirty = true, pendingFit = false;
  let bounds;
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line.threshold = .03;
  const removeRightClick = onMapRightClick(renderer.domElement, event => {
    if (!active) return;
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    const hit = raycaster.intersectObjects([...groups.tokens.children, ...groups.portals.children, ...groups.lightMarkers.children, ...groups.props.children, ...groups.doors.children, ...groups.walls.children, ...(isGM ? [] : fogGroup.children)],true)[0];
    if (hit?.object.userData.tokenId) host.closest('#floor').dispatchEvent(new CustomEvent('token-edit', { detail: hit.object.userData.tokenId }));
    else if (hit?.object.userData.portalId) host.closest('#floor').dispatchEvent(new CustomEvent('portal-menu', {
      detail: { id: hit.object.userData.portalId, x: event.clientX, y: event.clientY }
    }));
    else if (hit?.object.userData.doorIndex !== undefined) host.closest('#floor').dispatchEvent(new CustomEvent('door-menu', {
      detail: { index: hit.object.userData.doorIndex, x: event.clientX, y: event.clientY }
    }));
    else if (hit?.object.userData.propId) host.closest('#floor').dispatchEvent(new CustomEvent('prop-menu', {
      detail: { id: hit.object.userData.propId, x: event.clientX, y: event.clientY }
    }));
    else if (hit?.object.userData.lightIndex !== undefined) host.closest('#floor').dispatchEvent(new CustomEvent('light-menu', {
      detail: { index: hit.object.userData.lightIndex, x: event.clientX, y: event.clientY }
    }));
  });
  const invalidate = () => { dirty = true; };
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
    return raycaster.intersectObjects([...groups.tokens.children, ...groups.portals.children, ...groups.lightMarkers.children, ...groups.doors.children, ...groups.walls.children, ...groups.props.children, ...(isGM ? [] : fogGroup.children)], true)[0]?.object.userData;
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
  function slabs(points, material, parent, open = false, doorIndex) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const dx = b.x - a.x, dz = b.y - a.y, length = Math.hypot(dx, dz);
      if (length < 0.00001) continue;
      const thickness = doorIndex !== undefined ? 0.06 : 0.12;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, 2, thickness), material);
      if (doorIndex !== undefined) mesh.userData.doorIndex = doorIndex;
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
    const material = (name, fallback) => {
      name=Object.hasOwn(palette,name)?name:fallback;
      if (!materials.has(name)) {
        const texture=new THREE.CanvasTexture(materialCanvas(name));
        texture.colorSpace=THREE.SRGBColorSpace;
        texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
        texture.anisotropy=renderer.capabilities.getMaxAnisotropy();
        materials.set(name,new THREE.MeshStandardMaterial({map:texture,bumpMap:texture,bumpScale:name==='metal'?.008:.035,
          roughness:name==='metal'?.4:name==='wood'?.8:.95,metalness:name==='metal'?.65:0}));
      }
      return materials.get(name);
    };
    for (const tile of model.floors || []) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material(tile.material, 'stone'));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(tile.x, -0.001, tile.y);
      mesh.receiveShadow = true;
      groups.floors.add(mesh);
    }
    model.walls.forEach((points, i) => slabs(points, material(model.wallMaterials?.[i], 'stone'), groups.walls));
    model.doors.forEach((door,index) => {
      if(door.hidden && !isGM) return;
      const window = door.type === 'window';
      const surface = window ? new THREE.MeshStandardMaterial({ color: '#8bd9f2', transparent: true, opacity: .25, roughness: .15, depthWrite: false })
        : material(door.material, 'wood');
      slabs(door.points, surface, groups.doors, !window && door.open, window?undefined:index);
    });
    const propMesh=createPropKit();
    const appearanceMesh=(appearance,key,value)=>{
      const mesh=propMesh(appearance);
      mesh.traverse(object=>{delete object.userData.propId; object.userData[key]=value;});
      return mesh;
    };
    for (const prop of model.props || []) if(isGM || !prop.hidden) groups.props.add(propMesh({...prop,kind:propAppearance(prop)?.kind || prop.kind}));
    model.lights.forEach((light,index)=>{
      if(light.propId || (light.hidden && !isGM)) return;
      const appearance=propAppearance(light);
      if(appearance) groups.lightMarkers.add(appearanceMesh(appearance,'lightIndex',index));
      else {
        const marker=new THREE.Mesh(new THREE.SphereGeometry(.12,8,6),new THREE.MeshBasicMaterial({color:light.color}));
        marker.position.set(light.x,.12,light.y); marker.userData.lightIndex=index;
        groups.lightMarkers.add(marker);
      }
    });
    for (const portal of model.portals || []) {
      if (portal.hidden && !isGM) continue;
      const appearance=propAppearance(portal);
      if(appearance) {
        groups.portals.add(appearanceMesh(appearance,'portalId',portal.id));
        continue;
      }
      const canvas=document.createElement('canvas');
      canvas.width=canvas.height=128;
      const context=canvas.getContext('2d');
      context.fillStyle='#502e73';
      context.beginPath(); context.arc(64,64,59,0,Math.PI*2); context.fill();
      context.strokeStyle='#d4a0ff'; context.lineWidth=6; context.stroke();
      context.fillStyle='#fff'; context.font='48px system-ui'; context.textAlign='center'; context.textBaseline='middle';
      context.fillText(PORTAL_ICONS[portal.icon] || PORTAL_ICONS.portal,64,64);
      const texture=new THREE.CanvasTexture(canvas);
      texture.colorSpace=THREE.SRGBColorSpace;
      const ring=new THREE.Mesh(new THREE.PlaneGeometry(.86,.86),new THREE.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.1,side:THREE.DoubleSide}));
      ring.rotation.x=-Math.PI/2; ring.position.set(portal.x,.015,portal.y);
      ring.userData.portalId=portal.id;
      groups.portals.add(ring);
    }
    for (const token of model.tokens || []) {
      const status = pcTokenStatus(token);
      const canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = status ? 384 : 256;
      const context = canvas.getContext('2d');
      context.fillStyle = '#344f70';
      context.beginPath(); context.arc(128, 128, 124, 0, Math.PI * 2); context.fill();
      context.strokeStyle = '#a2cbff'; context.lineWidth = 8; context.stroke();
      context.fillStyle = '#fff'; context.font = 'bold 76px system-ui'; context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText(token.name.split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join(''), 128, 128);
      if (status) {
        context.fillStyle = '#17212b'; context.fillRect(13, 272, 230, 23);
        context.fillStyle = status.color; context.fillRect(13, 272, 230 * status.fraction, 23);
        context.font = '600 36px system-ui'; context.lineWidth = 6; context.strokeStyle = '#17212b';
        context.strokeText(status.label, 128, 330, 250);
        context.fillStyle = '#fff'; context.fillText(status.label, 128, 330, 250);
      }
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const geometry = new THREE.PlaneGeometry(token.size, token.size * (status ? 1.5 : 1));
      if (status) geometry.translate(0, -token.size * .25, 0);
      const mesh = new THREE.Mesh(geometry,
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: .1 }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(token.x, .03, token.y);
      mesh.userData.tokenId = token.id;
      groups.tokens.add(mesh);
    }
    // Dispose materials for degenerate segments which produced no mesh.
    const used = new Set();
    root.traverse(object => { if (object.material) used.add(object.material); });
    materials.forEach(value => { if (!used.has(value)) { value.map?.dispose(); value.dispose(); } });
    const strength = light => light.off ? 0 : Math.max(0, Number.isFinite(light.intensity) ? light.intensity : 1) *
      THREE.MathUtils.clamp(Number.isFinite(light.opacity) ? light.opacity : 1, 0, 1);
    const lights = model.lights.filter(light => strength(light) > 0 && Number.isFinite(light.range) && light.range > 0);
    // shortcut: only the eight strongest eligible lights cast shadows; use tiled lighting for larger scenes.
    const shadowLights = new Set(lights.filter(light => light.source?.shadows !== false)
      .sort((a, b) => strength(b) - strength(a)).slice(0, 8));
    lights.forEach(light => {
      const height = Math.min(1.3, light.range / 2);
      const distance = Math.hypot(light.range, height);
      const source = new THREE.PointLight(light.color, strength(light) * 16, distance, 2);
      source.position.set(light.x, height, light.y);
      source.castShadow = shadowLights.has(light);
      source.shadow.mapSize.set(512, 512);
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
    controls.update();
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
    for (const rect of fogRectangles(model)) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(rect.width, 2.2, rect.height), fogMaterial);
      mesh.position.set(rect.x + rect.width / 2, 1.05, rect.y + rect.height / 2);
      fogGroup.add(mesh);
    }
    renderer.shadowMap.needsUpdate = true;
    invalidate();
  }
  function setActive(on) {
    active = on;
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
    setActive(false);
    removeRightClick();
    observer.disconnect();
    controls.dispose();
    disposeContents();
    fogGroup.children.forEach(mesh => mesh.geometry.dispose());
    fogGroup.clear();
    fogMaterial.dispose();
    sun.shadow.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }
  return { setMap, setEnvironment, setLayers, setActive, fit, destroy, tabletopPoint, screenPoint, tabletopHit, previewToken, previewObject };
}
