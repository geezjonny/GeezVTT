// Adapted from view3d.js: grid coordinates map directly to world (x, z).
// One grid cell = one world unit = 5 ft; walls and doors are two units high.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { onMapRightClick } from './map-right-click.js';

export function createMapView3D(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', '3D tabletop. Middle-drag to pan; scroll to zoom; right-drag to orbit. Right-click a token to edit.');
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
  const groups = { walls: new THREE.Group(), doors: new THREE.Group(), lights: new THREE.Group(), grid: new THREE.Group(), tokens: new THREE.Group() };
  const root = new THREE.Group();
  Object.values(groups).forEach(group => root.add(group));
  scene.add(root);
  let model, active = false, raf = 0, dirty = true, pendingFit = false;
  const raycaster = new THREE.Raycaster();
  const removeRightClick = onMapRightClick(renderer.domElement, event => {
    if (!active) return;
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    const hit = raycaster.intersectObjects(groups.tokens.children)[0];
    if (hit) host.closest('#floor').dispatchEvent(new CustomEvent('token-edit', { detail: hit.object.userData.tokenId }));
  });
  const invalidate = () => { dirty = true; };
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
    const radius = Math.hypot(model.width, model.height, 2) / 2;
    const fov = Math.min(THREE.MathUtils.degToRad(camera.fov), 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
    const distance = radius / Math.sin(fov / 2) * 1.12;
    const target = new THREE.Vector3(model.width / 2, 0.5, model.height / 2);
    controls.target.copy(target);
    camera.position.copy(target).add(new THREE.Vector3(0, 0.9, 0.8).normalize().multiplyScalar(distance));
    controls.minDistance = 0.5;
    controls.maxDistance = Math.max(distance * 4, 20);
    camera.far = Math.max(2000, distance * 8);
    camera.updateProjectionMatrix();
    controls.update();
    invalidate();
  }
  function slabs(points, material, parent, open = false) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const dx = b.x - a.x, dz = b.y - a.y, length = Math.hypot(dx, dz);
      if (length < 0.00001) continue;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, 2, 0.12), material);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.position.set((a.x + b.x) / 2, 1, (a.y + b.y) / 2);
      mesh.rotation.y = -Math.atan2(dz, dx);
      if (open) {
        // Swing the door 90 degrees around its first endpoint, leaving the opening clear.
        mesh.position.set(a.x - dz / 2, 1, a.y + dx / 2);
        mesh.rotation.y -= Math.PI / 2;
      }
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry),
        new THREE.LineBasicMaterial({ color: open ? 0x75f0b1 : 0x273445 }));
      mesh.add(edges);
      parent.add(mesh);
    }
  }
  function setMap(next, refit = true) {
    disposeContents();
    model = next;
    const texture = new THREE.Texture(model.image);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    texture.needsUpdate = true;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(model.width, model.height),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }));
    ground.receiveShadow = true;
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(model.width / 2, -0.005, model.height / 2);
    root.add(ground);
    const gridMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { size: { value: new THREE.Vector2(model.width, model.height) } },
      vertexShader: `varying vec2 gridUv;
        void main() { gridUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec2 size; varying vec2 gridUv;
        void main() {
          vec2 cell = vec2(gridUv.x, 1.0 - gridUv.y) * size;
          vec2 line = abs(fract(cell - 0.5) - 0.5) / max(fwidth(cell), vec2(0.0001));
          float alpha = 1.0 - min(min(line.x, line.y), 1.0);
          gl_FragColor = vec4(0.86, 0.9, 0.95, alpha * 0.55);
        }`
    });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(model.width, model.height), gridMaterial);
    grid.rotation.x = -Math.PI / 2;
    grid.position.set(model.width / 2, 0, model.height / 2);
    groups.grid.add(grid);
    const palette = { wood: '#a97848', stone: '#9ca3af', cobble: '#7e8275', brick: '#b96750', metal: '#a9c8d4' };
    const materials = new Map();
    const material = (name, fallback) => {
      const color = palette[name] || fallback;
      if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: name === 'metal' ? 0.35 : 0.85, metalness: name === 'metal' ? 0.65 : 0 }));
      return materials.get(color);
    };
    model.walls.forEach((points, i) => slabs(points, material(model.wallMaterials?.[i], '#a7aabb'), groups.walls));
    model.doors.forEach(door => slabs(door.points, material(door.material, door.open ? '#75b89a' : '#b47c42'), groups.doors, door.open));
    for (const token of model.tokens || []) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d');
      context.fillStyle = '#344f70';
      context.beginPath(); context.arc(128, 128, 124, 0, Math.PI * 2); context.fill();
      context.strokeStyle = '#a2cbff'; context.lineWidth = 8; context.stroke();
      context.fillStyle = '#fff'; context.font = 'bold 76px system-ui'; context.textAlign = 'center'; context.textBaseline = 'middle';
      context.fillText(token.name.split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join(''), 128, 128);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(token.size, token.size),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: .1 }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(token.x, .03, token.y);
      mesh.userData.tokenId = token.id;
      groups.tokens.add(mesh);
    }
    // Dispose materials for degenerate segments which produced no mesh.
    const used = new Set();
    root.traverse(object => { if (object.material) used.add(object.material); });
    materials.forEach(value => { if (!used.has(value)) value.dispose(); });
    const strength = light => Math.max(0, Number.isFinite(light.intensity) ? light.intensity : 1) *
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
    const radius = Math.hypot(model.width, model.height, 2) / 2;
    sun.target.position.set(model.width / 2, 0, model.height / 2);
    sun.position.copy(sun.target.position).add(new THREE.Vector3(-1, 2, 1).normalize().multiplyScalar(radius * 2));
    Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: 0.1, far: radius * 4 });
    sun.shadow.camera.updateProjectionMatrix();
    ambient.intensity = lights.length ? 0.22 : 0.8;
    sun.intensity = lights.length ? 0.35 : 2.5;
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
    sun.shadow.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }
  return { setMap, setLayers, setActive, fit, destroy };
}
