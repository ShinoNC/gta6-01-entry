import * as THREE from 'three';
import { intBetween, makeRng } from './random.js';
import { loadProp, loadGLB, MODEL_PATHS } from './models_loader.js';
// Mobile GPUs run MeshStandardMaterial with envMap 2-3x slower per
// pixel than Lambert — and glass facades cover most of the screen.
// On touch devices, facades use Lambert (same texture + night
// windows, no PBR reflections). Desktop keeps the reflective glass.
const IS_MOBILE = (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || (typeof navigator !== 'undefined' && /Android|iPhone|iPad/i.test(navigator.userAgent));
const facadeMaterial = (map, emissiveMap) => (IS_MOBILE
  ? new THREE.MeshLambertMaterial({ map, emissive: 0xffffff, emissiveMap, emissiveIntensity: 0 })
  : new THREE.MeshStandardMaterial({ map, emissive: 0xffffff, emissiveMap, emissiveIntensity: 0, metalness: 0.85, roughness: 0.15, envMapIntensity: 1.3 }));
// Zoned city: downtown glass towers in the centre, a commercial ring
// around them, residential streets beyond that, and beachfront villas on
// the outer ring — each zone reads differently at a glance (height,
// style, colour), instead of the same glass box on every block.
// ZONE_HOUSE_MODELS is the plug-in point: a new Vinish house GLB only
// needs its file in assets/models/, one row in HOUSE_MODELS below, and
// its name in one of these lists — the zone rotation picks it up.
const HOUSE_MODELS = {
  // w/d/h in metres + bbox centre offset (cx, cz), measured from the GLB
  // with gltf-transform inspect (the models are not centred on origin).
  'modern-house': { w: 12.8, d: 11.0, h: 6.97, cx: -0.1, cz: 1.45 },
  'beach-house': { w: 12.89, d: 13.79, h: 7.42, cx: 0.75, cz: 2.2 },
  'container-home': { w: 14.82, d: 6.49, h: 5.5, cx: 1.3, cz: 0.93 },
  bungalow: { w: 16.39, d: 12.21, h: 6.64, cx: 0, cz: 0.9 },
  'family-house': { w: 14.2, d: 11.0, h: 10.14, cx: 1.95, cz: 0.94 },
  'a-frame-cabin': { w: 8.0, d: 13.5, h: 7.45, cx: 0, cz: 1.65 },
  'tiny-house': { w: 9.1, d: 3.2, h: 4.3, cx: -0.7, cz: 0.1 },
  supermarket: { w: 36.0, d: 38.07, h: 9.6, cx: 0, cz: 6.97 },
  'corner-cafe': { w: 14.5, d: 14.5, h: 9.88, cx: 2.25, cz: 2.25 },
  'office-tower': { w: 30.2, d: 30.9, h: 69.74, cx: 0, cz: 4.35 },
};
const ZONE_HOUSE_MODELS = {
  residential: ['family-house', 'bungalow', 'container-home', 'tiny-house', 'a-frame-cabin', 'modern-house'],
  beachfront: ['beach-house', 'bungalow', 'family-house'],
};
const zoneForBlock = (col, row) => {
  if (col >= 4 && col <= 7 && row >= 4 && row <= 7) return 'downtown';
  if (col >= 3 && col <= 8 && row >= 3 && row <= 8) return 'commercial';
  if (col === 0 || col === 11 || row === 0 || row === 11) return 'beachfront';
  return 'residential';
};
// loadProp only knows the models registered in models_loader.js; the
// newer house/town models load through the shared cached loadGLB path
// instead (static props need no skeleton re-bind — a plain clone is
// enough, and it shares materials across instances).
const loadHouseModel = (name) => (MODEL_PATHS[name]
  ? loadProp(name)
  : loadGLB(`assets/models/${name}.glb`).then((g) => g.scene.clone(true)));
// Start loading the office tower GLB at module import: it is the
// tallest building and the most visible pop-in (glass box placeholder
// shows until the 1.7 MB GLB arrives). Preloading here means
// swapInGlb finds it cached when the tower is built.
loadHouseModel('office-tower').catch(() => {});
// VICE ROYALE is an island: a 12x12 block city grid (bigger than top-1
// KARIMBU's 10x10) with a beach ring and wide sea on all four sides.
// Pitch 52 is kept, so every existing coordinate (missions, businesses,
// shop, spray, parked cars) stays valid: the old 6x4 city is the centre
// of the new grid, and the new blocks fill the ring around it.
const CITY_BLOCK_COLUMNS = 10;
const CITY_BLOCK_ROWS = 10;
const BLOCK_SIZE = 40;
const ROAD_WIDTH = 12;
const STREET_PITCH = BLOCK_SIZE + ROAD_WIDTH;
const HALF_W = (CITY_BLOCK_COLUMNS * STREET_PITCH + ROAD_WIDTH) / 2;
const NORTH_EDGE = -HALF_W;
export const CITY_EDGE = HALF_W;
const BEACH_WIDTH = 38;
export const SHORELINE = HALF_W + BEACH_WIDTH;
// Hospital entrance: the starting spawn and the WASTED respawn.
export const HOSPITAL_SPAWN = { x: 8, z: -26 };
const WATER_SLOPE = 0.2;
const WATER_FAR = 1500;
export const MAP_EXTENT = 420;
const DISTRICTS = [
  { name: 'NORTHGATE', west: true, band: -1, lx: -159, lz: -263, colour: '#8a7bd8' },
  { name: 'FOG HARBOR', west: false, band: -1, lx: 159, lz: -263, colour: '#7ac4ff' },
  { name: 'OLD PORT', west: true, band: 0, lx: -107, lz: -135, colour: '#c98a5a' },
  { name: 'HARBOR LIGHTS', west: false, band: 0, lx: 107, lz: -135, colour: '#ffd978' },
  { name: 'LANTERN ROW', west: true, band: 1, lx: -107, lz: -13, colour: '#ff5aa8' },
  { name: 'MARINA DEL SOL', west: false, band: 1, lx: 107, lz: -13, colour: '#2ad0c4' },
  { name: 'PALM ROW', west: true, band: 2, lx: -107, lz: 42, colour: '#7affc4' },
  { name: 'PELICAN BAY', west: false, band: 2, lx: 107, lz: 42, colour: '#9fd4e8' },
  { name: 'SUNSET KEYS', west: true, band: 3, lx: -159, lz: 107, colour: '#ff7a3d' },
  { name: 'GULL HARBOR', west: false, band: 3, lx: 159, lz: 107, colour: '#ff8a94' },
  { name: 'SOUTH POINT', west: true, band: 4, lx: -159, lz: 237, colour: '#3da86b' },
  { name: 'BEACON KEY', west: false, band: 4, lx: 159, lz: 237, colour: '#e8a33d' },
];
// Every named place on the island (city districts + the two beach names
// the shoreline returns) for the map's District Standing panel.
export function districtList() {
  return [
    ...DISTRICTS.map((d) => ({ name: d.name, colour: d.colour })),
    { name: 'CORAL STRAND', colour: '#f0cd8c' },
    { name: 'SUNSET BLUFF', colour: '#e8b07a' },
  ];
}
export function districtNameAt(x, z) {
  if (Math.abs(x) > CITY_EDGE || Math.abs(z) > CITY_EDGE) return x < 0 ? 'CORAL STRAND' : 'SUNSET BLUFF';
  const band = z < -208 ? -1 : z <= -STREET_PITCH ? 0 : z < 26 ? 1 : z < 58 ? 2 : z < 156 ? 3 : 4;
  const west = x < 0;
  return DISTRICTS.find((d) => d.west === west && d.band === band).name;
}
export function districtLabels() {
  return [...DISTRICTS.map((d) => ({ name: d.name, x: d.lx, z: d.lz })), { name: 'CORAL STRAND', x: -159, z: 337 }, { name: 'SUNSET BLUFF', x: 159, z: 337 }];
}
// Street density by time of day (GTA-like: 3am streets are near-empty,
// the evening is moderate, daytime is full). Keyframes in game minutes;
// linear between them. The nightlife districts stay busier at night.
export const NIGHTLIFE_DISTRICTS = ['LANTERN ROW', 'MARINA DEL SOL'];
const NIGHTLIFE_FLOOR = 0.7;
const DENSITY_KEYS = [[0, 0.6], [60, 0.6], [120, 0.22], [360, 0.22], [420, 1], [1320, 1], [1380, 0.6], [1440, 0.6]];
export function densityForMinute(minutes) {
  const t = ((minutes % 1440) + 1440) % 1440;
  for (let i = 0; i < DENSITY_KEYS.length - 1; i += 1) {
    const [t0, d0] = DENSITY_KEYS[i];
    const [t1, d1] = DENSITY_KEYS[i + 1];
    if (t >= t0 && t <= t1) return t1 === t0 ? d0 : d0 + ((d1 - d0) * (t - t0)) / (t1 - t0);
  }
  return 0.6;
}
export function averageDensity(minutes) {
  const base = densityForMinute(minutes);
  return (10 * base + 2 * Math.max(base, NIGHTLIFE_FLOOR)) / 12;
}
const blockCentreX = (c) => -HALF_W + ROAD_WIDTH + BLOCK_SIZE / 2 + c * STREET_PITCH;
const blockCentreZ = (r) => NORTH_EDGE + ROAD_WIDTH + BLOCK_SIZE / 2 + r * STREET_PITCH;
const roadCentreX = (i) => -HALF_W + ROAD_WIDTH / 2 + i * STREET_PITCH;
const roadCentreZ = (i) => NORTH_EDGE + ROAD_WIDTH / 2 + i * STREET_PITCH;
export function roadLines() {
  const lines = [];
  for (let i = 0; i <= CITY_BLOCK_COLUMNS; i += 1) {
    lines.push({ axis: 'z', at: roadCentreX(i), from: NORTH_EDGE, to: HALF_W });
  }
  for (let j = 0; j <= CITY_BLOCK_ROWS; j += 1) {
    lines.push({ axis: 'x', at: roadCentreZ(j), from: -HALF_W, to: HALF_W });
  }
  return lines;
}
// Compass heading for driving along a road line in a direction.
export function headingFor(axis, direction) {
  if (axis === 'z') return direction > 0 ? 0 : Math.PI;
  return direction > 0 ? Math.PI / 2 : -Math.PI / 2;
}
// Water depth in metres: 0 on land, growing 1m per 5m past the shoreline.
// The depth gradient IS the boundary — no invisible wall at the shore.
// Cars stall at ~1.4m, the player starts swimming at ~1m.
export function waterDepthAt(x, z) {
  const dx = Math.max(0, Math.abs(x) - SHORELINE);
  const dz = Math.max(0, Math.abs(z) - SHORELINE);
  return Math.hypot(dx, dz) * WATER_SLOPE;
}
export function shoreOutward(x, z) {
  const cx = Math.max(-SHORELINE, Math.min(SHORELINE, x));
  const cz = Math.max(-SHORELINE, Math.min(SHORELINE, z));
  const dx = x - cx;
  const dz = z - cz;
  const d = Math.hypot(dx, dz);
  return d > 0.001 ? { x: dx / d, z: dz / d } : null;
}
function skyGradientTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  for (const [o, c] of [[0, '#3a7bd5'], [0.4, '#6db3e8'], [0.7, '#a8d8f0'], [1, '#d4eefc']]) gradient.addColorStop(o, c);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function resolveCircleAgainstBoxes(position, radius, boxes) {
  for (const box of boxes) {
    const nearestX = Math.max(box.minX, Math.min(position.x, box.maxX));
    const nearestZ = Math.max(box.minZ, Math.min(position.z, box.maxZ));
    const dx = position.x - nearestX;
    const dz = position.z - nearestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq >= radius * radius) continue;
    if (distSq > 0.0001) {
      const dist = Math.sqrt(distSq);
      position.x = nearestX + (dx / dist) * radius;
      position.z = nearestZ + (dz / dist) * radius;
    } else {
      const push = [position.x - box.minX + radius, box.maxX - position.x + radius, position.z - box.minZ + radius, box.maxZ - position.z + radius];
      const m = Math.min(...push);
      if (m === push[0]) position.x = box.minX - radius;
      else if (m === push[1]) position.x = box.maxX + radius;
      else if (m === push[2]) position.z = box.minZ - radius;
      else position.z = box.maxZ + radius;
    }
  }
}
// Window cells in a facade texture: connected components of the two window
// colours (dark slate unlit, warm yellow lit-by-day). All four facades
// share those colours, so one detector covers them.
function windowCells(image) {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const isWindow = (x, y) => {
    const i = (y * canvas.width + x) * 4;
    return (data[i] === 88 && data[i + 1] === 110 && data[i + 2] === 150)
      || (data[i] === 255 && data[i + 1] === 214 && data[i + 2] === 120);
  };
  const seen = new Uint8Array(canvas.width * canvas.height);
  const cells = [];
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (!isWindow(x, y) || seen[y * canvas.width + x]) continue;
      let minX = x, maxX = x, minY = y, maxY = y, area = 0;
      const stack = [[x, y]];
      seen[y * canvas.width + x] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        area += 1;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
          if (nx < 0 || ny < 0 || nx >= canvas.width || ny >= canvas.height) continue;
          if (seen[ny * canvas.width + nx] || !isWindow(nx, ny)) continue;
          seen[ny * canvas.width + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      if (area >= 12) cells.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
    }
  }
  return cells;
}
// Night emissive map for one building: black everywhere except a random
// ~60% of its windows, glowing warm yellow. Rolled per building, so no
// two buildings share a lit pattern.
function litWindowsTexture(cells, rng) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, 64, 64);
  const shades = ['#ffd978', '#ffce6b', '#ffe6a8'];
  for (const cell of cells) {
    if (rng() >= 0.6) continue;
    ctx.fillStyle = shades[Math.floor(rng() * shades.length)];
    ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
// Building name signs: fictional GTA-style names, one shared canvas
// texture per name. White bold text on a dark panel with a gold border
// (white on #141030 is ~16:1) — readable from street level, and the
// emissive map makes the sign glow at night like the lit windows.
const SIGN_NAMES = ['PALM HOTEL', 'VICE DINER', 'NEON MART', 'CORAL CAFE', 'SUNSET BAR', 'KEYS BAKERY', 'MARINA MOTEL', 'LANTERN LOUNGE', 'HARBOR GYM', 'OLD PORT TAVERN', 'PELICAN PIZZA', 'SOLARIS SUSHI', 'BLUFF BOOKS', 'GULL GROCERY', 'EMBER GRILL', 'TIDE TATTOO', 'COCONUT CLUB', 'STARFISH SPA', 'ANCHOR ARMS', 'RIPTIDE RECORDS', 'OCEAN DRIVE INN', 'NEON PALMS HOTEL', 'CORAL BAY RESORT', 'SUNSET STRIP CAFE', 'VICE CITY TACOS', 'PALM COURT HOTEL', 'BAYSIDE BISTRO', 'TROPICANA LOUNGE', 'SEASIDE STEAKHOUSE', 'MIAMI VICE BAR', 'CORAL GABLES INN', 'OCEAN BREEZE SPA', 'PALM BEACH GRILL', 'SUNSET COVE HOTEL', 'VICE ROYALE CASINO', 'TROPICAL SMOOTHIES', 'BEACHFRONT BAKERY', 'MARINA BAY HOTEL', 'COCONUT GROVE CAFE', 'STARFISH INN'];
const signTextureCache = new Map();
function makeSignTexture(text) {
  if (signTextureCache.has(text)) return signTextureCache.get(text);
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#141030';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#ffc828';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 56px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 68, 470);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  signTextureCache.set(text, texture);
  return texture;
}
const signMaterialCache = new Map();
export function signMaterialFor(text) {
  if (signMaterialCache.has(text)) return signMaterialCache.get(text);
  const tex = makeSignTexture(text);
  const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0 });
  signMaterialCache.set(text, mat);
  return mat;
}
// Which facade of a box faces a target point (a road or a named place).
function facingFor(box, tx, tz) {
  const d = [
    ['S', Math.abs(tz - box.maxZ)],
    ['N', Math.abs(tz - box.minZ)],
    ['E', Math.abs(tx - box.maxX)],
    ['W', Math.abs(tx - box.minX)],
  ];
  d.sort((a, b) => a[1] - b[1]);
  return d[0][0];
}
const SIGN_W = 8, SIGN_H = 2, SIGN_Y = 4.5;
function signPlacement(box, facing) {
  if (facing === 'S') return { x: (box.minX + box.maxX) / 2, z: box.maxZ + 0.12, rotY: 0, nx: 0, nz: 1 };
  if (facing === 'N') return { x: (box.minX + box.maxX) / 2, z: box.minZ - 0.12, rotY: Math.PI, nx: 0, nz: -1 };
  if (facing === 'E') return { x: box.maxX + 0.12, z: (box.minZ + box.maxZ) / 2, rotY: Math.PI / 2, nx: 1, nz: 0 };
  return { x: box.minX - 0.12, z: (box.minZ + box.maxZ) / 2, rotY: -Math.PI / 2, nx: -1, nz: 0 };
}
export function buildCity(scene, textures, rng) {
  const group = new THREE.Group();
  const buildingBoxes = [];
  const buildingMaterials = [];
  const signMaterials = [];
  const signs = [];
  const skyTex = skyGradientTexture();
  const nightSky = new THREE.Color(0x14102a);
  const daySunCol = new THREE.Color(0xfff2d0);
  const nightSunCol = new THREE.Color(0x8090c8);
  // Sunset colours: the light passes through orange at dusk/dawn
  // (f≈0.5) instead of lerping straight from warm white to blue.
  const sunsetSunCol = new THREE.Color(0xff9a3c);
  const sunsetFogCol = new THREE.Color(0xe89a5a);
  const nightFogCol = new THREE.Color(0x14102a);
  const dayFogCol = new THREE.Color(0xbfd9e8);
  const daySunDiscCol = new THREE.Color(0xffe9a8);
  const sunsetDiscCol = new THREE.Color(0xff7a2a);
  scene.background = skyTex;
  // Sky environment for the glass towers: an equirect gradient (deep blue
  // zenith, bright horizon, warm ground) with a sun-glare patch toward the
  // sun, so the MeshStandardMaterial glass reflects the island sky instead
  // of rendering black. Lambert materials ignore scene.environment, so
  // nothing else in the scene changes.
  const envCanvas = document.createElement('canvas');
  envCanvas.width = 64;
  envCanvas.height = 32;
  const envCtx = envCanvas.getContext('2d');
  const envGrad = envCtx.createLinearGradient(0, 0, 0, 32);
  envGrad.addColorStop(0, '#2f6fc4');
  envGrad.addColorStop(0.42, '#7fb8e8');
  envGrad.addColorStop(0.5, '#eef7ff');
  envGrad.addColorStop(0.56, '#c8d8c0');
  envGrad.addColorStop(1, '#8a7a5a');
  envCtx.fillStyle = envGrad;
  envCtx.fillRect(0, 0, 64, 32);
  envCtx.fillStyle = 'rgba(255,242,205,0.95)';
  envCtx.fillRect(50, 11, 9, 4);
  envCtx.fillStyle = 'rgba(255,242,205,0.5)';
  envCtx.fillRect(47, 9, 15, 8);
  const envTexture = new THREE.CanvasTexture(envCanvas);
  envTexture.mapping = THREE.EquirectangularReflectionMapping;
  envTexture.colorSpace = THREE.SRGBColorSpace;
  scene.environment = envTexture;
  scene.fog = new THREE.Fog(0xbfd9e8, 120, 900);
  const sun = new THREE.Mesh(new THREE.CircleGeometry(26, 24), new THREE.MeshBasicMaterial({ color: 0xffe9a8, fog: false }));
  sun.position.set(-180, 42, 420);
  sun.lookAt(0, 20, 0);
  group.add(sun);
  // Moon: a pale disc in the north-east sky, visible only at night
  // (the sun hides when f > 0.5 — without a moon the night sky was
  // empty). Placed high so it reads from the beach and the title shot.
  const moon = new THREE.Mesh(new THREE.CircleGeometry(18, 24), new THREE.MeshBasicMaterial({ color: 0xe8ecf5, fog: false }));
  moon.position.set(180, 80, -320);
  moon.lookAt(0, 20, 0);
  moon.visible = false;
  group.add(moon);
  const flat = (tex, rx, ry, w, d, x, y, z) => {
    const t = tex.clone();
    t.needsUpdate = true;
    t.repeat.set(rx, ry);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: t }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  // Island stack: wide ocean underneath everything, a sand sheet for the
  // beach ring, then the city ground on top — the sand shows as a 38m
  // ring around all four sides. Roads sit above the ground.
  const ocean = flat(textures.water, 120, 120, WATER_FAR * 2, WATER_FAR * 2, 0, -0.15, 0);
  const waterTexture = ocean.material.map;
  flat(textures.sand, 40, 40, SHORELINE * 2, SHORELINE * 2, 0, 0.01, 0);
  const ground = flat(textures.sidewalk, 80, 80, HALF_W * 2, HALF_W * 2, 0, 0.02, 0);
  ground.receiveShadow = true;
  // Procedural strips end at the city edge (+/-266): the old 544m strips
  // poked 6m onto the sand at both ends.
  for (let i = 0; i <= CITY_BLOCK_COLUMNS; i += 1) {
    flat(textures.road, 1, 61, ROAD_WIDTH, HALF_W * 2, roadCentreX(i), 0.03, 0);
  }
  for (let j = 0; j <= CITY_BLOCK_ROWS; j += 1) {
    const stripTexture = textures.road.clone();
    stripTexture.needsUpdate = true;
    stripTexture.repeat.set(1, 61);
    const stripGeometry = new THREE.PlaneGeometry(ROAD_WIDTH, HALF_W * 2);
    stripGeometry.rotateX(-Math.PI / 2);
    stripGeometry.rotateY(Math.PI / 2);
    const strip = new THREE.Mesh(stripGeometry, new THREE.MeshLambertMaterial({ map: stripTexture }));
    strip.position.set(0, 0.04, roadCentreZ(j));
    group.add(strip);
  }
  const facades = [textures.facadeA, textures.facadeB, textures.facadeC, textures.facadeD, textures.facadeE, textures.facadeF];
  const facadeCells = facades.map((facade) => windowCells(facade.image));
  const roofMaterial = new THREE.MeshLambertMaterial({ map: textures.roof });
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const signGeometry = new THREE.PlaneGeometry(SIGN_W, SIGN_H);
  // One shared radial glow texture: sign halos, streetlight glow + pools.
  const glowTexture = (() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  // Sign halos: one shared additive material, one 12x4 plane per sign
  // sitting just behind it so the rim glows around the panel at night.
  const haloGeometry = new THREE.PlaneGeometry(12, 4);
  const haloMaterial = new THREE.MeshBasicMaterial({ map: glowTexture, color: 0xffd978, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  // Ground-floor lobby: dark glass entrance with gold trim, display
  // windows, and planter boxes — one shared canvas texture per shop.
  const storefrontTexture = (() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 112;
    const x = c.getContext('2d');
    x.fillStyle = '#2a2f3a';
    x.fillRect(0, 0, 256, 112);
    // Gold trim band along the top.
    x.fillStyle = '#c8a85c';
    x.fillRect(0, 0, 256, 5);
    x.fillRect(0, 24, 256, 2);
    // Dark glass display windows with a diagonal sky reflection.
    for (const wx of [10, 184]) {
      x.fillStyle = '#5a7a9a';
      x.fillRect(wx, 34, 62, 58);
      x.fillStyle = '#9fd4e8';
      x.beginPath();
      x.moveTo(wx, 92);
      x.lineTo(wx + 24, 34);
      x.lineTo(wx + 40, 34);
      x.lineTo(wx + 16, 92);
      x.closePath();
      x.fill();
    }
    // Glass entrance door, centre, with gold frame and handle.
    x.fillStyle = '#c8a85c';
    x.fillRect(96, 34, 64, 68);
    x.fillStyle = '#7aa8c8';
    x.fillRect(100, 38, 56, 64);
    x.fillStyle = '#e8f4ff';
    x.beginPath();
    x.moveTo(100, 102);
    x.lineTo(122, 38);
    x.lineTo(132, 38);
    x.lineTo(110, 102);
    x.closePath();
    x.fill();
    x.fillStyle = '#c8a85c';
    x.fillRect(148, 62, 4, 18);
    // Planter boxes with green shrubs at both ends.
    for (const px of [14, 208]) {
      x.fillStyle = '#4a4238';
      x.fillRect(px, 92, 34, 10);
      x.fillStyle = '#2fd35e';
      x.beginPath();
      x.arc(px + 8, 90, 7, 0, Math.PI * 2);
      x.arc(px + 17, 87, 8, 0, Math.PI * 2);
      x.arc(px + 26, 90, 7, 0, Math.PI * 2);
      x.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const storefrontGeometry = new THREE.PlaneGeometry(8, 3.5);
  const storefrontMaterial = new THREE.MeshLambertMaterial({ map: storefrontTexture });
  // Rooftop + facade dressing, shared across all buildings: AC units,
  // water towers (tank + cone roof + leg), antenna masts, 3D awnings in
  // four colours, and a merged balcony unit (slab + railing, one mesh).
  const acGeo = new THREE.BoxGeometry(1.2, 0.8, 1.2);
  const acMat = new THREE.MeshLambertMaterial({ color: 0xb8b8c2 });
  const waterTankGeo = new THREE.CylinderGeometry(1.2, 1.2, 2, 8);
  const waterRoofGeo = new THREE.ConeGeometry(1.5, 1, 8);
  const waterLegGeo = new THREE.BoxGeometry(0.4, 2, 0.4);
  const waterMat = new THREE.MeshLambertMaterial({ color: 0xa87858 });
  const antennaGeo = new THREE.CylinderGeometry(0.06, 0.06, 5, 4);
  const antennaMat = new THREE.MeshLambertMaterial({ color: 0x70707c });
  const antennaTipGeo = new THREE.SphereGeometry(0.15, 6, 5);
  const antennaTipMat = new THREE.MeshBasicMaterial({ color: 0xff2a3a });
  const awningGeo = new THREE.BoxGeometry(6, 0.12, 1.6);
  const awningMats = [0x3a3f4a, 0x8a6f3a, 0x2a4a5a, 0x5a5a6a].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const balconyGeo = mergedGeo([
    [new THREE.BoxGeometry(2.4, 0.15, 0.9), new THREE.Matrix4().makeTranslation(0, 0, 0)],
    [new THREE.BoxGeometry(2.4, 0.5, 0.06), new THREE.Matrix4().makeTranslation(0, 0.32, 0.42)],
  ]);
  const balconyMat = new THREE.MeshLambertMaterial({ color: 0x9fb8cc });
  // Vent pipes (stack + cap disc), rooftop garden (planter + bushes)
  // and the parapet rim material: a real rim of four thin walls, not
  // the old solid slab that capped the roof in flat grey.
  const ventGeo = new THREE.CylinderGeometry(0.28, 0.28, 1.4, 6);
  const ventCapGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.18, 6);
  const ventMat = new THREE.MeshLambertMaterial({ color: 0x8a8a96 });
  const planterGeo = new THREE.BoxGeometry(3.2, 0.7, 1.6);
  const planterMat = new THREE.MeshLambertMaterial({ color: 0x9a8a76 });
  const bushGeo = new THREE.SphereGeometry(0.9, 7, 6);
  const bushMat = new THREE.MeshLambertMaterial({ color: 0x3da86b });
  const parapetMat = new THREE.MeshLambertMaterial({ color: 0xcfc8ba });
  // House dressing (residential/beachfront zones): shared pastel wall
  // palettes, roof colours, a unit pyramid roof (base is a square of
  // side sqrt(2) after the 45-degree turn — scale by w/1.414), and a
  // door + window set so a box house reads as a house, not a crate.
  const pyramidGeo = new THREE.ConeGeometry(1, 1, 4);
  pyramidGeo.rotateY(Math.PI / 4);
  const houseWallMats = [0xf2e6d0, 0xe8c9a0, 0xd0e0c0, 0xc0d8e8, 0xe8b8a0, 0xd8c8e8, 0xf0d8b0, 0xc8d8c8].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const villaWallMats = [0xfff6e8, 0xf0e8d8, 0xd8f0e8, 0xffe8d0, 0xe8f0f8].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const houseRoofMats = [0xa85a3a, 0x8a4a3a, 0x5a5a6a, 0x7a5a3a, 0x9a3a3a].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const doorMat = new THREE.MeshLambertMaterial({ color: 0x6a4a2a });
  const windowMat = new THREE.MeshLambertMaterial({ color: 0x9fc8d8 });
  const doorGeo = new THREE.BoxGeometry(0.9, 2.1, 0.12);
  const windowGeo = new THREE.BoxGeometry(1.2, 1.2, 0.12);
  const pickMat = (mats) => mats[Math.floor(rng() * mats.length)];
  // Landmark night animation (lighthouse beam, ferris wheel) + night factor.
  let nightF = 0, nightClock = 0;
  const landmarkNight = { beam: null, beamMat: null, wheel: null, hubMat: null, cabinPivots: null };
  const usedNamesByRoad = new Map();
  const buildings = [];
  const addSign = (box, name, tx, tz) => {
    const facing = facingFor(box, tx, tz);
    const p = signPlacement(box, facing);
    // Per-sign material instance: shared materials cannot blink out of
    // phase, so each sign gets its own clone (texture still shared).
    const mat = signMaterialFor(name).clone();
    const phase = rng() * Math.PI * 2;
    signMaterials.push({ mat, phase });
    const mesh = new THREE.Mesh(signGeometry, mat);
    mesh.position.set(p.x, SIGN_Y, p.z);
    mesh.rotation.y = p.rotY;
    group.add(mesh);
    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
    halo.position.set(p.x - p.nx * 0.06, SIGN_Y, p.z - p.nz * 0.06);
    halo.rotation.y = p.rotY;
    group.add(halo);
    const entry = { name, x: p.x, y: SIGN_Y, z: p.z, box, mesh, halo, p };
    signs.push(entry);
    return entry;
  };
  // Zoned skyline: downtown draws the tall tiers (7-12 storeys), the
  // commercial ring stays mid-rise (3-6 storeys) — a tall tower never
  // stands next to another tall tower within downtown (lastTall caps
  // the next plot), so the rhythm reads short-tall-short instead of a
  // flat line or a clump. VICE TOWER (70m, Office Tower GLB) stays the
  // tallest silhouette on the island. Residential/beachfront blocks
  // never reach this code — they are houses, built below.
  let lastTall = false;
  const rollHeight = (zone) => {
    if (zone === 'downtown') {
      const t = rng();
      if (t < 0.25) return intBetween(rng, 18, 24);
      if (t < 0.65) return intBetween(rng, 24, 32);
      return intBetween(rng, 32, 40);
    }
    return intBetween(rng, 9, 18);
  };
  // A GLB plot is built as a box first (same footprint, so the
  // swapped for the model when it loads; on load failure the box stays
  // and the game is fine. The holder starts INVISIBLE: a box that
  // suddenly morphs into a detailed building reads as a bug, while a
  // building popping in once reads as loading. Extras (tower helipad
  // and sign) hide with the holder and appear with the model.
  const swapInGlb = (name, holder, x, z, rotY, extras = []) => {
    holder.visible = false;
    for (const e of extras) e.visible = false;
    loadHouseModel(name).then((glb) => {
      const spec = HOUSE_MODELS[name];
      glb.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      const wrap = new THREE.Group();
      wrap.name = `glb-${name}`;
      wrap.position.set(x, 0, z);
      wrap.rotation.y = rotY;
      glb.position.set(-spec.cx, 0, -spec.cz);
      wrap.add(glb);
      // GLB models are static once placed: compute matrices FIRST,
      // then freeze them so the renderer skips the per-frame recompute.
      // (Freeze-before-compute leaves identity matrices — everything
      // renders at the origin with frustum culling broken.)
      wrap.updateMatrixWorld(true);
      wrap.traverse((o) => { o.matrixAutoUpdate = false; });
      group.add(wrap);
      group.remove(holder);
      for (const e of extras) e.visible = true;
    }).catch(() => {
      holder.visible = true;
      for (const e of extras) e.visible = true;
    });
  };
  const buildGlbHouse = (name, x, z, rotIdx) => {
    const spec = HOUSE_MODELS[name];
    const rotY = rotIdx * Math.PI / 2;
    const swapped = rotIdx % 2 === 1;
    const w = swapped ? spec.d : spec.w;
    const d = swapped ? spec.w : spec.d;
    const wallH = Math.max(3, spec.h - 1.8);
    const holder = new THREE.Group();
    holder.name = `placeholder-${name}`;
    holder.position.set(x, 0, z);
    const box = new THREE.Mesh(boxGeometry, pickMat(houseWallMats));
    box.scale.set(w, wallH, d);
    box.position.y = wallH / 2;
    box.castShadow = true;
    const roof = new THREE.Mesh(pyramidGeo, pickMat(houseRoofMats));
    roof.scale.set(w * 0.7071, 1.8, d * 0.7071);
    roof.position.y = wallH + 0.9;
    holder.add(box, roof);
    group.add(holder);
    buildingBoxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    swapInGlb(name, holder, x, z, rotY);
  };
  const buildBoxHouse = (x, z, zone) => {
    const w = 10 + Math.floor(rng() * 5);
    const d = 9 + Math.floor(rng() * 4);
    const h = 4 + Math.floor(rng() * (zone === 'beachfront' ? 2 : 3));
    const box = new THREE.Mesh(boxGeometry, pickMat(zone === 'beachfront' ? villaWallMats : houseWallMats));
    box.scale.set(w, h, d);
    box.position.set(x, h / 2, z);
    box.castShadow = true;
    box.receiveShadow = true;
    group.add(box);
    // Roof variety: pyramid or a single shed slope. No flat slab — a
    // flat slab reads as a crate.
    const roofRoll = rng();
    const roofMat = pickMat(houseRoofMats);
    if (roofRoll < 0.5) {
      const roof = new THREE.Mesh(pyramidGeo, roofMat);
      roof.scale.set(w * 0.7071, 2, d * 0.7071);
      roof.position.set(x, h + 1, z);
      group.add(roof);
    } else {
      const shed = new THREE.Mesh(boxGeometry, roofMat);
      shed.scale.set(w + 0.6, 0.15, d + 0.6);
      shed.position.set(x, h + 0.55, z);
      shed.rotation.x = 0.22;
      group.add(shed);
    }
    // Door + two windows on the south face, so the box reads as a house.
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.position.set(x, 1.05, z + d / 2 + 0.06);
    const winL = new THREE.Mesh(windowGeo, windowMat);
    winL.position.set(x - w / 4, 2.4, z + d / 2 + 0.06);
    const winR = new THREE.Mesh(windowGeo, windowMat);
    winR.position.set(x + w / 4, 2.4, z + d / 2 + 0.06);
    group.add(door, winL, winR);
    buildingBoxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  };
  const buildHouseBlock = (col, row, cx, cz, zone) => {
    // Two plots per block, both GLB houses: the model cycles through
    // the zone list by block hash (so every model shows up several
    // times and adjacent plots differ) and the rotation cycles too.
    // Box houses are gone — a flat slab with a door on one face read
    // as a beige crate from every other angle.
    const models = ZONE_HOUSE_MODELS[zone];
    for (let pi = 0; pi < 2; pi += 1) {
      const x = cx + (pi === 0 ? -10 : 10);
      buildGlbHouse(models[(col * 5 + row * 3 + pi) % models.length], x, cz, (col + row + pi) % 4);
    }
  };
  // Town GLB (supermarket / corner cafe): placeholder box + a shop sign
  // on the south face; the sign stays when the model swaps in. Like the
  // hospital, town buildings are NOT in `buildings` — a named sign must
  // never overwrite their own sign.
  const buildGlbBuilding = (name, x, z, signName) => {
    const spec = HOUSE_MODELS[name];
    const holder = new THREE.Group();
    holder.name = `placeholder-${name}`;
    holder.position.set(x, 0, z);
    const box = new THREE.Mesh(boxGeometry, new THREE.MeshLambertMaterial({ color: 0xe8e0d0 }));
    box.scale.set(spec.w, spec.h, spec.d);
    box.position.y = spec.h / 2;
    box.castShadow = true;
    holder.add(box);
    group.add(holder);
    const boxRec = { minX: x - spec.w / 2, maxX: x + spec.w / 2, minZ: z - spec.d / 2, maxZ: z + spec.d / 2 };
    buildingBoxes.push(boxRec);
    // Sign target 1m south of the south face: facingFor picks the
    // NEAREST face, and a far target (z+52) lands closer to the east /
    // west faces of a wide building than to its south face.
    if (signName) addSign(boxRec, signName, x, z + spec.d / 2 + 1);
    swapInGlb(name, holder, x, z, 0);
  };
  for (let row = 0; row < CITY_BLOCK_ROWS; row += 1) {
    for (let column = 0; column < CITY_BLOCK_COLUMNS; column += 1) {
      const cx = blockCentreX(column);
      const cz = blockCentreZ(row);
      // Reserved blocks: hospital (6,5), VICE TOWER (5,9), clock tower
      // (5,5), casino (9,2), stadium (3,9) — built separately below.
      if ((column === 6 && row === 5) || (column === 5 && row === 9) || (column === 5 && row === 5) || (column === 9 && row === 2) || (column === 3 && row === 9)) continue;
      const zone = zoneForBlock(column, row);
      if (zone === 'residential' || zone === 'beachfront') {
        buildHouseBlock(column, row, cx, cz, zone);
        continue;
      }
      // Town anchors: the supermarket fills block (3,3) on its own
      // (36x38m); the corner cafe shares block (8,8) with one glass
      // mid-rise next door.
      if (column === 3 && row === 3) {
        buildGlbBuilding('supermarket', cx, cz, 'SUPERMARKET');
        continue;
      }
      const twin = rng() < 0.45;
      const depth = 28 + 4 * Math.floor(rng() * 3);
      // Corner cafe block: the cafe takes the west plot, one glass
      // mid-rise takes the east plot.
      if (column === 8 && row === 8) buildGlbBuilding('corner-cafe', cx - 10, cz, 'CORNER CAFE');
      const plots = (column === 8 && row === 8)
        ? [{ x: cx + 10, z: cz, w: 16, d: depth }]
        : twin
          ? [{ x: cx - 10, z: cz, w: 16 + 2 * Math.floor(rng() * 3), d: depth }, { x: cx + 10, z: cz, w: 16 + 2 * Math.floor(rng() * 3), d: depth }]
          : [{ x: cx, z: cz, w: 30 + 2 * Math.floor(rng() * 3), d: depth }];
      for (const plot of plots) {
        let height = rollHeight(zone);
        if (lastTall && height > 20) height = intBetween(rng, 8, 14);
        lastTall = height > 28;
        const facadeIndex = Math.floor(rng() * facades.length);
        const facadeTexture = facades[facadeIndex].clone();
        facadeTexture.needsUpdate = true;
        const repeatX = Math.max(1, Math.round(plot.w / 10));
        const repeatY = Math.max(1, Math.round(height / 8));
        facadeTexture.repeat.set(repeatX, repeatY);
        const emissiveTexture = litWindowsTexture(facadeCells[facadeIndex], rng);
        emissiveTexture.repeat.set(repeatX, repeatY);
        // Glass curtain wall: high metalness + low roughness so the facade
        // reflects the sky environment and gleams in the sun; the emissive
        // map still drives the night windows (emissive is independent of
        // metalness). On mobile this is Lambert (see facadeMaterial).
        const side = facadeMaterial(facadeTexture, emissiveTexture);
        buildingMaterials.push(side);
        // One material, not a 6-material array: a material array costs one
        // draw call per box face group (6 per building), a single material
        // costs 1. The roof is a separate thin slab with its top flush
        // with the building top, so the facade never shows on the roof.
        const building = new THREE.Mesh(boxGeometry, side);
        building.scale.set(plot.w, height, plot.d);
        building.position.set(plot.x, height / 2, plot.z);
        building.castShadow = true;
        building.receiveShadow = true;
        group.add(building);
        const roofSlab = new THREE.Mesh(boxGeometry, roofMaterial);
        roofSlab.scale.set(plot.w, 0.15, plot.d);
        roofSlab.position.set(plot.x, height - 0.075, plot.z);
        group.add(roofSlab);
        // Shape variety: a setback box on some buildings (then a smaller
        // second setback on the tallest — guaranteed above 24m), a
        // parapet rim on most. Shops (6-7m) never get a setback: a box
        // on a 1-storey shop would double its height. topY/topW/topD
        // track the roof the dressing sits on.
        let topY = height, topW = plot.w, topD = plot.d;
        const hasSetback = height >= 8 && (rng() < 0.3 || height > 13);
        if (hasSetback) {
          const sh = intBetween(rng, 3, 6);
          const setback = new THREE.Mesh(boxGeometry, side);
          setback.scale.set(plot.w * 0.55, sh, plot.d * 0.55);
          setback.position.set(plot.x, height + sh / 2, plot.z);
          group.add(setback);
          const setbackRoof = new THREE.Mesh(boxGeometry, roofMaterial);
          setbackRoof.scale.set(plot.w * 0.55, 0.15, plot.d * 0.55);
          setbackRoof.position.set(plot.x, height + sh - 0.075, plot.z);
          group.add(setbackRoof);
          topY = height + sh;
          topW = plot.w * 0.55;
          topD = plot.d * 0.55;
          if ((height > 13 && rng() < 0.6) || height > 24) {
            const sh2 = intBetween(rng, 3, 5);
            const setback2 = new THREE.Mesh(boxGeometry, side);
            setback2.scale.set(plot.w * 0.32, sh2, plot.d * 0.32);
            setback2.position.set(plot.x, topY + sh2 / 2, plot.z);
            group.add(setback2);
            const setback2Roof = new THREE.Mesh(boxGeometry, roofMaterial);
            setback2Roof.scale.set(plot.w * 0.32, 0.15, plot.d * 0.32);
            setback2Roof.position.set(plot.x, topY + sh2 - 0.075, plot.z);
            group.add(setback2Roof);
            topY += sh2;
            topW = plot.w * 0.32;
            topD = plot.d * 0.32;
          }
        }
        // Parapet: four thin walls around the roof edge (light concrete),
        // leaving the roof surface visible — never a solid slab.
        if (rng() < 0.6) {
          const rimH = 0.6, rimT = 0.3;
          const rimN = new THREE.Mesh(boxGeometry, parapetMat);
          rimN.scale.set(plot.w + rimT * 2, rimH, rimT);
          rimN.position.set(plot.x, height + rimH / 2, plot.z - plot.d / 2);
          const rimS = rimN.clone();
          rimS.position.z = plot.z + plot.d / 2;
          const rimW = new THREE.Mesh(boxGeometry, parapetMat);
          rimW.scale.set(rimT, rimH, plot.d);
          rimW.position.set(plot.x - plot.w / 2, height + rimH / 2, plot.z);
          const rimE = rimW.clone();
          rimE.position.x = plot.x + plot.w / 2;
          group.add(rimN, rimS, rimW, rimE);
        }
        // Rooftop dressing: AC units on most roofs, vent pipes on some,
        // a rooftop garden on some low/mid roofs, a water tower on some
        // taller ones, an antenna mast on the tallest. When a setback
        // leaves a lower roof ring exposed, the ring gets its own AC
        // unit so it is not a bare slab.
        if (rng() < 0.75) {
          const nAc = 1 + Math.floor(rng() * 2);
          for (let a = 0; a < nAc; a += 1) {
            const ac = new THREE.Mesh(acGeo, acMat);
            ac.position.set(plot.x + (rng() - 0.5) * (topW - 2), topY + 0.4, plot.z + (rng() - 0.5) * (topD - 2));
            group.add(ac);
          }
        }
        if (rng() < 0.4) {
          const nVent = 1 + Math.floor(rng() * 2);
          for (let v = 0; v < nVent; v += 1) {
            const vx = plot.x + (rng() - 0.5) * (topW - 2);
            const vz = plot.z + (rng() - 0.5) * (topD - 2);
            const vent = new THREE.Mesh(ventGeo, ventMat);
            vent.position.set(vx, topY + 0.7, vz);
            const cap = new THREE.Mesh(ventCapGeo, ventMat);
            cap.position.set(vx, topY + 1.45, vz);
            group.add(vent, cap);
          }
        }
        if (height <= 20 && topW >= 12 && rng() < 0.15) {
          const planter = new THREE.Mesh(planterGeo, planterMat);
          planter.position.set(plot.x - topW / 4, topY + 0.35, plot.z);
          group.add(planter);
          for (let b = 0; b < 3; b += 1) {
            const bush = new THREE.Mesh(bushGeo, bushMat);
            bush.position.set(plot.x - topW / 4 - 1 + b, topY + 1.2, plot.z + (rng() - 0.5) * 0.8);
            group.add(bush);
          }
        }
        if (hasSetback && rng() < 0.6) {
          const ringAc = new THREE.Mesh(acGeo, acMat);
          const ringX = plot.x + (rng() < 0.5 ? -1 : 1) * plot.w * 0.36;
          const ringZ = plot.z + (rng() - 0.5) * plot.d * 0.6;
          ringAc.position.set(ringX, height + 0.4, ringZ);
          group.add(ringAc);
        }
        // Water towers REMOVED: brown wooden tanks look wrong on
        // modern glass towers (Vice City / Miami style, not old NYC).
        if (height > 13 && rng() < 0.4) {
          const mast = new THREE.Mesh(antennaGeo, antennaMat);
          mast.position.set(plot.x, topY + 2.5, plot.z);
          const tip = new THREE.Mesh(antennaTipGeo, antennaTipMat);
          tip.position.set(plot.x, topY + 5, plot.z);
          group.add(mast, tip);
        }
        const box = { minX: plot.x - plot.w / 2, maxX: plot.x + plot.w / 2, minZ: plot.z - plot.d / 2, maxZ: plot.z + plot.d / 2 };
        buildingBoxes.push(box);
        // Every building carries a name sign on the facade facing their
        // nearest road; no name repeats on the same street. Height is
        // kept for the high-sign pass below (tallest signed towers).
        const record = { box, sign: null, height };
        buildings.push(record);
        if (rng() < 1) {
          const nearestZRoad = roadCentreX(Math.round((plot.x + HALF_W - ROAD_WIDTH / 2) / STREET_PITCH));
          const nearestXRoad = roadCentreZ(Math.round((plot.z + HALF_W - ROAD_WIDTH / 2) / STREET_PITCH));
          const dzRoad = Math.abs(plot.x - nearestZRoad);
          const dxRoad = Math.abs(plot.z - nearestXRoad);
          // Single plots sit equidistant from all four roads — break the
          // tie at random so signs do not all face east.
          const useZ = dzRoad < dxRoad || (dzRoad === dxRoad && rng() < 0.5);
          const roadKey = useZ ? `z:${nearestZRoad}` : `x:${nearestXRoad}`;
          const tx = useZ ? nearestZRoad : plot.x;
          const tz = useZ ? plot.z : nearestXRoad;
          if (!usedNamesByRoad.has(roadKey)) usedNamesByRoad.set(roadKey, new Set());
          const used = usedNamesByRoad.get(roadKey);
          const start = Math.floor(rng() * SIGN_NAMES.length);
          let name = SIGN_NAMES[start];
          for (let k = 0; k < SIGN_NAMES.length; k += 1) {
            const candidate = SIGN_NAMES[(start + k) % SIGN_NAMES.length];
            if (!used.has(candidate)) { name = candidate; break; }
          }
          used.add(name);
          record.sign = addSign(box, name, tx, tz);
          // Ground-floor storefront on the same facade as the sign; a 3D
          // awning instead when the storefront does not roll (the
          // storefront texture already paints an awning — no doubling).
          const p = record.sign.p;
          if (rng() < 0.55) {
            const store = new THREE.Mesh(storefrontGeometry, storefrontMaterial);
            store.position.set(p.x - p.nx * 0.04, 1.75, p.z - p.nz * 0.04);
            store.rotation.y = p.rotY;
            group.add(store);
          } else if (rng() < 0.6) {
            const awning = new THREE.Mesh(awningGeo, awningMats[Math.floor(rng() * awningMats.length)]);
            awning.position.set(p.x + p.nx * 0.8, 3.4, p.z + p.nz * 0.8);
            awning.rotation.set(0.35, p.rotY, 0, 'YXZ');
            group.add(awning);
          }
          // Balconies on tall signed buildings: two slabs on the sign
          // facade, staggered in height and offset along the facade;
          // taller towers get extra rows higher up.
          if (height > 14 && rng() < 0.5) {
            const tx = p.nz !== 0 ? 1 : 0, tz = p.nx !== 0 ? 1 : 0;
            const offs = [[-plot.w / 4, 6.5], [plot.w / 4, 11]];
            if (height > 20) offs.push([-plot.w / 4, 17]);
            if (height > 26) offs.push([plot.w / 4, 23]);
            for (const [off, by] of offs) {
              if (by + 1 > height) continue;
              const balc = new THREE.Mesh(balconyGeo, balconyMat);
              balc.position.set(p.x + tx * off + p.nx * 0.5, by, p.z + tz * off + p.nz * 0.5);
              balc.rotation.y = p.rotY;
              group.add(balc);
            }
          }
        }
      }
    }
  }
  // Named places get their own sign on the nearest building, facing the
  // spot itself: the three businesses, Pay'n'Spray, and the Harbor Lights
  // safehouse (second-nearest building to the dealership corner, so the
  // two signs do not land on the same facade).
  const nearestBuildings = (x, z) => [...buildings].sort((a, b) => {
    const da = Math.hypot((a.box.minX + a.box.maxX) / 2 - x, (a.box.minZ + a.box.maxZ) / 2 - z);
    const db = Math.hypot((b.box.minX + b.box.maxX) / 2 - x, (b.box.minZ + b.box.maxZ) / 2 - z);
    return da - db;
  });
  const setNamedSign = (record, name, x, z) => {
    if (record.sign) {
      const mat = signMaterialFor(name).clone();
      signMaterials.push({ mat, phase: rng() * Math.PI * 2 });
      record.sign.mesh.material = mat;
      record.sign.name = name;
      // Re-face the sign toward the named spot itself (halo follows).
      const p = signPlacement(record.box, facingFor(record.box, x, z));
      record.sign.mesh.position.set(p.x, SIGN_Y, p.z);
      record.sign.mesh.rotation.y = p.rotY;
      record.sign.halo.position.set(p.x - p.nx * 0.06, SIGN_Y, p.z - p.nz * 0.06);
      record.sign.halo.rotation.y = p.rotY;
      record.sign.x = p.x;
      record.sign.z = p.z;
      record.sign.p = p;
      return;
    }
    record.sign = addSign(record.box, name, x, z);
  };
  const named = [
    { name: 'KEYS CAB CO.', x: 52, z: 52, nth: 0 },
    { name: 'NEON PALMS', x: -52, z: -52, nth: 0 },
    { name: 'SOLSTICE MOTORS', x: 104, z: -104, nth: 0 },
    { name: 'SAFEHOUSE', x: 104, z: -104, nth: 1 },
    { name: "PAY 'N SPRAY", x: 104, z: -52, nth: 0 },
  ];
  for (const place of named) {
    const ranked = nearestBuildings(place.x, place.z);
    if (ranked[place.nth]) setNamedSign(ranked[place.nth], place.name, place.x, place.z);
  }
  // High signs: ground-floor signs are invisible from the title
  // screen's aerial orbit, so the 10 tallest signed towers carry a
  // second, large sign near the roofline on the same facade (same name
  // as the ground sign — one building, one name).
  {
    const signed = buildings.filter((r) => r.sign && r.height >= 18);
    signed.sort((a, b) => b.height - a.height);
    const highGeo = new THREE.PlaneGeometry(16, 4);
    for (const record of signed.slice(0, 10)) {
      const p = record.sign.p;
      const faceW = p.nz !== 0 ? record.box.maxX - record.box.minX : record.box.maxZ - record.box.minZ;
      const w = Math.min(16, Math.max(10, faceW - 2));
      const mat = signMaterialFor(record.sign.name).clone();
      signMaterials.push({ mat, phase: rng() * Math.PI * 2 });
      const mesh = new THREE.Mesh(highGeo, mat);
      mesh.scale.setScalar(w / 16);
      mesh.position.set(p.x, record.height - 2.2, p.z);
      mesh.rotation.y = p.rotY;
      group.add(mesh);
      const halo = new THREE.Mesh(haloGeometry, haloMaterial);
      halo.scale.setScalar(w / 12);
      halo.position.set(p.x - p.nx * 0.06, record.height - 2.2, p.z - p.nz * 0.06);
      halo.rotation.y = p.rotY;
      group.add(halo);
    }
  }
  // HOSPITAL: white building on the block east of spawn; the starting
  // spawn and the WASTED respawn are its entrance (GTA-style). Its box
  // goes in buildingBoxes for collision, but it is NOT in `buildings` —
  // a named sign must never overwrite the HOSPITAL sign.
  // Facade side material (cloned texture + per-building lit windows).
  const facadeSide = (idx, rx, ry) => {
    const ft = facades[idx].clone();
    ft.needsUpdate = true;
    ft.repeat.set(rx, ry);
    const et = litWindowsTexture(facadeCells[idx], rng);
    et.repeat.set(rx, ry);
    const side = facadeMaterial(ft, et);
    buildingMaterials.push(side);
    return side;
  };
  const lmWhite = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const lmRed = new THREE.MeshLambertMaterial({ color: 0xe63946 });
  const lmGold = new THREE.MeshLambertMaterial({ color: 0xffb703 });
  const lmDark = new THREE.MeshLambertMaterial({ color: 0x5a5a6a });
  {
    const hospSide = facadeSide(2, 3, 2);
    const hosp = new THREE.Mesh(boxGeometry, [hospSide, hospSide, roofMaterial, roofMaterial, hospSide, hospSide]);
    hosp.scale.set(32, 14, 32);
    hosp.position.set(26, 7, -26);
    hosp.castShadow = true;
    hosp.receiveShadow = true;
    group.add(hosp);
    const hospBox = { minX: 10, maxX: 42, minZ: -42, maxZ: -10 };
    buildingBoxes.push(hospBox);
    addSign(hospBox, 'HOSPITAL', 0, -26);
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 0.9), lmRed);
    crossV.position.set(9.9, 8, -26);
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.9, 2.6), lmRed);
    crossH.position.set(9.9, 8, -26);
    group.add(crossV, crossH);
  }
  // Landmarks: one recognizable point per district, compact meshes.
  // VICE TOWER — Office Tower GLB (30.2 x 30.9m, antenna tip 69.74m —
  // both measured from the model, not guessed). A glass box of the
  // same footprint stands in until the GLB loads. Roof levels measured
  // from the GLB: main slab at 59m, stepped crown top at 62m (a 12.2m
  // square), antenna spike to 69.74m. The helipad sits on the crown
  // top, south of the antenna spike (the slab ring is only 3.5m wide,
  // no pad fits there). GLB-local
  // coords map to world with a -4.35 z shift (the model's centre
  // offset), so local (0, 3.5) is world (26, 233.15).
  {
    const TOWER_H = HOUSE_MODELS['office-tower'].h;
    const CROWN = 62.5;
    const side = facadeSide(0, 2, 7);
    const holder = new THREE.Group();
    holder.name = 'placeholder-office-tower';
    holder.position.set(26, 0, 234);
    const tower = new THREE.Mesh(boxGeometry, [side, side, roofMaterial, roofMaterial, side, side]);
    tower.scale.set(30.2, TOWER_H, 30.9);
    tower.position.y = TOWER_H / 2;
    tower.castShadow = true;
    holder.add(tower);
    group.add(holder);
    // Helipad on the crown top, south-east of the centre antenna
    // spike: white rim ring, dark pad, white H marking. Offset east so
    // the centre antenna spike (local 0,0) does not pierce the pad.
    const padRim = new THREE.Mesh(new THREE.CircleGeometry(3.2, 24), new THREE.MeshLambertMaterial({ color: 0xf2f0e8 }));
    padRim.rotation.x = -Math.PI / 2;
    padRim.position.set(28.8, CROWN + 0.12, 227.15);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(2.9, 24), new THREE.MeshLambertMaterial({ color: 0x3a3f4a }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(28.8, CROWN + 0.14, 227.15);
    const hMat = new THREE.MeshLambertMaterial({ color: 0xf2f0e8 });
    const hBarGeo = new THREE.BoxGeometry(0.5, 0.05, 3.4);
    const hCrossGeo = new THREE.BoxGeometry(2.2, 0.05, 0.5);
    const hL = new THREE.Mesh(hBarGeo, hMat);
    hL.position.set(27.7, CROWN + 0.17, 227.15);
    const hR = new THREE.Mesh(hBarGeo, hMat);
    hR.position.set(29.9, CROWN + 0.17, 227.15);
    const hC = new THREE.Mesh(hCrossGeo, hMat);
    hC.position.set(28.8, CROWN + 0.17, 227.15);
    group.add(padRim, pad, hL, hR, hC);
    // High sign on ALL FOUR faces, just under the main slab (59m) — the
    // tower's name, readable from any direction. The GLB carries a -4.35
    // z offset, so its centre is at world z=21.65, not 26: south face at
    // z=37.1, north at z=6.2, east/west faces at x=41.1/10.9. Each sign
    // sits 0.15m off its face, halo 0.1m behind the sign.
    const towerMat = signMaterialFor('VICE TOWER').clone();
    signMaterials.push({ mat: towerMat, phase: rng() * Math.PI * 2 });
    const signGeo = new THREE.PlaneGeometry(12, 3);
    const towerSign = new THREE.Mesh(signGeo, towerMat);
    towerSign.position.set(24.5, 56, 245.25);
    group.add(towerSign);
    const towerHalo = new THREE.Mesh(haloGeometry, haloMaterial);
    towerHalo.scale.set(1, 1, 1);
    towerHalo.position.set(24.5, 56, 245.15);
    group.add(towerHalo);
    const towerSignN = new THREE.Mesh(signGeo, towerMat);
    towerSignN.rotation.y = Math.PI;
    towerSignN.position.set(24.5, 56, 214.05);
    group.add(towerSignN);
    const towerHaloN = new THREE.Mesh(haloGeometry, haloMaterial);
    towerHaloN.scale.set(1, 1, 1);
    towerHaloN.rotation.y = Math.PI;
    towerHaloN.position.set(24.5, 56, 214.15);
    group.add(towerHaloN);
    const towerSignE = new THREE.Mesh(signGeo, towerMat);
    towerSignE.rotation.y = Math.PI / 2;
    towerSignE.position.set(41.25, 56, 229.65);
    group.add(towerSignE);
    const towerHaloE = new THREE.Mesh(haloGeometry, haloMaterial);
    towerHaloE.scale.set(1, 1, 1);
    towerHaloE.rotation.y = Math.PI / 2;
    towerHaloE.position.set(41.15, 56, 229.65);
    group.add(towerHaloE);
    const towerSignW = new THREE.Mesh(signGeo, towerMat);
    towerSignW.rotation.y = -Math.PI / 2;
    towerSignW.position.set(10.75, 56, 229.65);
    group.add(towerSignW);
    const towerHaloW = new THREE.Mesh(haloGeometry, haloMaterial);
    towerHaloW.scale.set(1, 1, 1);
    towerHaloW.rotation.y = -Math.PI / 2;
    towerHaloW.position.set(10.85, 56, 229.65);
    group.add(towerHaloW);
    buildingBoxes.push({ minX: 11, maxX: 41, minZ: 219, maxZ: 249 });
    swapInGlb('office-tower', holder, 26, 234, 0, [padRim, pad, hL, hR, hC, towerSign, towerHalo, towerSignN, towerHaloN, towerSignE, towerHaloE, towerSignW, towerHaloW]);
  }
  // Casino — gold pyramid + big neon sign, north-east block.
  {
    const base = new THREE.Mesh(boxGeometry, new THREE.MeshLambertMaterial({ color: 0xfff3d6 }));
    base.scale.set(30, 4, 30);
    base.position.set(182, 2, -182);
    group.add(base);
    const pyr = new THREE.Mesh(new THREE.ConeGeometry(24, 18, 4), lmGold);
    pyr.rotation.y = Math.PI / 4;
    pyr.position.set(182, 13, -182);
    group.add(pyr);
    const mat = signMaterialFor('VICE CASINO').clone();
    signMaterials.push({ mat, phase: rng() * Math.PI * 2 });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), mat);
    sign.position.set(182, 6, -166.8);
    group.add(sign);
    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
    halo.scale.set(1.4, 1.4, 1);
    halo.position.set(182, 6, -166.75);
    group.add(halo);
    buildingBoxes.push({ minX: 167, maxX: 197, minZ: -197, maxZ: -167 });
  }
  // Ferris wheel — south beach, slow rotation, lit hub at night.
  // A-frame legs converge on the hub (feet 7m out, tops at the axle),
  // double rim + 8 spoke bars, a solid hub, and 8 detailed cabins that
  // hang from their own pivots — counter-rotated every frame in
  // update() so they stay upright instead of tumbling with the wheel.
  {
    const legMat = lmWhite;
    const legLen = Math.hypot(7, 15);
    const legTilt = Math.atan2(7, 15);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, legLen, 3.2), legMat);
      leg.position.set(150 + s * 3.5, 7.5, 288);
      leg.rotation.z = s * legTilt;
      leg.castShadow = true;
      group.add(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 2.4), lmDark);
      foot.position.set(150 + s * 7, 0.25, 288);
      group.add(foot);
    }
    const crossbar = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.5, 3.2), legMat);
    crossbar.position.set(150, 7.5, 288);
    group.add(crossbar);
    const wheel = new THREE.Group();
    wheel.position.set(150, 15, 288);
    // Real depth: twin rims front/back (z = +/-1.2) joined by cross-bars
    // at the cabin hang points, so the wheel reads as a 3D structure
    // from any angle instead of a flat disc.
    const rimMat = new THREE.MeshBasicMaterial({ color: 0xffc828 });
    for (const rz of [-1.2, 1.2]) {
      const rimOuter = new THREE.Mesh(new THREE.TorusGeometry(12, 0.45, 8, 36), rimMat);
      rimOuter.position.z = rz;
      wheel.add(rimOuter);
      const rimInner = new THREE.Mesh(new THREE.TorusGeometry(9, 0.25, 6, 32), rimMat);
      rimInner.position.z = rz;
      wheel.add(rimInner);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 8;
      for (const rz of [-1.2, 1.2]) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(24, 0.3, 0.3), lmWhite);
        spoke.rotation.z = a;
        spoke.position.z = rz;
        wheel.add(spoke);
      }
      const ca = (i / 8) * Math.PI * 2;
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 2.4), lmWhite);
      bar.position.set(Math.cos(ca) * 12, Math.sin(ca) * 12, 0);
      wheel.add(bar);
    }
    const hubDrum = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 3.0, 16), lmGold);
    hubDrum.rotation.x = Math.PI / 2;
    wheel.add(hubDrum);
    for (const s of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 12), lmDark);
      cap.rotation.x = Math.PI / 2;
      cap.position.z = s * 1.6;
      wheel.add(cap);
    }
    const gondolaCols = [0xff5a7a, 0x2ad0c4, 0xffc828, 0x2fd35e, 0xff7a3d, 0xff2d78, 0x2a7ad0, 0xe63946];
    const cabinGlass = new THREE.MeshLambertMaterial({ color: 0x1a2a3a });
    const cabinPivots = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const pivot = new THREE.Group();
      pivot.position.set(Math.cos(a) * 12, Math.sin(a) * 12, 0);
      const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.2, 0.15), lmDark);
      hanger.position.y = -0.6;
      pivot.add(hanger);
      const bodyMat = new THREE.MeshLambertMaterial({ color: gondolaCols[i] });
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.3, 1.4), bodyMat);
      body.position.y = -1.85;
      body.castShadow = true;
      pivot.add(body);
      const windows = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.5, 1.46), cabinGlass);
      windows.position.y = -1.65;
      pivot.add(windows);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.6, 4), bodyMat);
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(1, 1, 0.8);
      roof.position.y = -0.9;
      pivot.add(roof);
      wheel.add(pivot);
      cabinPivots.push(pivot);
    }
    group.add(wheel);
    const hubMat = new THREE.SpriteMaterial({ map: glowTexture, color: 0xffc828, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const hub = new THREE.Sprite(hubMat);
    hub.scale.set(10, 10, 1);
    hub.position.set(150, 15, 288);
    group.add(hub);
    landmarkNight.wheel = wheel;
    landmarkNight.hubMat = hubMat;
    landmarkNight.cabinPivots = cabinPivots;
    buildingBoxes.push({ minX: 141, maxX: 159, minZ: 284, maxZ: 292 });
  }
  // Stadium — domed roof, south-west block. Radius 19: the block is 40m
  // wide, so the old 26m drum spilled 6m onto the road on all four sides
  // (and its collision box blocked the road). A bare drum + dome read as
  // a grain silo, so the drum gets doors, a window band, ribs, a cornice
  // and a big name sign, the dome gets seam rings + a crown + antenna,
  // and four floodlight masts stand at the diagonals.
  {
    const cx = -78, cz = 234;
    // Bright white, not dull: pure white + a strong emissive lift so
    // the shaded side stays white instead of going grey-beige. Lambert
    // alone darkens the dome's north side to mud.
    const arenaWhite = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9a9a9a });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(19, 19, 10, 20), arenaWhite);
    wall.position.set(cx, 5, cz);
    wall.castShadow = true;
    group.add(wall);
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(19.6, 19.8, 0.6, 20), lmDark);
    plinth.position.set(cx, 0.3, cz);
    group.add(plinth);
    // Four door portals (N/E/S/W): dark inset + steps.
    const doorMat = new THREE.MeshLambertMaterial({ color: 0x1a2030 });
    for (let d = 0; d < 4; d++) {
      const a = (d * Math.PI) / 2;
      const door = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.6, 0.4), doorMat);
      door.position.set(cx + Math.sin(a) * 19.05, 1.8, cz + Math.cos(a) * 19.05);
      door.rotation.y = a;
      group.add(door);
      const step = new THREE.Mesh(new THREE.BoxGeometry(4, 0.3, 1.4), lmWhite);
      step.position.set(cx + Math.sin(a) * 20, 0.15, cz + Math.cos(a) * 20);
      step.rotation.y = a;
      group.add(step);
    }
    // Window/vent band around the drum, just under the cornice.
    const band = new THREE.Mesh(new THREE.CylinderGeometry(19.2, 19.2, 1.6, 20, 1, true), new THREE.MeshLambertMaterial({ color: 0x1a2a3a }));
    band.position.set(cx, 8.2, cz);
    group.add(band);
    // Ribs around the drum (skipping the four door angles).
    const ribGeo = new THREE.BoxGeometry(0.5, 9.6, 0.35);
    for (let i = 0; i < 16; i++) {
      if (i % 4 === 0) continue;
      const a = (i * Math.PI) / 8;
      const rib = new THREE.Mesh(ribGeo, lmWhite);
      rib.position.set(cx + Math.sin(a) * 19.3, 5.1, cz + Math.cos(a) * 19.3);
      rib.rotation.y = a;
      group.add(rib);
    }
    // Cornice ring at the drum/dome joint.
    const cornice = new THREE.Mesh(new THREE.TorusGeometry(19.35, 0.35, 8, 40), lmGold);
    cornice.rotation.x = Math.PI / 2;
    cornice.position.set(cx, 10, cz);
    group.add(cornice);
    // Big name sign on the SOUTH face (toward the beach and the title
    // camera), so the name reads from the front instead of edge-on.
    const arenaMat = signMaterialFor('VICE ARENA').clone();
    signMaterials.push({ mat: arenaMat, phase: rng() * Math.PI * 2 });
    const arenaSign = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), arenaMat);
    arenaSign.position.set(cx, 5.5, cz + 19.7);
    group.add(arenaSign);
    const arenaHalo = new THREE.Mesh(haloGeometry, haloMaterial);
    arenaHalo.position.set(cx, 5.5, cz + 19.6);
    group.add(arenaHalo);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(19, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), arenaWhite);
    dome.position.set(cx, 10, cz);
    dome.castShadow = true;
    group.add(dome);
    // Panel seam rings on the dome (radii from the hemisphere at each height).
    const seamMat = new THREE.MeshLambertMaterial({ color: 0xc8ccd2 });
    for (const [y, r] of [[16, 18.0], [20, 16.2], [24, 12.9]]) {
      const seam = new THREE.Mesh(new THREE.TorusGeometry(r, 0.15, 6, 40), seamMat);
      seam.rotation.x = Math.PI / 2;
      seam.position.set(cx, y, cz);
      group.add(seam);
    }
    // Crown/skylight disc straddling the apex + antenna.
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 1, 16), lmDark);
    crown.position.set(cx, 28.8, cz);
    group.add(crown);
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4, 6), lmDark);
    antenna.position.set(cx, 31.3, cz);
    group.add(antenna);
    const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a3a }));
    antennaTip.position.set(cx, 33.4, cz);
    group.add(antennaTip);
    // Four floodlight masts at the diagonals (inside the block).
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6cc });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const mx = cx + sx * 15, mz = cz + sz * 15;
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 1.4), lmDark);
      base.position.set(mx, 0.4, mz);
      group.add(base);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 20, 8), lmDark);
      pole.position.set(mx, 10.8, mz);
      pole.castShadow = true;
      group.add(pole);
      const head = new THREE.Group();
      head.position.set(mx, 20.8, mz);
      head.lookAt(cx, 8, cz);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 0.3), lmDark);
      head.add(frame);
      const lamps = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.8), lampMat);
      lamps.position.z = 0.18;
      head.add(lamps);
      group.add(head);
    }
    buildingBoxes.push({ minX: -98, maxX: -58, minZ: 214, maxZ: 254 });
  }
  // Clock tower — centre-west block, glass curtain wall like the other
  // towers, flat roof with a parapet rim, big clock face on all four
  // sides. The emissive windows use a local fixed-seed rng so the
  // shared seed-1 stream (palms, trees, traffic spawns) is untouched.
  {
    const clockTex = (() => {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 128;
      const x = c.getContext('2d');
      x.fillStyle = '#f2f0e8';
      x.beginPath();
      x.arc(64, 64, 62, 0, Math.PI * 2);
      x.fill();
      x.strokeStyle = '#1a1030';
      x.lineWidth = 6;
      x.beginPath();
      x.arc(64, 64, 58, 0, Math.PI * 2);
      x.stroke();
      x.lineWidth = 8;
      x.beginPath();
      x.moveTo(64, 64);
      x.lineTo(64, 26);
      x.stroke();
      x.lineWidth = 6;
      x.beginPath();
      x.moveTo(64, 64);
      x.lineTo(92, 78);
      x.stroke();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const towerFacade = facades[0].clone();
    towerFacade.needsUpdate = true;
    towerFacade.repeat.set(1, 3);
    const towerEmissive = litWindowsTexture(facadeCells[0], makeRng(0xc10c));
    towerEmissive.repeat.set(1, 3);
    const towerSide = facadeMaterial(towerFacade, towerEmissive);
    buildingMaterials.push(towerSide);
    const tower = new THREE.Mesh(boxGeometry, [towerSide, towerSide, roofMaterial, roofMaterial, towerSide, towerSide]);
    tower.scale.set(8, 20, 8);
    tower.position.set(-26, 10, -26);
    tower.castShadow = true;
    tower.receiveShadow = true;
    group.add(tower);
    // Flat roof: parapet rim around the roof edge (light concrete),
    // same dressing as the other buildings — no pyramid, no spire.
    const rimH = 0.6, rimT = 0.3;
    const rimN = new THREE.Mesh(boxGeometry, parapetMat);
    rimN.scale.set(8 + rimT * 2, rimH, rimT);
    rimN.position.set(-26, 20 + rimH / 2, -30);
    const rimS = rimN.clone();
    rimS.position.z = -22;
    const rimW = new THREE.Mesh(boxGeometry, parapetMat);
    rimW.scale.set(rimT, rimH, 8);
    rimW.position.set(-30, 20 + rimH / 2, -26);
    const rimE = rimW.clone();
    rimE.position.x = -22;
    group.add(rimN, rimS, rimW, rimE);
    const faceGeo = new THREE.PlaneGeometry(5, 5);
    const clockMat = new THREE.MeshBasicMaterial({ map: clockTex });
    for (const [fx, fz, ry] of [[-26, -21.9, 0], [-26, -30.1, Math.PI], [-21.9, -26, Math.PI / 2], [-30.1, -26, -Math.PI / 2]]) {
      const f = new THREE.Mesh(faceGeo, clockMat);
      f.position.set(fx, 16, fz);
      f.rotation.y = ry;
      group.add(f);
    }
    buildingBoxes.push({ minX: -30, maxX: -22, minZ: -30, maxZ: -22 });
  }
  // Yacht — a proper luxury motor yacht anchored off the south beach
  // next to the ferris wheel, close enough to read from the coastal
  // road. Curved hull (extruded outline, pointed bow, flat transom),
  // rounded superstructure with a glass band, flybridge with a raked
  // windscreen, radar mast, railings and a sagging shade sail over
  // the aft sundeck. Local axes: bow +X, beam Z, deck at y≈2.15.
  {
    const yacht = new THREE.Group();
    yacht.position.set(230, 0, 380);
    yacht.rotation.y = 0.15;
    // A proper superyacht: 2x the old 26m hull — 52m long, readable
    // from the coastal road instead of a toy boat.
    yacht.scale.setScalar(2);
    const glassMat = new THREE.MeshPhongMaterial({ color: 0x16283a, shininess: 90, specular: 0x6a8aa0 });
    const teakMat = new THREE.MeshLambertMaterial({ color: 0xd8b98a });
    const navyMat = new THREE.MeshLambertMaterial({ color: 0x1a5a9a });
    // Bright gelcoat white for hull + cabin + rails (the shared warm
    // cream reads grey on the shaded side of the large curved hull).
    const yachtWhite = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0 });
    // Hull outline, top view: pointed bow, wide midships, flat stern.
    const hullShape = new THREE.Shape();
    hullShape.moveTo(-13, -2.4);
    hullShape.bezierCurveTo(-8, -3.5, 2, -3.5, 13, 0);
    hullShape.bezierCurveTo(2, 3.5, -8, 3.5, -13, 2.4);
    hullShape.closePath();
    const hullGeo = new THREE.ExtrudeGeometry(hullShape, {
      depth: 2.0, bevelEnabled: true, bevelThickness: 0.35,
      bevelSize: 0.3, bevelSegments: 3, curveSegments: 12,
    });
    hullGeo.rotateX(-Math.PI / 2);
    const hull = new THREE.Mesh(hullGeo, yachtWhite);
    hull.position.y = -0.2;
    yacht.add(hull);
    // Deck, slightly inset from the hull's top edge.
    const deckGeo = new THREE.ShapeGeometry(hullShape, 12);
    deckGeo.rotateX(-Math.PI / 2);
    const deck = new THREE.Mesh(deckGeo, teakMat);
    deck.scale.set(0.96, 1, 0.96);
    deck.position.y = 2.16;
    yacht.add(deck);
    // Outline points offset outward by a fixed distance (edge normals),
    // for the waterline stripe, cap rail and deck railing.
    const outline2D = hullShape.getPoints(32);
    const offsetOutline = (dist, y) => {
      const n = outline2D.length;
      const pts = [];
      for (let i = 0; i < n; i++) {
        const prev = outline2D[(i - 1 + n) % n], cur = outline2D[i], next = outline2D[(i + 1) % n];
        let nx = 0, ny = 0;
        for (const [ax, ay, bx, by] of [[prev.x, prev.y, cur.x, cur.y], [cur.x, cur.y, next.x, next.y]]) {
          const ex = bx - ax, ey = by - ay, len = Math.hypot(ex, ey) || 1;
          nx += ey / len; ny -= ex / len;
        }
        const nl = Math.hypot(nx, ny) || 1;
        pts.push(new THREE.Vector3(cur.x + (nx / nl) * dist, y, -(cur.y + (ny / nl) * dist)));
      }
      return pts;
    };
    const tubeAlong = (pts, radius, mat) => {
      const curve = new THREE.CatmullRomCurve3(pts, true);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 72, radius, 6, true), mat);
      yacht.add(tube);
      return tube;
    };
    tubeAlong(offsetOutline(0.38, 0.15), 0.13, navyMat);
    tubeAlong(offsetOutline(0.12, 2.28), 0.1, yachtWhite);
    tubeAlong(offsetOutline(0.12, 3.02), 0.05, yachtWhite);
    const stanchionGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.85, 5);
    const railPts = offsetOutline(0.12, 0);
    for (let i = 0; i < railPts.length; i += 3) {
      const st = new THREE.Mesh(stanchionGeo, yachtWhite);
      st.position.set(railPts[i].x, 2.6, railPts[i].z);
      yacht.add(st);
    }
    // Main superstructure: tapered elliptical cabin + glass band.
    const cabin = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.1, 1.7, 24), yachtWhite);
    cabin.scale.set(1.7, 1, 0.95);
    cabin.position.set(-1.5, 3.05, 0);
    yacht.add(cabin);
    const cabinGlass = new THREE.Mesh(new THREE.CylinderGeometry(2.72, 2.92, 0.7, 24, 1, true), glassMat);
    cabinGlass.scale.set(1.7, 1, 0.95);
    cabinGlass.position.set(-1.5, 3.25, 0);
    yacht.add(cabinGlass);
    // Flybridge: smaller tapered cabin + raked wraparound windscreen.
    const fly = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.3, 1.2, 24), yachtWhite);
    fly.scale.set(1.5, 1, 0.9);
    fly.position.set(-2.5, 4.5, 0);
    yacht.add(fly);
    const shield = new THREE.Mesh(new THREE.CylinderGeometry(1.98, 2.38, 0.75, 16, 1, true, Math.PI / 2 - 0.75, 1.5), glassMat);
    shield.scale.set(1.5, 1, 0.9);
    shield.position.set(-2.5, 4.72, 0);
    shield.rotation.z = 0.15;
    yacht.add(shield);
    // Radar arch over the flybridge + mast with radar bar and light.
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.11, 6, 20, Math.PI), yachtWhite);
    arch.position.set(-2.5, 5.1, 0);
    arch.rotation.y = Math.PI / 2;
    yacht.add(arch);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 3.2, 6), yachtWhite);
    mast.position.set(-3.5, 6.7, 0);
    yacht.add(mast);
    const radar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.3), yachtWhite);
    radar.position.set(-3.5, 7.4, 0);
    radar.rotation.y = 0.5;
    yacht.add(radar);
    const mastLight = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff6cc }));
    mastLight.position.set(-3.5, 8.35, 0);
    yacht.add(mastLight);
    // Shade sail: triangular sunshade over the aft sundeck, sagging
    // between the masthead and two aft poles.
    const sailPoleGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.3, 5);
    for (const sz of [-1, 1]) {
      const pole = new THREE.Mesh(sailPoleGeo, yachtWhite);
      pole.position.set(-11.5, 2.8, sz * 2.7);
      yacht.add(pole);
    }
    const sailGeo = (() => {
      const a = new THREE.Vector3(-3.5, 7.6, 0), b = new THREE.Vector3(-11.5, 3.4, -2.7), c = new THREE.Vector3(-11.5, 3.4, 2.7);
      const seg = 5, pos = [], idx = [], rowStart = [];
      for (let i = 0; i <= seg; i++) {
        rowStart.push(pos.length / 3);
        for (let j = 0; j <= seg - i; j++) {
          const u = i / seg, v = j / seg, w = 1 - u - v;
          const sag = 0.7 * 27 * u * v * w;
          pos.push(
            a.x + u * (b.x - a.x) + v * (c.x - a.x),
            a.y + u * (b.y - a.y) + v * (c.y - a.y) - sag,
            a.z + u * (b.z - a.z) + v * (c.z - a.z),
          );
        }
      }
      for (let i = 0; i < seg; i++) {
        for (let j = 0; j < seg - i; j++) {
          const a0 = rowStart[i] + j, b0 = rowStart[i + 1] + j;
          idx.push(a0, b0, a0 + 1);
          if (j < seg - i - 1) idx.push(a0 + 1, b0, b0 + 1);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    })();
    const sail = new THREE.Mesh(sailGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    yacht.add(sail);
    // Swim platform at the stern + bow windlass and anchor.
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 0.22, 16), teakMat);
    platform.position.set(-13.8, 0.4, 0);
    yacht.add(platform);
    const windlass = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.35, 8), lmDark);
    windlass.position.set(10.5, 2.35, 0);
    yacht.add(windlass);
    const anchor = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 6, 12), lmDark);
    anchor.position.set(13.45, 1.1, 0);
    anchor.rotation.y = Math.PI / 2;
    yacht.add(anchor);
    // Navigation lights: red port (-Z), green starboard (+Z), on the
    // cabin sides just proud of the glass band.
    const navRed = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a3a }));
    navRed.position.set(2, 3.0, -2.8);
    yacht.add(navRed);
    const navGreen = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0x2aff66 }));
    navGreen.position.set(2, 3.0, 2.8);
    yacht.add(navGreen);
    // Big name board on the cabin's beach-facing side: 12x3m, readable
    // from the coastal road (the old yacht had no name at all).
    const yachtMat = signMaterialFor('SOLSTICE').clone();
    signMaterials.push({ mat: yachtMat, phase: rng() * Math.PI * 2 });
    const yachtSign = new THREE.Mesh(new THREE.PlaneGeometry(12, 3), yachtMat);
    yachtSign.position.set(-1.5, 3.5, -3.15);
    yachtSign.rotation.y = Math.PI;
    yacht.add(yachtSign);
    group.add(yacht);
  }
  // City-kit accents (Vinish GLBs, added when loaded — the procedural
  // roads and streetlights stay; these are showcase pieces, not
  // replacements). Street lights + a traffic signal dress the (52,52)
  // intersection. The road GLB belongs on the streets (see the merged
  // GLB roads below), not on the sand.
  {
    const addAccent = (name, x, z, rotY, y = 0) => {
      loadHouseModel(name).then((glb) => {
        glb.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        const wrap = new THREE.Group();
        wrap.name = `glb-${name}`;
        wrap.position.set(x, y, z);
        wrap.rotation.y = rotY;
        wrap.add(glb);
        group.add(wrap);
      }).catch(() => {});
    };
    // Street lights: pole at the corner, arm reaching over the road
    // (the GLB arm extends +Z, 2.74m).
    addAccent('street-light', 45.2, 45.2, Math.PI / 2);
    addAccent('street-light', 45.2, 58.8, Math.PI / 2);
    addAccent('street-light', 58.8, 58.8, -Math.PI / 2);
    // Traffic signal: mast arm extends -X, so from the north-east
    // corner with a 90-degree turn it reaches over the road.
    addAccent('traffic-signal', 58.8, 45.2, Math.PI / 2);
  }
  // GLB roads: the Vinish Road Straight tile (16x16m) laid along the
  // coastal ring (the +/-312 roads) and the two central avenues (x=0,
  // z=0), with Road Crossroads tiles at the 9 intersections where they
  // meet. Merged per material into one mesh per material (9 draw calls
  // for ~220 tiles — never ~220 clones). Straight tiles skip any
  // position within 8m of an intersection centre so they never overlap
  // the crossroads tile; the procedural strip shows through the 24m
  // gaps at road ends. The tile's biggest primitive has no UVs, so the
  // merge fills zeros where a part lacks them.
  {
    const TILE = 16;
    const CROSSINGS = [];
    for (const cx of [-312, 0, 312]) for (const cz of [-312, 0, 312]) CROSSINGS.push({ x: cx, z: cz });
    const nearCrossing = (x, z) => CROSSINGS.some((c) => Math.abs(x - c.x) < 8 && Math.abs(z - c.z) < 8);
    // Roads run every 52m (-312 + i*52). A straight tile must skip
    // EVERY road crossing, not just the 9 GLB-road ones: the tile's
    // sidewalk (y=0.15) spans the full 16m width, so a tile sitting
    // on a non-GLB cross street paves over that road and cars drive
    // diagonally across the sidewalk to get through.
    const ROAD_AT = [];
    for (let i = 0; i <= 12; i++) ROAD_AT.push(-312 + i * 52);
    const nearAnyRoad = (p) => ROAD_AT.some((r) => Math.abs(p - r) < 8);
    const tileCentres = [];
    for (const at of [-312, 0, 312]) {
      for (let p = -288; p <= 288; p += TILE) {
        if (!nearCrossing(at, p) && !nearAnyRoad(p)) tileCentres.push({ x: at, z: p, rotY: 0 });
      }
      for (let p = -288; p <= 288; p += TILE) {
        if (!nearCrossing(p, at) && !nearAnyRoad(p)) tileCentres.push({ x: p, z: at, rotY: Math.PI / 2 });
      }
    }
    // GLB road tiles DISABLED: the Vinish road models sit 0.15-0.20m
    // above the ground plane (sidewalk at y=0.20 vs player/cars at
    // y=0), so peds and cars sink knee-deep into them, and their
    // sidewalks pave over every non-GLB cross street. The procedural
    // road strips (12m wide, y=0.03, lane markings in texture) are
    // consistent at all 169 intersections. The merge code stays for
    // reference; only the two load calls are disabled.
    const mergeTiles = (glb, centres) => {
      glb.updateMatrixWorld(true);
      const byMat = new Map();
      glb.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
        if (!byMat.has(o.material)) byMat.set(o.material, []);
        byMat.get(o.material).push(g);
      });
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), t = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);
      const v = new THREE.Vector3(), nm = new THREE.Matrix3();
      for (const [mat, geos] of byMat) {
        let vc = 0, ic = 0;
        for (const g of geos) { vc += g.attributes.position.count; ic += g.index.count; }
        vc *= centres.length;
        ic *= centres.length;
        const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), idx = new Uint32Array(ic);
        let vo = 0, io = 0;
        for (const tile of centres) {
          q.setFromAxisAngle(up, tile.rotY || 0);
          t.set(tile.x, 0.05, tile.z);
          m.compose(t, q, s);
          nm.getNormalMatrix(m);
          for (const g of geos) {
            const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
            for (let i = 0; i < p.count; i++) {
              v.fromBufferAttribute(p, i).applyMatrix4(m);
              pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
              v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
              nor[(vo + i) * 3] = v.x; nor[(vo + i) * 3 + 1] = v.y; nor[(vo + i) * 3 + 2] = v.z;
              if (u) { uv[(vo + i) * 2] = u.getX(i); uv[(vo + i) * 2 + 1] = u.getY(i); }
            }
            for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo;
            vo += p.count;
            io += g.index.count;
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    };
    // GLB road tiles disabled (see note above): procedural strips only.
    // loadHouseModel('road-straight').then((glb) => mergeTiles(glb, tileCentres)).catch(() => {});
    // loadHouseModel('road-crossroads').then((glb) => mergeTiles(glb, CROSSINGS)).catch(() => {});
  }
  // Lifeguard tower on the south sand, west of the ferris wheel: braced
  // legs, a deck with railings, a white cabin with a glass window band,
  // a ladder, and a red pyramid roof.
  {
    const legGeo = new THREE.BoxGeometry(0.25, 3, 0.25);
    for (const [lx, lz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
      const leg = new THREE.Mesh(legGeo, lmWhite);
      leg.position.set(120 + lx, 1.5, 284 + lz);
      group.add(leg);
    }
    // X cross-braces between the legs on all four faces.
    const braceGeo = new THREE.BoxGeometry(0.15, 4.0, 0.15);
    for (const [bx, bz, axis] of [[0, -1.4, 'z'], [0, 1.4, 'z'], [-1.4, 0, 'x'], [1.4, 0, 'x']]) {
      for (const tilt of [-0.75, 0.75]) {
        const brace = new THREE.Mesh(braceGeo, lmRed);
        brace.position.set(120 + bx, 1.5, 284 + bz);
        if (axis === 'z') brace.rotation.z = tilt;
        else brace.rotation.x = tilt;
        group.add(brace);
      }
    }
    // Deck platform under the cabin, with railing posts + top rails.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.2, 4.6), lmDark);
    deck.position.set(120, 3.1, 284);
    group.add(deck);
    const postGeo = new THREE.BoxGeometry(0.08, 0.9, 0.08);
    for (let i = 0; i <= 4; i++) {
      const t = -2.2 + i * 1.1;
      for (const [px, pz] of [[t, -2.2], [t, 2.2]]) {
        const post = new THREE.Mesh(postGeo, lmRed);
        post.position.set(120 + px, 3.65, 284 + pz);
        group.add(post);
      }
      if (i > 0 && i < 4) {
        for (const [px, pz] of [[-2.2, t], [2.2, t]]) {
          const post = new THREE.Mesh(postGeo, lmRed);
          post.position.set(120 + px, 3.65, 284 + pz);
          group.add(post);
        }
      }
    }
    for (const [rx, rz, w, d] of [[0, -2.2, 4.6, 0.08], [0, 2.2, 4.6, 0.08], [-2.2, 0, 0.08, 4.6], [2.2, 0, 0.08, 4.6]]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), lmRed);
      rail.position.set(120 + rx, 4.1, 284 + rz);
      group.add(rail);
    }
    const cabin = new THREE.Mesh(boxGeometry, lmWhite);
    cabin.scale.set(3.4, 2.4, 3.4);
    cabin.position.set(120, 4.2, 284);
    cabin.castShadow = true;
    group.add(cabin);
    // Glass window band around the cabin (south face split around the door).
    const towerGlass = new THREE.MeshLambertMaterial({ color: 0x1a2a3a });
    const winN = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.9, 0.06), towerGlass);
    winN.position.set(120, 4.8, 284 - 1.73);
    group.add(winN);
    for (const s of [-1, 1]) {
      const winS = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 0.06), towerGlass);
      winS.position.set(120 + s * 1.2, 4.8, 284 + 1.73);
      group.add(winS);
      const winSide = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 3.5), towerGlass);
      winSide.position.set(120 + s * 1.73, 4.8, 284);
      group.add(winSide);
    }
    const roof = new THREE.Mesh(pyramidGeo, lmRed);
    roof.scale.set(3.4 * 0.7071, 1.6, 3.4 * 0.7071);
    roof.position.set(120, 6.2, 284);
    group.add(roof);
    const door = new THREE.Mesh(doorGeo, lmRed);
    door.position.set(120, 4.05, 284 + 1.76);
    group.add(door);
    // Ladder from the sand up to the deck, south face.
    const ladRailGeo = new THREE.BoxGeometry(0.08, 3.2, 0.08);
    for (const lx of [-0.35, 0.35]) {
      const ladRail = new THREE.Mesh(ladRailGeo, lmDark);
      ladRail.position.set(120 + lx, 1.6, 284 + 2.35);
      group.add(ladRail);
    }
    const rungGeo = new THREE.BoxGeometry(0.78, 0.08, 0.08);
    for (let i = 0; i < 6; i++) {
      const rung = new THREE.Mesh(rungGeo, lmDark);
      rung.position.set(120, 0.4 + i * 0.5, 284 + 2.35);
      group.add(rung);
    }
    buildingBoxes.push({ minX: 118.3, maxX: 121.7, minZ: 334.3, maxZ: 337.7 });
  }
  // Merge part geometries (each with a matrix) into one, so the balcony
  // slab is one mesh instead of two.
  function mergedGeo(parts) {
    let vc = 0, ic = 0;
    for (const [g] of parts) { vc += g.attributes.position.count; ic += g.index.count; }
    const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), idx = new Uint32Array(ic);
    const v = new THREE.Vector3(), nm = new THREE.Matrix3();
    let vo = 0, io = 0;
    for (const [g, m] of parts) {
      nm.getNormalMatrix(m);
      const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m);
        pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z;
        v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
        nor[(vo + i) * 3] = v.x; nor[(vo + i) * 3 + 1] = v.y; nor[(vo + i) * 3 + 2] = v.z;
        uv[(vo + i) * 2] = u.getX(i); uv[(vo + i) * 2 + 1] = u.getY(i);
      }
      for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo;
      vo += p.count; io += g.index.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    return out;
  }
  // Street-tree trunk bark.
  const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x8a6540 });
  // Clear of roads and buildings (with a 1m margin): beach palms use it
  // too, so none lands inside a landmark box (lighthouse, ferris wheel).
  const roadClear = (x, z) => {
    for (let i = 0; i <= CITY_BLOCK_COLUMNS; i += 1) {
      if (Math.abs(x - roadCentreX(i)) < 8 && z >= NORTH_EDGE && z <= HALF_W) return false;
    }
    for (let j = 0; j <= CITY_BLOCK_ROWS; j += 1) {
      if (Math.abs(z - roadCentreZ(j)) < 8 && x >= -HALF_W && x <= HALF_W) return false;
    }
    for (const box of buildingBoxes) {
      if (x > box.minX - 1 && x < box.maxX + 1 && z > box.minZ - 1 && z < box.maxZ + 1) return false;
    }
    return true;
  };
  const trees = [];
  // Beach palms are the Vinish "Coconut Palm" GLB (CC BY 4.0): the loop
  // below only records spots, then one cached load clones the model per
  // palm — clones share the 6 materials, so ~500 palms cost one
  // download and one material set. Palms grow on the beach only, never
  // in the city.
  const palmSpots = [];
  const plantPalm = (x, z, scale) => {
    if (!roadClear(x, z)) return;
    palmSpots.push({ x, z, scale, rotY: rng() * Math.PI * 2 });
    trees.push({ x, z });
  };
  // Beach palms on all four shores: one row per side (12–18m spacing)
  // so the beach reads lined, not scattered, plus a sparse second row
  // (15%) for depth. The GLB is ~9.3m tall, so the scale range is
  // 0.8–1.0. Was 6–10m + 30% (~350 palms, ~2.4M triangles) — the user
  // said there are too many, so the row is roughly halved (~190 palms,
  // ~1.3M triangles); the beach still reads lined from street level.
  for (let s = -HALF_W + 8; s < HALF_W; s += intBetween(rng, 12, 18)) {
    plantPalm(s, CITY_EDGE + 6 + rng() * 6, 0.8 + rng() * 0.2);
    if (rng() < 0.15) plantPalm(s + 5, SHORELINE - 8 - rng() * 8, 0.8 + rng() * 0.2);
    plantPalm(s, -CITY_EDGE - 6 - rng() * 6, 0.8 + rng() * 0.2);
    if (rng() < 0.15) plantPalm(s + 5, -SHORELINE + 8 + rng() * 8, 0.8 + rng() * 0.2);
    plantPalm(CITY_EDGE + 6 + rng() * 6, s, 0.8 + rng() * 0.2);
    if (rng() < 0.15) plantPalm(SHORELINE - 8 - rng() * 8, s + 5, 0.8 + rng() * 0.2);
    plantPalm(-CITY_EDGE - 6 - rng() * 6, s, 0.8 + rng() * 0.2);
    if (rng() < 0.15) plantPalm(-SHORELINE + 8 + rng() * 8, s + 5, 0.8 + rng() * 0.2);
  }
  // One InstancedMesh per shore per palm part (6 parts x 4 shores = 24
  // draw calls for ~190 palms, instead of ~1,100): clones share the
  // materials but not the draw calls. Per-shore meshes keep frustum
  // culling useful — one island-wide instance cloud would draw every
  // palm from every angle.
  loadGLB('assets/models/coconut-palm.glb').then((g) => {
    g.scene.updateMatrixWorld(true);
    const parts = [];
    g.scene.traverse((o) => {
      if (o.isMesh) parts.push({ geo: o.geometry, mat: o.material, local: o.matrixWorld.clone() });
    });
    const shores = [[], [], [], []];
    for (const spot of palmSpots) {
      const side = Math.abs(spot.x) > Math.abs(spot.z) ? (spot.x > 0 ? 2 : 3) : (spot.z > 0 ? 1 : 0);
      shores[side].push(spot);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const spots of shores) {
      if (!spots.length) continue;
      for (const part of parts) {
        const inst = new THREE.InstancedMesh(part.geo, part.mat, spots.length);
        inst.name = 'glb-coconut-palm';
        inst.castShadow = true;
        spots.forEach((spot, i) => {
          q.setFromAxisAngle(up, spot.rotY);
          s.setScalar(spot.scale);
          t.set(spot.x, 0, spot.z);
          m.compose(t, q, s).multiply(part.local);
          inst.setMatrixAt(i, m);
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        group.add(inst);
      }
    }
  }).catch(() => {});
  // Street trees: small round-canopy trees along the city sidewalks —
  // palms grow on the beach and the coastal road only, never downtown.
  // Same roadside placement as the old street palms (never on a road
  // rect in either orientation, never inside a building).
  const streetTrunkGeo = new THREE.CylinderGeometry(0.14, 0.2, 1.8, 5);
  const streetCanopyGeo = new THREE.SphereGeometry(1.4, 8, 6);
  const streetCanopyGeo2 = new THREE.SphereGeometry(1.0, 8, 6);
  const streetLeafMat = new THREE.MeshLambertMaterial({ color: 0x3da86b });
  const streetTreeSpots = [];
  const plantStreetTree = (x, z, scale) => {
    if (!roadClear(x, z)) return;
    streetTreeSpots.push({ x, z, scale, rotY: rng() * Math.PI * 2 });
    trees.push({ x, z });
  };
  for (let i = 0; i < 70; i += 1) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const x = roadCentreX(intBetween(rng, 0, CITY_BLOCK_COLUMNS)) + (rng() < 0.5 ? -1 : 1) * (8 + rng() * 3);
      const z = NORTH_EDGE + rng() * (HALF_W - NORTH_EDGE);
      if (!roadClear(x, z)) continue;
      plantStreetTree(x, z, 0.8 + rng() * 0.4);
      break;
    }
  }
  // Instanced street trees: 3 draw calls for ~70 trees instead of ~210.
  // The per-tree offsets match the old Group children exactly.
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const off = new THREE.Matrix4();
    const buildTreePart = (geo, mat, ox, oy, oz) => {
      const inst = new THREE.InstancedMesh(geo, mat, streetTreeSpots.length);
      inst.name = 'street-tree';
      streetTreeSpots.forEach((spot, i) => {
        q.setFromAxisAngle(up, spot.rotY);
        s.setScalar(spot.scale);
        t.set(spot.x, 0, spot.z);
        off.makeTranslation(ox, oy, oz);
        m.compose(t, q, s).multiply(off);
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      group.add(inst);
    };
    buildTreePart(streetTrunkGeo, trunkMaterial, 0, 0.9, 0);
    buildTreePart(streetCanopyGeo, streetLeafMat, 0, 2.6, 0);
    buildTreePart(streetCanopyGeo2, streetLeafMat, 0.7, 3.2, 0.3);
  }
  // Streetlights: a pole + a curved arm reaching toward the intersection
  // + a lamp head at the arm's end, plus a glow sprite + ground pool.
  // 4 real SpotLights ride the nearest lamp heads around the player (the
  // only real lights besides the headlight).
  const polePositions = [];
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7, 5);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x70707c });
  const armGeo = new THREE.BoxGeometry(0.1, 0.1, 2.2);
  const lampGeo = new THREE.BoxGeometry(0.5, 0.16, 0.28);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0x555560 });
  const streetGlowMat = new THREE.SpriteMaterial({ map: glowTexture, color: 0xffe6b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const poolGeo = new THREE.CircleGeometry(4.5, 20);
  poolGeo.rotateX(-Math.PI / 2);
  const poolMat = new THREE.MeshBasicMaterial({ map: glowTexture, color: 0xffe6b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  // Instanced poles/arms/lamps/pools: 4 draw calls instead of ~200.
  // Glow sprites stay individual (sprites cannot instance). The lamp
  // head hangs at the arm's far end, over the road.
  const streetlightSpots = [];
  for (let i = 0; i <= CITY_BLOCK_COLUMNS; i += 2) {
    for (let j = 0; j <= CITY_BLOCK_ROWS; j += 2) {
      const px = roadCentreX(i) + 6.8, pz = roadCentreZ(j) + 6.8;
      const hx = px - 1.35, hz = pz - 1.35;
      streetlightSpots.push({ px, pz, hx, hz });
      polePositions.push({ x: hx, z: hz });
    }
  }
  for (const { hx, hz } of streetlightSpots) {
    const glow = new THREE.Sprite(streetGlowMat);
    glow.scale.set(7, 7, 1);
    glow.position.set(hx, 7, hz);
    group.add(glow);
  }
  {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), t = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const buildLightPart = (geo, mat, at) => {
      const inst = new THREE.InstancedMesh(geo, mat, streetlightSpots.length);
      inst.name = 'streetlight';
      streetlightSpots.forEach((spot, i) => {
        const [x, y, z, rotY] = at(spot);
        q.setFromAxisAngle(up, rotY);
        t.set(x, y, z);
        m.compose(t, q, s);
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      group.add(inst);
    };
    buildLightPart(poleGeo, poleMat, (p) => [p.px, 3.5, p.pz, 0]);
    buildLightPart(armGeo, poleMat, (p) => [p.px - 0.64, 7, p.pz - 0.64, Math.PI / 4]);
    buildLightPart(lampGeo, lampMat, (p) => [p.hx, 6.95, p.hz, 0]);
    buildLightPart(poolGeo, poolMat, (p) => [p.hx, 0.05, p.hz, 0]);
  }
  const streetSpots = [];
  for (let i = 0; i < 4; i++) {
    const s = new THREE.SpotLight(0xffe6b0, 0, 34, 0.8, 0.7);
    s.position.set(0, 8.5, 0);
    scene.add(s);
    scene.add(s.target);
    streetSpots.push(s);
  }
  let streetTimer = 0;
  // Per-slot streetlight state: the assigned pole index (-1 = none),
  // the pending pole while fading out, the fade multiplier (0 = dark),
  // and the phase (-1 fading out, 0 steady, 1 fading in). A light never
  // slides between poles: it fades out, teleports, and fades back in.
  const streetPoleIdx = [-1, -1, -1, -1];
  const streetPending = [-1, -1, -1, -1];
  const streetFade = [0, 0, 0, 0];
  const streetPhase = [0, 0, 0, 0];
  function nearestFreePole(pos, taken) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < polePositions.length; i++) {
      if (taken.has(i)) continue;
      const d = (polePositions[i].x - pos.x) ** 2 + (polePositions[i].z - pos.z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
  // Beach dressing: colourful umbrellas scattered on the south sand +
  // benches along the south shore, facing the sea. No collision — they
  // are small props on open sand, like the palms.
  const umbrellaPoleGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.2, 5);
  const umbrellaCanopyGeo = new THREE.ConeGeometry(1.6, 0.7, 8);
  const umbrellaMats = [0xff5aa8, 0x2ad0c4, 0xffc828, 0xff7a3d, 0x2a7ad0].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  for (let i = 0; i < 24; i += 1) {
    const x = -HALF_W + 20 + rng() * (HALF_W * 2 - 40);
    const z = CITY_EDGE + 10 + rng() * 20;
    if (Math.hypot(x - 150, z - 288) < 18) continue;
    if (Math.hypot(x - 120, z - 284) < 6) continue;
    if (x > 170 && x < 206 && z > 324 && z < 344) continue;
    const pole = new THREE.Mesh(umbrellaPoleGeo, poleMat);
    pole.position.set(x, 1.1, z);
    const canopy = new THREE.Mesh(umbrellaCanopyGeo, umbrellaMats[i % umbrellaMats.length]);
    canopy.position.set(x, 2.4, z);
    group.add(pole, canopy);
  }
  const benchSeatGeo = new THREE.BoxGeometry(1.8, 0.12, 0.5);
  const benchBackGeo = new THREE.BoxGeometry(1.8, 0.5, 0.1);
  const benchLegGeo = new THREE.BoxGeometry(0.12, 0.45, 0.45);
  const benchMat = new THREE.MeshLambertMaterial({ color: 0x8a6a4a });
  for (let i = 0; i < 10; i += 1) {
    const x = -HALF_W + 30 + (i * (HALF_W * 2 - 60)) / 9 + rng() * 4;
    const z = CITY_EDGE + 2;
    if (Math.hypot(x - 150, z - 288) < 16) continue;
    const seat = new THREE.Mesh(benchSeatGeo, benchMat);
    seat.position.set(x, 0.5, z);
    const back = new THREE.Mesh(benchBackGeo, benchMat);
    back.position.set(x, 0.85, z - 0.25);
    const legL = new THREE.Mesh(benchLegGeo, benchMat);
    legL.position.set(x - 0.7, 0.22, z);
    const legR = new THREE.Mesh(benchLegGeo, benchMat);
    legR.position.set(x + 0.7, 0.22, z);
    group.add(seat, back, legL, legR);
  }
  const billboardMaterial = new THREE.MeshBasicMaterial({ map: textures.billboard });
  const billboardBack = new THREE.MeshLambertMaterial({ color: 0x241a2a });
  for (const bx of [-52, 52]) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 0.4), [billboardBack, billboardBack, billboardBack, billboardBack, billboardMaterial, billboardBack]);
    board.position.set(bx, 10, 330);
    board.rotation.y = Math.PI;
    group.add(board);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7, 0.6), billboardBack);
    post.position.set(bx, 3.5, 330);
    group.add(post);
  }
  const sunLight = new THREE.DirectionalLight(0xfff2d0, 3.0);
  sunLight.position.set(-120, 70, 200);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  // A 200m shadow box that follows the player (updateSunFocus, below):
  // the old 760m box re-rendered the whole island into the shadow map
  // every frame, and the 300m box still covered most of downtown. 200m
  // keeps shadows where the player can see them; fog hides the edge.
  // The title orbit widens it back to 380 (full island).
  const SUN_DIR = new THREE.Vector3(-120, 70, 200).normalize();
  let sunHalf = 100;
  sunLight.shadow.camera.left = -100;
  sunLight.shadow.camera.right = 100;
  sunLight.shadow.camera.top = 100;
  sunLight.shadow.camera.bottom = -100;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 1000;
  sunLight.shadow.bias = -0.0002;
  sunLight.shadow.normalBias = 1;
  scene.add(sunLight);
  scene.add(sunLight.target);
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x9a8a76, 1.7);
  scene.add(hemi);
  // Freeze static matrices: the city group holds ~4000 objects whose
  // transforms never change. Skipping their per-frame matrix recompute
  // frees CPU for peds and traffic. Only the animated objects keep
  // auto-update: lighthouse beam pivot, ferris wheel, cabin pivots.
  // (Sun, spotlights, peds, cars live in the scene, not this group.)
  // Compute matrices FIRST, then freeze — freezing first leaves every
  // object with an identity matrix (all geometry at the origin).
  group.updateMatrixWorld(true);
  const animated = new Set([landmarkNight.beam, landmarkNight.wheel, ...(landmarkNight.cabinPivots || [])]);
  group.traverse((o) => { if (!animated.has(o)) o.matrixAutoUpdate = false; });
  scene.add(group);
  return {
    buildingBoxes,
    trees,
    sunLight,
    buildingMaterials,
    signMaterials,
    signs,
    waterDepthAt,
    shoreOutward,
    bounds: { minX: -WATER_FAR + 100, maxX: WATER_FAR - 100, minZ: -WATER_FAR + 100, maxZ: WATER_FAR - 100 },
    resolveCircle(position, radius) {
      resolveCircleAgainstBoxes(position, radius, buildingBoxes);
      position.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, position.x));
      position.z = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, position.z));
    },
    // The shadow camera follows (x, z) with a +/-half box: a 300m box
    // skips distant casters in the shadow pass and resolves ~2.5x
    // finer than the old 760m box at the same 2048 map. The focus snaps
    // to the shadow-texel grid so shadows do not shimmer while moving.
    updateSunFocus(x, z, half) {
      if (half !== sunHalf) {
        sunHalf = half;
        const c = sunLight.shadow.camera;
        c.left = -half;
        c.right = half;
        c.top = half;
        c.bottom = -half;
        c.updateProjectionMatrix();
      }
      const texel = (half * 2) / sunLight.shadow.mapSize.x;
      const fx = Math.round(x / texel) * texel;
      const fz = Math.round(z / texel) * texel;
      sunLight.target.position.set(fx, 0, fz);
      sunLight.target.updateMatrixWorld();
      sunLight.position.set(fx + SUN_DIR.x * 250, SUN_DIR.y * 250, fz + SUN_DIR.z * 250);
    },
    update(dt) {
      waterTexture.offset.x += dt * 0.008;
      waterTexture.offset.y += dt * 0.005;
      nightClock += dt;
      if (landmarkNight.beam) {
        landmarkNight.beam.rotation.y += dt * 0.8;
        landmarkNight.beamMat.opacity = nightF * 0.35;
      }
      if (landmarkNight.wheel) {
        landmarkNight.wheel.rotation.z += dt * 0.08;
        landmarkNight.hubMat.opacity = nightF * 0.6;
        // Cabins hang from their own pivots: counter-rotate each one so
        // it stays upright while the wheel turns under it.
        if (landmarkNight.cabinPivots) {
          for (const p of landmarkNight.cabinPivots) p.rotation.z = -landmarkNight.wheel.rotation.z;
        }
      }
    },
    // The 4 real street SpotLights sit on the nearest poles to the player
    // (re-picked twice a second). A slot keeps its pole until the pole is
    // far (>40m) and another pole is clearly nearer (>10m), so a player
    // hovering between two poles does not flip the light back and forth.
    updateStreetlights(dt, pos, f) {
      streetTimer -= dt;
      if (streetTimer <= 0) {
        streetTimer = 0.5;
        const taken = new Set(streetPoleIdx.filter((i) => i >= 0));
        for (let i = 0; i < 4; i++) if (streetPhase[i] < 0 && streetPending[i] >= 0) taken.add(streetPending[i]);
        for (let i = 0; i < 4; i++) {
          const cur = streetPoleIdx[i];
          if (cur < 0) {
            const next = nearestFreePole(pos, taken);
            if (next >= 0) {
              streetPoleIdx[i] = next;
              taken.add(next);
              const p = polePositions[next];
              streetSpots[i].position.set(p.x, 8.5, p.z);
              streetSpots[i].target.position.set(p.x, 0, p.z);
              streetPhase[i] = 1;
            }
            continue;
          }
          const curDist = Math.hypot(polePositions[cur].x - pos.x, polePositions[cur].z - pos.z);
          if (curDist <= 40) continue;
          const next = nearestFreePole(pos, taken);
          if (next < 0) continue;
          const nextDist = Math.hypot(polePositions[next].x - pos.x, polePositions[next].z - pos.z);
          if (nextDist > curDist - 10) continue;
          if (streetPhase[i] < 0 && streetPending[i] >= 0) taken.delete(streetPending[i]);
          taken.delete(cur);
          taken.add(next);
          streetPending[i] = next;
          streetPhase[i] = -1;
        }
      }
      for (let i = 0; i < 4; i++) {
        const s = streetSpots[i];
        if (streetPhase[i] < 0) {
          streetFade[i] = Math.max(0, streetFade[i] - dt / 0.2);
          if (streetFade[i] === 0) {
            const next = streetPending[i];
            streetPoleIdx[i] = next;
            const p = polePositions[next];
            s.position.set(p.x, 8.5, p.z);
            s.target.position.set(p.x, 0, p.z);
            streetPhase[i] = 1;
          }
        } else if (streetPhase[i] > 0) {
          streetFade[i] = Math.min(1, streetFade[i] + dt / 0.2);
          if (streetFade[i] === 1) streetPhase[i] = 0;
        }
        s.intensity = f * 900 * streetFade[i];
        s.visible = f > 0.02 && streetFade[i] > 0;
      }
    },
    setNight(f) {
      nightF = f;
      sunLight.intensity = 3.0 - 2.85 * f;
      if (f < 0.5) {
        sunLight.color.lerpColors(daySunCol, sunsetSunCol, f * 2);
        scene.fog.color.lerpColors(dayFogCol, sunsetFogCol, f * 2);
      } else {
        sunLight.color.lerpColors(sunsetSunCol, nightSunCol, (f - 0.5) * 2);
        scene.fog.color.lerpColors(sunsetFogCol, nightFogCol, (f - 0.5) * 2);
      }
      sun.material.color.lerpColors(daySunDiscCol, sunsetDiscCol, Math.min(1, f * 2));
      hemi.intensity = 1.7 - 1.35 * f;
      sun.visible = f < 0.5;
      moon.visible = f > 0.5;
      scene.background = f > 0.5 ? nightSky : skyTex;
      // Windows glow as night falls (0 by day — daytime is unchanged).
      for (const material of buildingMaterials) material.emissiveIntensity = f * 1.7;
      // Neon signs: halo always on at night, face blinks gently and slowly,
      // each sign out of phase.
      for (const s of signMaterials) s.mat.emissiveIntensity = f * 1.8 * (0.72 + 0.28 * Math.sin(nightClock * 0.7 + s.phase));
      haloMaterial.opacity = f * 0.4;
      streetGlowMat.opacity = f * 0.5;
      poolMat.opacity = f * 0.3;
      lampMat.color.setHex(f > 0.5 ? 0xfff2cc : 0x555560);
    },
  };
}
